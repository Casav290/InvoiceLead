import { and, asc, desc, eq, isNull, like, sql } from "drizzle-orm";
import { z } from "zod";
import { VAT_CODES } from "@/countries/ch/vat";
import { toForm } from "./api";
import {
  type ContactInput,
  createContactWithinPlan,
  DOCUMENT_LANGUAGES,
  getContact,
  listContacts,
  parseContactForm,
} from "./contacts";
import type { Db } from "./db";
import {
  auditLog,
  type Contact,
  contacts,
  invoices,
  memberships,
  type Organization,
  organizations,
  users,
} from "./db/schema";
import {
  createInvoice,
  deleteDraft,
  getInvoice,
  INVOICE_LANGUAGES,
  isVatRegistered,
  MAX_LINES,
  parseInvoiceForm,
  updateInvoice,
} from "./invoices";
import { checkEnvelope, type IncomingExchange, orgSendersFrom } from "./lead-id/leadId";
import { organizationPlan, planCode, quotaAccess, tierOf } from "./plans";
import { can, hasAppAccess, isRemoved, type Member } from "./roles";
import { hasSeat } from "./team";

/**
 * Liaison sans clé (26.10.2026) : ce qu'InvoiceLead reçoit et laisse lire des autres applications
 * Lead de la même entreprise (organisation ERPlead). Aucune clé, aucune formule : la personne agit
 * avec ses propres droits ici, et InvoiceLead applique ses propres limites (contacts de la formule).
 *
 * - Boîte de réception : enveloppe 'invoice' de ProjectLead (temps passé → brouillon de facture).
 * - Lecture : 'contact' pour ProjectLead (« Importer depuis InvoiceLead »), clients seulement.
 */

/** Qui peut envoyer quoi ici. Aucune autre paire n'existe. */
export const ACCEPTS: Record<string, string[]> = { invoice: ["projectlead"] };
/** Qui peut lire quoi ici. */
export const READERS: Record<string, string[]> = { contact: ["projectlead"] };

/** Expéditeurs dont le jeton doit porter l'organisation (EXCHANGE_ORG_SENDERS, défaut « projectlead »). */
export const orgSenders = () => orgSendersFrom(process.env.EXCHANGE_ORG_SENDERS, "projectlead");

export type ExchangeReply = { status: number; body: Record<string, unknown> };
const reply = (status: number, body: Record<string, unknown>): ExchangeReply => ({ status, body });

const opt = (max: number) => z.string().trim().max(max).nullish();
const invoiceData = z.object({
  client: z.object({
    source_id: z.string().trim().min(1).max(200),
    invoicelead_contact_id: z.string().trim().max(100).nullish(),
    kind: z.enum(["company", "person"]).default("company"),
    name: z.string().trim().min(1).max(2000),
    contact_person: opt(2000),
    email: opt(2000),
    phone: opt(2000),
    street: opt(2000),
    building_number: opt(2000),
    postal_code: opt(2000),
    town: opt(2000),
    country: opt(10),
    language: opt(10),
    vat_number: opt(100),
  }),
  title: opt(2000),
  intro: opt(2000),
  service_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  currency: opt(10),
  vat_code: z.enum(VAT_CODES).nullish(),
  language: opt(10),
  lines: z
    .array(
      z.object({
        description: z.string().trim().min(1).max(2000),
        quantity: z.number().finite().positive().max(1_000_000),
        unit: z.enum(["hour", "day", "piece", "flat", "month"]),
        unit_price_cents: z.number().int().min(0).max(100_000_000_00),
      }),
    )
    .min(1)
    .max(MAX_LINES),
});
type InvoiceData = z.infer<typeof invoiceData>;

/** L'entreprise InvoiceLead de l'organisation ERPlead : par son identifiant seulement. */
export async function organizationOfLeadOrg(database: Db, leadOrg: string) {
  const [org] = await database
    .select()
    .from(organizations)
    .where(eq(organizations.leadOrg, leadOrg))
    .limit(1);
  return org ?? null;
}

type Person = { userId: string; name: string; member: (Member & { userId: string }) | null };

/** La personne du jeton (son `sub` ERPlead = lead_sub ici) et son adhésion à cette entreprise. */
async function personOf(
  database: Db,
  organizationId: string,
  leadSub: string,
): Promise<Person | null> {
  const [row] = await database
    .select({
      userId: users.id,
      name: users.name,
      role: memberships.role,
      appRole: memberships.appRole,
      removedAt: memberships.removedAt,
      orgId: memberships.organizationId,
    })
    .from(users)
    .leftJoin(
      memberships,
      and(eq(memberships.userId, users.id), eq(memberships.organizationId, organizationId)),
    )
    .where(eq(users.leadSub, leadSub))
    .limit(1);
  if (!row) return null;
  return {
    userId: row.userId,
    name: row.name,
    member:
      row.orgId && row.role
        ? { userId: row.userId, role: row.role, appRole: row.appRole, removedAt: row.removedAt }
        : null,
  };
}

/** Premier administrateur présent, qui a donc le droit de facturer ; null s'il n'y en a pas. */
async function firstBillingAdmin(database: Db, organizationId: string) {
  const rows = await database
    .select({
      userId: users.id,
      name: users.name,
      role: memberships.role,
      appRole: memberships.appRole,
      removedAt: memberships.removedAt,
    })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(
      and(
        eq(memberships.organizationId, organizationId),
        eq(memberships.role, "admin"),
        isNull(memberships.removedAt),
      ),
    )
    .orderBy(asc(memberships.createdAt));
  return rows.find((m) => can(m, "billing")) ?? null;
}

const isUniqueViolation = (e: unknown) => {
  const err = e as { code?: string; cause?: { code?: string } };
  return err?.code === "23505" || err?.cause?.code === "23505";
};

const base = (organizationId: string) =>
  and(eq(contacts.organizationId, organizationId), isNull(contacts.archivedAt));

async function contactByRef(database: Db, organizationId: string, ref: string) {
  const [row] = await database
    .select()
    .from(contacts)
    .where(and(eq(contacts.organizationId, organizationId), eq(contacts.externalRef, ref)))
    .limit(1);
  return row ?? null;
}

/**
 * Le contact de la facture : l'indice de ProjectLead s'il est à cette entreprise, sinon la fiche déjà
 * reliée à ce client ProjectLead, sinon le même e-mail, sinon le même nom ; à défaut, créé dans la
 * limite de la formule et relié (« projectlead:<client> », unique par entreprise).
 */
async function resolveContact(
  database: Db,
  org: Organization,
  who: { organizationId: string; userId: string },
  client: InvoiceData["client"],
): Promise<Contact | ExchangeReply> {
  const ref = `projectlead:${client.source_id}`;
  if (client.invoicelead_contact_id) {
    const hinted = await getContact(database, org.id, client.invoicelead_contact_id);
    if (hinted && !hinted.archivedAt) return hinted;
  }
  const linked = await contactByRef(database, org.id, ref);
  if (linked && !linked.archivedAt) return linked;
  const email = client.email?.trim().toLowerCase();
  const tries = [
    email ? sql`lower(${contacts.email}) = ${email}` : null,
    sql`lower(${contacts.name}) = lower(${client.name})`,
  ];
  for (const cond of tries) {
    if (!cond) continue;
    const [row] = await database
      .select()
      .from(contacts)
      .where(and(base(org.id), cond))
      .orderBy(asc(contacts.createdAt))
      .limit(1);
    if (row) {
      if (!row.externalRef && !linked) {
        // Relié pour la prochaine fois ; une course perdue ne change rien au résultat.
        await database
          .update(contacts)
          .set({ externalRef: ref })
          .where(and(eq(contacts.id, row.id), isNull(contacts.externalRef)))
          .catch(() => undefined);
      }
      return row;
    }
  }

  // Création : mêmes règles que le formulaire et l'API (adresse structurée, NPA, IDE…).
  const country = (client.country ?? "").toUpperCase() || org.country;
  const lang = (client.language ?? "").toLowerCase();
  const form = toForm(
    {
      kind: client.kind,
      isCustomer: true,
      name: client.name,
      contactPerson: client.contact_person ?? "",
      email: client.email ?? "",
      phone: client.phone ?? "",
      street: client.street ?? "",
      buildingNumber: client.building_number ?? "",
      postalCode: client.postal_code ?? "",
      town: client.town ?? "",
      country,
      language: (DOCUMENT_LANGUAGES as readonly string[]).includes(lang) ? lang : org.defaultLocale,
      uid: client.vat_number ?? "",
    },
    ["isCustomer"],
  );
  const parsed = parseContactForm(form);
  if (!parsed.ok) {
    const fields = Object.fromEntries(
      Object.entries(parsed.errors).map(([k, v]) => [`client.${k}`, String(v)]),
    );
    return reply(422, { error: "invalid", fields });
  }
  const data: ContactInput = { ...parsed.data, externalRef: ref };
  try {
    const saved = await createContactWithinPlan(database, who, data);
    if (saved !== "planLimit") return saved;
  } catch (e) {
    // Un clic et la tâche mensuelle en même temps : l'autre a créé la fiche, on la reprend.
    if (!isUniqueViolation(e)) throw e;
    const other = await contactByRef(database, org.id, ref);
    if (other) return other;
    throw e;
  }
  const plan = await organizationPlan(database, org.id);
  const access = plan ? await quotaAccess(database, plan, "contacts") : null;
  return reply(409, {
    error: "contact_limit",
    limit: access?.limit ?? null,
    count: access?.used ?? null,
    plan: plan ? planCode(tierOf(plan)) : "free",
  });
}

/**
 * Enveloppe 'invoice' de ProjectLead : brouillon de facture du temps passé, créé ou remplacé
 * (même `source.id` = même brouillon). Réponse { id, status, total_cents, contact_id }.
 */
export async function receiveInvoice(
  database: Db,
  tok: IncomingExchange,
  envelope: unknown,
): Promise<ExchangeReply> {
  const refused = checkEnvelope(tok, envelope, ACCEPTS, orgSenders());
  if (refused) return reply(refused.status, { error: refused.error });
  const env = envelope as { org: string; source: { id: string }; data: unknown };
  const parsed = invoiceData.safeParse(env.data);
  if (!parsed.success) {
    const fields = Object.fromEntries(parsed.error.issues.map((i) => [i.path.join("."), i.code]));
    return reply(422, { error: "invalid", fields });
  }
  const data = parsed.data;
  const org = await organizationOfLeadOrg(database, env.org);
  if (!org) return reply(404, { error: "unknown_org" });

  // Qui crée le brouillon : la personne si elle est membre avec le droit de facturer ; membre sans
  // ce droit → refus ; pas membre ici, ou tâche mensuelle sans personne → le premier administrateur.
  const admin = await firstBillingAdmin(database, org.id);
  let actor: string | null = null;
  let draftFor: string | null = null;
  const person = tok.person ? await personOf(database, org.id, tok.person) : null;
  if (person?.member) {
    const allowed = can(person.member, "billing") && (await hasSeat(database, org, person.userId));
    if (!allowed)
      return reply(403, { error: "person_not_allowed", ...(admin ? { admin: admin.name } : {}) });
    actor = person.userId;
  } else {
    if (!admin) return reply(409, { error: "no_billing_admin" });
    actor = admin.userId;
    draftFor = tok.person;
  }
  const who = { organizationId: org.id, userId: actor };

  const contact = await resolveContact(database, org, who, data.client);
  if ("status" in contact && "body" in contact) return contact as ExchangeReply;
  const c = contact as Contact;

  // Le brouillon, validé comme une saisie (TVA au taux de la date de prestation, devise, lignes).
  const language = (INVOICE_LANGUAGES as readonly string[]).includes(data.language ?? "")
    ? (data.language as string)
    : (INVOICE_LANGUAGES as readonly string[]).includes(c.language)
      ? c.language
      : (INVOICE_LANGUAGES as readonly string[]).includes(org.defaultLocale)
        ? org.defaultLocale
        : "de";
  const today = new Date().toISOString().slice(0, 10);
  const form = toForm({
    contactId: c.id,
    language,
    issueDate: today,
    serviceDate: data.service_date,
    title: data.title ?? "",
    introText: data.intro ?? "",
    currency: data.currency ?? "",
    lines: data.lines.map((l) => ({
      description: l.description,
      quantity: String(Math.round(l.quantity * 1000) / 1000),
      unit: l.unit,
      unitPrice: (l.unit_price_cents / 100).toFixed(2),
      vatCode: data.vat_code ?? "normal",
    })),
  });
  const input = parseInvoiceForm(form, {
    vatRegistered: await isVatRegistered(database, org.id),
    country: org.country,
  });
  if (!input.ok) return reply(422, { error: "invalid", fields: input.errors });

  const ref = `projectlead:${env.source.id}`;
  const existing = async () => {
    const [row] = await database
      .select({ id: invoices.id, status: invoices.status, kind: invoices.kind })
      .from(invoices)
      .where(and(eq(invoices.organizationId, org.id), eq(invoices.externalRef, ref)))
      .limit(1);
    return row ?? null;
  };
  const done = async (id: string, status: "created" | "updated", userId: string) => {
    if (draftFor) {
      await database.insert(auditLog).values({
        organizationId: org.id,
        userId,
        action: "projectlead.draft_for",
        entity: "invoice",
        entityId: id,
        data: { person: draftFor, source: env.source.id, status },
      });
    }
    const found = await getInvoice(database, org.id, id);
    return reply(status === "created" ? 201 : 200, {
      id,
      status,
      total_cents: found?.invoice.totalCents ?? 0,
      contact_id: c.id,
    });
  };
  const replace = async (id: string, status: string) => {
    if (status !== "draft") return reply(409, { error: "already_issued", id });
    const saved = await updateInvoice(database, who, id, input.data, "invoice");
    if (saved === "notDraft") return reply(409, { error: "already_issued", id });
    if (!saved || typeof saved !== "object") return reply(500, { error: "server" });
    return done(id, "updated", who.userId);
  };

  const found = await existing();
  if (found) return replace(found.id, found.status);
  const created = await createInvoice(database, who, input.data, "invoice");
  if (created === "contact")
    return reply(422, { error: "invalid", fields: { contactId: "required" } });
  if (!created || typeof created !== "object") return reply(500, { error: "server" });
  try {
    await database.update(invoices).set({ externalRef: ref }).where(eq(invoices.id, created.id));
  } catch (e) {
    if (!isUniqueViolation(e)) throw e;
    // Deux envois identiques en même temps : l'autre a gagné, on retire ce brouillon et on met le sien à jour.
    await deleteDraft(database, who, created.id);
    const other = await existing();
    if (!other) throw e;
    return replace(other.id, other.status);
  }
  return done(created.id, "created", who.userId);
}

/** Contact tel que le rend /api/v1/contacts (forme du contrat de lecture). */
const contactOut = (c: Contact) => ({
  id: c.id,
  kind: c.kind,
  name: c.name,
  contactPerson: c.contactPerson,
  email: c.email,
  phone: c.phone,
  street: c.street,
  buildingNumber: c.buildingNumber,
  postalCode: c.postalCode,
  town: c.town,
  country: c.country,
  language: c.language,
  uid: c.uid,
  isCustomer: c.isCustomer,
});

/**
 * Lecture pour ProjectLead : clients de l'entreprise (pas les fournisseurs), 20 au plus, avec les
 * droits de la personne du jeton. Pas membre ici → 403 person_not_member, jamais d'administrateur
 * à sa place.
 */
export async function readForExchange(
  database: Db,
  tok: IncomingExchange,
  query: URLSearchParams,
): Promise<ExchangeReply> {
  const type = query.get("type") ?? "";
  if (!Object.hasOwn(READERS, type)) return reply(422, { error: "unsupported_type" });
  if (!(READERS[type] ?? []).includes(tok.app)) return reply(403, { error: "sender_not_allowed" });
  if (!tok.org) return reply(401, { error: "org_required" });
  if (!tok.person) return reply(400, { error: "person_required" });
  const org = await organizationOfLeadOrg(database, tok.org);
  if (!org) return reply(404, { error: "unknown_org" });
  const person = await personOf(database, org.id, tok.person);
  if (!person?.member) return reply(403, { error: "person_not_member", reason: "not_opened" });
  if (isRemoved(person.member) || !hasAppAccess(person.member))
    return reply(403, { error: "person_not_member", reason: "disabled" });
  if (!(await hasSeat(database, org, person.userId)))
    return reply(403, { error: "person_not_member", reason: "no_seat" });
  const q = (query.get("q") ?? "").slice(0, 100);
  const rows = await listContacts(database, org.id, q);
  return reply(200, {
    data: rows
      .filter((r) => r.isCustomer)
      .slice(0, 20)
      .map(contactOut),
  });
}

/** Dernier brouillon reçu de ProjectLead (créé ou remplacé), pour l'écran « Applications Lead ». */
export async function lastProjectLeadDraft(database: Db, organizationId: string) {
  const [row] = await database
    .select({ at: invoices.updatedAt })
    .from(invoices)
    .where(
      and(eq(invoices.organizationId, organizationId), like(invoices.externalRef, "projectlead:%")),
    )
    .orderBy(desc(invoices.updatedAt))
    .limit(1);
  return row?.at ?? null;
}
