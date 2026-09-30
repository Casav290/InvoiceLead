import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  formatReference,
  isValidQrReference,
  isValidScorReference,
  mod10Recursive,
  qrReference,
  scorReference,
} from "@/countries/ch/qr-reference";
import { attachLeadIdentity } from "@/server/auth/attach";
import { createContact, parseContactForm } from "@/server/contacts";
import { organizations } from "@/server/db/schema";
import { qrBillData, renderInvoicePdf } from "@/server/invoice-pdf";
import { createInvoice, getInvoice, issueInvoice, parseInvoiceForm } from "@/server/invoices";
import { claims } from "../support/claims";
import { testDb } from "../support/db";

const t = testDb();
const db = t.database;
beforeEach(() => t.reset());
afterAll(() => t.close());

describe("références de paiement", () => {
  it("suivent les exemples officiels", () => {
    // Exemple SIX : 21 00000 00003 13947 14300 09017
    expect(mod10Recursive("21000000000313947143000901")).toBe(7);
    expect(isValidQrReference("210000000003139471430009017")).toBe(true);
    expect(isValidQrReference("210000000003139471430009018")).toBe(false);
    // Exemple ISO 11649 : RF18 5390 0754 7034
    expect(scorReference("539007547034")).toBe("RF18539007547034");
    expect(isValidScorReference("RF18 5390 0754 7034")).toBe(true);
    expect(isValidScorReference("RF19539007547034")).toBe(false);
  });

  it("se tirent du numéro de facture", () => {
    const qrr = qrReference("2026-0042");
    expect(qrr).toHaveLength(27);
    expect(qrr.startsWith("0000000000000000002026004")).toBe(true);
    expect(isValidQrReference(qrr)).toBe(true);
    expect(isValidScorReference(scorReference("2026-0042"))).toBe(true);
    expect(formatReference("210000000003139471430009017")).toBe("21 00000 00003 13947 14300 09017");
    expect(formatReference("RF18539007547034")).toBe("RF18 5390 0754 7034");
  });
});

function form(values: Record<string, string | string[]>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(values))
    for (const x of Array.isArray(v) ? v : [v]) f.append(k, x);
  return f;
}

async function issued(qrIban: string | null) {
  const a = await attachLeadIdentity(db, claims());
  const who = { organizationId: a.organization.id, userId: a.user.id };
  await db
    .update(organizations)
    .set({
      vatRegistered: true,
      uid: "CHE116281710",
      legalName: "Atelier Muster GmbH",
      street: "Bahnhofstrasse",
      buildingNumber: "1",
      postalCode: "8001",
      town: "Zürich",
      iban: "CH9300762011623852957",
      qrIban,
      settingsCompletedAt: new Date(),
    })
    .where(eq(organizations.id, a.organization.id));
  const c = parseContactForm(
    form({
      kind: "company",
      isCustomer: "on",
      name: "Kunde AG",
      language: "fr",
      country: "CH",
      street: "Rue du Lac",
      buildingNumber: "12",
      postalCode: "1204",
      town: "Genève",
      paymentTermDays: "30",
    }),
  );
  if (!c.ok) throw new Error("contact");
  const contact = await createContact(db, who, c.data);
  const r = parseInvoiceForm(
    form({
      contactId: contact.id,
      language: "fr",
      issueDate: "2026-03-01",
      "line.description": ["Conseil\nAtelier du 12 février", "Frais"],
      "line.quantity": ["2.5", "1"],
      "line.unit": ["hour", "flat"],
      "line.unitPrice": ["150", "40.50"],
      "line.vatCode": ["normal", "exempt"],
      "line.productId": ["", ""],
    }),
    { vatRegistered: true },
  );
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  const draft = await createInvoice(db, who, r.data);
  if (typeof draft !== "object" || !draft) throw new Error("brouillon");
  await issueInvoice(db, who, draft.id);
  const found = await getInvoice(db, a.organization.id, draft.id);
  if (!found) throw new Error("facture");
  return found;
}

const labels = {
  invoice: "Facture",
  issueDate: "Date",
  serviceDate: "Prestation",
  dueDate: "Payable jusqu'au",
  description: "Désignation",
  quantity: "Quantité",
  unitPrice: "Prix unitaire",
  vat: "TVA",
  amount: "Montant",
  net: "Total hors TVA",
  total: "Total",
  vatLine: (rate: string, base: string) => `TVA ${rate} sur ${base}`,
  payTo: (iban: string) => `À verser sur le compte ${iban}.`,
  referenceLine: (ref: string) => `Référence : ${ref}`,
  units: { hour: "h", flat: "forfait" },
};

describe("QR-facture et PDF", () => {
  it("utilise une référence SCOR avec un IBAN ordinaire", async () => {
    const { invoice, lines } = await issued(null);
    expect(invoice.paymentReference).toBe(scorReference("2026-0001"));
    const data = qrBillData(invoice);
    expect(data).toMatchObject({
      currency: "CHF",
      amount: 445.88,
      creditor: { account: "CH9300762011623852957", zip: "8001", city: "Zürich" },
      debtor: { name: "Kunde AG", address: "Rue du Lac", buildingNumber: "12", city: "Genève" },
      message: "Facture 2026-0001",
    });
    const pdf = await renderInvoicePdf(invoice, lines, labels);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(5000);
  });

  it("utilise une référence QRR avec un QR-IBAN", async () => {
    // QR-IBAN d'exemple de SIX (IID 30808).
    const { invoice, lines } = await issued("CH4431999123000889012");
    expect(invoice.paymentReference).toBe(qrReference("2026-0001"));
    expect(qrBillData(invoice)?.creditor.account).toBe("CH4431999123000889012");
    const pdf = await renderInvoicePdf(invoice, lines, labels);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  });
});
