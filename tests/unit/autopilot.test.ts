import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { parseCamt } from "@/countries/ch/camt";
import { createFirstFiscalYear, installChart } from "@/server/accounting";
import { attachLeadIdentity } from "@/server/auth/attach";
import {
  approveReview,
  autopilotSummary,
  autoSafe,
  findAnomalies,
  reviewQueue,
  runAutopilot,
  undoAutoPosting,
} from "@/server/autopilot";
import { importEntries, proposeAll } from "@/server/bank";
import { counterpartyKey } from "@/server/booking-rules";
import { createContact, parseContactForm } from "@/server/contacts";
import {
  accounts,
  bankTransactions,
  bookingRules,
  journalLines,
  organizations,
} from "@/server/db/schema";
import { createInvoice, issueInvoice, parseInvoiceForm } from "@/server/invoices";
import { verifyChain } from "@/server/ledger";
import { invoiceBalance } from "@/server/payments";
import { camt053 } from "../support/camt";
import { claims } from "../support/claims";
import { testDb } from "../support/db";
import { setTestEnv } from "../support/env";

const t = testDb();
const db = t.database;
beforeAll(() => setTestEnv());
beforeEach(() => t.reset());
afterAll(() => t.close());

function form(values: Record<string, string | string[]>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(values))
    for (const x of Array.isArray(v) ? v : [v]) f.append(k, x);
  return f;
}

describe("seuils du pilote automatique", () => {
  it("ne passe seul que la référence, la règle trois fois confirmée et l'IA quasi certaine", () => {
    const base = { kind: "account" as const, accountId: "x", vatCode: null, explanation: "" };
    expect(
      autoSafe({
        kind: "invoice",
        invoiceId: "x",
        explanation: "",
        source: "reference",
        confidence: 1,
      }),
    ).toBe(true);
    expect(autoSafe({ ...base, source: "rule", confidence: 0.88 + 0.03 * 3 })).toBe(true);
    expect(autoSafe({ ...base, source: "rule", confidence: 0.88 + 0.03 * 2 })).toBe(false);
    expect(autoSafe({ ...base, source: "ai", confidence: 0.97 })).toBe(true);
    expect(autoSafe({ ...base, source: "ai", confidence: 0.95 })).toBe(false);
    expect(autoSafe(null)).toBe(false);
  });
});

async function setup(autopilot: boolean, rank = 1) {
  const a = await attachLeadIdentity(db, claims());
  const who = { organizationId: a.organization.id, userId: a.user.id };
  await db
    .update(organizations)
    .set({
      autopilot,
      leadPlan: rank === 0 ? "free" : "pro",
      entitlements: { plan: { rank } },
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
    form({ kind: "company", isCustomer: "on", name: "Kunde AG", language: "de", country: "CH" }),
  );
  if (!c.ok) throw new Error("contact");
  const contact = await createContact(db, who, c.data);
  const r = parseInvoiceForm(
    form({
      contactId: contact.id,
      language: "de",
      issueDate: "2026-03-01",
      "line.description": ["Beratung"],
      "line.unit": ["flat"],
      "line.quantity": ["1"],
      "line.unitPrice": ["500"],
      "line.productId": [""],
    }),
    { vatRegistered: false },
  );
  if (!r.ok) throw new Error("facture");
  const draft = await createInvoice(db, who, r.data);
  if (typeof draft !== "object" || !draft) throw new Error("brouillon");
  const invoice = await issueInvoice(db, who, draft.id);
  if (typeof invoice !== "object") throw new Error(invoice);
  // Swisscom sur 6510, déjà confirmé trois fois ; « Garage » une seule fois.
  const [phone] = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.organizationId, who.organizationId), eq(accounts.number, "6510")));
  if (!phone) throw new Error("compte");
  await db.insert(bookingRules).values([
    {
      organizationId: who.organizationId,
      counterpartyKey: counterpartyKey("Swisscom") ?? "",
      counterpartyLabel: "Swisscom",
      direction: "out",
      accountId: phone.id,
      hits: 3,
    },
    {
      organizationId: who.organizationId,
      counterpartyKey: counterpartyKey("Garage Muster") ?? "",
      counterpartyLabel: "Garage Muster",
      direction: "out",
      accountId: phone.id,
      hits: 1,
    },
  ]);
  const { entries } = parseCamt(
    camt053("CH9300762011623852957", [
      {
        id: "P1",
        date: "2026-03-10",
        amount: "500.00",
        credit: true,
        party: "Kunde AG",
        reference: invoice.paymentReference ?? "",
      },
      { id: "P2", date: "2026-03-11", amount: "107.70", credit: false, party: "Swisscom" },
      { id: "P3", date: "2026-03-12", amount: "80.00", credit: false, party: "Garage Muster" },
    ]),
  );
  await importEntries(db, who, entries);
  await proposeAll(db, who, { language: "de", useAi: false });
  return { who, invoice, phone };
}

describe("pilote automatique", () => {
  it("ne fait rien tant qu'il n'est pas activé", async () => {
    const { who } = await setup(false);
    expect(await runAutopilot(db, who)).toBe(0);
  });

  it("travaille aussi en formule gratuite, sur les lignes du relevé importé", async () => {
    const { who } = await setup(true, 0);
    expect(await runAutopilot(db, who)).toBe(2);
  });

  it("comptabilise le sûr, laisse le reste, se fait approuver ou annuler", async () => {
    const { who, invoice, phone } = await setup(true);
    expect(await runAutopilot(db, who)).toBe(2);

    const rows = await db
      .select()
      .from(bankTransactions)
      .where(eq(bankTransactions.organizationId, who.organizationId));
    const by = (party: string) => rows.find((r) => r.counterparty === party);
    expect(by("Kunde AG")).toMatchObject({ status: "posted", autoPosted: true });
    expect(by("Swisscom")).toMatchObject({ status: "posted", autoPosted: true });
    expect(by("Garage Muster")).toMatchObject({ status: "proposed", autoPosted: false });
    expect((await invoiceBalance(db, invoice.id, invoice.totalCents)).openCents).toBe(0);
    // Le pilote ne renforce pas lui-même la règle qui l'a guidé.
    const [rule] = await db
      .select()
      .from(bookingRules)
      .where(eq(bookingRules.counterpartyLabel, "Swisscom"));
    expect(rule?.hits).toBe(3);

    expect(await reviewQueue(db, who.organizationId)).toHaveLength(2);
    expect((await autopilotSummary(db, who.organizationId, "2026-03-20")).toApprove).toBe(2);

    // Swisscom n'allait pas sur ce compte : extourne, mouvement à relire, règle oubliée.
    const swisscom = by("Swisscom");
    if (!swisscom) throw new Error("mouvement");
    expect(await undoAutoPosting(db, who, swisscom.id, "2026-03-20")).toBe("undone");
    const [back] = await db
      .select()
      .from(bankTransactions)
      .where(eq(bankTransactions.id, swisscom.id));
    expect(back).toMatchObject({ status: "proposed", autoPosted: false, journalEntryId: null });
    const phoneLines = await db
      .select()
      .from(journalLines)
      .where(eq(journalLines.accountId, phone.id));
    expect(phoneLines.reduce((s, l) => s + l.debitCents - l.creditCents, 0)).toBe(0);
    expect(
      await db.select().from(bookingRules).where(eq(bookingRules.counterpartyLabel, "Swisscom")),
    ).toHaveLength(0);
    expect((await verifyChain(db, who.organizationId)).ok).toBe(true);

    expect(await approveReview(db, who)).toBe(1);
    expect(await reviewQueue(db, who.organizationId)).toHaveLength(0);
  });
});

describe("anomalies", () => {
  it("relève doublons, justificatifs manquants et montants inhabituels", async () => {
    const a = await attachLeadIdentity(db, claims());
    const who = { organizationId: a.organization.id, userId: a.user.id };
    await installChart(db, who, "corporation");
    await createFirstFiscalYear(db, who, { start: "2026-01-01", extended: false });
    const tx = (id: string, date: string, amount: string, party: string) => ({
      id,
      date,
      amount,
      credit: false,
      party,
    });
    const { entries } = parseCamt(
      camt053("CH9300762011623852957", [
        tx("D1", "2026-03-02", "120.00", "Druckerei Muster"),
        tx("D2", "2026-03-04", "120.00", "Druckerei Muster"),
        tx("U1", "2026-01-05", "100.00", "Strom AG"),
        tx("U2", "2026-02-05", "110.00", "Strom AG"),
        tx("U3", "2026-03-05", "105.00", "Strom AG"),
        tx("U4", "2026-04-05", "900.00", "Strom AG"),
      ]),
    );
    await importEntries(db, who, entries);
    const found = await findAnomalies(db, who.organizationId, "2026-04-20");
    const kinds = found.map((f) => `${f.kind}:${f.amountCents}`).sort();
    expect(kinds).toContain("duplicate:-12000");
    expect(kinds).toContain("unusualAmount:-90000");
    expect(kinds.filter((k) => k.startsWith("duplicate"))).toHaveLength(1);

    // Dépense comptabilisée il y a plus d'une semaine sans justificatif.
    const [office] = await db
      .select()
      .from(accounts)
      .where(and(eq(accounts.organizationId, who.organizationId), eq(accounts.number, "6500")));
    const { validateTransaction } = await import("@/server/bank");
    const [first] = await db
      .select()
      .from(bankTransactions)
      .where(eq(bankTransactions.counterparty, "Strom AG"))
      .orderBy(bankTransactions.bookingDate);
    if (!first || !office) throw new Error("données");
    expect(
      await validateTransaction(db, who, first.id, { accountId: office.id, vatCode: null }),
    ).toBe("posted");
    const after = await findAnomalies(db, who.organizationId, "2026-04-20");
    expect(after.some((f) => f.kind === "missingReceipt" && f.transactionId === first.id)).toBe(
      true,
    );
  });
});
