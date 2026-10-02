import { and, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { convertDocument, formatFxRate, parseFxRate, paymentFx, toHome } from "@/lib/currencies";
import { createFirstFiscalYear, installChart } from "@/server/accounting";
import { attachLeadIdentity } from "@/server/auth/attach";
import { createContact, parseContactForm } from "@/server/contacts";
import {
  accounts,
  invoicePayments,
  invoices,
  journalEntries,
  journalLines,
  organizations,
} from "@/server/db/schema";
import { fetchFxRate } from "@/server/fx";
import { createCreditNote, createInvoice, issueInvoice, parseInvoiceForm } from "@/server/invoices";
import { postPending } from "@/server/ledger";
import { addPayment, parsePaymentForm } from "@/server/payments";
import { claims } from "../support/claims";
import { testDb } from "../support/db";
import { setTestEnv } from "../support/env";

const t = testDb();
setTestEnv({});
const db = t.database;
beforeEach(() => t.reset());
afterAll(() => t.close());

function form(values: Record<string, string | string[]>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(values))
    for (const x of Array.isArray(v) ? v : [v]) f.append(k, x);
  return f;
}

/** Faux service de cours : un cours fixe, ou une panne. */
const rateOf = (rate: number | null) =>
  (async () =>
    rate === null
      ? new Response("down", { status: 503 })
      : Response.json({ rates: { CHF: rate } })) as unknown as typeof fetch;

describe("conversion", () => {
  it("lit, affiche et applique un cours", () => {
    expect(parseFxRate("0,9412")).toBe(0.9412);
    expect(parseFxRate("1.1")).toBe(1.1);
    expect(parseFxRate("0")).toBeNull();
    expect(parseFxRate("-1")).toBeNull();
    expect(parseFxRate("abc")).toBeNull();
    expect(formatFxRate(0.94)).toBe("0.9400");
    expect(formatFxRate(1.123456)).toBe("1.123456");
    expect(toHome(108_100, 0.94)).toBe(101_614);
    expect(toHome(500, null)).toBe(500);
  });

  it("convertit une pièce sans perdre de centime : l'écart d'arrondi va au chiffre d'affaires", () => {
    const r = convertDocument(
      [
        { netCents: 33_333, vatCents: 2_700 },
        { netCents: 10_001, vatCents: 260 },
      ],
      46_294,
      0.9417,
    );
    expect(r.receivableCents).toBe(Math.round(46_294 * 0.9417));
    expect(r.groups[0]?.vatCents).toBe(Math.round(2_700 * 0.9417));
    expect(r.groups[1]?.vatCents).toBe(Math.round(260 * 0.9417));
    const sum = r.groups.reduce((s, g) => s + g.netCents + g.vatCents, 0);
    expect(sum).toBe(r.receivableCents);
  });

  it("calcule la différence de change d'un paiement, et solde exactement au dernier", () => {
    expect(
      paymentFx({
        amountCents: 10_000,
        paymentRate: 0.95,
        invoiceRate: 0.94,
        settles: false,
        remainingReceivableCents: 0,
      }),
    ).toEqual({ moneyCents: 9_500, receivableCents: 9_400, differenceCents: 100 });
    expect(
      paymentFx({
        amountCents: 10_000,
        paymentRate: null,
        invoiceRate: 0.94,
        settles: true,
        remainingReceivableCents: 9_401,
      }),
    ).toEqual({ moneyCents: 9_400, receivableCents: 9_401, differenceCents: -1 });
  });

  it("demande le cours BCE au service et rend null en cas de panne", async () => {
    let asked = "";
    const fetcher = (async (url: string) => {
      asked = url;
      return Response.json({ amount: 1, base: "EUR", rates: { CHF: 0.9412 } });
    }) as unknown as typeof fetch;
    expect(await fetchFxRate("EUR", "CHF", "2026-03-02", fetcher)).toBe(0.9412);
    expect(asked).toMatch(/\/2026-03-02\?base=EUR&symbols=CHF$/);
    expect(await fetchFxRate("EUR", "CHF", "2026-03-02", rateOf(null))).toBeNull();
    expect(await fetchFxRate("CHF", "CHF", "2026-03-02", rateOf(null))).toBe(1);
  });
});

/** Facture en EUR d'une entreprise suisse en formule Pro (la multidevise en fait partie). */
async function euroInvoice(extra: Record<string, string> = {}) {
  const a = await attachLeadIdentity(db, claims());
  const who = { organizationId: a.organization.id, userId: a.user.id };
  await db
    .update(organizations)
    .set({
      entitlements: { plan: { rank: 1 } },
      vatRegistered: true,
      vatMethod: "effective",
      vatSettlement: "agreed",
      uid: "CHE116281710",
      legalName: "Atelier Muster GmbH",
      street: "Bahnhofstrasse",
      postalCode: "8001",
      town: "Zürich",
      iban: "CH9300762011623852957",
      settingsCompletedAt: new Date(),
    })
    .where(eq(organizations.id, a.organization.id));
  await installChart(db, who, "corporation");
  await createFirstFiscalYear(db, who, { start: "2026-01-01", extended: false });
  const c = parseContactForm(
    form({
      kind: "company",
      isCustomer: "on",
      name: "Kunde GmbH",
      language: "de",
      country: "DE",
      street: "Unter den Linden",
      postalCode: "10115",
      town: "Berlin",
      paymentTermDays: "30",
    }),
  );
  if (!c.ok) throw new Error(JSON.stringify(c.errors));
  const contact = await createContact(db, who, c.data);
  const r = parseInvoiceForm(
    form({
      contactId: contact.id,
      language: "de",
      issueDate: "2026-03-02",
      currency: "EUR",
      "line.description": ["Beratung"],
      "line.quantity": ["1"],
      "line.unit": ["flat"],
      "line.unitPrice": ["1000"],
      "line.vatCode": ["normal"],
      "line.productId": [""],
      ...extra,
    }),
    { vatRegistered: true, country: "CH" },
  );
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  const draft = await createInvoice(db, who, r.data);
  if (typeof draft !== "object" || !draft) throw new Error("brouillon");
  return { who, draft };
}

async function linesOf(organizationId: string, sourceId: string) {
  return db
    .select({
      number: accounts.number,
      debit: journalLines.debitCents,
      credit: journalLines.creditCents,
    })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
    .innerJoin(accounts, eq(accounts.id, journalLines.accountId))
    .where(
      and(eq(journalEntries.organizationId, organizationId), eq(journalEntries.sourceId, sourceId)),
    );
}

const net = (rows: { debit: number; credit: number }[]) =>
  rows.reduce((s, r) => s + r.debit - r.credit, 0);

describe("facture en devise", () => {
  it("fige le cours BCE à l'émission et comptabilise en francs", async () => {
    const { who, draft } = await euroInvoice();
    expect(draft.currency).toBe("EUR");
    expect(draft.fxRate).toBeNull();
    const issued = await issueInvoice(db, who, draft.id, rateOf(0.94));
    if (typeof issued !== "object") throw new Error(String(issued));
    expect(issued.fxRate).toBe(0.94);
    expect(issued.totalCents).toBe(108_100);

    await postPending(db, who);
    const rows = await linesOf(who.organizationId, draft.id);
    const by = (n: string) => net(rows.filter((r) => r.number === n));
    expect(by("1100")).toBe(101_614);
    expect(by("3400")).toBe(-94_000);
    expect(by("2200")).toBe(-7_614);
  });

  it("n'émet pas sans cours, et garde un cours saisi", async () => {
    const { who, draft } = await euroInvoice();
    expect(await issueInvoice(db, who, draft.id, rateOf(null))).toBe("fxRate");
    const [still] = await db.select().from(invoices).where(eq(invoices.id, draft.id));
    expect(still?.status).toBe("draft");

    const manual = await euroInvoice({ fxRate: "0,93" });
    const issued = await issueInvoice(db, manual.who, manual.draft.id, rateOf(null));
    if (typeof issued !== "object") throw new Error(String(issued));
    expect(issued.fxRate).toBe(0.93);
  });

  it("comptabilise la différence de change au paiement et solde la créance au centime", async () => {
    const { who, draft } = await euroInvoice();
    await issueInvoice(db, who, draft.id, rateOf(0.94));
    await postPending(db, who);

    // Premier acompte au cours saisi, solde au cours BCE du jour.
    const p1 = parsePaymentForm(
      form({ paidOn: "2026-03-20", amount: "333.33", method: "bank", fxRate: "0.9517" }),
    );
    if (!p1.ok) throw new Error("paiement");
    const first = await addPayment(db, who, draft.id, p1.data);
    if (typeof first !== "object") throw new Error(String(first));
    expect(first.fxRate).toBe(0.9517);
    const second = await addPayment(
      db,
      who,
      draft.id,
      { paidOn: "2026-04-02", amountCents: 74_767, method: "bank", note: null },
      rateOf(0.9601),
    );
    if (typeof second !== "object") throw new Error(String(second));
    expect(second.fxRate).toBe(0.9601);
    await postPending(db, who);

    const receivable = [
      ...(await linesOf(who.organizationId, draft.id)),
      ...(await linesOf(who.organizationId, first.id)),
      ...(await linesOf(who.organizationId, second.id)),
    ].filter((r) => r.number === "1100");
    expect(net(receivable)).toBe(0);

    const bank = (await linesOf(who.organizationId, second.id)).filter((r) => r.number === "1020");
    expect(net(bank)).toBe(Math.round(74_767 * 0.9601));
    const paid = await db
      .select()
      .from(invoicePayments)
      .where(eq(invoicePayments.invoiceId, draft.id));
    expect(paid.every((p) => p.journalEntryId && p.receivableHomeCents)).toBe(true);
    // Différence totale : argent reçu moins créance convertie.
    const all = [
      ...(await linesOf(who.organizationId, first.id)),
      ...(await linesOf(who.organizationId, second.id)),
    ];
    const fx = net(all.filter((r) => r.number === "6960"));
    expect(fx).toBe(101_614 - Math.round(33_333 * 0.9517) - Math.round(74_767 * 0.9601));
  });

  it("garde la devise et le cours de la facture sur l'avoir", async () => {
    const { who, draft } = await euroInvoice();
    await issueInvoice(db, who, draft.id, rateOf(0.94));
    const note = await createCreditNote(db, who, draft.id, "2026-03-10");
    if (typeof note !== "object") throw new Error(String(note));
    expect(note.currency).toBe("EUR");
    expect(note.fxRate).toBe(0.94);
    const issued = await issueInvoice(db, who, note.id, rateOf(0.99));
    if (typeof issued !== "object") throw new Error(String(issued));
    expect(issued.fxRate).toBe(0.94);
    await postPending(db, who);
    const rows = await linesOf(who.organizationId, note.id);
    expect(net(rows.filter((r) => r.number === "1100"))).toBe(-101_614);
  });

  it("refuse une devise inconnue et un cours invalide", () => {
    const r = parseInvoiceForm(
      form({
        contactId: "00000000-0000-4000-8000-000000000000",
        language: "de",
        issueDate: "2026-03-02",
        currency: "JPY",
        fxRate: "x",
        "line.description": ["Beratung"],
        "line.quantity": ["1"],
        "line.unit": ["flat"],
        "line.unitPrice": ["1000"],
        "line.productId": [""],
      }),
      { vatRegistered: false, country: "CH" },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.currency).toBe("required");
  });
});
