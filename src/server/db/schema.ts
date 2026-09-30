import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

/** Personne. Rattachée au Compte Lead par `lead_sub`, jamais par l'email seul. */
export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    leadSub: text("lead_sub").unique(),
    email: text("email").notNull(),
    name: text("name").notNull().default(""),
    locale: text("locale").notNull().default("de"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // L'identité se rattache par `lead_sub`. Deux comptes Lead peuvent donc porter la même adresse
    // (compte recréé, boîte réattribuée, adresse non vérifiée) sans jamais bloquer une connexion.
    // L'unicité ne vaut que pour les personnes pas encore rattachées au Compte Lead.
    index("users_email_lower_idx").on(sql`lower(${t.email})`),
    uniqueIndex("users_email_unlinked_idx")
      .on(sql`lower(${t.email})`)
      .where(sql`${t.leadSub} is null`),
  ],
);

/** Entreprise cliente (organisation du Compte Lead). Toutes les données métier y sont rattachées. */
export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  leadOrg: text("lead_org").unique(),
  name: text("name").notNull(),
  country: text("country").notNull().default("CH"),
  currency: text("currency").notNull().default("CHF"),
  defaultLocale: text("default_locale").notNull().default("de"),
  leadPlan: text("lead_plan").notNull().default("free"),
  hasAccess: boolean("has_access").notNull().default(false),
  entitlements: jsonb("entitlements"),
  entitlementsAt: timestamp("entitlements_at", { withTimezone: true }),

  // Données de l'entreprise (réglages), reprises sur les devis, factures et QR-factures.
  legalName: text("legal_name"),
  legalForm: text("legal_form"), // sole_proprietorship | gmbh | ag | partnership | association | other
  street: text("street"),
  buildingNumber: text("building_number"),
  postalCode: text("postal_code"),
  town: text("town"),
  email: text("email"),
  phone: text("phone"),
  website: text("website"),
  uid: text("uid"), // CHE123456789, sans séparateurs
  vatRegistered: boolean("vat_registered").notNull().default(false),
  vatMethod: text("vat_method"), // effective | net_tax_rate
  vatSettlement: text("vat_settlement"), // agreed | received
  iban: text("iban"),
  qrIban: text("qr_iban"),
  fiscalYearStartMonth: integer("fiscal_year_start_month").notNull().default(1),
  settingsCompletedAt: timestamp("settings_completed_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** Appartenance d'une personne à une organisation, avec son rôle Lead (admin, manager, user). */
export const memberships = pgTable(
  "memberships",
  {
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("user"),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.organizationId, t.userId] }),
    index("memberships_user_idx").on(t.userId),
  ],
);

/** Session locale. L'identifiant est l'empreinte SHA-256 du jeton du cookie, jamais le jeton lui-même. */
export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    idToken: text("id_token"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("sessions_user_idx").on(t.userId), index("sessions_expires_idx").on(t.expiresAt)],
);

/** Journal des actions sensibles, conservé avec l'organisation. */
export const auditLog = pgTable(
  "audit_log",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    organizationId: uuid("organization_id").references(() => organizations.id, {
      onDelete: "set null",
    }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    entity: text("entity"),
    entityId: text("entity_id"),
    data: jsonb("data"),
    createdAt: createdAt(),
  },
  (t) => [index("audit_log_org_idx").on(t.organizationId, t.createdAt)],
);

export type User = typeof users.$inferSelect;
export type Organization = typeof organizations.$inferSelect;

/** Client ou fournisseur d'une organisation. L'adresse est structurée, comme l'exige la QR-facture. */
export const contacts = pgTable(
  "contacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    kind: text("kind").notNull().default("company"), // company | person
    isCustomer: boolean("is_customer").notNull().default(true),
    isSupplier: boolean("is_supplier").notNull().default(false),
    name: text("name").notNull(), // raison sociale, ou « Prénom Nom »
    contactPerson: text("contact_person"),
    email: text("email"),
    phone: text("phone"),
    street: text("street"),
    buildingNumber: text("building_number"),
    postalCode: text("postal_code"),
    town: text("town"),
    country: text("country").notNull().default("CH"),
    language: text("language").notNull().default("de"), // langue des documents : de | fr | it | en
    uid: text("uid"),
    paymentTermDays: integer("payment_term_days").notNull().default(30),
    notes: text("notes"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("contacts_org_name_idx").on(t.organizationId, sql`lower(${t.name})`)],
);

export type Contact = typeof contacts.$inferSelect;

/** Article ou prestation du catalogue d'une organisation. Prix unitaire hors TVA, en centimes. */
export const products = pgTable(
  "products",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    sku: text("sku"),
    name: text("name").notNull(),
    description: text("description"),
    unit: text("unit").notNull().default("piece"), // hour | day | piece | flat | km | month
    unitPriceCents: bigint("unit_price_cents", { mode: "number" }).notNull(),
    vatCode: text("vat_code").notNull().default("normal"), // normal | reduced | lodging | exempt | export
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("products_org_name_idx").on(t.organizationId, sql`lower(${t.name})`),
    uniqueIndex("products_org_sku_idx")
      .on(t.organizationId, t.sku)
      .where(sql`${t.sku} is not null and ${t.archivedAt} is null`),
  ],
);

export type Product = typeof products.$inferSelect;

/**
 * Compte du plan comptable d'une organisation (plan PME suisse, classes 1 à 9). Les comptes « système »
 * portent un rôle (débiteurs, TVA due, banque...) que les écritures automatiques retrouvent sans
 * dépendre du numéro, que l'entreprise peut adapter.
 */
export const accounts = pgTable(
  "accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    number: text("number").notNull(), // 4 chiffres, la classe est le premier
    nameDe: text("name_de").notNull(),
    nameFr: text("name_fr").notNull(),
    type: text("type").notNull(), // asset | liability | equity | revenue | expense | closing
    role: text("role"),
    vatCode: text("vat_code"), // code TVA proposé par défaut à la saisie
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("accounts_org_number_idx").on(t.organizationId, t.number),
    uniqueIndex("accounts_org_role_idx")
      .on(t.organizationId, t.role)
      .where(sql`${t.role} is not null`),
  ],
);

export type Account = typeof accounts.$inferSelect;

/** Exercice comptable. Les exercices se suivent sans trou ni chevauchement. */
export const fiscalYears = pgTable(
  "fiscal_years",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    startDate: date("start_date", { mode: "string" }).notNull(),
    endDate: date("end_date", { mode: "string" }).notNull(),
    status: text("status").notNull().default("open"), // open | closed
    closedAt: timestamp("closed_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("fiscal_years_org_start_idx").on(t.organizationId, t.startDate),
    check("fiscal_years_dates_check", sql`${t.endDate} >= ${t.startDate}`),
  ],
);

export type FiscalYear = typeof fiscalYears.$inferSelect;
