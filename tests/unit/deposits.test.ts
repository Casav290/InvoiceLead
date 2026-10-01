import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { attachLeadIdentity } from "@/server/auth/attach";
import { createContact, parseContactForm } from "@/server/contacts";
import { organizations } from "@/server/db/schema";
import { documentVariant } from "@/server/document-pdf";
import { renderInvoicePdf } from "@/server/invoice-pdf";
import {
  convertQuoteToInvoice,
  createDepositInvoice,
  createInvoice,
  depositInvoices,
  getInvoice,
  issueInvoice,
  parseInvoiceForm,
} from "@/server/invoices";
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

async function issuedQuote() {
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
  const c = parseContactForm(
    form({ kind: "company", isCustomer: "on", name: "Kunde AG", language: "fr", country: "CH" }),
  );
  if (!c.ok) throw new Error("contact");
  const contact = await createContact(db, who, c.data);
  const r = parseInvoiceForm(
    form({
      contactId: contact.id,
      language: "fr",
      issueDate: "2026-03-01",
      "line.description": ["Conseil", "Frais"],
      "line.quantity": ["2.5", "1"],
      "line.unit": ["hour", "flat"],
      "line.unitPrice": ["150", "40.50"],
      "line.vatCode": ["normal", "exempt"],
      "line.productId": ["", ""],
    }),
    { vatRegistered: true },
  );
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  const draft = await createInvoice(db, who, r.data, "quote");
  if (typeof draft !== "object" || !draft) throw new Error("brouillon");
  const quote = await issueInvoice(db, who, draft.id);
  if (typeof quote !== "object") throw new Error(quote);
  return { who, quote };
}

describe("factures d'acompte", () => {
  it("facturent un pourcentage par taux, puis se déduisent de la facture finale", async () => {
    const { who, quote } = await issuedQuote();
    expect(quote.netCents).toBe(41_550);

    expect(await createDepositInvoice(db, who, quote.id, 0, "2026-03-05")).toBe("percent");
    expect(await createDepositInvoice(db, who, quote.id, 120, "2026-03-05")).toBe("percent");
    const deposit = await createDepositInvoice(db, who, quote.id, 30, "2026-03-05");
    if (typeof deposit !== "object") throw new Error(deposit);
    expect(deposit).toMatchObject({ kind: "invoice", deposit: true, sourceQuoteId: quote.id });
    const found = await getInvoice(db, who.organizationId, deposit.id);
    expect(
      found?.lines.map((l) => [l.description, l.unitPriceCents, l.vatCode, l.vatRateBp]),
    ).toEqual([
      ["Acompte de 30\u202f% selon l’offre O-2026-0001", 11_250, "normal", 810],
      ["Acompte de 30\u202f% selon l’offre O-2026-0001", 1_215, "exempt", 0],
    ]);
    expect(deposit.netCents).toBe(12_465);
    // Plus de 100 % au total : refusé, brouillons compris.
    expect(await createDepositInvoice(db, who, quote.id, 75, "2026-03-05")).toBe("tooHigh");
    const issuedDeposit = await issueInvoice(db, who, deposit.id);
    if (typeof issuedDeposit !== "object") throw new Error(issuedDeposit);
    expect(issuedDeposit.number).toBe("2026-0001");
    expect(await depositInvoices(db, who.organizationId, quote.id)).toHaveLength(1);

    const final = await convertQuoteToInvoice(db, who, quote.id, "2026-04-01");
    if (typeof final !== "object") throw new Error(final);
    const finalFound = await getInvoice(db, who.organizationId, final.id);
    expect(
      finalFound?.lines.slice(2).map((l) => [l.description, l.quantityMilli, l.unitPriceCents]),
    ).toEqual([
      ["Moins facture d’acompte 2026-0001", -1000, 11_250],
      ["Moins facture d’acompte 2026-0001", -1000, 1_215],
    ]);
    expect(final.netCents).toBe(41_550 - 12_465);
    expect(final.deposit).toBe(false);
    // Plus d'acompte sur un devis facturé.
    expect(await createDepositInvoice(db, who, quote.id, 10, "2026-04-02")).toBe("notConvertible");
  });

  it("tire confirmation de commande et bon de livraison des bonnes pièces", async () => {
    expect(documentVariant("order", "quote")).toBe("order");
    expect(documentVariant("order", "invoice")).toBeNull();
    expect(documentVariant("delivery", "invoice")).toBe("delivery");
    expect(documentVariant("delivery", "credit_note")).toBeNull();
    expect(documentVariant(null, "invoice")).toBeNull();

    const { who, quote } = await issuedQuote();
    const found = await getInvoice(db, who.organizationId, quote.id);
    if (!found) throw new Error("devis");
    const pdf = await renderInvoicePdf({ ...found.invoice, number: "BL-2026-0001" }, found.lines, {
      invoice: "Bon de livraison",
      issueDate: "Date",
      serviceDate: "Prestation",
      dueDate: "Valable jusqu'au",
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
      hideDueDate: true,
      deliveryNote: { received: "Marchandise reçue :" },
    });
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  });
});
