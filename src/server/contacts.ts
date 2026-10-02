import { and, asc, eq, ilike, isNull, or, sql } from "drizzle-orm";
import { isValidUkPostcode } from "@/countries/gb/vat";
import { isUsState, isValidZip } from "@/countries/us/tax";
import { normalizeVatId } from "@/countries/vat-ids";
import type { Db } from "./db";
import { auditLog, type Contact, contacts } from "./db/schema";
import { lockQuota, organizationPlan, quotaAccess } from "./plans";

export const CONTACT_KINDS = ["company", "person"] as const;
export const DOCUMENT_LANGUAGES = ["de", "fr", "it", "en"] as const;
/** Pays proposés au départ ; les autres viendront avec les packs pays. */
export const CONTACT_COUNTRIES = ["CH", "LI", "DE", "FR", "IT", "AT", "GB", "US"] as const;

export type ContactInput = {
  kind: (typeof CONTACT_KINDS)[number];
  isCustomer: boolean;
  isSupplier: boolean;
  name: string;
  contactPerson: string | null;
  email: string | null;
  phone: string | null;
  street: string | null;
  buildingNumber: string | null;
  postalCode: string | null;
  town: string | null;
  region?: string | null;
  country: (typeof CONTACT_COUNTRIES)[number];
  language: (typeof DOCUMENT_LANGUAGES)[number];
  uid: string | null;
  paymentTermDays: number;
  notes: string | null;
};

export type ContactErrors = Partial<Record<keyof ContactInput, string>>;

const text = (form: FormData, key: string) => String(form.get(key) ?? "").trim();
const optional = (value: string) => (value === "" ? null : value);

export function parseContactForm(
  form: FormData,
): { ok: true; data: ContactInput } | { ok: false; errors: ContactErrors } {
  const errors: ContactErrors = {};

  const kind = text(form, "kind") as ContactInput["kind"];
  if (!CONTACT_KINDS.includes(kind)) errors.kind = "required";

  const name = text(form, "name");
  if (!name) errors.name = "required";
  else if (name.length > 70) errors.name = "tooLong";

  const isCustomer = form.get("isCustomer") === "on";
  const isSupplier = form.get("isSupplier") === "on";
  if (!isCustomer && !isSupplier) errors.isCustomer = "role";

  const email = optional(text(form, "email"));
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.email = "email";

  // L'adresse est facultative (un prospect peut n'avoir qu'un e-mail), mais complète si commencée :
  // la QR-facture n'accepte qu'une adresse structurée avec rue, NPA et localité.
  const street = optional(text(form, "street"));
  const buildingNumber = optional(text(form, "buildingNumber"));
  const postalCode = optional(text(form, "postalCode"));
  const town = optional(text(form, "town"));
  const regionRaw = optional(text(form, "region"));
  const country = (text(form, "country") || "CH") as ContactInput["country"];
  if (!CONTACT_COUNTRIES.includes(country)) errors.country = "required";
  const anyAddress = street || buildingNumber || postalCode || town;
  if (anyAddress) {
    if (!street) errors.street = "required";
    if (!postalCode) errors.postalCode = "required";
    else if ((country === "CH" || country === "LI") && !/^\d{4}$/.test(postalCode))
      errors.postalCode = "postalCode";
    else if (country === "US" && !isValidZip(postalCode)) errors.postalCode = "postalCode";
    else if (country === "GB" && !isValidUkPostcode(postalCode)) errors.postalCode = "postalCode";
    if (!town) errors.town = "required";
  }
  if (street && street.length > 70) errors.street = "tooLong";
  if (town && town.length > 35) errors.town = "tooLong";
  if (buildingNumber && buildingNumber.length > 16) errors.buildingNumber = "tooLong";
  // États-Unis : code d'État USPS (TX, NY…), exigé avec une adresse.
  const region = country === "US" ? (regionRaw?.toUpperCase() ?? null) : regionRaw;
  if (country === "US" && anyAddress && (!region || !isUsState(region))) errors.region = "usState";
  if (region && region.length > 35) errors.region = "tooLong";

  const language = text(form, "language") as ContactInput["language"];
  if (!DOCUMENT_LANGUAGES.includes(language)) errors.language = "required";

  const uidRaw = optional(text(form, "uid"));
  // IDE suisse ou numéro de TVA d'un autre pays (autoliquidation).
  const uid = uidRaw ? normalizeVatId(uidRaw) : null;
  if (uidRaw && !uid) errors.uid = "uid";

  const paymentTermDays = Number(text(form, "paymentTermDays") || "30");
  if (!Number.isInteger(paymentTermDays) || paymentTermDays < 0 || paymentTermDays > 365) {
    errors.paymentTermDays = "paymentTerm";
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    data: {
      kind,
      isCustomer,
      isSupplier,
      name,
      contactPerson: optional(text(form, "contactPerson")),
      email,
      phone: optional(text(form, "phone")),
      street,
      buildingNumber,
      postalCode,
      town,
      region,
      country,
      language,
      uid,
      paymentTermDays,
      notes: optional(text(form, "notes")),
    },
  };
}

/** Contacts actifs de l'organisation, filtrés par nom, e-mail ou localité. */
export async function listContacts(
  database: Db,
  organizationId: string,
  query = "",
): Promise<Contact[]> {
  const q = query.trim();
  const pattern = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  return database
    .select()
    .from(contacts)
    .where(
      and(
        eq(contacts.organizationId, organizationId),
        isNull(contacts.archivedAt),
        q
          ? or(
              ilike(contacts.name, pattern),
              ilike(contacts.email, pattern),
              ilike(contacts.town, pattern),
            )
          : undefined,
      ),
    )
    .orderBy(asc(sql`lower(${contacts.name})`))
    .limit(500);
}

/** Un contact, seulement s'il appartient à l'organisation. */
export async function getContact(
  database: Db,
  organizationId: string,
  id: string,
): Promise<Contact | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [row] = await database
    .select()
    .from(contacts)
    .where(and(eq(contacts.id, id), eq(contacts.organizationId, organizationId)))
    .limit(1);
  return row ?? null;
}

async function insertContact(
  tx: Db,
  who: { organizationId: string; userId: string },
  data: ContactInput,
): Promise<Contact> {
  const [row] = await tx
    .insert(contacts)
    .values({ ...data, organizationId: who.organizationId })
    .returning();
  if (!row) throw new Error("contact_not_saved");
  await tx.insert(auditLog).values({
    organizationId: who.organizationId,
    userId: who.userId,
    action: "contact.create",
    entity: "contact",
    entityId: row.id,
  });
  return row;
}

/** Crée un contact sans regarder la formule (données reprises, jeux d'essai). */
export async function createContact(
  database: Db,
  who: { organizationId: string; userId: string },
  data: ContactInput,
): Promise<Contact> {
  return database.transaction((tx) => insertContact(tx as unknown as Db, who, data));
}

/**
 * Nouveau contact dans la limite de la formule (gratuite : 50 contacts actifs), compté puis créé
 * sous un verrou de l'entreprise : deux créations simultanées ne dépassent pas la limite. Le
 * formulaire, l'API, le serveur MCP et l'import depuis CRMlead passent tous par ici.
 */
export async function createContactWithinPlan(
  database: Db,
  who: { organizationId: string; userId: string },
  data: ContactInput,
): Promise<Contact | "planLimit"> {
  const plan = await organizationPlan(database, who.organizationId);
  if (!plan) return "planLimit";
  return database.transaction(async (tx) => {
    const t = tx as unknown as Db;
    await lockQuota(t, who.organizationId, "contacts");
    if (!(await quotaAccess(t, plan, "contacts")).allowed) return "planLimit" as const;
    return insertContact(t, who, data);
  });
}

/** Met à jour un contact de l'organisation ; rend null s'il n'existe pas chez elle. */
export async function updateContact(
  database: Db,
  who: { organizationId: string; userId: string },
  id: string,
  data: ContactInput,
): Promise<Contact | null> {
  if (!(await getContact(database, who.organizationId, id))) return null;
  return database.transaction(async (tx) => {
    const [row] = await tx
      .update(contacts)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(contacts.id, id), eq(contacts.organizationId, who.organizationId)))
      .returning();
    await tx.insert(auditLog).values({
      organizationId: who.organizationId,
      userId: who.userId,
      action: "contact.update",
      entity: "contact",
      entityId: id,
    });
    return row ?? null;
  });
}

/** Archive plutôt que supprimer : un contact déjà facturé doit rester lisible dans les pièces. */
export async function archiveContact(
  database: Db,
  who: { organizationId: string; userId: string },
  id: string,
): Promise<boolean> {
  const [row] = await database
    .update(contacts)
    .set({ archivedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(contacts.id, id), eq(contacts.organizationId, who.organizationId)))
    .returning({ id: contacts.id });
  if (!row) return false;
  await database.insert(auditLog).values({
    organizationId: who.organizationId,
    userId: who.userId,
    action: "contact.archive",
    entity: "contact",
    entityId: id,
  });
  return true;
}
