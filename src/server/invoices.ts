import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { countryPack } from "@/countries";
import { paymentReference } from "@/countries/ch/qr-reference";
import { VAT_CODES, type VatCode } from "@/countries/ch/vat";
import { parseAmountToCents } from "@/lib/amount-input";
import { type Currency, isCurrency, parseFxRate } from "@/lib/currencies";
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
import { fetchFxRate } from "./fx";
import { PRODUCT_UNITS } from "./products";
import { emitEvent, invoiceSummary } from "./webhooks";

type Who = { organizationId: string; userId: string };
export const DOCUMENT_KINDS = ["invoice", "quote", "credit_note"] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];
/** Durée de validité proposée pour un devis sans date saisie. */
export const QUOTE_VALIDITY_DAYS = 30;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const INVOICE_LANGUAGES = ["de", "fr", "en"] as const;

/** Langue de document admise, allemand par défaut. */
export function documentLanguage(value: unknown): (typeof INVOICE_LANGUAGES)[number] {
  return value === "fr" || value === "en" ? value : "de";
}
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
  /** Devise de la pièce ; absente, celle de l'entreprise. */
  currency?: Currency;
  /** Cours saisi pour une pièce en devise ; absent, le cours BCE du jour d'émission. */
  fxRate?: number | null;
  lines: InvoiceLineInput[];
};

/** Codes d'erreur par champ ; les lignes utilisent « lines.3.unitPrice ». */
export type InvoiceErrors = Record<string, string>;

const text = (form: FormData, key: string) => String(form.get(key) ?? "").trim();
const optional = (value: string) => (value === "" ? null : value);
const all = (form: FormData, key: string) => form.getAll(key).map((v) => String(v).trim());

export function parseInvoiceForm(
  form: FormData,
  options: { vatRegistered: boolean; country?: string | null },
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

  const home = countryPack(options.country).currency;
  const currency = text(form, "currency") || home;
  if (!isCurrency(currency)) errors.currency = "required";
  let fxRate: number | null = null;
  const fxText = text(form, "fxRate");
  if (currency !== home && fxText) {
    fxRate = parseFxRate(fxText);
    if (fxRate === null) errors.fxRate = "fxRate";
  }

  let rateDateOk = true;
  if (options.vatRegistered && isIsoDate(serviceDate)) {
    try {
      countryPack(options.country).vatRateBp("normal", serviceDate);
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
      currency: currency as Currency,
      fxRate,
      lines,
    },
  };
}

function addDays(iso: string, days: number) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function priced(
  data: InvoiceInput,
  vatRegistered: boolean,
  country: string,
  localRateBp: number | null = null,
) {
  const { vatRateBp } = countryPack(country);
  const rates = data.lines.map((l) =>
    vatRegistered && l.vatCode ? vatRateBp(l.vatCode, data.serviceDate, localRateBp) : 0,
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

async function taxProfileOf(database: Db, organizationId: string) {
  const [row] = await database
    .select({
      vatRegistered: organizations.vatRegistered,
      country: organizations.country,
      salesTaxRateBp: organizations.salesTaxRateBp,
    })
    .from(organizations)
    .where(eq(organizations.id, organizationId));
  const pack = countryPack(row?.country);
  return {
    vatRegistered: row?.vatRegistered ?? false,
    country: pack.code,
    currency: pack.currency,
    localRateBp: row?.salesTaxRateBp ?? null,
  };
}

async function vatRegisteredOf(database: Db, organizationId: string) {
  return (await taxProfileOf(database, organizationId)).vatRegistered;
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
  links: { sourceQuoteId?: string; relatedInvoiceId?: string } = {},
): Promise<SaveResult> {
  if (kind === "credit_note" && id) {
    // Un avoir reste au nom du client de sa facture, quoi que dise le formulaire.
    const [current] = await database
      .select({ contactId: invoices.contactId })
      .from(invoices)
      .where(and(eq(invoices.id, id), eq(invoices.organizationId, who.organizationId)));
    if (current) data = { ...data, contactId: current.contactId };
  }
  const contact = await customerOf(database, who.organizationId, data.contactId);
  if (!contact) return "contact";
  const {
    vatRegistered,
    country,
    currency: home,
    localRateBp,
  } = await taxProfileOf(database, who.organizationId);
  let currency: string = data.currency ?? home;
  let fxRate = currency === home ? null : (data.fxRate ?? null);
  if (kind === "credit_note") {
    // L'avoir est dans la devise et au cours de sa facture : il en annule une part exacte.
    let relatedId = links.relatedInvoiceId ?? null;
    if (!relatedId && id) {
      const [current] = await database
        .select({ relatedInvoiceId: invoices.relatedInvoiceId })
        .from(invoices)
        .where(and(eq(invoices.id, id), eq(invoices.organizationId, who.organizationId)));
      relatedId = current?.relatedInvoiceId ?? null;
    }
    if (relatedId) {
      const [related] = await database
        .select({ currency: invoices.currency, fxRate: invoices.fxRate })
        .from(invoices)
        .where(and(eq(invoices.id, relatedId), eq(invoices.organizationId, who.organizationId)));
      if (related) {
        currency = related.currency;
        fxRate = related.fxRate;
      }
    }
  }
  const { rates, totals } = priced(data, vatRegistered, country, localRateBp);
  const values = {
    contactId: contact.id,
    language: data.language,
    title: data.title,
    introText: data.introText,
    footerText: data.footerText,
    issueDate: data.issueDate,
    serviceDate: data.serviceDate,
    dueDate:
      kind === "credit_note"
        ? data.issueDate
        : (data.dueDate ??
          addDays(
            data.issueDate,
            kind === "quote" ? QUOTE_VALIDITY_DAYS : contact.paymentTermDays,
          )),
    vatRegistered,
    currency,
    fxRate,
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
          sourceQuoteId: links.sourceQuoteId ?? null,
          relatedInvoiceId: links.relatedInvoiceId ?? null,
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
): Promise<{
  invoice: Invoice;
  lines: InvoiceLine[];
  contact: Contact;
  related: { id: string; number: string | null } | null;
} | null> {
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
  let related: { id: string; number: string | null } | null = null;
  if (row.invoice.relatedInvoiceId) {
    const [r] = await database
      .select({ id: invoices.id, number: invoices.number })
      .from(invoices)
      .where(
        and(
          eq(invoices.id, row.invoice.relatedInvoiceId),
          eq(invoices.organizationId, organizationId),
        ),
      );
    related = r ?? null;
  }
  return { ...row, lines, related };
}

export type InvoiceRow = Pick<
  Invoice,
  "id" | "number" | "status" | "issueDate" | "dueDate" | "totalCents" | "currency"
> & { contactName: string; paidCents: number; creditedCents: number; chargesCents: number };

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
      paidCents:
        sql<number>`coalesce((select sum(p.amount_cents) from invoice_payments p where p.invoice_id = ${invoices.id}), 0)::bigint`.mapWith(
          Number,
        ),
      creditedCents:
        sql<number>`coalesce((select sum(c.total_cents) from invoices c where c.related_invoice_id = ${invoices.id} and c.kind = 'credit_note' and c.status = 'issued'), 0)::bigint`.mapWith(
          Number,
        ),
      chargesCents:
        sql<number>`coalesce((select sum(r.fee_cents + r.interest_cents) from invoice_reminders r where r.invoice_id = ${invoices.id} and r.waived_at is null), 0)::bigint`.mapWith(
          Number,
        ),
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
 * « 2026-0001 » pour une facture, « O-2026-0001 » pour un devis (Offerte, offre), « G-2026-0001 »
 * pour un avoir (Gutschrift) : année de la date
 * de la pièce, compteur sans trou par année et par type.
 */
export function formatInvoiceNumber(year: number, value: number, kind: DocumentKind = "invoice") {
  const prefix = kind === "quote" ? "O-" : kind === "credit_note" ? "G-" : "";
  return `${prefix}${year}-${String(value).padStart(4, "0")}`;
}

export type IssueResult =
  | Invoice
  | "notFound"
  | "notDraft"
  | "companyIncomplete"
  | "vatChanged"
  | "creditTooHigh"
  | "fxRate";

/**
 * Émet un brouillon : numéro définitif, expéditeur et destinataire figés. Le numéro est pris dans la
 * même transaction que le changement d'état, si bien qu'un échec ne laisse aucun trou.
 */
export async function issueInvoice(
  database: Db,
  who: Who,
  id: string,
  fetcher?: typeof fetch,
): Promise<IssueResult> {
  if (!UUID.test(id)) return "notFound";
  // Facture en devise sans cours saisi : cours BCE du jour d'émission, cherché hors transaction.
  const [draft] = await database
    .select({
      kind: invoices.kind,
      currency: invoices.currency,
      fxRate: invoices.fxRate,
      issueDate: invoices.issueDate,
      home: organizations.currency,
    })
    .from(invoices)
    .innerJoin(organizations, eq(organizations.id, invoices.organizationId))
    .where(and(eq(invoices.id, id), eq(invoices.organizationId, who.organizationId)));
  let fetchedRate: number | null = null;
  if (draft && draft.kind === "invoice" && draft.currency !== draft.home && draft.fxRate === null) {
    fetchedRate = await fetchFxRate(draft.currency, draft.home, draft.issueDate, fetcher);
    if (fetchedRate === null) return "fxRate";
  }
  const result = await database.transaction(async (tx): Promise<IssueResult> => {
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
    let fxRate = row.invoice.currency === org.currency ? null : (row.invoice.fxRate ?? fetchedRate);

    const kind = row.invoice.kind as DocumentKind;
    if (kind === "credit_note") {
      // L'avoir ne peut dépasser ce qui reste à créditer sur sa facture, ni changer de client.
      const relatedId = row.invoice.relatedInvoiceId;
      if (!relatedId) return "notFound";
      const [target] = await tx
        .select()
        .from(invoices)
        .where(and(eq(invoices.id, relatedId), eq(invoices.organizationId, who.organizationId)))
        .for("update");
      if (target?.status !== "issued" || target.contactId !== row.invoice.contactId)
        return "notFound";
      const credited = await creditedCents(tx as unknown as Db, relatedId);
      if (row.invoice.totalCents <= 0 || credited + row.invoice.totalCents > target.totalCents)
        return "creditTooHigh";
      if (target.currency !== row.invoice.currency) return "notFound";
      fxRate = target.fxRate;
    }
    if (kind !== "quote" && row.invoice.currency !== org.currency && !fxRate) return "fxRate";
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
      region: c.region,
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
      region: org.region,
      country: org.country,
      uid: org.uid,
      email: org.email,
      phone: org.phone,
      iban: org.iban,
      qrIban: org.qrIban,
      vatNumber:
        org.vatRegistered && org.uid ? vatNumberLabel(org.uid, row.invoice.language) : null,
      taxNumber: ["DE", "FR", "GB", "US"].includes(org.country) ? org.taxNumber : null,
    };
    const number = formatInvoiceNumber(year, seq.value, kind);
    const [issued] = await tx
      .update(invoices)
      .set({
        status: "issued",
        number,
        fxRate,
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
  if (typeof result === "object" && result.kind !== "quote")
    await emitEvent(database, who.organizationId, "invoice.issued", {
      invoice: invoiceSummary(result),
    });
  return result;
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
          currency: quote.currency as Currency,
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
        { sourceQuoteId: quoteId },
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

/** Somme des avoirs émis sur une facture. */
export async function creditedCents(database: Db, invoiceId: string): Promise<number> {
  const [row] = await database
    .select({ sum: sql<string | null>`sum(${invoices.totalCents})` })
    .from(invoices)
    .where(
      and(
        eq(invoices.relatedInvoiceId, invoiceId),
        eq(invoices.kind, "credit_note"),
        eq(invoices.status, "issued"),
      ),
    );
  return Number(row?.sum ?? 0);
}

/**
 * Prépare un avoir sur une facture émise : brouillon reprenant toutes ses lignes (annulation
 * complète), à réduire pour un avoir partiel. La date de prestation reste celle de la facture, pour
 * que la TVA corrigée soit celle qui a été facturée.
 */
export async function createCreditNote(
  database: Db,
  who: Who,
  invoiceId: string,
  today: string,
): Promise<Invoice | "notFound" | "contact"> {
  const found = await getInvoice(database, who.organizationId, invoiceId);
  if (found?.invoice.kind !== "invoice" || found.invoice.status !== "issued") return "notFound";
  const { invoice, lines } = found;
  const result = await writeInvoice(
    database,
    who,
    {
      contactId: invoice.contactId,
      language: invoice.language as InvoiceInput["language"],
      title: null,
      introText: null,
      footerText: null,
      issueDate: today < invoice.issueDate ? invoice.issueDate : today,
      serviceDate: invoice.serviceDate,
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
    "credit_note",
    { relatedInvoiceId: invoice.id },
  );
  if (result === "contact") return "contact";
  if (typeof result !== "object" || !result) throw new Error("credit_note_failed");
  return result;
}
