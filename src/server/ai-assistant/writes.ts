import { countryPack } from "@/countries";
import { VAT_CODES } from "@/countries/ch/vat";
import { computeTotals, formatQuantity } from "@/lib/invoice-math";
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
import type { Db } from "../db";
import type { Organization } from "../db/schema";
import {
  createInvoice,
  getInvoice,
  INVOICE_LANGUAGES,
  type InvoiceInput,
  isVatRegistered,
  parseInvoiceForm,
  updateInvoice,
} from "../invoices";
import { featureAccess } from "../plans";
import { can, type Member } from "../roles";

/**
 * Écritures de la bulle Assistant IA, en deux temps. `prepareWrite` valide la demande avec les mêmes
 * règles que les formulaires (parseContactForm, parseInvoiceForm) et rend un résumé lisible, sans
 * rien écrire. `executeWrite` ne tourne qu'après le clic « Confirmer » (jeton signé, usage unique) :
 * il revérifie les droits et la validation, puis appelle les fonctions de l'application.
 *
 * Seules ces quatre écritures existent. Émettre une facture (numéro légal), l'envoyer, enregistrer
 * un paiement, relancer, supprimer, toucher à l'abonnement, à l'équipe ou aux clés : aucun outil.
 */
export const WRITE_TOOLS = [
  "create_contact",
  "update_contact",
  "create_invoice_draft",
  "update_invoice_draft",
] as const;
export type WriteTool = (typeof WRITE_TOOLS)[number];
export const isWriteTool = (name: string): name is WriteTool =>
  (WRITE_TOOLS as readonly string[]).includes(name);

export type AssistantContext = {
  database: Db;
  userId: string;
  organization: Organization;
  membership: Member;
  /** Date du jour, AAAA-MM-JJ. */
  today: string;
};

/** Résumé « À confirmer » : des valeurs brutes, les libellés viennent des textes de la bulle. */
export type ConfirmSummary = {
  action: WriteTool;
  fields: { key: string; value: string }[];
  lines?: {
    description: string;
    quantity: string;
    unit: string;
    unitPriceCents: number;
    netCents: number;
  }[];
  totals?: { currency: string; netCents: number; vatCents: number; totalCents: number };
};

export type WriteResult = {
  action: WriteTool;
  id: string;
  /** Page de l'objet, sans la langue (« /app/invoices/… »). */
  path: string;
  label: string;
};

type Failure = { ok: false; error: string };
type Json = Record<string, unknown>;

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const has = (o: Json, k: string) => Object.hasOwn(o, k) && o[k] !== undefined && o[k] !== null;

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

function contactFromRow(c: NonNullable<Awaited<ReturnType<typeof getContact>>>): Json {
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

/** Reprend seulement les champs connus de la demande (jamais l'organisation ni un identifiant). */
function contactPatch(input: Json): Json {
  const out: Json = {};
  for (const k of CONTACT_FIELDS) if (has(input, k)) out[k] = input[k];
  for (const k of ["isCustomer", "isSupplier"])
    if (typeof input[k] === "boolean") out[k] = input[k];
  return out;
}

function contactSummary(action: WriteTool, data: ContactInput, before?: string): ConfirmSummary {
  const address = [
    [data.street, data.buildingNumber].filter(Boolean).join(" "),
    [data.postalCode, data.town].filter(Boolean).join(" "),
  ]
    .filter(Boolean)
    .join(", ");
  const fields = [
    ...(before && before !== data.name ? [{ key: "previousName", value: before }] : []),
    { key: "name", value: data.name },
    { key: "kind", value: data.kind },
    {
      key: "role",
      value: [data.isCustomer && "customer", data.isSupplier && "supplier"]
        .filter(Boolean)
        .join("+"),
    },
    { key: "email", value: data.email ?? "" },
    { key: "phone", value: data.phone ?? "" },
    { key: "contactPerson", value: data.contactPerson ?? "" },
    { key: "address", value: address },
    { key: "country", value: data.country },
    { key: "language", value: data.language },
    { key: "uid", value: data.uid ?? "" },
    { key: "paymentTermDays", value: String(data.paymentTermDays) },
  ].filter((f) => f.value !== "");
  return { action, fields };
}

async function buildContact(
  ctx: AssistantContext,
  tool: "create_contact" | "update_contact",
  input: Json,
): Promise<{ ok: true; data: ContactInput; before?: string; id?: string } | Failure> {
  let base = contactDefaults(ctx.organization);
  let before: string | undefined;
  const id = str(input.contactId);
  if (tool === "update_contact") {
    const current = await getContact(ctx.database, ctx.organization.id, id);
    if (!current || current.archivedAt) return { ok: false, error: "contact_not_found" };
    base = contactFromRow(current);
    before = current.name;
  }
  const merged = { ...base, ...contactPatch(input) };
  const parsed = parseContactForm(toForm(merged, ["isCustomer", "isSupplier"]));
  if (!parsed.ok) return { ok: false, error: `invalid ${JSON.stringify(parsed.errors)}` };
  return { ok: true, data: parsed.data, before, ...(tool === "update_contact" ? { id } : {}) };
}

type LineIn = {
  description?: unknown;
  quantity?: unknown;
  unit?: unknown;
  unitPrice?: unknown;
  vatCode?: unknown;
  productId?: unknown;
};

const scalar = (v: unknown) =>
  typeof v === "number" ? String(v) : typeof v === "string" ? v.trim() : "";

function linesFromInput(lines: unknown, vatRegistered: boolean): Json[] | null {
  if (!Array.isArray(lines)) return null;
  return lines.slice(0, 100).map((raw) => {
    const l = (raw && typeof raw === "object" ? raw : {}) as LineIn;
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

async function buildDraft(
  ctx: AssistantContext,
  tool: "create_invoice_draft" | "update_invoice_draft",
  input: Json,
): Promise<
  | {
      ok: true;
      data: InvoiceInput;
      kind: "invoice" | "quote";
      id?: string;
      number?: string | null;
      customer: string;
      vatRegistered: boolean;
    }
  | Failure
> {
  const org = ctx.organization;
  const vatRegistered = await isVatRegistered(ctx.database, org.id);
  let base: Json;
  let kind: "invoice" | "quote" = input.kind === "quote" ? "quote" : "invoice";
  let id: string | undefined;
  let number: string | null | undefined;
  if (tool === "update_invoice_draft") {
    id = str(input.documentId);
    const found = await getInvoice(ctx.database, org.id, id);
    if (!found) return { ok: false, error: "document_not_found" };
    const doc = found.invoice;
    if (doc.status !== "draft") return { ok: false, error: "not_a_draft" };
    if (doc.kind !== "invoice" && doc.kind !== "quote") return { ok: false, error: "not_editable" };
    kind = doc.kind;
    number = doc.number;
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
      lines: found.lines.map((l) => ({
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
  // Une nouvelle date de pièce sans échéance donnée : l'échéance repart du délai du client.
  if (tool === "update_invoice_draft" && has(patch, "issueDate") && !has(patch, "dueDate"))
    merged.dueDate = "";

  const contact = await getContact(ctx.database, org.id, str(merged.contactId));
  if (!contact || contact.archivedAt) return { ok: false, error: "contact_not_found" };
  if (!has(patch, "language") && tool === "create_invoice_draft")
    merged.language = (INVOICE_LANGUAGES as readonly string[]).includes(contact.language)
      ? contact.language
      : homeLanguage(org, INVOICE_LANGUAGES);
  if (!Array.isArray(merged.lines)) merged.lines = [];

  const parsed = parseInvoiceForm(toForm(merged), { vatRegistered, country: org.country });
  if (!parsed.ok) return { ok: false, error: `invalid ${JSON.stringify(parsed.errors)}` };
  // Facturer dans une autre devise : formule Pro, comme le formulaire (saveInvoice). Un brouillon
  // déjà dans sa devise la garde.
  const currency = parsed.data.currency ?? org.currency;
  if (
    currency !== org.currency &&
    !featureAccess(org, "multiCurrency").allowed &&
    base.currency !== currency
  )
    return { ok: false, error: "plan_multi_currency" };
  return {
    ok: true,
    data: parsed.data,
    kind,
    id,
    number,
    customer: contact.name,
    vatRegistered,
  };
}

function draftSummary(
  ctx: AssistantContext,
  action: WriteTool,
  d: Extract<Awaited<ReturnType<typeof buildDraft>>, { ok: true }>,
): ConfirmSummary {
  const pack = countryPack(ctx.organization.country);
  const rates = d.data.lines.map((l) =>
    d.vatRegistered && l.vatCode
      ? pack.vatRateBp(l.vatCode, d.data.serviceDate, ctx.organization.salesTaxRateBp)
      : 0,
  );
  const totals = computeTotals(
    d.data.lines.map((l, i) => ({
      quantityMilli: l.quantityMilli,
      unitPriceCents: l.unitPriceCents,
      vatRateBp: rates[i] ?? 0,
    })),
  );
  const fields = [
    { key: "documentKind", value: d.kind },
    ...(d.number ? [{ key: "number", value: d.number }] : []),
    { key: "customer", value: d.customer },
    { key: "title", value: d.data.title ?? "" },
    { key: "issueDate", value: d.data.issueDate },
    { key: "dueDate", value: d.data.dueDate ?? "" },
    { key: "language", value: d.data.language },
    { key: "status", value: "draft" },
  ].filter((f) => f.value !== "");
  return {
    action,
    fields,
    lines: d.data.lines.map((l, i) => ({
      description: l.description,
      quantity: formatQuantity(l.quantityMilli),
      unit: l.unit,
      unitPriceCents: l.unitPriceCents,
      netCents: totals.lines[i] ?? 0,
    })),
    totals: {
      currency: d.data.currency ?? ctx.organization.currency,
      netCents: totals.netCents,
      vatCents: totals.vatCents,
      totalCents: totals.totalCents,
    },
  };
}

/** Valide une écriture proposée et rend son résumé ; n'écrit rien. */
export async function prepareWrite(
  ctx: AssistantContext,
  tool: WriteTool,
  input: Json,
): Promise<{ ok: true; summary: ConfirmSummary } | Failure> {
  if (!can(ctx.membership, "billing")) return { ok: false, error: "forbidden_role" };
  if (tool === "create_contact" || tool === "update_contact") {
    const built = await buildContact(ctx, tool, input);
    if (!built.ok) return built;
    return { ok: true, summary: contactSummary(tool, built.data, built.before) };
  }
  const built = await buildDraft(ctx, tool, input);
  if (!built.ok) return built;
  return { ok: true, summary: draftSummary(ctx, tool, built) };
}

/** Exécute une écriture confirmée par la personne, droits et validation revérifiés. */
export async function executeWrite(
  ctx: AssistantContext,
  tool: WriteTool,
  input: Json,
): Promise<{ ok: true; result: WriteResult } | Failure> {
  if (!can(ctx.membership, "billing")) return { ok: false, error: "forbidden_role" };
  const who = { organizationId: ctx.organization.id, userId: ctx.userId };
  if (tool === "create_contact" || tool === "update_contact") {
    const built = await buildContact(ctx, tool, input);
    if (!built.ok) return built;
    if (tool === "create_contact") {
      const created = await createContactWithinPlan(ctx.database, who, built.data);
      if (created === "planLimit") return { ok: false, error: "plan_limit" };
      return {
        ok: true,
        result: {
          action: tool,
          id: created.id,
          path: `/app/contacts/${created.id}`,
          label: created.name,
        },
      };
    }
    const updated = await updateContact(ctx.database, who, built.id ?? "", built.data);
    if (!updated) return { ok: false, error: "contact_not_found" };
    return {
      ok: true,
      result: {
        action: tool,
        id: updated.id,
        path: `/app/contacts/${updated.id}`,
        label: updated.name,
      },
    };
  }
  const built = await buildDraft(ctx, tool, input);
  if (!built.ok) return built;
  const saved =
    tool === "create_invoice_draft"
      ? await createInvoice(ctx.database, who, built.data, built.kind)
      : await updateInvoice(ctx.database, who, built.id ?? "", built.data, built.kind);
  if (saved === null || saved === "notDraft") return { ok: false, error: "not_a_draft" };
  if (saved === "contact") return { ok: false, error: "contact_not_found" };
  const section = built.kind === "quote" ? "quotes" : "invoices";
  return {
    ok: true,
    result: {
      action: tool,
      id: saved.id,
      path: `/app/${section}/${saved.id}`,
      label: saved.number ?? built.customer,
    },
  };
}
