import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { VAT_CODES } from "@/countries/ch/vat";
import { CONTACT_COUNTRIES, CONTACT_KINDS, createContact, DOCUMENT_LANGUAGES } from "./contacts";
import type { Db } from "./db";
import { contacts, invoices } from "./db/schema";
import { createInvoice, deleteDraft, INVOICE_LANGUAGES, MAX_LINES } from "./invoices";
import { PRODUCT_UNITS } from "./products";

/**
 * Passage d'un lead gagné de CRMlead vers InvoiceLead (docs/CRMLEAD.md). CRMlead ouvre
 * `/{locale}/app/import/crmlead?d=<JSON en base64url>` ; la personne relit puis confirme. Rien n'est
 * créé sans ce clic, et le contenu n'est qu'un pré-remplissage : il est validé comme une saisie.
 */
const str = (max: number) => z.string().trim().min(1).max(max);
const opt = (max: number) => z.string().trim().max(max).optional();

export const handoffSchema = z.object({
  v: z.literal(1),
  kind: z.enum(["quote", "invoice"]).default("quote"),
  currency: z.literal("CHF").default("CHF"),
  lead: z.object({ id: str(100), title: opt(200) }),
  contact: z.object({
    id: opt(100),
    kind: z.enum(CONTACT_KINDS).default("company"),
    name: str(200),
    contactPerson: opt(200),
    email: z.string().trim().toLowerCase().email().max(254).optional(),
    phone: opt(50),
    street: opt(70),
    buildingNumber: opt(16),
    postalCode: opt(16),
    town: opt(35),
    country: z.enum(CONTACT_COUNTRIES).default("CH"),
    language: z.enum(DOCUMENT_LANGUAGES).optional(),
  }),
  lines: z
    .array(
      z.object({
        description: str(500),
        quantity: z.number().positive().max(1_000_000),
        unit: z.enum(PRODUCT_UNITS).default("flat"),
        unitPriceCents: z.number().int().min(0).max(100_000_000_00),
        vatCode: z.enum(VAT_CODES).default("normal"),
      }),
    )
    .min(1)
    .max(MAX_LINES),
});

export type Handoff = z.infer<typeof handoffSchema>;

export function decodeHandoff(param: string | undefined | null): Handoff | null {
  if (!param || param.length > 60_000) return null;
  try {
    const json = JSON.parse(Buffer.from(param, "base64url").toString("utf8"));
    const parsed = handoffSchema.safeParse(json);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function encodeHandoff(value: z.input<typeof handoffSchema>): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

export const handoffTotalCents = (h: Handoff) =>
  h.lines.reduce((sum, l) => sum + Math.round(l.quantity * l.unitPriceCents), 0);

type Who = { organizationId: string; userId: string };

export type ImportResult =
  | { status: "created" | "existing"; id: string; kind: "quote" | "invoice" }
  | { status: "contactLimit" };

/** Contact déjà connu : même fiche CRMlead, sinon même e-mail, sinon même nom. */
async function findContact(database: Db, organizationId: string, h: Handoff) {
  const base = and(eq(contacts.organizationId, organizationId), isNull(contacts.archivedAt));
  const tries = [
    h.contact.id ? eq(contacts.externalRef, `crmlead:${h.contact.id}`) : null,
    h.contact.email ? sql`lower(${contacts.email}) = ${h.contact.email}` : null,
    sql`lower(${contacts.name}) = lower(${h.contact.name})`,
  ];
  for (const cond of tries) {
    if (!cond) continue;
    const [row] = await database.select().from(contacts).where(and(base, cond)).limit(1);
    if (row) return row;
  }
  return null;
}

/**
 * Crée le brouillon (devis ou facture) du lead, et son contact s'il n'existe pas encore. Un même lead
 * ne donne qu'une pièce : un second passage rend la première.
 */
export async function importHandoff(
  database: Db,
  who: Who,
  h: Handoff,
  opts: { language: string; today: string; canCreateContact: boolean },
): Promise<ImportResult> {
  const ref = `crmlead:${h.lead.id}`;
  const existing = async () => {
    const [row] = await database
      .select({ id: invoices.id, kind: invoices.kind })
      .from(invoices)
      .where(and(eq(invoices.organizationId, who.organizationId), eq(invoices.externalRef, ref)))
      .limit(1);
    return row
      ? { status: "existing" as const, id: row.id, kind: row.kind as "quote" | "invoice" }
      : null;
  };
  const found = await existing();
  if (found) return found;

  const language = (INVOICE_LANGUAGES as readonly string[]).includes(
    h.contact.language ?? opts.language,
  )
    ? ((h.contact.language ?? opts.language) as (typeof INVOICE_LANGUAGES)[number])
    : "de";

  let contact = await findContact(database, who.organizationId, h);
  if (!contact) {
    if (!opts.canCreateContact) return { status: "contactLimit" };
    const c = h.contact;
    contact = await createContact(database, who, {
      kind: c.kind,
      isCustomer: true,
      isSupplier: false,
      name: c.name,
      contactPerson: c.contactPerson || null,
      email: c.email ?? null,
      phone: c.phone || null,
      street: c.street || null,
      buildingNumber: c.buildingNumber || null,
      postalCode: c.postalCode || null,
      town: c.town || null,
      country: c.country,
      language: c.language ?? language,
      uid: null,
      paymentTermDays: 30,
      notes: null,
    });
    if (c.id) {
      await database
        .update(contacts)
        .set({ externalRef: `crmlead:${c.id}` })
        .where(eq(contacts.id, contact.id));
    }
  }

  const created = await createInvoice(
    database,
    who,
    {
      contactId: contact.id,
      language,
      title: h.lead.title || null,
      introText: null,
      footerText: null,
      issueDate: opts.today,
      serviceDate: opts.today,
      dueDate: null,
      lines: h.lines.map((l) => ({
        productId: null,
        description: l.description,
        quantityMilli: Math.round(l.quantity * 1000),
        unit: l.unit,
        unitPriceCents: l.unitPriceCents,
        vatCode: l.vatCode,
      })),
    },
    h.kind,
  );
  if (!created || typeof created === "string") throw new Error("crmlead:not_saved");
  try {
    await database.update(invoices).set({ externalRef: ref }).where(eq(invoices.id, created.id));
  } catch {
    // Double clic : l'autre passage a gagné, on retire ce brouillon et on rend le sien.
    await deleteDraft(database, who, created.id);
    const other = await existing();
    if (other) return other;
    throw new Error("crmlead:conflict");
  }
  return { status: "created", id: created.id, kind: h.kind };
}
