import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { countryPack } from "@/countries";
import { isValidUstId, vatRateBpDe } from "@/countries/de/vat";
import { isValidSepaIban, vatNumberLabel } from "@/lib/swiss-ids";
import { attachLeadIdentity } from "@/server/auth/attach";
import { parseCompanyForm, saveCompanySettings } from "@/server/company";
import { createContact, parseContactForm } from "@/server/contacts";
import { organizations } from "@/server/db/schema";
import { epcQrPayload, qrBillData, renderInvoicePdf } from "@/server/invoice-pdf";
import { createInvoice, getInvoice, issueInvoice, parseInvoiceForm } from "@/server/invoices";
import { claims } from "../support/claims";
import { testDb } from "../support/db";

const t = testDb();
const db = t.database;
beforeEach(() => t.reset());
afterAll(() => t.close());

function form(values: Record<string, string | string[]>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(values)) {
    for (const x of Array.isArray(v) ? v : [v]) f.append(k, x);
  }
  return f;
}

const COMPANY = {
  country: "DE",
  legalName: "Werkstatt Müller GmbH",
  legalForm: "gmbh",
  street: "Friedrichstrasse",
  buildingNumber: "10",
  postalCode: "10117",
  town: "Berlin",
  uid: "DE 136 695 976",
  vatRegistered: "on",
  vatSettlement: "agreed",
  iban: "DE89 3704 0044 0532 0130 00",
  fiscalYearStartMonth: "1",
};

describe("pack Allemagne", () => {
  it("taux datés, USt-IdNr., IBAN et format des montants", () => {
    expect(vatRateBpDe("normal", "2026-03-01")).toBe(1900);
    expect(vatRateBpDe("reduced", "2026-03-01")).toBe(700);
    expect(vatRateBpDe("lodging", "2026-03-01")).toBe(700);
    expect(vatRateBpDe("normal", "2020-10-15")).toBe(1600);
    expect(vatRateBpDe("export", "2026-03-01")).toBe(0);
    expect(isValidUstId("DE136695976")).toBe(true);
    expect(isValidUstId("DE136695977")).toBe(false);
    expect(isValidSepaIban("DE89370400440532013000")).toBe(true);
    expect(isValidSepaIban("DE89370400440532013001")).toBe(false);
    expect(vatNumberLabel("DE136695976", "fr")).toBe("USt-IdNr. DE136695976");
    expect(countryPack("DE")).toMatchObject({
      currency: "EUR",
      paymentSlip: "epc-qr",
      accounting: false,
    });
    expect(countryPack("XX").code).toBe("CH");
  });

  it("réglages allemands : NPA à 5 chiffres, USt-IdNr., pas de QR-IBAN ni de TDFN", () => {
    const ok = parseCompanyForm(
      form({
        ...COMPANY,
        qrIban: "CH4431999123000889012",
        netTaxRate: "6.2",
        vatMethod: "net_tax_rate",
      }),
    );
    if (!ok.ok) throw new Error(JSON.stringify(ok.errors));
    expect(ok.data).toMatchObject({
      country: "DE",
      uid: "DE136695976",
      qrIban: null,
      vatMethod: "effective",
      netTaxRateBp: null,
      iban: "DE89370400440532013000",
    });
    const bad = parseCompanyForm(form({ ...COMPANY, postalCode: "8001", uid: "DE123" }));
    expect(!bad.ok && bad.errors).toMatchObject({ postalCode: "postalCode", uid: "ustId" });
  });

  it("facture en euros à 19 %, GiroCode au lieu de la QR-facture, pays figé ensuite", async () => {
    const a = await attachLeadIdentity(db, claims());
    const who = { organizationId: a.organization.id, userId: a.user.id };
    const company = parseCompanyForm(form(COMPANY));
    if (!company.ok) throw new Error(JSON.stringify(company.errors));
    expect(await saveCompanySettings(db, who, company.data)).toBe("saved");
    const [org] = await db
      .select()
      .from(organizations)
      .where(eq(organizations.id, a.organization.id));
    expect(org).toMatchObject({ country: "DE", currency: "EUR" });

    const contact = parseContactForm(
      form({
        kind: "company",
        isCustomer: "on",
        name: "Kunde GmbH",
        language: "de",
        country: "DE",
        street: "Hauptstrasse",
        buildingNumber: "5",
        postalCode: "80331",
        town: "München",
        paymentTermDays: "14",
      }),
    );
    if (!contact.ok) throw new Error(JSON.stringify(contact.errors));
    const c = await createContact(db, who, contact.data);
    const parsed = parseInvoiceForm(
      form({
        contactId: c.id,
        language: "de",
        issueDate: "2026-09-30",
        "line.description": ["Beratung"],
        "line.quantity": ["10"],
        "line.unit": ["hour"],
        "line.unitPrice": ["100"],
        "line.vatCode": ["normal"],
        "line.productId": [""],
      }),
      { vatRegistered: true, country: "DE" },
    );
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
    const draft = await createInvoice(db, who, parsed.data);
    if (!draft || typeof draft !== "object") throw new Error("brouillon");
    expect(draft).toMatchObject({
      currency: "EUR",
      netCents: 100000,
      vatCents: 19000,
      totalCents: 119000,
    });
    await issueInvoice(db, who, draft.id);
    const found = await getInvoice(db, a.organization.id, draft.id);
    if (!found) throw new Error("facture");
    const { invoice, lines } = found;
    expect(invoice.sender?.vatNumber).toBe("USt-IdNr. DE136695976");
    expect(qrBillData(invoice)).toBeNull();
    const epc = epcQrPayload(invoice)?.split("\n");
    expect(epc?.slice(0, 8)).toEqual([
      "BCD",
      "002",
      "1",
      "SCT",
      "",
      "Werkstatt Müller GmbH",
      "DE89370400440532013000",
      "EUR1190.00",
    ]);
    expect(epc?.[9]).toMatch(/^RF\d{2}/);

    const pdf = await renderInvoicePdf(invoice, lines, {
      invoice: "Rechnung",
      issueDate: "Datum",
      serviceDate: "Leistungsdatum",
      dueDate: "Zahlbar bis",
      description: "Beschreibung",
      quantity: "Menge",
      unitPrice: "Einzelpreis",
      vat: "USt",
      amount: "Betrag",
      net: "Netto",
      total: "Total",
      vatLine: (rate, base) => `USt ${rate} auf ${base}`,
      payTo: (iban) => `Zahlbar auf ${iban}.`,
      referenceLine: (ref) => `Referenz ${ref}`,
      units: { hour: "Std." },
      scanToPay: "Mit der Banking-App scannen.",
    });
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");

    // Une pièce émise : le pays ne change plus.
    const swiss = parseCompanyForm(
      form({
        ...COMPANY,
        country: "CH",
        postalCode: "8001",
        uid: "",
        vatRegistered: "",
        iban: "CH9300762011623852957",
      }),
    );
    if (!swiss.ok) throw new Error(JSON.stringify(swiss.errors));
    expect(await saveCompanySettings(db, who, swiss.data)).toBe("countryLocked");
  });
});
