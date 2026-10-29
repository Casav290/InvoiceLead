import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { VAT_CODES } from "@/countries/ch/vat";
import { formatQuantity } from "@/lib/invoice-math";
import { toForm } from "../api";
import {
  CONTACT_COUNTRIES,
  type ContactInput,
  createContactWithinPlan,
  DOCUMENT_LANGUAGES,
  getContact,
  parseContactForm,
  updateContact,
} from "../contacts";
import { detachCrmlead } from "../crmlead-sync";
import type { Contact, Organization } from "../db/schema";
import { recurringInvoices, webhookDeliveries } from "../db/schema";
import {
  convertQuoteToInvoice,
  createCreditNote,
  createDepositInvoice,
  createInvoice,
  creditedCents,
  getInvoice,
  INVOICE_LANGUAGES,
  type InvoiceInput,
  issueInvoice,
  isVatRegistered,
  parseInvoiceForm,
  setQuoteOutcome,
  updateInvoice,
} from "../invoices";
import { featureAccess } from "../plans";
import { addMonths, createRecurring, INTERVALS, setRecurringActive } from "../recurring";
import { dueReminders, waiveCharges } from "../reminders";
import {
  type AssistantContext,
  type ConfirmSummary,
  changes,
  DOCUMENT_VIEW_KEYS,
  dateField,
  defineOp,
  documentPath,
  documentSummary,
  documentView,
  enumField,
  fail,
  filled,
  moneyField,
  type OpOutcome,
  type SummaryField,
  text,
  who,
} from "./ops-core";

/**
 * Opérations de facturation : contacts, brouillons de factures, devis et avoirs, émission, issue d'un
 * devis, passage en facture, acompte, avoir, récurrence, frais de relance. Mêmes fonctions et mêmes
 * conditions que la page de la pièce (DocumentPages.tsx) et ses actions serveur.
 */

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .describe("YYYY-MM-DD");
const amount = z.union([z.string().max(20), z.number()]);

// Contacts

export const contactFields = {
  name: z.string().max(70).optional(),
  kind: z.enum(["company", "person"]).optional(),
  isCustomer: z.boolean().optional(),
  isSupplier: z.boolean().optional(),
  contactPerson: z.string().max(70).optional(),
  email: z.string().max(200).optional(),
  phone: z.string().max(40).optional(),
  street: z.string().max(70).optional(),
  buildingNumber: z.string().max(16).optional(),
  postalCode: z.string().max(16).optional(),
  town: z.string().max(35).optional(),
  region: z.string().max(35).optional().describe("US state code (TX, NY…) for US addresses"),
  country: z.enum(CONTACT_COUNTRIES).optional(),
  language: z.enum(DOCUMENT_LANGUAGES).optional(),
  uid: z.string().max(40).optional().describe("company VAT / UID number"),
  paymentTermDays: z.number().int().min(0).max(365).optional(),
  notes: z.string().max(1000).optional(),
};

const CONTACT_FIELDS = [
  "kind",
  "name",
  "contactPerson",
  "email",
  "phone",
  "street",
  "buildingNumber",
  "postalCode",
  "town",
  "region",
  "country",
  "language",
  "uid",
  "paymentTermDays",
  "notes",
] as const;

type Json = Record<string, unknown>;
const has = (o: Json, k: string) => Object.hasOwn(o, k) && o[k] !== undefined && o[k] !== null;

function homeLanguage(org: Organization, wanted: readonly string[]) {
  return wanted.includes(org.defaultLocale) ? org.defaultLocale : (wanted[0] ?? "en");
}

function contactDefaults(org: Organization): Json {
  return {
    kind: "company",
    isCustomer: true,
    isSupplier: false,
    country: (CONTACT_COUNTRIES as readonly string[]).includes(org.country) ? org.country : "CH",
    language: homeLanguage(org, DOCUMENT_LANGUAGES),
  };
}

function contactForm(c: Contact): Json {
  return {
    kind: c.kind,
    isCustomer: c.isCustomer,
    isSupplier: c.isSupplier,
    name: c.name,
    contactPerson: c.contactPerson ?? "",
    email: c.email ?? "",
    phone: c.phone ?? "",
    street: c.street ?? "",
    buildingNumber: c.buildingNumber ?? "",
    postalCode: c.postalCode ?? "",
    town: c.town ?? "",
    region: c.region ?? "",
    country: c.country,
    language: c.language,
    uid: c.uid ?? "",
    paymentTermDays: String(c.paymentTermDays),
    notes: c.notes ?? "",
  };
}

/** Seulement les champs connus de la demande (jamais l'entreprise ni un identifiant). */
function contactPatch(input: Json): Json {
  const out: Json = {};
  for (const k of CONTACT_FIELDS) if (has(input, k)) out[k] = input[k];
  for (const k of ["isCustomer", "isSupplier"])
    if (typeof input[k] === "boolean") out[k] = input[k];
  return out;
}

/** Valeurs d'un contact telles que la carte les montre. */
function contactView(c: ContactInput | Contact): Json {
  const address = [
    [c.street, c.buildingNumber].filter(Boolean).join(" "),
    [c.postalCode, c.town].filter(Boolean).join(" "),
  ]
    .filter(Boolean)
    .join(", ");
  return {
    name: c.name,
    kind: c.kind,
    role: [c.isCustomer && "customer", c.isSupplier && "supplier"].filter(Boolean).join("+"),
    email: c.email ?? "",
    phone: c.phone ?? "",
    contactPerson: c.contactPerson ?? "",
    address,
    region: c.region ?? "",
    country: c.country,
    language: c.language,
    uid: c.uid ?? "",
    paymentTermDays: String(c.paymentTermDays),
    // Note interne : relue plus tard par get_contact, elle n'est jamais écrite sans être vue.
    notes: c.notes ?? "",
  };
}

const CONTACT_VIEW_KEYS = [
  { key: "name" },
  { key: "kind", format: "enum" as const },
  { key: "role", format: "enum" as const },
  { key: "email" },
  { key: "phone" },
  { key: "contactPerson" },
  { key: "address" },
  { key: "region" },
  { key: "country" },
  { key: "language" },
  { key: "uid" },
  { key: "paymentTermDays" },
  { key: "notes" },
];

function contactSummary(action: string, c: Contact): ConfirmSummary {
  const v = contactView(c);
  return {
    action,
    fields: filled(
      CONTACT_VIEW_KEYS.map((k) => ({
        key: k.key,
        value: String(v[k.key] ?? ""),
        ...(k.format ? { format: k.format } : {}),
      })),
    ),
  };
}

function parseContact(merged: Json) {
  const parsed = parseContactForm(toForm(merged, ["isCustomer", "isSupplier"]));
  return parsed.ok
    ? parsed
    : { ok: false as const, error: `invalid ${JSON.stringify(parsed.errors)}` };
}

export const createContactOp = defineOp({
  id: "create_contact",
  permission: "billing",
  description:
    "PROPOSE a new contact (customer by default, supplier with isSupplier). Search first to avoid duplicates. Nothing is saved until the user clicks Confirm on the card.",
  schema: z.object({ ...contactFields, name: z.string().min(1).max(70) }),
  async run(ctx, input) {
    const parsed = parseContact({ ...contactDefaults(ctx.organization), ...contactPatch(input) });
    if (!parsed.ok) return fail(parsed.error);
    const created = await createContactWithinPlan(ctx.database, who(ctx), parsed.data);
    if (created === "planLimit") return fail("plan_limit");
    return {
      ok: true,
      result: {
        action: "create_contact",
        id: created.id,
        entity: "contact",
        path: `/app/contacts/${created.id}`,
        label: created.name,
      },
      summary: contactSummary("create_contact", created),
      item: { action: "create_contact", label: created.name, detail: created.kind },
    };
  },
});

export const updateContactOp = defineOp({
  id: "update_contact",
  permission: "billing",
  description:
    "PROPOSE changes to an existing contact: its id and only the fields to change. Nothing is saved until the user confirms.",
  schema: z.object({ contactId: z.string(), ...contactFields }),
  refs: { contactId: "contact" },
  async run(ctx, input) {
    const current = await getContact(ctx.database, ctx.organization.id, input.contactId);
    if (!current || current.archivedAt) return fail("contact_not_found");
    const parsed = parseContact({ ...contactForm(current), ...contactPatch(input) });
    if (!parsed.ok) return fail(parsed.error);
    const fields = changes(contactView(current), contactView(parsed.data), CONTACT_VIEW_KEYS);
    if (fields.length === 0) return fail("no_change");
    const updated = await updateContact(ctx.database, who(ctx), current.id, parsed.data);
    if (!updated) return fail("contact_not_found");
    const named = fields.some((f) => f.key === "name")
      ? fields
      : [text("contact", updated.name), ...fields];
    return {
      ok: true,
      result: {
        action: "update_contact",
        id: updated.id,
        entity: "contact",
        path: `/app/contacts/${updated.id}`,
        label: updated.name,
      },
      summary: { action: "update_contact", fields: named },
      item: { action: "update_contact", label: updated.name },
    };
  },
});

// Pièces

const lineSchema = z.object({
  description: z.string().max(500),
  quantity: amount.optional().describe('e.g. "1", "2.5"; default 1'),
  unit: z.enum(["hour", "day", "piece", "flat", "km", "month"]).optional().describe("default flat"),
  unitPrice: amount.describe('net unit price in units, dot decimal, e.g. "150.00"'),
  vatCode: z
    .enum(["normal", "reduced", "lodging", "exempt", "export"])
    .optional()
    .describe("only for VAT-registered companies; default normal"),
  productId: z.string().optional().describe("id from list_products, optional"),
});

const draftFields = {
  title: z.string().max(200).optional(),
  introText: z.string().max(2000).optional(),
  footerText: z.string().max(2000).optional(),
  issueDate: isoDate.optional(),
  serviceDate: isoDate.optional(),
  dueDate: isoDate.optional(),
  language: z.enum(INVOICE_LANGUAGES).optional(),
  currency: z.enum(["CHF", "EUR", "USD", "GBP"]).optional(),
};

const scalar = (v: unknown) =>
  typeof v === "number" ? String(v) : typeof v === "string" ? v.trim() : "";

function linesFromInput(lines: unknown, vatRegistered: boolean): Json[] | null {
  if (!Array.isArray(lines)) return null;
  return lines.slice(0, 100).map((raw) => {
    const l = (raw && typeof raw === "object" ? raw : {}) as Json;
    const vat = scalar(l.vatCode);
    return {
      description: scalar(l.description),
      quantity: scalar(l.quantity) || "1",
      unit: scalar(l.unit) || "flat",
      unitPrice: scalar(l.unitPrice),
      vatCode: vatRegistered
        ? (VAT_CODES as readonly string[]).includes(vat)
          ? vat
          : "normal"
        : "",
      productId: scalar(l.productId),
    };
  });
}

const DRAFT_FIELDS = [
  "contactId",
  "language",
  "title",
  "introText",
  "footerText",
  "issueDate",
  "serviceDate",
  "dueDate",
  "currency",
] as const;

type Built = {
  data: InvoiceInput;
  kind: "invoice" | "quote" | "credit_note";
  id?: string;
};

/**
 * Brouillon validé par parseInvoiceForm (règles du formulaire), avec la règle de la multidevise
 * (formule Pro) de l'action saveInvoice. Une modification repart du brouillon enregistré.
 */
async function buildDraft(
  ctx: AssistantContext,
  input: Json,
  existing?: NonNullable<Awaited<ReturnType<typeof getInvoice>>>,
): Promise<{ ok: true; built: Built } | { ok: false; error: string }> {
  const org = ctx.organization;
  const vatRegistered = await isVatRegistered(ctx.database, org.id);
  let base: Json;
  let kind: Built["kind"] = input.kind === "quote" ? "quote" : "invoice";
  if (existing) {
    const doc = existing.invoice;
    kind = doc.kind as Built["kind"];
    base = {
      contactId: doc.contactId,
      language: doc.language,
      title: doc.title ?? "",
      introText: doc.introText ?? "",
      footerText: doc.footerText ?? "",
      issueDate: doc.issueDate,
      serviceDate: doc.serviceDate,
      dueDate: doc.dueDate ?? "",
      currency: doc.currency,
      ...(doc.fxRate ? { fxRate: String(doc.fxRate) } : {}),
      lines: existing.lines.map((l) => ({
        description: l.description,
        quantity: formatQuantity(l.quantityMilli),
        unit: l.unit,
        unitPrice: (l.unitPriceCents / 100).toFixed(2),
        vatCode: l.vatCode ?? "",
        productId: l.productId ?? "",
      })),
    };
  } else {
    base = { issueDate: ctx.today, currency: org.currency };
  }
  const patch: Json = {};
  for (const k of DRAFT_FIELDS) if (has(input, k)) patch[k] = scalar(input[k]);
  const lines = has(input, "lines") ? linesFromInput(input.lines, vatRegistered) : null;
  if (has(input, "lines") && !lines) return { ok: false, error: "invalid lines" };
  const merged: Json = { ...base, ...patch, ...(lines ? { lines } : {}) };
  // Nouvelle date de pièce sans échéance donnée : l'échéance repart du délai du client.
  if (existing && has(patch, "issueDate") && !has(patch, "dueDate")) merged.dueDate = "";

  const contact = await getContact(ctx.database, org.id, scalar(merged.contactId));
  if (!contact || contact.archivedAt) return { ok: false, error: "contact_not_found" };
  if (!existing && !has(patch, "language"))
    merged.language = (INVOICE_LANGUAGES as readonly string[]).includes(contact.language)
      ? contact.language
      : homeLanguage(org, INVOICE_LANGUAGES);
  if (!Array.isArray(merged.lines)) merged.lines = [];

  const parsed = parseInvoiceForm(toForm(merged), { vatRegistered, country: org.country });
  if (!parsed.ok) return { ok: false, error: `invalid ${JSON.stringify(parsed.errors)}` };
  // Facturer dans une autre devise : formule Pro (saveInvoice). Un brouillon déjà dans sa devise la garde.
  const currency = parsed.data.currency ?? org.currency;
  if (
    currency !== org.currency &&
    !featureAccess(org, "multiCurrency").allowed &&
    base.currency !== currency
  )
    return { ok: false, error: "plan_multi_currency" };
  return { ok: true, built: { data: parsed.data, kind, id: existing?.invoice.id } };
}

async function documentOutcome(
  ctx: AssistantContext,
  action: string,
  documentId: string,
  entityLabel?: (label: string) => string,
  extra: SummaryField[] = [],
  notes: string[] = [],
): Promise<OpOutcome> {
  const described = await documentSummary(ctx, action, documentId, extra, notes);
  if (!described) return fail("document_not_found");
  return {
    ok: true,
    result: {
      action,
      id: documentId,
      entity: "document",
      path: documentPath(described.kind, documentId),
      label: entityLabel ? entityLabel(described.label) : described.label,
    },
    summary: described.summary,
    item: described.item,
  };
}

export const createDraftOp = defineOp({
  id: "create_invoice_draft",
  permission: "billing",
  description:
    "PROPOSE a new DRAFT invoice, or a DRAFT quote with kind=quote, for an existing customer (contactId from search_contacts, or @key of a contact created in the same propose_batch). VAT and totals are computed by InvoiceLead. Nothing is saved until the user confirms; the draft is neither issued nor sent.",
  schema: z.object({
    kind: z.enum(["invoice", "quote"]).optional().describe("default invoice"),
    contactId: z.string(),
    lines: z.array(lineSchema).min(1).max(100),
    ...draftFields,
  }),
  refs: { contactId: "contact", "lines.productId": "product" },
  async run(ctx, input) {
    const draft = await buildDraft(ctx, input);
    if (!draft.ok) return fail(draft.error);
    const saved = await createInvoice(ctx.database, who(ctx), draft.built.data, draft.built.kind);
    if (saved === "contact") return fail("contact_not_found");
    if (typeof saved !== "object" || !saved) return fail("not_saved");
    return documentOutcome(ctx, "create_invoice_draft", saved.id);
  },
});

export const updateDraftOp = defineOp({
  id: "update_invoice_draft",
  permission: "billing",
  description:
    "PROPOSE changes to a DRAFT invoice, quote or credit note (documentId). Give only the fields to change; `lines`, when given, replaces all lines. detachCrmleadDeal=true removes a CRMlead deal inherited from an earlier quote (as on the document page). Issued documents cannot be changed. Nothing is saved until the user confirms.",
  schema: z.object({
    documentId: z.string(),
    contactId: z.string().optional(),
    lines: z.array(lineSchema).min(1).max(100).optional(),
    detachCrmleadDeal: z.boolean().optional(),
    ...draftFields,
  }),
  refs: { documentId: "document", contactId: "contact", "lines.productId": "product" },
  async run(ctx, input) {
    const existing = await getInvoice(ctx.database, ctx.organization.id, input.documentId);
    if (!existing) return fail("document_not_found");
    const doc = existing.invoice;
    if (doc.status !== "draft") return fail("not_a_draft");
    const { documentId: _id, detachCrmleadDeal, ...rest } = input;
    const edits = Object.values(rest).some((v) => v !== undefined);
    if (!edits && !detachCrmleadDeal) return fail("no_change");
    const notes: string[] = [];
    if (detachCrmleadDeal) {
      // Comme la page de la pièce : seulement une affaire reprise d'un devis précédent (pas l'import).
      if (!doc.crmleadLeadId || doc.externalRef) return fail("no_inherited_crmlead_deal");
      await detachCrmlead(ctx.database, ctx.organization.id, doc.id);
      notes.push("crmleadDetached");
    }
    const before = documentView(existing);
    if (edits) {
      const draft = await buildDraft(ctx, rest, existing);
      if (!draft.ok) return fail(draft.error);
      const saved = await updateInvoice(
        ctx.database,
        who(ctx),
        doc.id,
        draft.built.data,
        draft.built.kind,
      );
      if (saved === null || saved === "notDraft") return fail("not_a_draft");
      if (saved === "contact") return fail("contact_not_found");
      if (input.lines) notes.push("linesReplaced");
    }
    const outcome = await documentOutcome(
      ctx,
      "update_invoice_draft",
      doc.id,
      undefined,
      [],
      notes,
    );
    if (!outcome.ok) return outcome;
    // Ce qui change sur l'en-tête (textes, dates, devise compris), montré « avant → après » : à la
    // place du champ s'il est sur la carte, sinon ajouté avant le statut (un titre effacé, une date
    // de prestation remise à la date de la pièce).
    const after = await getInvoice(ctx.database, ctx.organization.id, doc.id);
    if (after) {
      const diff = changes(before, documentView(after), DOCUMENT_VIEW_KEYS);
      const changed = new Map(diff.map((f) => [f.key, f]));
      const shown = outcome.summary.fields.map((f) => changed.get(f.key) ?? f);
      const missing = diff.filter((f) => !outcome.summary.fields.some((x) => x.key === f.key));
      const status = shown.findIndex((f) => f.key === "status");
      shown.splice(status < 0 ? shown.length : status, 0, ...missing);
      outcome.summary.fields = shown;
    }
    return outcome;
  },
});

const nextDay = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

/**
 * Relances automatiques par e-mail (formule Pro, activées dans les réglages des relances) : la tâche
 * quotidienne de 05:00 UTC les envoie au client avec le PDF et un lien de partage.
 */
const autoReminders = (org: Organization) =>
  org.reminderAuto && featureAccess(org, "reminderAuto").allowed;

/**
 * La facture émise partirait-elle en relance par e-mail aussitôt ? Déjà échue (la relance suit dès
 * que son délai est atteint), ou due au passage d'aujourd'hui ou de demain (rappel courtois d'un
 * client retardataire) ; seulement si le client a une adresse e-mail, comme l'envoi automatique.
 */
async function reminderSoon(
  ctx: AssistantContext,
  invoice: { id: string; dueDate: string | null },
  email: string | null,
) {
  if (!email) return false;
  if (invoice.dueDate && invoice.dueDate < ctx.today) return true;
  for (const day of [ctx.today, nextDay(ctx.today)]) {
    const due = await dueReminders(ctx.database, ctx.organization.id, day);
    if (due.some((r) => r.invoiceId === invoice.id && r.email && !r.locked)) return true;
  }
  return false;
}

/** Webhooks de l'entreprise mis en file par l'émission (envoyés après la validation). */
async function webhooksQueued(ctx: AssistantContext, documentId: string) {
  const [row] = await ctx.database
    .select({ n: sql<number>`count(*)`.mapWith(Number) })
    .from(webhookDeliveries)
    .where(
      and(
        eq(webhookDeliveries.organizationId, ctx.organization.id),
        eq(webhookDeliveries.event, "invoice.issued"),
        eq(webhookDeliveries.status, "pending"),
        sql`${webhookDeliveries.payload}->'data'->'invoice'->>'id' = ${documentId}`,
      ),
    );
  return (row?.n ?? 0) > 0;
}

export const issueDocumentOp = defineOp({
  id: "issue_document",
  permission: "billing",
  description:
    "PROPOSE to ISSUE a draft invoice, quote or credit note (documentId): it gets its final legal number and can no longer be edited (an issued invoice is corrected with a credit note). Issuing sends nothing to the customer by itself; sending stays with the user on the document page. When the company's automatic e-mail reminders are on, an invoice already overdue (or reminded at the next daily run) is refused: the user issues it on the document page. Only when the user asks to issue / finalise / validate the document.",
  schema: z.object({ documentId: z.string() }),
  refs: { documentId: "document" },
  async run(ctx, input) {
    const found = await getInvoice(ctx.database, ctx.organization.id, input.documentId);
    if (!found) return fail("document_not_found");
    if (found.invoice.status !== "draft") return fail("not_a_draft");
    const issued = await issueInvoice(ctx.database, who(ctx), found.invoice.id);
    if (typeof issued === "string") return fail(issued);
    const notes = ["issueFinal"];
    if (issued.kind === "invoice" && autoReminders(ctx.organization)) {
      // Une relance partirait par e-mail au prochain passage de la tâche quotidienne : envoyer à
      // l'extérieur reste à la personne, qui émet depuis la page de la pièce (cahier, A7).
      if (await reminderSoon(ctx, issued, found.contact.email))
        return fail("auto_reminder_on_screen");
      notes.push("autoReminders");
    } else notes.push("nothingSent");
    if (await webhooksQueued(ctx, issued.id)) notes.push("webhooksNotified");
    return documentOutcome(ctx, "issue_document", issued.id, undefined, [], notes);
  },
  // Comme l'action « Émettre » : comptabilisation de ce qui peut l'être, puis webhooks de l'entreprise.
  effects: ["post", "webhooks"],
});

export const quoteOutcomeOp = defineOp({
  id: "set_quote_outcome",
  permission: "billing",
  description:
    "PROPOSE to mark an issued quote as accepted or declined by the customer (quoteId), as the buttons of the quote page do (accepted from issued or declined; declined from issued or accepted).",
  schema: z.object({ quoteId: z.string(), outcome: z.enum(["accepted", "declined"]) }),
  refs: { quoteId: "document" },
  async run(ctx, input) {
    const found = await getInvoice(ctx.database, ctx.organization.id, input.quoteId);
    if (found?.invoice.kind !== "quote") return fail("quote_not_found");
    const from = input.outcome === "accepted" ? ["issued", "declined"] : ["issued", "accepted"];
    if (!from.includes(found.invoice.status))
      return fail(`not_possible_from_${found.invoice.status}`);
    if (!(await setQuoteOutcome(ctx.database, who(ctx), found.invoice.id, input.outcome)))
      return fail("quote_not_found");
    const label = `${found.invoice.number ?? ""} · ${found.contact.name}`;
    return {
      ok: true,
      result: {
        action: "set_quote_outcome",
        id: found.invoice.id,
        entity: "document",
        path: documentPath("quote", found.invoice.id),
        label: found.invoice.number ?? found.contact.name,
      },
      summary: {
        action: "set_quote_outcome",
        fields: filled([
          enumField("documentKind", "quote"),
          text("number", found.invoice.number),
          text("customer", found.contact.name),
          moneyField("total", found.invoice.totalCents, found.invoice.currency),
          {
            key: "quoteStatus",
            value: input.outcome,
            before: found.invoice.status,
            format: "enum",
          },
        ]),
      },
      item: { action: "set_quote_outcome", label, detail: input.outcome },
    };
  },
});

export const convertQuoteOp = defineOp({
  id: "convert_quote_to_invoice",
  permission: "billing",
  description:
    "PROPOSE to turn an issued or accepted quote (quoteId) into a DRAFT invoice dated today, with the same customer, texts and lines, issued deposit invoices deducted; the quote becomes 'invoiced'. The invoice stays a draft (not issued, not sent).",
  schema: z.object({ quoteId: z.string() }),
  refs: { quoteId: "document" },
  async run(ctx, input) {
    const quote = await getInvoice(ctx.database, ctx.organization.id, input.quoteId);
    if (quote?.invoice.kind !== "quote") return fail("quote_not_found");
    if (!["issued", "accepted"].includes(quote.invoice.status))
      return fail(`not_possible_from_${quote.invoice.status}`);
    const converted = await convertQuoteToInvoice(
      ctx.database,
      who(ctx),
      quote.invoice.id,
      ctx.today,
    );
    if (typeof converted === "string") return fail(converted);
    return documentOutcome(ctx, "convert_quote_to_invoice", converted.id, undefined, [
      text("fromQuote", quote.invoice.number),
    ]);
  },
});

export const depositOp = defineOp({
  id: "create_deposit_invoice",
  permission: "billing",
  description:
    "PROPOSE a DRAFT deposit invoice on an issued or accepted quote (quoteId): a percentage of the quote's net amount, one line per VAT rate. Deposits cannot exceed the quote.",
  schema: z.object({
    quoteId: z.string(),
    percent: z.number().gt(0).max(100).describe("e.g. 30 for 30 %"),
  }),
  refs: { quoteId: "document" },
  async run(ctx, input) {
    const quote = await getInvoice(ctx.database, ctx.organization.id, input.quoteId);
    if (quote?.invoice.kind !== "quote") return fail("quote_not_found");
    const deposit = await createDepositInvoice(
      ctx.database,
      who(ctx),
      quote.invoice.id,
      input.percent,
      ctx.today,
    );
    if (typeof deposit === "string") return fail(deposit);
    return documentOutcome(ctx, "create_deposit_invoice", deposit.id, undefined, [
      text("fromQuote", quote.invoice.number),
      { key: "percent", value: String(input.percent), format: "percent" },
    ]);
  },
});

export const creditNoteOp = defineOp({
  id: "create_credit_note",
  permission: "billing",
  description:
    "PROPOSE a DRAFT credit note on an issued invoice (invoiceId) that is not fully credited yet: it repeats all lines (full cancellation); reduce it afterwards with propose_update_invoice_draft for a partial credit note. Nothing is refunded or paid.",
  schema: z.object({ invoiceId: z.string() }),
  refs: { invoiceId: "document" },
  async run(ctx, input) {
    const found = await getInvoice(ctx.database, ctx.organization.id, input.invoiceId);
    if (found?.invoice.kind !== "invoice" || found.invoice.status !== "issued")
      return fail("invoice_not_issued");
    // Comme la page : un avoir tant qu'il reste quelque chose à créditer.
    if (found.invoice.totalCents - (await creditedCents(ctx.database, found.invoice.id)) <= 0)
      return fail("already_credited");
    const note = await createCreditNote(ctx.database, who(ctx), found.invoice.id, ctx.today);
    if (typeof note === "string") return fail(note === "contact" ? "contact_not_found" : note);
    return documentOutcome(
      ctx,
      "create_credit_note",
      note.id,
      undefined,
      [text("relatedInvoice", found.invoice.number)],
      ["creditNoteDraft"],
    );
  },
});

export const recurringOp = defineOp({
  id: "create_recurring_invoice",
  permission: "billing",
  description:
    "PROPOSE to repeat an issued invoice (invoiceId) every 1, 3, 6 or 12 months from nextDate: the daily task then creates a new DRAFT invoice each time. Automatic sending is never switched on by the assistant (the user chooses it on the invoice page).",
  schema: z.object({
    invoiceId: z.string(),
    intervalMonths: z.union([z.literal(1), z.literal(3), z.literal(6), z.literal(12)]),
    nextDate: isoDate
      .optional()
      .describe("first new invoice; default one month after the invoice date"),
  }),
  refs: { invoiceId: "document" },
  async run(ctx, input) {
    const found = await getInvoice(ctx.database, ctx.organization.id, input.invoiceId);
    // Comme la page : le panneau « Récurrence » n'existe que sur une facture émise.
    if (found?.invoice.kind !== "invoice" || found.invoice.status === "draft")
      return fail("invoice_not_issued");
    if (!(INTERVALS as readonly number[]).includes(input.intervalMonths)) return fail("invalid");
    const nextDate = input.nextDate ?? addMonths(found.invoice.issueDate, 1);
    const created = await createRecurring(ctx.database, who(ctx), found.invoice.id, {
      intervalMonths: input.intervalMonths,
      nextDate,
      autoSend: false,
    });
    if (typeof created === "string")
      return fail(created === "planLimit" ? "plan_limit_recurring" : created);
    const label = `${found.invoice.number ?? ""} · ${found.contact.name}`;
    return {
      ok: true,
      result: {
        action: "create_recurring_invoice",
        id: created.id,
        entity: "recurring",
        path: "/app/invoices/recurring",
        label: found.invoice.number ?? found.contact.name,
      },
      summary: {
        action: "create_recurring_invoice",
        fields: filled([
          text("number", found.invoice.number),
          text("customer", found.contact.name),
          moneyField("total", found.invoice.totalCents, found.invoice.currency),
          { key: "intervalMonths", value: String(input.intervalMonths), format: "month" },
          dateField("nextDate", nextDate),
          { key: "autoSend", value: "false", format: "bool" },
        ]),
        notes: ["recurringDrafts"],
      },
      item: { action: "create_recurring_invoice", label },
    };
  },
});

export const recurringStatusOp = defineOp({
  id: "set_recurring_status",
  permission: "billing",
  description:
    "PROPOSE to pause (active=false) or resume (active=true) a recurring invoice (recurringId from list_recurring_invoices). Resuming counts in the plan's active recurring invoices. A recurring invoice with automatic sending (autoSend) is resumed by the user on the screen, never by the assistant: it would e-mail invoices.",
  schema: z.object({ recurringId: z.string(), active: z.boolean() }),
  refs: { recurringId: "recurring" },
  async run(ctx, input) {
    if (!/^[0-9a-f-]{36}$/i.test(input.recurringId)) return fail("recurring_not_found");
    const [row] = await ctx.database
      .select({
        active: recurringInvoices.active,
        autoSend: recurringInvoices.autoSend,
        sourceInvoiceId: recurringInvoices.sourceInvoiceId,
        nextDate: recurringInvoices.nextDate,
      })
      .from(recurringInvoices)
      .where(
        and(
          eq(recurringInvoices.id, input.recurringId),
          eq(recurringInvoices.organizationId, ctx.organization.id),
        ),
      );
    if (!row) return fail("recurring_not_found");
    if (row.active === input.active) return fail("no_change");
    // Reprendre une récurrence qui s'envoie toute seule ferait partir des factures par e-mail :
    // envoyer à l'extérieur reste à la personne, sur l'écran des récurrences.
    if (input.active && row.autoSend) return fail("auto_send_on_screen");
    const done = await setRecurringActive(ctx.database, who(ctx), input.recurringId, input.active);
    if (done === "planLimit") return fail("plan_limit_recurring");
    if (done === "plan") return fail("plan_multi_currency");
    if (!done) return fail("recurring_not_found");
    const source = await getInvoice(ctx.database, ctx.organization.id, row.sourceInvoiceId);
    const name = source ? `${source.invoice.number ?? ""} · ${source.contact.name}` : "";
    return {
      ok: true,
      result: {
        action: "set_recurring_status",
        id: input.recurringId,
        entity: "recurring",
        path: "/app/invoices/recurring",
        label: source?.invoice.number ?? name,
      },
      summary: {
        action: "set_recurring_status",
        fields: filled([
          text("number", source?.invoice.number),
          text("customer", source?.contact.name),
          dateField("nextDate", row.nextDate),
          {
            key: "recurringStatus",
            value: input.active ? "active" : "paused",
            before: row.active ? "active" : "paused",
            format: "enum",
          },
        ]),
      },
      item: {
        action: "set_recurring_status",
        label: name,
        detail: input.active ? "active" : "paused",
      },
    };
  },
});

export const waiveChargesOp = defineOp({
  id: "waive_reminder_charges",
  permission: "billing",
  description:
    "PROPOSE to waive the reminder fees and late interest charged on an issued invoice (invoiceId), as the button of the invoice page does. No payment is recorded.",
  schema: z.object({ invoiceId: z.string() }),
  refs: { invoiceId: "document" },
  async run(ctx, input) {
    const found = await getInvoice(ctx.database, ctx.organization.id, input.invoiceId);
    if (found?.invoice.kind !== "invoice" || found.invoice.status !== "issued")
      return fail("invoice_not_issued");
    const waived = await waiveCharges(ctx.database, who(ctx), found.invoice.id, ctx.today);
    if (waived === "closed") return fail("period_closed");
    if (waived <= 0) return fail("nothing_to_waive");
    const label = `${found.invoice.number ?? ""} · ${found.contact.name}`;
    return {
      ok: true,
      result: {
        action: "waive_reminder_charges",
        id: found.invoice.id,
        entity: "document",
        path: documentPath("invoice", found.invoice.id),
        label: found.invoice.number ?? found.contact.name,
      },
      summary: {
        action: "waive_reminder_charges",
        fields: filled([
          text("number", found.invoice.number),
          text("customer", found.contact.name),
          moneyField("waived", waived, found.invoice.currency),
        ]),
      },
      item: {
        action: "waive_reminder_charges",
        label,
        amountCents: waived,
        currency: found.invoice.currency,
      },
    };
  },
});
