import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { paymentReference } from "@/countries/ch/qr-reference";
import { VAT_CODES, type VatCode, vatRateBp } from "@/countries/ch/vat";
import { parseAmountToCents } from "@/lib/amount-input";
import { isIsoDate } from "@/lib/fiscal-year";
import { computeTotals, parseQuantityToMilli } from "@/lib/invoice-math";
import { vatNumberLabel } from "@/lib/swiss-ids";
import type { Db } from "./db";
import {
  auditLog,
  type Contact,
  contacts,
  type Invoice,
  type InvoiceLine,
  invoiceLines,
  invoices,
  numberSequences,
  organizations,
  type PartySnapshot,
} from "./db/schema";
import { PRODUCT_UNITS } from "./products";

type Who = { organizationId: string; userId: string };
export const DOCUMENT_KINDS = ["invoice", "quote"] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];
/** Durée de validité proposée pour un devis sans date saisie. */
export const QUOTE_VALIDITY_DAYS = 30;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const INVOICE_LANGUAGES = ["de", "fr"] as const;
export const MAX_LINES = 100;

export type InvoiceLineInput = {
  productId: string | null;
  description: string;
  quantityMilli: number;
  unit: (typeof PRODUCT_UNITS)[number];
  unitPriceCents: number;
  vatCode: VatCode | null;
};

export type InvoiceInput = {
  contactId: string;
  language: (typeof INVOICE_LANGUAGES)[number];
  title: string | null;
  introText: string | null;
  footerText: string | null;
  issueDate: string;
  serviceDate: string;
  dueDate: string | null;
  lines: InvoiceLineInput[];
};

/** Codes d'erreur par champ ; les lignes utilisent « lines.3.unitPrice ». */
export type InvoiceErrors = Record<string, string>;

const text = (form: FormData, key: string) => String(form.get(key) ?? "").trim();
const optional = (value: string) => (value === "" ? null : value);
const all = (form: FormData, key: string) => form.getAll(key).map((v) => String(v).trim());

export function parseInvoiceForm(
  form: FormData,
  options: { vatRegistered: boolean },
): { ok: true; data: InvoiceInput } | { ok: false; errors: InvoiceErrors } {
  const errors: InvoiceErrors = {};
  const contactId = text(form, "contactId");
  if (!UUID.test(contactId)) errors.contactId = "required";

  const language = text(form, "language") as InvoiceInput["language"];
  if (!INVOICE_LANGUAGES.includes(language)) errors.language = "required";

  const issueDate = text(form, "issueDate");
  if (!isIsoDate(issueDate)) errors.issueDate = "date";
  const serviceDate = text(form, "serviceDate") || issueDate;
  if (!isIsoDate(serviceDate)) errors.serviceDate = "date";
  const dueDate = optional(text(form, "dueDate"));
  if (dueDate && !isIsoDate(dueDate)) errors.dueDate = "date";
  else if (dueDate && isIsoDate(issueDate) && dueDate < issueDate)
    errors.dueDate = "dueBeforeIssue";

  let rateDateOk = true;
  if (options.vatRegistered && isIsoDate(serviceDate)) {
    try {
      vatRateBp("normal", serviceDate);
    } catch {
      rateDateOk = false;
      errors.serviceDate = "vatDate";
    }
  }

  const descriptions = all(form, "line.description");
  const quantities = all(form, "line.quantity");
  const units = all(form, "line.unit");
  const prices = all(form, "line.unitPrice");
  const vatCodes = all(form, "line.vatCode");
  const productIds = all(form, "line.productId");
  const lines: InvoiceLineInput[] = [];
  descriptions.forEach((description, i) => {
    const quantity = quantities[i] ?? "";
    const price = prices[i] ?? "";
    // Une ligne entièrement vide est ignorée : c'est la ligne prête à remplir en bas du tableau.
    if (!description && !price && (!quantity || quantity === "1")) return;
    const n = lines.length;
    if (!description) errors[`lines.${n}.description`] = "required";
    else if (description.length > 500) errors[`lines.${n}.description`] = "tooLong";
    const quantityMilli = parseQuantityToMilli(quantity || "1");
    if (quantityMilli === null || quantityMilli === 0) errors[`lines.${n}.quantity`] = "quantity";
    const unit = (units[i] ?? "") as InvoiceLineInput["unit"];
    if (!PRODUCT_UNITS.includes(unit)) errors[`lines.${n}.unit`] = "required";
    const unitPriceCents = parseAmountToCents(price);
    if (unitPriceCents === null) errors[`lines.${n}.unitPrice`] = "amount";
    let vatCode: VatCode | null = null;
    if (options.vatRegistered) {
      vatCode = (vatCodes[i] ?? "") as VatCode;
      if (!VAT_CODES.includes(vatCode)) errors[`lines.${n}.vatCode`] = "required";
    }
    const productId = productIds[i] ?? "";
    lines.push({
      productId: UUID.test(productId) ? productId : null,
      description,
      quantityMilli: quantityMilli ?? 0,
      unit,
      unitPriceCents: unitPriceCents ?? 0,
      vatCode,
    });
  });
  if (lines.length === 0) errors.lines = "noLines";
  if (lines.length > MAX_LINES) errors.lines = "tooManyLines";

  if (Object.keys(errors).length > 0 || !rateDateOk) return { ok: false, errors };
  return {
    ok: true,
    data: {
      contactId,
      language,
      title: optional(text(form, "title")),
      introText: optional(text(form, "introText")),
      footerText: optional(text(form, "footerText")),
      issueDate,
      serviceDate,
      dueDate,
      lines,
    },
  };
}

function addDays(iso: string, days: number) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function priced(data: InvoiceInput, vatRegistered: boolean) {
  const rates = data.lines.map((l) =>
    vatRegistered && l.vatCode ? vatRateBp(l.vatCode, data.serviceDate) : 0,
  );
  const totals = computeTotals(
    data.lines.map((l, i) => ({
      quantityMilli: l.quantityMilli,
      unitPriceCents: l.unitPriceCents,
      vatRateBp: rates[i] ?? 0,
    })),
  );
  return { rates, totals };
}

async function customerOf(database: Db, organizationId: string, contactId: string) {
  const [row] = await database
    .select()
    .from(contacts)
    .where(
      and(
        eq(contacts.id, contactId),
        eq(contacts.organizationId, organizationId),
        isNull(contacts.archivedAt),
      ),
    )
    .limit(1);
  return row ?? null;
}

async function vatRegisteredOf(database: Db, organizationId: string) {
  const [row] = await database
    .select({ vatRegistered: organizations.vatRegistered })
    .from(organizations)
    .where(eq(organizations.id, organizationId));
  return row?.vatRegistered ?? false;
}

export async function isVatRegistered(database: Db, organizationId: string) {
  return vatRegisteredOf(database, organizationId);
}

type SaveResult = Invoice | "contact" | "notDraft" | null;

async function writeInvoice(
  database: Db,
  who: Who,
  data: InvoiceInput,
  id: string | null,
  kind: DocumentKind,
  sourceQuoteId: string | null = null,
): Promise<SaveResult> {
  const contact = await customerOf(database, who.organizationId, data.contactId);
  if (!contact) return "contact";
  const vatRegistered = await vatRegisteredOf(database, who.organizationId);
  const { rates, totals } = priced(data, vatRegistered);
  const values = {
    contactId: contact.id,
    language: data.language,
    title: data.title,
    introText: data.introText,
    footerText: data.footerText,
    issueDate: data.issueDate,
    serviceDate: data.serviceDate,
    dueDate:
      data.dueDate ??
      addDays(data.issueDate, kind === "quote" ? QUOTE_VALIDITY_DAYS : contact.paymentTermDays),
    vatRegistered,
    netCents: totals.netCents,
    vatCents: totals.vatCents,
    totalCents: totals.totalCents,
    updatedAt: new Date(),
  };
  return database.transaction(async (tx) => {
    let invoice: Invoice | undefined;
    if (id) {
      [invoice] = await tx
        .update(invoices)
        .set(values)
        .where(
          and(
            eq(invoices.id, id),
            eq(invoices.organizationId, who.organizationId),
            eq(invoices.kind, kind),
            eq(invoices.status, "draft"),
          ),
        )
        .returning();
      if (!invoice) return "notDraft";
      await tx.delete(invoiceLines).where(eq(invoiceLines.invoiceId, id));
    } else {
      [invoice] = await tx
        .insert(invoices)
        .values({
          ...values,
          kind,
          sourceQuoteId,
          organizationId: who.organizationId,
          createdBy: who.userId,
        })
        .returning();
      if (!invoice) throw new Error("invoice_not_saved");
    }
    const invoiceId = invoice.id;
    await tx.insert(invoiceLines).values(
      data.lines.map((l, i) => ({
        invoiceId,
        position: i + 1,
        productId: l.productId,
        description: l.description,
        quantityMilli: l.quantityMilli,
        unit: l.unit,
        unitPriceCents: l.unitPriceCents,
        vatCode: vatRegistered ? l.vatCode : null,
        vatRateBp: rates[i] ?? 0,
        netCents: totals.lines[i] ?? 0,
      })),
    );
    await tx.insert(auditLog).values({
      organizationId: who.organizationId,
      userId: who.userId,
      action: `${kind}.${id ? "update" : "create"}`,
      entity: kind,
      entityId: invoiceId,
      data: { totalCents: totals.totalCents },
    });
    return invoice;
  });
}

export async function createInvoice(
  database: Db,
  who: Who,
  data: InvoiceInput,
  kind: DocumentKind = "invoice",
) {
  return writeInvoice(database, who, data, null, kind);
}

/** Modifie un brouillon de l'organisation ; une pièce émise ne change plus. */
export async function updateInvoice(
  database: Db,
  who: Who,
  id: string,
  data: InvoiceInput,
  kind: DocumentKind = "invoice",
) {
  if (!UUID.test(id)) return null;
  return writeInvoice(database, who, data, id, kind);
}

export async function getInvoice(
  database: Db,
  organizationId: string,
  id: string,
): Promise<{ invoice: Invoice; lines: InvoiceLine[]; contact: Contact } | null> {
  if (!UUID.test(id)) return null;
  const [row] = await database
    .select({ invoice: invoices, contact: contacts })
    .from(invoices)
    .innerJoin(contacts, eq(contacts.id, invoices.contactId))
    .where(and(eq(invoices.id, id), eq(invoices.organizationId, organizationId)))
    .limit(1);
  if (!row) return null;
  const lines = await database
    .select()
    .from(invoiceLines)
    .where(eq(invoiceLines.invoiceId, id))
    .orderBy(asc(invoiceLines.position));
  return { ...row, lines };
}

export type InvoiceRow = Pick<
  Invoice,
  "id" | "number" | "status" | "issueDate" | "dueDate" | "totalCents" | "currency"
> & { contactName: string };

export async function listInvoices(
  database: Db,
  organizationId: string,
  kind: DocumentKind = "invoice",
): Promise<InvoiceRow[]> {
  return database
    .select({
      id: invoices.id,
      number: invoices.number,
      status: invoices.status,
      issueDate: invoices.issueDate,
      dueDate: invoices.dueDate,
      totalCents: invoices.totalCents,
      currency: invoices.currency,
      contactName: contacts.name,
    })
    .from(invoices)
    .innerJoin(contacts, eq(contacts.id, invoices.contactId))
    .where(and(eq(invoices.organizationId, organizationId), eq(invoices.kind, kind)))
    .orderBy(desc(invoices.issueDate), desc(invoices.createdAt))
    .limit(500);
}

export async function deleteDraft(database: Db, who: Who, id: string): Promise<boolean> {
  if (!UUID.test(id)) return false;
  const [row] = await database
    .delete(invoices)
    .where(
      and(
        eq(invoices.id, id),
        eq(invoices.organizationId, who.organizationId),
        eq(invoices.status, "draft"),
      ),
    )
    .returning({ id: invoices.id });
  if (!row) return false;
  await database.insert(auditLog).values({
    organizationId: who.organizationId,
    userId: who.userId,
    action: "document.delete_draft",
    entity: "invoice",
    entityId: id,
  });
  return true;
}

/**
 * « 2026-0001 » pour une facture, « O-2026-0001 » pour un devis (Offerte, offre) : année de la date
 * de la pièce, compteur sans trou par année et par type.
 */
export function formatInvoiceNumber(year: number, value: number, kind: DocumentKind = "invoice") {
  return `${kind === "quote" ? "O-" : ""}${year}-${String(value).padStart(4, "0")}`;
}

export type IssueResult = Invoice | "notFound" | "notDraft" | "companyIncomplete" | "vatChanged";

/**
 * Émet un brouillon : numéro définitif, expéditeur et destinataire figés. Le numéro est pris dans la
 * même transaction que le changement d'état, si bien qu'un échec ne laisse aucun trou.
 */
export async function issueInvoice(database: Db, who: Who, id: string): Promise<IssueResult> {
  if (!UUID.test(id)) return "notFound";
  return database.transaction(async (tx) => {
    const [row] = await tx
      .select({ invoice: invoices, contact: contacts })
      .from(invoices)
      .innerJoin(contacts, eq(contacts.id, invoices.contactId))
      .where(and(eq(invoices.id, id), eq(invoices.organizationId, who.organizationId)))
      .for("update", { of: invoices })
      .limit(1);
    if (!row) return "notFound";
    if (row.invoice.status !== "draft") return "notDraft";
    const [org] = await tx
      .select()
      .from(organizations)
      .where(eq(organizations.id, who.organizationId));
    if (!org?.settingsCompletedAt) return "companyIncomplete";
    if (org.vatRegistered !== row.invoice.vatRegistered) return "vatChanged";

    const kind = row.invoice.kind as DocumentKind;
    const year = Number(row.invoice.issueDate.slice(0, 4));
    const [seq] = await tx
      .insert(numberSequences)
      .values({ organizationId: who.organizationId, kind, year, lastValue: 1 })
      .onConflictDoUpdate({
        target: [numberSequences.organizationId, numberSequences.kind, numberSequences.year],
        set: { lastValue: sql`${numberSequences.lastValue} + 1` },
      })
      .returning({ value: numberSequences.lastValue });
    if (!seq) throw new Error("sequence_failed");

    const c = row.contact;
    const recipient: PartySnapshot = {
      name: c.name,
      contactPerson: c.contactPerson,
      street: c.street,
      buildingNumber: c.buildingNumber,
      postalCode: c.postalCode,
      town: c.town,
      country: c.country,
      uid: c.uid,
      email: c.email,
    };
    const sender: PartySnapshot = {
      name: org.legalName ?? org.name,
      street: org.street,
      buildingNumber: org.buildingNumber,
      postalCode: org.postalCode,
      town: org.town,
      country: org.country,
      uid: org.uid,
      email: org.email,
      phone: org.phone,
      iban: org.iban,
      qrIban: org.qrIban,
      vatNumber:
        org.vatRegistered && org.uid ? vatNumberLabel(org.uid, row.invoice.language) : null,
    };
    const number = formatInvoiceNumber(year, seq.value, kind);
    const [issued] = await tx
      .update(invoices)
      .set({
        status: "issued",
        number,
        paymentReference: kind === "invoice" ? paymentReference(number, !!org.qrIban) : null,
        recipient,
        sender,
        issuedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(invoices.id, id))
      .returning();
    if (!issued) throw new Error("issue_failed");
    await tx.insert(auditLog).values({
      organizationId: who.organizationId,
      userId: who.userId,
      action: `${kind}.issue`,
      entity: kind,
      entityId: id,
      data: { number: issued.number, totalCents: issued.totalCents },
    });
    return issued;
  });
}

/** Accepté ou refusé par le client : seulement pour un devis émis et pas encore facturé. */
export async function setQuoteOutcome(
  database: Db,
  who: Who,
  id: string,
  outcome: "accepted" | "declined",
): Promise<boolean> {
  if (!UUID.test(id)) return false;
  const [row] = await database
    .update(invoices)
    .set({ status: outcome, updatedAt: new Date() })
    .where(
      and(
        eq(invoices.id, id),
        eq(invoices.organizationId, who.organizationId),
        eq(invoices.kind, "quote"),
        inArray(invoices.status, ["issued", "accepted", "declined"]),
      ),
    )
    .returning({ id: invoices.id });
  if (!row) return false;
  await database.insert(auditLog).values({
    organizationId: who.organizationId,
    userId: who.userId,
    action: `quote.${outcome}`,
    entity: "quote",
    entityId: id,
  });
  return true;
}

/**
 * Transforme un devis émis ou accepté en brouillon de facture : mêmes client, textes et lignes, datée
 * du jour. La TVA est recalculée à la date de la prestation de la facture. Le devis passe à
 * « facturé » dans la même transaction, si bien qu'il ne peut pas être facturé deux fois.
 */
export async function convertQuoteToInvoice(
  database: Db,
  who: Who,
  quoteId: string,
  today: string,
): Promise<Invoice | "notConvertible" | "contact"> {
  const found = await getInvoice(database, who.organizationId, quoteId);
  if (found?.invoice.kind !== "quote") return "notConvertible";
  const { invoice: quote, lines } = found;
  return database
    .transaction(async (tx) => {
      const [claimed] = await tx
        .update(invoices)
        .set({ status: "invoiced", updatedAt: new Date() })
        .where(
          and(
            eq(invoices.id, quoteId),
            eq(invoices.organizationId, who.organizationId),
            inArray(invoices.status, ["issued", "accepted"]),
          ),
        )
        .returning({ id: invoices.id });
      if (!claimed) return "notConvertible";
      const result = await writeInvoice(
        tx as unknown as Db,
        who,
        {
          contactId: quote.contactId,
          language: quote.language as InvoiceInput["language"],
          title: null,
          introText: quote.introText,
          footerText: quote.footerText,
          issueDate: today,
          serviceDate: today,
          dueDate: null,
          lines: lines.map((l) => ({
            productId: l.productId,
            description: l.description,
            quantityMilli: l.quantityMilli,
            unit: l.unit as InvoiceLineInput["unit"],
            unitPriceCents: l.unitPriceCents,
            vatCode: (l.vatCode as VatCode | null) ?? "normal",
          })),
        },
        null,
        "invoice",
        quoteId,
      );
      if (result === "contact") {
        // Client archivé entre-temps : on annule le passage à « facturé ».
        tx.rollback();
      }
      if (typeof result !== "object" || !result) throw new Error("conversion_failed");
      await tx.insert(auditLog).values({
        organizationId: who.organizationId,
        userId: who.userId,
        action: "quote.convert",
        entity: "quote",
        entityId: quoteId,
        data: { invoiceId: result.id },
      });
      return result;
    })
    .catch((e: unknown) => {
      if (e instanceof Error && /rollback/i.test(e.message)) return "contact" as const;
      throw e;
    });
}
