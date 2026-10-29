import type { z } from "zod";
import { countryPack } from "@/countries";
import type { Locale } from "@/i18n/routing";
import { formatQuantity } from "@/lib/invoice-math";
import type { Db } from "../db";
import type { Organization } from "../db/schema";
import { getInvoice } from "../invoices";
import { appRoleOf, can, type Member, type Permission } from "../roles";

/**
 * Socle des écritures de la bulle Assistant IA (cahier du 27.10.2026, A1 à A8) : chaque action
 * permise de l'interface est une opération, proposée par un outil `propose_<id>` et appliquée après
 * le clic « Confirmer ». Une opération appelle les MÊMES fonctions que l'écran, avec les mêmes droits
 * (permission de l'action serveur, plan comptable du pays, fonctions de la formule) ; elle n'écrit
 * jamais l'entreprise ni la personne venues du modèle, seulement celles de la session.
 */

export type AssistantContext = {
  database: Db;
  userId: string;
  /** Nom de la personne (notes de frais : « Personne » par défaut, comme le formulaire). */
  userName: string;
  organization: Organization;
  membership: Member;
  /** Date du jour, AAAA-MM-JJ. */
  today: string;
  /** Langue de l'interface (libellés des comptes, lecture d'un justificatif par l'IA). */
  locale: Locale;
};

/** Ce qu'une opération a créé ou modifié, pour les références d'un lot et la page qui le montre. */
export type Entity =
  | "contact"
  | "document"
  | "product"
  | "project"
  | "time_entry"
  | "bill"
  | "recurring"
  | "account"
  | "fiscal_year"
  | "vat_return"
  | "company"
  | "receipt"
  | "ledger"
  | "user";

export type OpResult = {
  action: string;
  id: string;
  entity: Entity;
  /** Page qui montre le résultat, sans la langue (« /app/quotes/… »). */
  path: string;
  label: string;
  /** Langue de l'interface choisie : la bulle rouvre la même page dans cette langue. */
  locale?: string;
};

/**
 * Champ du résumé « À confirmer » : des valeurs brutes, les libellés et la présentation viennent des
 * textes de la bulle. `before` : valeur actuelle d'une modification (« avant → après »).
 */
export type SummaryField = {
  key: string;
  value: string;
  before?: string;
  format?: "date" | "money" | "minutes" | "percent" | "enum" | "bool" | "month";
  currency?: string;
  /** Montant modifié dont la devise change aussi : devise de la valeur `before`. */
  beforeCurrency?: string;
};

export type SummaryLine = {
  description: string;
  quantity: string;
  unit: string;
  unitPriceCents: number;
  netCents: number;
};

export type SummaryTotals = {
  currency: string;
  netCents: number;
  vatCents: number;
  totalCents: number;
};

/**
 * Une ligne du résumé d'un lot : l'action, ce qu'elle touche, et pour une pièce son montant. Sur la
 * carte du lot, `fields` porte ce que l'opération écrit (les champs de sa propre carte, « avant →
 * après » pour une modification).
 */
export type BatchItem = {
  action: string;
  label: string;
  fields?: SummaryField[];
  /** Valeur d'une liste à traduire (« quote », « invoice »…), montrée avant le libellé. */
  detail?: string;
  /** Unité du montant (prix d'un article). */
  unit?: string;
  amountCents?: number;
  currency?: string;
  lines?: SummaryLine[];
  totals?: SummaryTotals;
  /**
   * Lot : remarques propres à CETTE opération (clés des textes « notes »), quand toutes les
   * opérations de son groupe ne les partagent pas (une facture et un devis émis ensemble).
   */
  notes?: string[];
};

export type ConfirmSummary = {
  /** Identifiant de l'opération, ou « batch » pour un lot. */
  action: string;
  fields: SummaryField[];
  lines?: SummaryLine[];
  totals?: SummaryTotals;
  /** Remarques à montrer sous les champs (clés des textes « notes »). */
  notes?: string[];
  /**
   * Lot : les opérations groupées par action, dans l'ordre de leur première apparition ; chaque
   * groupe garde son total et ses premières lignes (le reste : « + N autres »).
   */
  groups?: {
    action: string;
    count: number;
    items: BatchItem[];
    /** Remarques communes à toutes les opérations du groupe, montrées une fois sous le groupe. */
    notes?: string[];
  }[];
  /** Lot : nombre total d'opérations. */
  count?: number;
};

export type OpSuccess = {
  ok: true;
  result: OpResult;
  summary: ConfirmSummary;
  item: BatchItem;
  /**
   * Relances automatiques à surveiller une fois TOUTES les opérations jouées (operations.ts) : une
   * facture émise, ou le client qui vient de recevoir sa première adresse e-mail.
   */
  reminders?: { invoiceId?: string; contactId?: string };
};
export type OpFailure = { ok: false; error: string };
export type OpOutcome = OpSuccess | OpFailure;

/** Champs d'identifiant qu'un lot peut remplir par la clé d'une opération précédente (« @c1 »). */
export const REF_FIELDS = [
  "contactId",
  "documentId",
  "quoteId",
  "invoiceId",
  "productId",
  "projectId",
  "billId",
  "receiptId",
  "recurringId",
  "accountId",
  "fiscalYearId",
] as const;
export type RefField = (typeof REF_FIELDS)[number];

export type Operation<S extends z.ZodType = z.ZodType> = {
  /** Identifiant (outil `propose_<id>`, jeton, textes de la carte). */
  id: string;
  /**
   * Droit de l'action serveur de l'écran ; « member » : toute personne qui n'est pas en lecture seule ;
   * « self » : toute personne connectée, pour ses propres préférences.
   */
  permission: Permission | "member" | "self";
  description: string;
  schema: S;
  /** Champs d'identifiant que le lot peut remplir par une clé, avec ce qu'ils désignent. */
  refs?: Partial<Record<RefField | "lines.productId", Entity>>;
  /** Utilisable dans un lot (défaut : oui). */
  batch?: boolean;
  /**
   * Jouée dans une transaction (défaut : oui) : la proposition est un essai à blanc annulé, la
   * confirmation une transaction validée. Non : lecture par l'IA, jamais rejouée pour rien.
   */
  transactional?: boolean;
  /**
   * Champs de la carte qui suivent l'heure du clic (durée du chrono arrêté) : hors de l'empreinte
   * qui vérifie, à la confirmation, que la carte montre encore ce qui sera écrit.
   */
  volatile?: string[];
  /** Exécute l'opération sur `ctx.database` et rend le résumé lu dans l'état écrit. */
  run(ctx: AssistantContext, input: z.infer<S>): Promise<OpOutcome>;
  /** Proposition d'une opération non transactionnelle : contrôles seuls, rien n'est écrit. */
  check?(ctx: AssistantContext, input: z.infer<S>): Promise<OpOutcome>;
  /**
   * Suites de l'action serveur de l'écran, lancées une fois la transaction validée et hors d'elle
   * (une seule fois pour tout un lot) : comptabiliser ce qui peut l'être, envoyer les webhooks de
   * l'entreprise.
   */
  effects?: ("post" | "webhooks")[];
};

export const defineOp = <S extends z.ZodType>(op: Operation<S>): Operation<S> => op;

export const fail = (error: string): OpFailure => ({ ok: false, error });
export const who = (ctx: AssistantContext) => ({
  organizationId: ctx.organization.id,
  userId: ctx.userId,
});

/** Le droit de la personne pour cette opération, comme l'action serveur de l'écran ; null si permis. */
export function rightProblem(
  ctx: Pick<AssistantContext, "membership" | "organization">,
  op: Pick<Operation, "permission">,
): string | null {
  if (op.permission === "self") return null;
  if (op.permission === "member") {
    const role = appRoleOf(ctx.membership);
    return role === "readonly" || role === "none" ? "forbidden_role" : null;
  }
  if (!can(ctx.membership, op.permission)) return "forbidden_role";
  // requirePermission : sans comptabilité dans le pack du pays, aucune action comptable.
  if (
    (op.permission === "accounting" || op.permission === "setup") &&
    !countryPack(ctx.organization.country).accounting
  )
    return "forbidden_country";
  return null;
}

// Résumés

const s = (v: unknown) => (v === null || v === undefined ? "" : String(v));

export const text = (key: string, value: unknown): SummaryField => ({ key, value: s(value) });
export const enumField = (key: string, value: unknown): SummaryField => ({
  key,
  value: s(value),
  format: "enum",
});
export const dateField = (key: string, value: unknown): SummaryField => ({
  key,
  value: s(value),
  format: "date",
});
export const moneyField = (key: string, cents: number, currency: string): SummaryField => ({
  key,
  value: String(cents),
  format: "money",
  currency,
});

/** Champs vides retirés : la carte ne montre que ce qui a une valeur. */
export const filled = (fields: (SummaryField | null | false | undefined)[]): SummaryField[] =>
  fields.filter((f): f is SummaryField => !!f && f.value !== "");

/**
 * Modification : les seuls champs qui changent, avec leur valeur actuelle. Rien ne change → liste
 * vide (l'opération est refusée, la carte n'aurait rien à confirmer).
 */
export function changes(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  keys: { key: string; format?: SummaryField["format"]; currency?: string }[],
): SummaryField[] {
  const out: SummaryField[] = [];
  for (const k of keys) {
    const b = s(before[k.key]);
    const a = s(after[k.key]);
    if (a === b) continue;
    out.push({
      key: k.key,
      value: a,
      before: b,
      ...(k.format ? { format: k.format } : {}),
      ...(k.currency ? { currency: k.currency } : {}),
    });
  }
  return out;
}

type FoundDocument = NonNullable<Awaited<ReturnType<typeof getInvoice>>>;

/**
 * En-tête d'une pièce tel que la carte le montre : tout ce que le formulaire de la pièce enregistre
 * et que le PDF imprime (textes d'introduction et de pied de page compris), pour la carte et pour
 * « avant → après ».
 */
export function documentView(found: FoundDocument): Record<string, string> {
  const i = found.invoice;
  return {
    customer: found.contact.name,
    title: i.title ?? "",
    issueDate: i.issueDate,
    serviceDate: i.serviceDate ?? "",
    dueDate: i.kind === "credit_note" ? "" : (i.dueDate ?? ""),
    language: i.language,
    currency: i.currency,
    introText: i.introText ?? "",
    footerText: i.footerText ?? "",
  };
}

export const DOCUMENT_VIEW_KEYS: { key: string; format?: SummaryField["format"] }[] = [
  { key: "customer" },
  { key: "title" },
  { key: "issueDate", format: "date" },
  { key: "serviceDate", format: "date" },
  { key: "dueDate", format: "date" },
  { key: "language" },
  { key: "currency" },
  { key: "introText" },
  { key: "footerText" },
];

/** Résumé d'une pièce telle qu'elle est enregistrée (lignes, totaux), lu dans la transaction. */
export async function documentSummary(
  ctx: AssistantContext,
  action: string,
  documentId: string,
  extra: SummaryField[] = [],
  notes: string[] = [],
): Promise<{
  summary: ConfirmSummary;
  item: BatchItem;
  label: string;
  kind: string;
  found: FoundDocument;
} | null> {
  const found = await getInvoice(ctx.database, ctx.organization.id, documentId);
  if (!found) return null;
  const i = found.invoice;
  const v = documentView(found);
  const lines: SummaryLine[] = found.lines.map((l) => ({
    description: l.description,
    quantity: formatQuantity(l.quantityMilli),
    unit: l.unit,
    unitPriceCents: l.unitPriceCents,
    netCents: l.netCents,
  }));
  const totals: SummaryTotals = {
    currency: i.currency,
    netCents: i.netCents,
    vatCents: i.vatCents,
    totalCents: i.totalCents,
  };
  const status = i.status === "draft" ? "draft" : i.status;
  const summary: ConfirmSummary = {
    action,
    fields: filled([
      enumField("documentKind", i.kind),
      text("number", i.number),
      text("customer", v.customer),
      text("title", v.title),
      dateField("issueDate", v.issueDate),
      // Date de prestation : montrée quand elle n'est pas la date de la pièce (sa valeur par défaut).
      dateField("serviceDate", v.serviceDate === v.issueDate ? "" : v.serviceDate),
      dateField("dueDate", v.dueDate),
      text("language", v.language),
      text("introText", v.introText),
      text("footerText", v.footerText),
      ...extra,
      enumField("status", status),
    ]),
    lines,
    totals,
    ...(notes.length ? { notes } : {}),
  };
  const label = i.number ?? found.contact.name;
  return {
    summary,
    item: {
      action,
      label: i.number ? `${i.number} · ${found.contact.name}` : found.contact.name,
      detail: i.kind,
      amountCents: i.totalCents,
      currency: i.currency,
      lines,
      totals,
    },
    label,
    kind: i.kind,
    found,
  };
}

/** Page d'une pièce, sans la langue. */
export const documentPath = (kind: string, id: string) =>
  `/app/${kind === "quote" ? "quotes" : kind === "credit_note" ? "credit-notes" : "invoices"}/${id}`;

/** Montant saisi par le modèle (« 3500 », « 3'500.00 », 240) en texte de formulaire. */
export const amountText = (v: unknown) =>
  typeof v === "number" ? String(v) : typeof v === "string" ? v.trim() : "";

/** Valeur de formulaire : chaîne nettoyée, nombre en texte, rien pour null/undefined. */
export const formValue = (v: unknown) =>
  typeof v === "string"
    ? v.trim()
    : typeof v === "number" || typeof v === "boolean"
      ? String(v)
      : "";
