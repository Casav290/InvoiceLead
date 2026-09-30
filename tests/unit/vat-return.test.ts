import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { parseCamt } from "@/countries/ch/camt";
import { periodsBetween, quartersBetween, vatDueDate } from "@/countries/ch/vat-return";
import { createFirstFiscalYear, installChart } from "@/server/accounting";
import { attachLeadIdentity } from "@/server/auth/attach";
import { ignoreTransaction, importEntries, validateTransaction } from "@/server/bank";
import { createContact, parseContactForm } from "@/server/contacts";
import {
  accounts,
  bankTransactions,
  journalLines,
  organizations,
  vatReturns,
} from "@/server/db/schema";
import { createInvoice, issueInvoice, parseInvoiceForm } from "@/server/invoices";
import { postPending, verifyChain } from "@/server/ledger";
import { addPayment } from "@/server/payments";
import { draftVatReturn, validateVatReturn } from "@/server/vat-return";
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
  });
});
beforeEach(() => t.reset());
afterAll(() => t.close());

function form(values: Record<string, string | string[]>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(values))
    for (const x of Array.isArray(v) ? v : [v]) f.append(k, x);
  return f;
}

describe("périodes TVA", () => {
  it("découpent en trimestres civils et donnent l'échéance à 60 jours", () => {
    expect(quartersBetween("2025-07-15", "2026-02-01")).toEqual([
      { start: "2025-07-01", end: "2025-09-30" },
      { start: "2025-10-01", end: "2025-12-31" },
      { start: "2026-01-01", end: "2026-03-31" },
    ]);
    expect(vatDueDate("2026-03-31")).toBe("2026-05-30");
    expect(periodsBetween("2025-09-01", "2026-08-01", 6)).toEqual([
      { start: "2025-07-01", end: "2025-12-31" },
      { start: "2026-01-01", end: "2026-06-30" },
      { start: "2026-07-01", end: "2026-12-31" },
    ]);
  });
});

describe("décompte TVA", () => {
  it("se prépare depuis le journal, bloque tant que tout n'est pas comptabilisé, puis ferme la période", async () => {
    const a = await attachLeadIdentity(db, claims());
    const who = { organizationId: a.organization.id, userId: a.user.id };
    await db
      .update(organizations)
      .set({
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
        issueDate: "2026-02-10",
        "line.description": ["Beratung", "Buch", "Export"],
        "line.quantity": ["1", "1", "1"],
        "line.unit": ["flat", "piece", "flat"],
        "line.unitPrice": ["1000", "200", "300"],
        "line.vatCode": ["normal", "reduced", "export"],
        "line.productId": ["", "", ""],
      }),
      { vatRegistered: true },
    );
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    const draft = await createInvoice(db, who, r.data);
    if (typeof draft !== "object" || !draft) throw new Error("brouillon");
    await issueInvoice(db, who, draft.id);
    await postPending(db, who);

    await importEntries(
      db,
      who,
      parseCamt(
        camt053("CH9300762011623852957", [
          {
            id: "A",
            date: "2026-03-05",
            amount: "107.70",
            credit: false,
            party: "Swisscom",
            text: "Abo",
          },
          { id: "B", date: "2026-03-06", amount: "20.00", credit: false, party: "?", text: "?" },
        ]),
      ).entries,
    );
    const [internet] = await db.select().from(accounts).where(eq(accounts.number, "6510"));
    const txs = await db.select().from(bankTransactions).orderBy(bankTransactions.bookingDate);
    await validateTransaction(db, who, txs[0]?.id ?? "", {
      accountId: internet?.id ?? "",
      vatCode: "normal",
    });

    let d = await draftVatReturn(db, who.organizationId, "2026-01-01", "2026-03-31");
    expect(d.figures).toMatchObject({
      "200": 150_000,
      "220": 30_000,
      "230": 0,
      "289": 30_000,
      "299": 120_000,
      "303": 100_000,
      "313": 20_000,
      "399": 8100 + 520,
      "400": 0,
      "405": 807,
      "479": 807,
      "500": 8620 - 807,
      "510": 0,
    });
    expect(d.anomalies).toEqual([
      { code: "pendingBank", severity: "block", count: 1 },
      { code: "inputWithoutReceipt", severity: "warn", count: 1 },
    ]);
    expect(await validateVatReturn(db, who, "2026-01-01", "2026-03-31")).toBe("blocked");

    await ignoreTransaction(db, who, txs[1]?.id ?? "");
    d = await draftVatReturn(db, who.organizationId, "2026-01-01", "2026-03-31");
    expect(d.anomalies.map((x) => x.code)).toEqual(["inputWithoutReceipt"]);
    expect(await validateVatReturn(db, who, "2026-01-01", "2026-03-31")).toBe("validated");

    const [ret] = await db.select().from(vatReturns);
    const lines = await db
      .select({ n: accounts.number, d: journalLines.debitCents, c: journalLines.creditCents })
      .from(journalLines)
      .innerJoin(accounts, eq(accounts.id, journalLines.accountId))
      .where(eq(journalLines.entryId, ret?.journalEntryId ?? ""))
      .orderBy(journalLines.position);
    expect(lines).toEqual([
      { n: "2200", d: 8620, c: 0 },
      { n: "1171", d: 0, c: 807 },
      { n: "2201", d: 0, c: 7813 },
    ]);

    // Période close : ni nouvelle écriture datée dedans, ni second décompte.
    await importEntries(
      db,
      who,
      parseCamt(
        camt053("CH9300762011623852957", [
          {
            id: "C",
            date: "2026-03-20",
            amount: "15.00",
            credit: false,
            party: "Kiosk",
            text: "?",
          },
        ]),
      ).entries,
    );
    const late = (await db.select().from(bankTransactions)).find(
      (x) => x.bookingDate === "2026-03-20",
    );
    expect(
      await validateTransaction(db, who, late?.id ?? "", {
        accountId: internet?.id ?? "",
        vatCode: null,
      }),
    ).toBe("vatPeriodClosed");
    expect(
      (await draftVatReturn(db, who.organizationId, "2026-01-01", "2026-03-31")).anomalies.map(
        (x) => x.code,
      ),
    ).toContain("alreadyValidated");
    expect(await verifyChain(db, who.organizationId)).toMatchObject({ ok: true, count: 3 });
  });
});

describe("décompte TVA au taux de la dette fiscale nette", () => {
  it("impose le chiffre d'affaires TVA comprise au taux net et rend l'écart au chiffre d'affaires", async () => {
    const a = await attachLeadIdentity(db, claims());
    const who = { organizationId: a.organization.id, userId: a.user.id };
    await db
      .update(organizations)
      .set({
        vatRegistered: true,
        vatMethod: "net_tax_rate",
        vatSettlement: "agreed",
        netTaxRateBp: null,
        uid: "CHE116281710",
        legalName: "Atelier Muster",
        street: "Bahnhofstrasse",
        postalCode: "8001",
        town: "Zürich",
        iban: "CH9300762011623852957",
        settingsCompletedAt: new Date(),
      })
      .where(eq(organizations.id, a.organization.id));
    await installChart(db, who, "sole_proprietorship");
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
        issueDate: "2026-02-10",
        "line.description": ["Beratung", "Buch"],
        "line.quantity": ["1", "1"],
        "line.unit": ["flat", "piece"],
        "line.unitPrice": ["1000", "200"],
        "line.vatCode": ["normal", "reduced"],
        "line.productId": ["", ""],
      }),
      { vatRegistered: true },
    );
    if (!r.ok) throw new Error("facture");
    const draft = await createInvoice(db, who, r.data);
    if (typeof draft !== "object" || !draft) throw new Error("brouillon");
    await issueInvoice(db, who, draft.id);
    await postPending(db, who);

    let d = await draftVatReturn(db, who.organizationId, "2026-01-01", "2026-06-30");
    expect(d.anomalies.map((x) => x.code)).toEqual(["noNetTaxRate"]);
    await db
      .update(organizations)
      .set({ netTaxRateBp: 620 })
      .where(eq(organizations.id, a.organization.id));
    d = await draftVatReturn(db, who.organizationId, "2026-01-01", "2026-06-30");
    // 1'200.00 + TVA facturée 86.20 = 1'286.20 ; 6,2 % = 79.7444 → 79.74
    expect(d).toMatchObject({
      method: "net_tax_rate",
      anomalies: [],
      figures: {
        "200": 128_620,
        "299": 128_620,
        "322": 128_620,
        "322t": 7974,
        "399": 7974,
        "500": 7974,
      },
    });
    expect(d.figures["400"]).toBeUndefined();
    expect(await validateVatReturn(db, who, "2026-01-01", "2026-06-30")).toBe("validated");
    const [ret] = await db.select().from(vatReturns);
    const lines = await db
      .select({ n: accounts.number, d: journalLines.debitCents, c: journalLines.creditCents })
      .from(journalLines)
      .innerJoin(accounts, eq(accounts.id, journalLines.accountId))
      .where(eq(journalLines.entryId, ret?.journalEntryId ?? ""))
      .orderBy(journalLines.position);
    expect(lines).toEqual([
      { n: "2200", d: 8620, c: 0 },
      { n: "2201", d: 0, c: 7974 },
      { n: "3800", d: 0, c: 646 },
    ]);
  });
});

describe("décompte TVA selon les contre-prestations reçues", () => {
  it("ne doit la TVA d'une facture qu'au prorata de ce qui est payé dans la période", async () => {
    const a = await attachLeadIdentity(db, claims());
    const who = { organizationId: a.organization.id, userId: a.user.id };
    await db
      .update(organizations)
      .set({
        vatRegistered: true,
        vatMethod: "effective",
        vatSettlement: "received",
        uid: "CHE116281710",
        legalName: "Atelier Muster",
        street: "Bahnhofstrasse",
        postalCode: "8001",
        town: "Zürich",
        iban: "CH9300762011623852957",
        settingsCompletedAt: new Date(),
      })
      .where(eq(organizations.id, a.organization.id));
    await installChart(db, who, "sole_proprietorship");
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
        issueDate: "2026-02-10",
        "line.description": ["Beratung", "Buch"],
        "line.quantity": ["1", "1"],
        "line.unit": ["flat", "piece"],
        "line.unitPrice": ["1000", "200"],
        "line.vatCode": ["normal", "reduced"],
        "line.productId": ["", ""],
      }),
      { vatRegistered: true },
    );
    if (!r.ok) throw new Error("facture");
    const draft = await createInvoice(db, who, r.data);
    if (typeof draft !== "object" || !draft) throw new Error("brouillon");
    const invoice = await issueInvoice(db, who, draft.id);
    if (typeof invoice !== "object") throw new Error(invoice);
    expect(invoice.totalCents).toBe(128_620);
    // Moitié payée au premier trimestre, le reste au deuxième.
    await addPayment(db, who, invoice.id, {
      paidOn: "2026-03-20",
      amountCents: 64_310,
      method: "bank",
      note: null,
    });
    await addPayment(db, who, invoice.id, {
      paidOn: "2026-04-15",
      amountCents: 64_310,
      method: "bank",
      note: null,
    });
    await postPending(db, who);

    const q1 = await draftVatReturn(db, who.organizationId, "2026-01-01", "2026-03-31");
    expect(q1.anomalies).toEqual([]);
    expect(q1.figures).toMatchObject({
      "200": 60_000,
      "299": 60_000,
      "303": 50_000,
      "303t": 4050,
      "313": 10_000,
      "313t": 260,
      "399": 4310,
    });
    const q2 = await draftVatReturn(db, who.organizationId, "2026-04-01", "2026-06-30");
    expect(q2.figures["399"]).toBe(4310);
    expect(await validateVatReturn(db, who, "2026-01-01", "2026-03-31")).toBe("validated");
  });
});
