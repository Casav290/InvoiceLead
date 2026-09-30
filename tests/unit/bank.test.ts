import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { parseCamt } from "@/countries/ch/camt";
import { createFirstFiscalYear, installChart } from "@/server/accounting";
import { attachLeadIdentity } from "@/server/auth/attach";
import { importEntries, proposeAll, validateConfident, validateTransaction } from "@/server/bank";
import { createContact, parseContactForm } from "@/server/contacts";
import {
  accounts,
  bankTransactions,
  journalEntries,
  journalLines,
  organizations,
} from "@/server/db/schema";
import { createInvoice, issueInvoice, parseInvoiceForm } from "@/server/invoices";
import { verifyChain } from "@/server/ledger";
import { invoiceBalance } from "@/server/payments";
import { camt053 } from "../support/camt";
import { claims } from "../support/claims";
import { testDb } from "../support/db";

const t = testDb();
const db = t.database;
beforeAll(() => {
  Object.assign(process.env, {
    DATABASE_URL: process.env.TEST_DATABASE_URL,
    APP_URL: "https://invoicelead.io",
    SESSION_SECRET: "unit-secret-unit-secret-unit-secret-unit",
    LEAD_ID_ISSUER: "https://crmlead.io",
    LEAD_ID_CLIENT_ID: "invoicelead",
    LEAD_ID_CLIENT_SECRET: "x",
    LEAD_ID_REDIRECT_URI: "https://invoicelead.io/auth/lead/callback",
    LEAD_ID_APP: "invoicelead",
    AI_API_KEY: "test",
    AI_BASE_URL: "https://ai.test/v4",
  });
});
beforeEach(() => t.reset());
afterEach(() => vi.unstubAllGlobals());
afterAll(() => t.close());

describe("relevé camt.053", () => {
  it("lit montants signés, références, contreparties et écritures groupées", () => {
    const s = parseCamt(
      camt053(
        "CH9300762011623852957",
        [
          {
            id: "A1",
            date: "2026-03-10",
            amount: "448.62",
            credit: true,
            party: "Kunde AG",
            reference: "RF18 5390 0754 7034",
          },
          {
            id: "A2",
            date: "2026-03-11",
            amount: "107.70",
            credit: false,
            party: "Swisscom",
            text: "Rechnung März",
          },
        ],
        [
          {
            id: "B1",
            date: "2026-03-12",
            amount: "10.00",
            credit: true,
            party: "Eins",
            reference: "RF1",
          },
          {
            id: "B2",
            date: "2026-03-12",
            amount: "20.50",
            credit: true,
            party: "Zwei",
            reference: "RF2",
          },
        ],
      ),
    );
    expect(s.iban).toBe("CH9300762011623852957");
    expect(
      s.entries.map((e) => [e.bookingDate, e.amountCents, e.counterparty, e.reference]),
    ).toEqual([
      ["2026-03-10", 44_862, "Kunde AG", "RF18539007547034"],
      ["2026-03-11", -10_770, "Swisscom", null],
      ["2026-03-12", 1000, "Eins", "RF1"],
      ["2026-03-12", 2050, "Zwei", "RF2"],
    ]);
    expect(s.entries[1]?.text).toBe("Rechnung März");
    expect(new Set(s.entries.map((e) => e.externalId)).size).toBe(4);
    expect(() => parseCamt("<Document/>")).toThrow();
  });
});

function form(values: Record<string, string | string[]>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(values))
    for (const x of Array.isArray(v) ? v : [v]) f.append(k, x);
  return f;
}

describe("propositions et validation", () => {
  it("rapproche par la référence, propose par l'IA, puis comptabilise TVA comprise après validation", async () => {
    const a = await attachLeadIdentity(db, claims());
    const who = { organizationId: a.organization.id, userId: a.user.id };
    await db
      .update(organizations)
      .set({
        vatRegistered: true,
        vatMethod: "effective",
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
        name: "Kunde AG",
        language: "de",
        country: "CH",
        paymentTermDays: "30",
      }),
    );
    if (!c.ok) throw new Error("contact");
    const contact = await createContact(db, who, c.data);
    const r = parseInvoiceForm(
      form({
        contactId: contact.id,
        language: "de",
        issueDate: "2026-03-01",
        "line.description": ["Beratung"],
        "line.quantity": ["1"],
        "line.unit": ["flat"],
        "line.unitPrice": ["415"],
        "line.vatCode": ["normal"],
        "line.productId": [""],
      }),
      { vatRegistered: true },
    );
    if (!r.ok) throw new Error("facture");
    const draft = await createInvoice(db, who, r.data);
    if (typeof draft !== "object" || !draft) throw new Error("brouillon");
    const invoice = await issueInvoice(db, who, draft.id);
    if (typeof invoice !== "object") throw new Error(invoice);

    const xml = camt053("CH9300762011623852957", [
      {
        id: "A1",
        date: "2026-03-10",
        amount: "448.62",
        credit: true,
        party: "Kunde AG",
        reference: invoice.paymentReference ?? "",
      },
      {
        id: "A2",
        date: "2026-03-11",
        amount: "107.70",
        credit: false,
        party: "Swisscom",
        text: "Abo Internet",
      },
      {
        id: "A3",
        date: "2026-03-12",
        amount: "250.00",
        credit: false,
        party: "Unbekannt",
        text: "Twint",
      },
    ]);
    const { entries } = parseCamt(xml);
    expect(await importEntries(db, who, entries)).toEqual({ imported: 3, duplicates: 0 });
    expect(await importEntries(db, who, entries)).toEqual({ imported: 0, duplicates: 3 });

    // Faux modèle : il reçoit les deux mouvements non rapprochés et répond pour chacun.
    const fetchMock = vi.fn(async (_url: string, init: { body: string }) => {
      const body = JSON.parse(init.body);
      const payload = JSON.parse(body.messages[1].content);
      expect(payload.transactions).toHaveLength(2);
      expect(payload.chart.some((x: { number: string }) => x.number === "1020")).toBe(false);
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: `\`\`\`json\n${JSON.stringify({
                  results: [
                    {
                      id: "t1",
                      account: "6510",
                      vat: "normal",
                      confidence: 0.96,
                      explanation: "Abonnement internet.",
                    },
                    { id: "t2", account: "9999", vat: null, confidence: 0.3, explanation: "?" },
                  ],
                })}\n\`\`\``,
              },
            },
          ],
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    expect(await proposeAll(db, who, { language: "fr", useAi: true })).toEqual({
      proposed: 2,
      aiError: false,
    });
    expect(fetchMock).toHaveBeenCalledOnce();

    const rows = await db.select().from(bankTransactions).orderBy(bankTransactions.bookingDate);
    expect(rows.map((x) => [x.status, x.proposal?.kind, x.proposal?.confidence])).toEqual([
      ["proposed", "invoice", 1],
      ["proposed", "account", 0.96],
      ["new", undefined, undefined],
    ]);

    expect(await validateConfident(db, who)).toBe(2);
    expect((await invoiceBalance(db, invoice.id, invoice.totalCents)).openCents).toBe(0);
    const swisscom = rows[1];
    const [bankEntry] = await db
      .select()
      .from(journalEntries)
      .where(
        eq(
          journalEntries.id,
          (
            await db
              .select()
              .from(bankTransactions)
              .where(eq(bankTransactions.id, swisscom?.id ?? ""))
          )[0]?.journalEntryId ?? "",
        ),
      );
    const lines = await db
      .select({
        n: accounts.number,
        d: journalLines.debitCents,
        c: journalLines.creditCents,
        base: journalLines.vatBaseCents,
      })
      .from(journalLines)
      .innerJoin(accounts, eq(accounts.id, journalLines.accountId))
      .where(eq(journalLines.entryId, bankEntry?.id ?? ""))
      .orderBy(journalLines.position);
    // 107.70 TTC à 8.1 % : TVA 8.07, net 99.63
    expect(lines).toEqual([
      { n: "1020", d: 0, c: 10_770, base: null },
      { n: "6510", d: 9963, c: 0, base: null },
      { n: "1171", d: 807, c: 0, base: 9963 },
    ]);

    // Le mouvement sans proposition se valide avec le compte choisi par l'humain.
    const [account] = await db.select().from(accounts).where(eq(accounts.number, "2210"));
    expect(await validateTransaction(db, who, rows[2]?.id ?? "")).toBe("noProposal");
    expect(
      await validateTransaction(db, who, rows[2]?.id ?? "", {
        accountId: account?.id ?? "",
        vatCode: null,
      }),
    ).toBe("posted");
    expect(await validateTransaction(db, who, rows[2]?.id ?? "")).toBe("notFound");
    expect(await verifyChain(db, who.organizationId)).toMatchObject({ ok: true, count: 4 });
  });
});
