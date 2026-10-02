import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { parseCamt } from "@/countries/ch/camt";
import { parseIncomingInvoice } from "@/lib/einvoice-in";
import { buildPain001, referenceKind } from "@/lib/pain001";
import { createFirstFiscalYear, installChart } from "@/server/accounting";
import { attachLeadIdentity } from "@/server/auth/attach";
import { importEntries, proposeAll, validateTransaction } from "@/server/bank";
import {
  approveBill,
  billFromReceipt,
  createBill,
  exportPayments,
  importEInvoice,
  markBillPaid,
  normalizeIban,
} from "@/server/bills";
import {
  accounts,
  bankTransactions,
  bookingRules,
  journalLines,
  memberships,
  organizations,
  receipts,
  supplierBills,
} from "@/server/db/schema";
import { consumeQuota, organizationPlan, quotaAccess } from "@/server/plans";
import { camt053 } from "../support/camt";
import { claims } from "../support/claims";
import { testDb } from "../support/db";
import { setTestEnv } from "../support/env";

const t = testDb();
const db = t.database;
beforeAll(() => setTestEnv());
beforeEach(() => t.reset());
afterAll(() => t.close());

const UBL = `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:ID>R-2026-117</cbc:ID>
  <cbc:IssueDate>2026-03-03</cbc:IssueDate>
  <cbc:DueDate>2026-04-02</cbc:DueDate>
  <cbc:DocumentCurrencyCode>CHF</cbc:DocumentCurrencyCode>
  <cac:AccountingSupplierParty><cac:Party>
    <cac:PostalAddress><cbc:StreetName>Hardturmstrasse 3</cbc:StreetName><cbc:CityName>Zürich</cbc:CityName><cbc:PostalZone>8005</cbc:PostalZone><cac:Country><cbc:IdentificationCode>CH</cbc:IdentificationCode></cac:Country></cac:PostalAddress>
    <cac:PartyLegalEntity><cbc:RegistrationName>Druckerei Muster AG</cbc:RegistrationName></cac:PartyLegalEntity>
  </cac:Party></cac:AccountingSupplierParty>
  <cac:PaymentMeans><cbc:PaymentMeansCode>58</cbc:PaymentMeansCode><cbc:PaymentID>RF18539007547034</cbc:PaymentID><cac:PayeeFinancialAccount><cbc:ID>CH56 0483 5012 3456 7800 9</cbc:ID></cac:PayeeFinancialAccount></cac:PaymentMeans>
  <cac:TaxTotal><cbc:TaxAmount currencyID="CHF">32.40</cbc:TaxAmount><cac:TaxSubtotal><cbc:TaxableAmount currencyID="CHF">400.00</cbc:TaxableAmount><cbc:TaxAmount currencyID="CHF">32.40</cbc:TaxAmount><cac:TaxCategory><cbc:ID>S</cbc:ID><cbc:Percent>8.1</cbc:Percent></cac:TaxCategory></cac:TaxSubtotal></cac:TaxTotal>
  <cac:LegalMonetaryTotal><cbc:PayableAmount currencyID="CHF">432.40</cbc:PayableAmount></cac:LegalMonetaryTotal>
  <cac:InvoiceLine><cbc:ID>1</cbc:ID><cac:Item><cbc:Name>Flyer A5</cbc:Name></cac:Item></cac:InvoiceLine>
</Invoice>`;

describe("pièces reçues et paiement", () => {
  it("contrôle les IBAN, lit une e-facture UBL et reconnaît les références", () => {
    expect(normalizeIban("CH93 0076 2011 6238 5295 7")).toBe("CH9300762011623852957");
    expect(normalizeIban("CH93 0076 2011 6238 5295 8")).toBeNull();
    const ubl = parseIncomingInvoice(UBL);
    expect(ubl).toMatchObject({
      format: "ubl",
      supplierName: "Druckerei Muster AG",
      supplierTown: "Zürich",
      number: "R-2026-117",
      issueDate: "2026-03-03",
      dueDate: "2026-04-02",
      totalCents: 43_240,
      vatCents: 3_240,
      vatPercent: 8.1,
      iban: "CH5604835012345678009",
      paymentReference: "RF18539007547034",
      description: "Flyer A5",
    });
    expect(parseIncomingInvoice("<pas-une-facture/>")).toBeNull();
    expect(referenceKind("21 00000 00003 13947 14300 09017")).toBe("QRR");
    expect(referenceKind("RF18 5390 0754 7034")).toBe("SCOR");
    expect(referenceKind("Rechnung 42")).toBeNull();
    const xml = buildPain001({
      messageId: "M1",
      createdAt: new Date("2026-03-10T08:00:00Z"),
      debtorName: "Atelier & Co",
      debtorIban: "CH9300762011623852957",
      debtorCountry: "CH",
      payments: [
        {
          id: "P1",
          amountCents: 12_345,
          currency: "CHF",
          executionDate: "2026-03-12",
          creditorName: "Muster AG",
          creditorStreet: null,
          creditorPostalCode: "8001",
          creditorTown: "Zürich",
          creditorCountry: "CH",
          iban: "CH4431999123000889012",
          bic: null,
          reference: "210000000003139471430009017",
          message: null,
        },
      ],
    });
    expect(xml).toContain(
      "<Prtry>QRR</Prtry></CdOrPrtry></Tp><Ref>210000000003139471430009017</Ref>",
    );
    expect(xml).toContain("<CtrlSum>123.45</CtrlSum>");
    expect(xml).toContain("<Nm>Atelier &amp; Co</Nm>");
  });
});

async function company(dual = false) {
  const a = await attachLeadIdentity(db, claims());
  const who = { organizationId: a.organization.id, userId: a.user.id };
  await db
    .update(organizations)
    .set({
      vatRegistered: true,
      vatMethod: "effective",
      uid: "CHE116281710",
      dualApproval: dual,
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
  const [account] = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.organizationId, who.organizationId), eq(accounts.number, "6510")));
  if (!account) throw new Error("compte");
  return { a, who, account };
}

const net = (rows: { debitCents: number; creditCents: number }[]) =>
  rows.reduce((s, r) => s + r.debitCents - r.creditCents, 0);

describe("factures fournisseurs", () => {
  it("approuvée, comptabilisée avec l'impôt préalable, payée par pain.001 puis soldée par le relevé", async () => {
    const { who, account } = await company();
    const bill = await createBill(db, who, {
      supplierName: "Swisscom (Schweiz) AG",
      supplierStreet: "Alte Tiefenaustrasse 6",
      supplierPostalCode: "3048",
      supplierTown: "Worblaufen",
      supplierCountry: "CH",
      iban: "CH4431999123000889012",
      bic: null,
      paymentReference: "210000000003139471430009017",
      number: "INV-77",
      issueDate: "2026-03-05",
      dueDate: "2026-04-04",
      currency: "CHF",
      totalCents: 10_810,
      vatCode: "normal",
      accountId: account.id,
      description: "Internet",
    });
    const approved = await approveBill(db, who, bill.id);
    if (typeof approved !== "object") throw new Error(approved);
    expect(approved.status).toBe("approved");
    const lines = await db
      .select()
      .from(journalLines)
      .where(eq(journalLines.entryId, approved.journalEntryId ?? ""));
    expect(net(lines.filter((l) => l.accountId === account.id))).toBe(10_000);
    expect(lines.find((l) => l.vatRateBp === 810 && l.accountId !== account.id)?.debitCents).toBe(
      810,
    );
    // Le fournisseur apprend son compte, pour la prochaine facture et pour le relevé.
    const [rule] = await db.select().from(bookingRules);
    expect(rule?.accountId).toBe(account.id);

    const file = await exportPayments(db, who, null, "2026-03-20");
    if (typeof file === "string") throw new Error(file);
    expect(file.count).toBe(1);
    expect(file.xml).toContain("<IBAN>CH4431999123000889012</IBAN>");
    expect(file.xml).toContain("<IBAN>CH9300762011623852957</IBAN>");
    expect(file.xml).toContain("<Dt>2026-04-04</Dt>");
    expect(await exportPayments(db, who, null, "2026-03-20")).toBe("none");

    const { entries } = parseCamt(
      camt053("CH9300762011623852957", [
        {
          id: "S1",
          date: "2026-04-04",
          amount: "108.10",
          credit: false,
          party: "Swisscom (Schweiz) AG",
          reference: "210000000003139471430009017",
        },
      ]),
    );
    await importEntries(db, who, entries);
    await proposeAll(db, who, { language: "fr", useAi: false });
    const [tx] = await db.select().from(bankTransactions);
    expect(tx?.proposal).toMatchObject({ kind: "bill", billId: bill.id, source: "reference" });
    expect(await validateTransaction(db, who, tx?.id ?? "")).toBe("posted");
    const [paid] = await db.select().from(supplierBills).where(eq(supplierBills.id, bill.id));
    expect(paid).toMatchObject({ status: "paid", paidOn: "2026-04-04", bankTransactionId: tx?.id });
    const [payable] = await db
      .select()
      .from(accounts)
      .where(and(eq(accounts.organizationId, who.organizationId), eq(accounts.role, "payable")));
    const payableLines = await db
      .select()
      .from(journalLines)
      .where(eq(journalLines.accountId, payable?.id ?? ""));
    expect(net(payableLines)).toBe(0);
  });

  it("exige deux personnes avec la double validation, et un compte de charge", async () => {
    const { a, who, account } = await company(true);
    const base = {
      supplierName: "Druckerei Muster AG",
      supplierStreet: null,
      supplierPostalCode: null,
      supplierTown: null,
      supplierCountry: null,
      iban: null,
      bic: null,
      paymentReference: null,
      number: null,
      issueDate: "2026-03-05",
      dueDate: "2026-04-04",
      currency: "CHF",
      totalCents: 5_000,
      vatCode: null,
      description: null,
    };
    const noAccount = await createBill(db, who, { ...base, accountId: null });
    expect(await approveBill(db, who, noAccount.id)).toBe("noAccount");

    const bill = await createBill(db, who, { ...base, accountId: account.id });
    const first = await approveBill(db, who, bill.id);
    expect(typeof first === "object" && first.status).toBe("draft");
    expect(await approveBill(db, who, bill.id)).toBe("sameApprover");
    const b = await attachLeadIdentity(
      db,
      claims({ sub: "sub-b", email: "b@atelier.test", org: "org-atelier", org_role: "admin" }),
    );
    const [member] = await db.select().from(memberships).where(eq(memberships.userId, b.user.id));
    expect(member?.organizationId).toBe(a.organization.id);
    const second = await approveBill(
      db,
      { organizationId: a.organization.id, userId: b.user.id },
      bill.id,
    );
    expect(typeof second === "object" && second.status).toBe("approved");
    expect(await markBillPaid(db, who, bill.id, "2026-03-31", "cash")).toBe("paid");
  });

  it("naît d'un justificatif lu ou d'une e-facture reçue", async () => {
    const { who } = await company();
    const [rc] = await db
      .insert(receipts)
      .values({
        organizationId: who.organizationId,
        fileKey: "k",
        filename: "rechnung.pdf",
        contentType: "application/pdf",
        sizeBytes: 10,
        sha256: "abc",
        status: "read",
        extraction: {
          supplier: "Garage Muster",
          date: "2026-03-08",
          totalCents: 25_000,
          currency: "CHF",
          vatCents: null,
          vatCode: "normal",
          invoiceNumber: "G-9",
          description: "Service",
          accountNumber: "6200",
          confidence: 0.9,
          dueDate: "2026-04-07",
          iban: "CH44 3199 9123 0008 8901 2",
          paymentReference: "210000000003139471430009017",
        },
      })
      .returning();
    const fromReceipt = await billFromReceipt(db, who, rc?.id ?? "");
    if (typeof fromReceipt !== "object") throw new Error(fromReceipt);
    expect(fromReceipt).toMatchObject({
      supplierName: "Garage Muster",
      totalCents: 25_000,
      dueDate: "2026-04-07",
      iban: "CH4431999123000889012",
      source: "receipt",
    });
    expect(fromReceipt.accountId).not.toBeNull();
    expect(await billFromReceipt(db, who, rc?.id ?? "")).toBe("exists");

    const imported = await importEInvoice(db, who, {
      name: "rechnung.xml",
      type: "application/xml",
      bytes: Buffer.from(UBL),
    });
    if (typeof imported !== "object") throw new Error(imported);
    expect(imported).toMatchObject({
      supplierName: "Druckerei Muster AG",
      totalCents: 43_240,
      vatCode: "normal",
      iban: "CH5604835012345678009",
      source: "einvoice",
    });
    expect(
      await importEInvoice(db, who, {
        name: "x.xml",
        type: "application/xml",
        bytes: Buffer.from("<a/>"),
      }),
    ).toBe("notEInvoice");

    // Lue sans IA, une e-facture ne compte pas dans les pièces lues du mois : la formule gratuite
    // en reçoit autant qu'elle veut, même une fois ses 20 lectures par l'IA utilisées.
    const plan = await organizationPlan(db, who.organizationId);
    if (!plan) throw new Error("organisation");
    expect((await quotaAccess(db, plan, "aiReads")).used).toBe(0);
    const again = { name: "rechnung.xml", type: "application/xml", bytes: Buffer.from(UBL) };
    expect(await importEInvoice(db, who, again)).toBe("duplicate");
    for (let i = 0; i < 20; i++) await consumeQuota(db, plan, "aiReads");
    expect((await quotaAccess(db, plan, "aiReads")).allowed).toBe(false);
    const next = await importEInvoice(db, who, {
      name: "rechnung-118.xml",
      type: "application/xml",
      bytes: Buffer.from(UBL.replace("R-2026-117", "R-2026-118")),
    });
    expect(next).toMatchObject({ number: "R-2026-118", source: "einvoice" });
    expect((await quotaAccess(db, plan, "aiReads")).used).toBe(20);
  });
});
