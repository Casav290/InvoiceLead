import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createFirstFiscalYear, installChart } from "@/server/accounting";
import { attachLeadIdentity } from "@/server/auth/attach";
import { createContact, parseContactForm } from "@/server/contacts";
import { accounts, journalEntries, journalLines, organizations } from "@/server/db/schema";
import {
  createCreditNote,
  createInvoice,
  issueInvoice,
  parseInvoiceForm,
  updateInvoice,
} from "@/server/invoices";
import { countUnposted, postPending, verifyChain } from "@/server/ledger";
import { addPayment, deletePayment } from "@/server/payments";
import { claims } from "../support/claims";
import { testDb } from "../support/db";

const t = testDb();
const db = t.database;
beforeEach(() => t.reset());
afterAll(() => t.close());

function form(values: Record<string, string | string[]>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(values))
    for (const x of Array.isArray(v) ? v : [v]) f.append(k, x);
  return f;
}

async function setup() {
  const a = await attachLeadIdentity(db, claims());
  const who = { organizationId: a.organization.id, userId: a.user.id };
  await db
    .update(organizations)
    .set({
      vatRegistered: true,
      uid: "CHE116281710",
      legalName: "Atelier Muster GmbH",
      street: "Bahnhofstrasse",
      postalCode: "8001",
      town: "Zürich",
      iban: "CH9300762011623852957",
      settingsCompletedAt: new Date(),
    })
    .where(eq(organizations.id, a.organization.id));
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
      "line.description": ["Beratung", "Buch"],
      "line.quantity": ["2", "1"],
      "line.unit": ["hour", "piece"],
      "line.unitPrice": ["150", "30"],
      "line.vatCode": ["normal", "reduced"],
      "line.productId": ["", ""],
    }),
    { vatRegistered: true },
  );
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  const draft = await createInvoice(db, who, r.data);
  if (typeof draft !== "object" || !draft) throw new Error("brouillon");
  const issued = await issueInvoice(db, who, draft.id);
  if (typeof issued !== "object") throw new Error(issued);
  return { a, who, invoice: issued, contactId: contact.id };
}

async function linesOf(entryId: string) {
  return db
    .select({
      number: accounts.number,
      debit: journalLines.debitCents,
      credit: journalLines.creditCents,
      rate: journalLines.vatRateBp,
      base: journalLines.vatBaseCents,
    })
    .from(journalLines)
    .innerJoin(accounts, eq(accounts.id, journalLines.accountId))
    .where(eq(journalLines.entryId, entryId))
    .orderBy(journalLines.position);
}

describe("comptabilisation automatique", () => {
  it("attend le plan comptable et l'exercice, puis comptabilise la facture en partie double", async () => {
    const { who, invoice } = await setup();
    expect(await postPending(db, who)).toEqual({ posted: 0, waiting: 1, reason: "noChart" });
    await installChart(db, who, "corporation");
    expect(await postPending(db, who)).toMatchObject({ posted: 0, reason: "noFiscalYear" });
    await createFirstFiscalYear(db, who, { start: "2026-01-01", extended: false });
    expect(await postPending(db, who)).toEqual({ posted: 1, waiting: 0, reason: null });
    expect(await countUnposted(db, who.organizationId)).toBe(0);

    const [entry] = await db.select().from(journalEntries);
    if (!entry) throw new Error("écriture");
    expect(entry).toMatchObject({
      number: 1,
      seq: 1,
      entryDate: "2026-03-01",
      sourceType: "invoice",
    });
    // 300.00 à 8.1 % (TVA 24.30) et 30.00 à 2.6 % (TVA 0.78) : total 355.08
    expect(invoice.totalCents).toBe(35_508);
    expect(await linesOf(entry.id)).toEqual([
      { number: "1100", debit: 35_508, credit: 0, rate: null, base: null },
      { number: "3400", debit: 0, credit: 30_000, rate: 810, base: null },
      { number: "2200", debit: 0, credit: 2430, rate: 810, base: 30_000 },
      { number: "3400", debit: 0, credit: 3000, rate: 260, base: null },
      { number: "2200", debit: 0, credit: 78, rate: 260, base: 3000 },
    ]);
  });

  it("comptabilise paiements, avoirs et extournes, et garde une chaîne vérifiable", async () => {
    const { who, invoice, contactId } = await setup();
    await installChart(db, who, "sole_proprietorship");
    await createFirstFiscalYear(db, who, { start: "2026-01-01", extended: false });
    const pay = await addPayment(db, who, invoice.id, {
      paidOn: "2026-03-15",
      amountCents: 10_000,
      method: "bank",
      note: null,
    });
    if (typeof pay !== "object") throw new Error(pay);
    const credit = await createCreditNote(db, who, invoice.id, "2026-03-20");
    if (typeof credit !== "object") throw new Error(credit);
    const r = parseInvoiceForm(
      form({
        contactId,
        language: "de",
        issueDate: "2026-03-20",
        serviceDate: "2026-03-01",
        "line.description": ["Buch"],
        "line.quantity": ["1"],
        "line.unit": ["piece"],
        "line.unitPrice": ["30"],
        "line.vatCode": ["reduced"],
        "line.productId": [""],
      }),
      { vatRegistered: true },
    );
    if (!r.ok) throw new Error("avoir");
    await updateInvoice(db, who, credit.id, r.data, "credit_note");
    await issueInvoice(db, who, credit.id);

    expect(await postPending(db, who)).toMatchObject({ posted: 3, waiting: 0 });
    const entries = await db.select().from(journalEntries).orderBy(journalEntries.seq);
    expect(entries.map((e) => [e.sourceType, e.entryDate])).toEqual([
      ["invoice", "2026-03-01"],
      ["credit_note", "2026-03-20"],
      ["payment", "2026-03-15"],
    ]);
    expect(await linesOf(entries[1]?.id ?? "")).toEqual([
      { number: "1100", debit: 0, credit: 3078, rate: null, base: null },
      { number: "3400", debit: 3000, credit: 0, rate: 260, base: null },
      { number: "2200", debit: 78, credit: 0, rate: 260, base: -3000 },
    ]);
    expect(await linesOf(entries[2]?.id ?? "")).toEqual([
      { number: "1020", debit: 10_000, credit: 0, rate: null, base: null },
      { number: "1100", debit: 0, credit: 10_000, rate: null, base: null },
    ]);

    expect(await deletePayment(db, who, pay.id, "2026-04-02")).toBe(true);
    const reversal = (await db.select().from(journalEntries).orderBy(journalEntries.seq)).at(-1);
    expect(reversal).toMatchObject({
      sourceType: "payment_reversal",
      entryDate: "2026-04-02",
      number: 4,
    });
    expect(await linesOf(reversal?.id ?? "")).toEqual([
      { number: "1020", debit: 0, credit: 10_000, rate: null, base: null },
      { number: "1100", debit: 10_000, credit: 0, rate: null, base: null },
    ]);

    expect(await verifyChain(db, who.organizationId)).toEqual({ ok: true, count: 4 });
    // Le journal refuse toute modification…
    await expect(
      db.execute(sql`update journal_entries set description = 'x' where seq = 2`),
    ).rejects.toThrow();
    // …et une modification forcée (déclencheur coupé) se voit dans la chaîne.
    await db.execute(sql`alter table journal_entries disable trigger journal_entries_append_only`);
    await db.execute(sql`update journal_entries set description = 'falsifié' where seq = 2`);
    await db.execute(sql`alter table journal_entries enable trigger journal_entries_append_only`);
    expect(await verifyChain(db, who.organizationId)).toEqual({ ok: false, seq: 2 });
  });
});
