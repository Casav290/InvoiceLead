import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  check,
  customType,
  date,
  doublePrecision,
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
  /** Logo de l'entreprise (PNG ou JPEG), repris sur les devis, factures et avoirs. */
  logoKey: text("logo_key"),
  legalForm: text("legal_form"), // sole_proprietorship | gmbh | ag | partnership | association | other
  street: text("street"),
  buildingNumber: text("building_number"),
  postalCode: text("postal_code"),
  town: text("town"),
  /** État, province ou région (codes USPS aux États-Unis). */
  region: text("region"),
  email: text("email"),
  phone: text("phone"),
  website: text("website"),
  uid: text("uid"), // CHE123456789 ou, en Allemagne, USt-IdNr. DE123456789
  /** Allemagne : Steuernummer attribuée par le Finanzamt (« 12/345/67890 »). */
  taxNumber: text("tax_number"),
  vatRegistered: boolean("vat_registered").notNull().default(false),
  vatMethod: text("vat_method"), // effective | net_tax_rate
  vatSettlement: text("vat_settlement"), // agreed | received
  iban: text("iban"),
  qrIban: text("qr_iban"),
  /** Taux de la dette fiscale nette accordé par l'AFC (méthode TDFN), en points de base : 620 = 6,2 %. */
  netTaxRateBp: integer("net_tax_rate_bp"),
  /** États-Unis : taux combiné de sales tax (État, comté, ville), en points de base. */
  salesTaxRateBp: doublePrecision("sales_tax_rate_bp"),
  /** Compte Stripe connecté (Stripe Connect) qui reçoit les paiements en ligne des clients. */
  stripeAccountId: text("stripe_account_id"),
  /**
   * Pilote automatique : les propositions sûres (référence de paiement, règle confirmée, IA très
   * confiante) sont comptabilisées sans clic ; la personne ne relit que les exceptions.
   */
  autopilot: boolean("autopilot").notNull().default(false),
  /** Factures fournisseurs : deux personnes différentes approuvent avant le paiement. */
  dualApproval: boolean("dual_approval").notNull().default(false),
  /** Relances envoyées chaque jour par la tâche quotidienne (formule Pro), sans clic. */
  reminderAuto: boolean("reminder_auto").notNull().default(false),
  /** Frais de rappel dès la deuxième relance, en centimes ; 0 : aucun. */
  reminderFeeCents: bigint("reminder_fee_cents", { mode: "number" }).notNull().default(0),
  /** Intérêt moratoire annuel en points de base (500 = 5 %, art. 104 CO) ; vide : aucun. */
  lateInterestBp: doublePrecision("late_interest_bp"),
  fiscalYearStartMonth: integer("fiscal_year_start_month").notNull().default(1),
  settingsCompletedAt: timestamp("settings_completed_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/**
 * Appartenance d'une personne à une organisation : rôle Lead (admin, manager, user), relu à chaque
 * connexion, ou « fiduciary » pour une fiduciaire invitée par l'entreprise.
 */
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
    /** Droits dans InvoiceLead (roles.ts) : all, billing, accounting, readonly, none. Null vaut all. */
    appRole: text("app_role"),
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
    /** État ou région (codes USPS aux États-Unis). */
    region: text("region"),
    country: text("country").notNull().default("CH"),
    language: text("language").notNull().default("de"), // langue des documents : de | fr | it | en
    uid: text("uid"),
    paymentTermDays: integer("payment_term_days").notNull().default(30),
    notes: text("notes"),
    /** Fiche d'origine dans une autre application de la famille, « crmlead:<id> ». */
    externalRef: text("external_ref"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("contacts_org_name_idx").on(t.organizationId, sql`lower(${t.name})`),
    index("contacts_org_external_idx").on(t.organizationId, t.externalRef),
  ],
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
    /** Libellé anglais ; vide, l'interface anglaise retombe sur le libellé allemand. */
    nameEn: text("name_en"),
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

/** Compteurs de numérotation sans trou, par organisation, type de pièce et année. */
export const numberSequences = pgTable(
  "number_sequences",
  {
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(), // invoice | quote | credit_note
    year: integer("year").notNull(),
    lastValue: integer("last_value").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.organizationId, t.kind, t.year] })],
);

/** Adresse figée sur une pièce émise : la facture reste telle qu'envoyée, même si le contact change. */
export type PartySnapshot = {
  name: string;
  contactPerson?: string | null;
  street: string | null;
  buildingNumber: string | null;
  postalCode: string | null;
  town: string | null;
  /** État ou région (États-Unis). */
  region?: string | null;
  country: string;
  uid?: string | null;
  email?: string | null;
  phone?: string | null;
  iban?: string | null;
  qrIban?: string | null;
  vatNumber?: string | null;
  /** Allemagne : Steuernummer, exigée sur la facture quand il n'y a pas d'USt-IdNr. */
  taxNumber?: string | null;
};

/**
 * Facture ou devis (`kind`), qui partagent lignes, calculs et numérotation. Les devis ne passent jamais
 * en comptabilité ; transformé en facture, un devis garde le lien (`source_quote_id` sur la facture).
 *
 * Facture. Brouillon modifiable, puis émise : elle reçoit alors son numéro et devient immuable (seule
 * l'annulation par avoir la corrigera). Montants hors TVA, TVA et total en centimes.
 */
export const invoices = pgTable(
  "invoices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "restrict" }),
    kind: text("kind").notNull().default("invoice"), // invoice | quote | credit_note
    number: text("number"),
    // facture : draft | issued ; devis : draft | issued | accepted | declined | invoiced
    status: text("status").notNull().default("draft"),
    sourceQuoteId: uuid("source_quote_id"),
    /** Pour un avoir : la facture qu'il annule ou corrige. */
    relatedInvoiceId: uuid("related_invoice_id"),
    language: text("language").notNull().default("de"),
    currency: text("currency").notNull().default("CHF"),
    /**
     * Pièce en devise étrangère : valeur d'une unité de la devise de la pièce dans la monnaie de
     * l'entreprise (1 EUR = 0.9412 CHF). Saisi ou repris du cours BCE du jour d'émission, puis figé.
     */
    fxRate: doublePrecision("fx_rate"),
    title: text("title"),
    introText: text("intro_text"),
    footerText: text("footer_text"),
    issueDate: date("issue_date", { mode: "string" }).notNull(),
    serviceDate: date("service_date", { mode: "string" }).notNull(),
    dueDate: date("due_date", { mode: "string" }).notNull(),
    vatRegistered: boolean("vat_registered").notNull().default(false),
    netCents: bigint("net_cents", { mode: "number" }).notNull().default(0),
    vatCents: bigint("vat_cents", { mode: "number" }).notNull().default(0),
    totalCents: bigint("total_cents", { mode: "number" }).notNull().default(0),
    recipient: jsonb("recipient").$type<PartySnapshot>(),
    sender: jsonb("sender").$type<PartySnapshot>(),
    /** Référence de paiement de la QR-facture (QRR avec un QR-IBAN, sinon SCOR « RF… »), fixée à l'émission. */
    paymentReference: text("payment_reference"),
    /** Empreinte SHA-256 du jeton du lien de consultation en ligne ; le jeton lui-même n'est jamais stocké. */
    publicTokenHash: text("public_token_hash"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    sentTo: text("sent_to"),
    viewedAt: timestamp("viewed_at", { withTimezone: true }),
    /** Écriture comptable de l'émission ; vide tant que la pièce n'est pas comptabilisée. */
    journalEntryId: uuid("journal_entry_id"),
    /** Origine dans une autre application de la famille, « crmlead:<id du lead> » : évite les doublons. */
    externalRef: text("external_ref"),
    /** Projet facturé (heures reprises du suivi du temps). */
    projectId: uuid("project_id"),
    /** Facture d'acompte sur un devis (`source_quote_id`), déduite de la facture finale. */
    deposit: boolean("deposit").notNull().default(false),
    issuedAt: timestamp("issued_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("invoices_org_idx").on(t.organizationId, t.kind, t.createdAt),
    index("invoices_related_idx").on(t.relatedInvoiceId),
    uniqueIndex("invoices_public_token_idx").on(t.publicTokenHash),
    uniqueIndex("invoices_org_number_idx")
      .on(t.organizationId, t.number)
      .where(sql`${t.number} is not null`),
    uniqueIndex("invoices_org_external_idx")
      .on(t.organizationId, t.externalRef)
      .where(sql`${t.externalRef} is not null`),
  ],
);

export type Invoice = typeof invoices.$inferSelect;

/** Ligne de facture. Désignation et prix copiés de l'article : modifier l'article ne change rien ici. */
export const invoiceLines = pgTable(
  "invoice_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => invoices.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    productId: uuid("product_id").references(() => products.id, { onDelete: "set null" }),
    description: text("description").notNull(),
    quantityMilli: bigint("quantity_milli", { mode: "number" }).notNull(),
    unit: text("unit").notNull(),
    unitPriceCents: bigint("unit_price_cents", { mode: "number" }).notNull(),
    vatCode: text("vat_code"), // null si l'entreprise n'est pas assujettie
    /** Taux en points de base ; un demi-point est possible (sales tax de 8,875 %). */
    vatRateBp: doublePrecision("vat_rate_bp").notNull().default(0),
    netCents: bigint("net_cents", { mode: "number" }).notNull(),
  },
  (t) => [uniqueIndex("invoice_lines_position_idx").on(t.invoiceId, t.position)],
);

export type InvoiceLine = typeof invoiceLines.$inferSelect;

/** Paiement reçu sur une facture émise (saisi à la main ; le lettrage bancaire viendra plus tard). */
export const invoicePayments = pgTable(
  "invoice_payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => invoices.id, { onDelete: "restrict" }),
    paidOn: date("paid_on", { mode: "string" }).notNull(),
    amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
    method: text("method").notNull().default("bank"), // bank | cash | online | other
    note: text("note"),
    /** Paiement en ligne : identifiant chez le prestataire (session Stripe), unique pour l'idempotence. */
    externalRef: text("external_ref"),
    /** Facture en devise : cours du jour du paiement ; l'écart avec le cours de la facture va en différence de change. */
    fxRate: doublePrecision("fx_rate"),
    /** Part de la créance soldée, en monnaie de l'entreprise, fixée à la comptabilisation. */
    receivableHomeCents: bigint("receivable_home_cents", { mode: "number" }),
    journalEntryId: uuid("journal_entry_id"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [
    index("invoice_payments_invoice_idx").on(t.invoiceId),
    uniqueIndex("invoice_payments_external_idx")
      .on(t.externalRef)
      .where(sql`${t.externalRef} is not null`),
    check("invoice_payments_positive", sql`${t.amountCents} > 0`),
  ],
);

export type InvoicePayment = typeof invoicePayments.$inferSelect;

/**
 * Écriture du journal. Jamais modifiée ni supprimée : une erreur se corrige par une écriture
 * d'extourne (`reversal_of`). Chaque écriture porte l'empreinte de la précédente de l'organisation
 * (`prev_hash` → `hash`), si bien qu'une modification après coup se voit (GeBüV, art. 3 et 9).
 */
export const journalEntries = pgTable(
  "journal_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    fiscalYearId: uuid("fiscal_year_id")
      .notNull()
      .references(() => fiscalYears.id, { onDelete: "restrict" }),
    /** Ordre d'enregistrement dans l'organisation, base de la chaîne d'empreintes. */
    seq: integer("seq").notNull(),
    /** Numéro de l'écriture dans son exercice. */
    number: integer("number").notNull(),
    entryDate: date("entry_date", { mode: "string" }).notNull(),
    description: text("description").notNull(),
    sourceType: text("source_type").notNull(), // invoice | credit_note | payment | payment_reversal | manual
    sourceId: uuid("source_id"),
    reversalOf: uuid("reversal_of"),
    prevHash: text("prev_hash").notNull(),
    hash: text("hash").notNull(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("journal_entries_org_seq_idx").on(t.organizationId, t.seq),
    uniqueIndex("journal_entries_year_number_idx").on(t.fiscalYearId, t.number),
    index("journal_entries_org_date_idx").on(t.organizationId, t.entryDate),
  ],
);

export type JournalEntry = typeof journalEntries.$inferSelect;

/** Ligne d'écriture : un débit ou un crédit sur un compte, avec le détail TVA utile au décompte. */
export const journalLines = pgTable(
  "journal_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entryId: uuid("entry_id")
      .notNull()
      .references(() => journalEntries.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "restrict" }),
    debitCents: bigint("debit_cents", { mode: "number" }).notNull().default(0),
    creditCents: bigint("credit_cents", { mode: "number" }).notNull().default(0),
    vatRateBp: doublePrecision("vat_rate_bp"),
    /** Sur une ligne de TVA : le chiffre d'affaires (hors TVA) auquel elle s'applique. */
    vatBaseCents: bigint("vat_base_cents", { mode: "number" }),
  },
  (t) => [
    index("journal_lines_entry_idx").on(t.entryId),
    index("journal_lines_account_idx").on(t.accountId),
    check(
      "journal_lines_one_side",
      sql`(${t.debitCents} >= 0 and ${t.creditCents} >= 0 and (${t.debitCents} = 0) <> (${t.creditCents} = 0))`,
    ),
  ],
);

export type JournalLine = typeof journalLines.$inferSelect;

/**
 * Proposition de comptabilisation d'un mouvement bancaire : règlement d'une facture (trouvé par la
 * référence QR ou par l'IA) ou écriture sur un compte, avec le degré de certitude et l'explication.
 */
export type BankProposal =
  | {
      kind: "invoice";
      invoiceId: string;
      confidence: number;
      explanation: string;
      source: "reference" | "ai";
    }
  | {
      kind: "account";
      accountId: string;
      vatCode: string | null;
      confidence: number;
      explanation: string;
      source: "ai" | "rule" | "receipt";
    }
  | {
      kind: "bill";
      billId: string;
      confidence: number;
      explanation: string;
      source: "reference" | "ai";
    };

/** Mouvement d'un relevé bancaire importé, en attente de validation humaine. */
export const bankTransactions = pgTable(
  "bank_transactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    externalId: text("external_id").notNull(),
    bookingDate: date("booking_date", { mode: "string" }).notNull(),
    amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
    currency: text("currency").notNull().default("CHF"),
    counterparty: text("counterparty"),
    reference: text("reference"),
    text: text("text"),
    status: text("status").notNull().default("new"), // new | proposed | posted | ignored
    proposal: jsonb("proposal").$type<BankProposal>(),
    journalEntryId: uuid("journal_entry_id"),
    paymentId: uuid("payment_id"),
    validatedBy: uuid("validated_by").references(() => users.id, { onDelete: "set null" }),
    validatedAt: timestamp("validated_at", { withTimezone: true }),
    /** Comptabilisé par le pilote automatique, sans clic : à revoir dans le récapitulatif. */
    autoPosted: boolean("auto_posted").notNull().default(false),
    /** Écriture automatique approuvée par une personne. */
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("bank_transactions_org_external_idx").on(t.organizationId, t.externalId),
    index("bank_transactions_org_status_idx").on(t.organizationId, t.status, t.bookingDate),
  ],
);

export type BankTransaction = typeof bankTransactions.$inferSelect;

/**
 * Règle apprise des validations : telle contrepartie, dans tel sens, se comptabilise sur tel compte.
 * Elle passe avant l'IA pour les mouvements suivants, et se renforce à chaque validation identique.
 */
export const bookingRules = pgTable(
  "booking_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    counterpartyKey: text("counterparty_key").notNull(),
    counterpartyLabel: text("counterparty_label").notNull(),
    direction: text("direction").notNull(), // in | out
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    vatCode: text("vat_code"),
    hits: integer("hits").notNull().default(1),
    updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("booking_rules_key_idx").on(t.organizationId, t.counterpartyKey, t.direction),
  ],
);

export type BookingRule = typeof bookingRules.$inferSelect;

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });

/**
 * Fichiers gardés en base quand le stockage objet (Neon Object Storage) n'est pas configuré :
 * environnement local, tests, ou production avant l'activation du stockage.
 */
export const storedFiles = pgTable("stored_files", {
  key: text("key").primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  contentType: text("content_type").notNull(),
  bytes: bytea("bytes").notNull(),
  createdAt: createdAt(),
});

/** Données lues sur un justificatif par l'assistant. Montants en centimes. */
export type ReceiptExtraction = {
  supplier: string | null;
  date: string | null;
  totalCents: number | null;
  currency: string | null;
  vatCents: number | null;
  vatCode: string | null;
  invoiceNumber: string | null;
  description: string | null;
  accountNumber: string | null;
  confidence: number;
  /** Section paiement d'une facture fournisseur : échéance, compte et référence du créancier. */
  dueDate?: string | null;
  iban?: string | null;
  paymentReference?: string | null;
};

/**
 * Justificatif déposé (facture fournisseur, ticket). Lu par l'assistant, puis rattaché au mouvement
 * bancaire qui le paie ; il sert de preuve à l'écriture et en améliore la proposition.
 */
export const receipts = pgTable(
  "receipts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    fileKey: text("file_key").notNull(),
    filename: text("filename").notNull(),
    contentType: text("content_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    sha256: text("sha256").notNull(),
    status: text("status").notNull().default("new"), // new | read | error | matched | billed | posted
    extraction: jsonb("extraction").$type<ReceiptExtraction>(),
    bankTransactionId: uuid("bank_transaction_id"),
    journalEntryId: uuid("journal_entry_id"),
    uploadedBy: uuid("uploaded_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("receipts_org_sha_idx").on(t.organizationId, t.sha256),
    index("receipts_org_status_idx").on(t.organizationId, t.status),
    index("receipts_bank_tx_idx").on(t.bankTransactionId),
  ],
);

export type Receipt = typeof receipts.$inferSelect;

/** Chiffres d'un décompte TVA, par chiffre du formulaire AFC (montants en centimes). */
export type VatFigures = Record<string, number>;

/** Anomalie relevée avant la validation d'un décompte. */
export type VatAnomaly = {
  code: string;
  severity: "block" | "warn";
  count?: number;
  detail?: string;
};

/**
 * Décompte TVA d'une période. Validé, il fige ses chiffres, ferme la période au journal (plus
 * aucune écriture datée dedans) et vire la TVA due et l'impôt préalable sur le compte de décompte.
 */
export const vatReturns = pgTable(
  "vat_returns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    periodStart: date("period_start", { mode: "string" }).notNull(),
    periodEnd: date("period_end", { mode: "string" }).notNull(),
    status: text("status").notNull().default("validated"),
    figures: jsonb("figures").$type<VatFigures>().notNull(),
    anomalies: jsonb("anomalies").$type<VatAnomaly[]>().notNull(),
    journalEntryId: uuid("journal_entry_id"),
    validatedBy: uuid("validated_by").references(() => users.id, { onDelete: "set null" }),
    validatedAt: timestamp("validated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("vat_returns_period_idx").on(t.organizationId, t.periodStart),
    check("vat_returns_dates_check", sql`${t.periodEnd} >= ${t.periodStart}`),
  ],
);

export type VatReturn = typeof vatReturns.$inferSelect;

/** Relance envoyée (ou notée comme envoyée par courrier) pour une facture échue. */
export const invoiceReminders = pgTable(
  "invoice_reminders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => invoices.id, { onDelete: "cascade" }),
    level: integer("level").notNull(), // 1, 2, 3
    channel: text("channel").notNull(), // email | manual
    sentTo: text("sent_to"),
    sentBy: uuid("sent_by").references(() => users.id, { onDelete: "set null" }),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
    /** Frais de rappel ajoutés par cette relance, dans la devise de la facture. */
    feeCents: bigint("fee_cents", { mode: "number" }).notNull().default(0),
    /** Intérêts moratoires courus jusqu'à cette relance (en plus de ceux des relances précédentes). */
    interestCents: bigint("interest_cents", { mode: "number" }).notNull().default(0),
    /** Écriture des frais et intérêts (créance contre produit financier). */
    journalEntryId: uuid("journal_entry_id"),
    /** Frais et intérêts abandonnés : ils ne sont plus dus, leur écriture est extournée. */
    waivedAt: timestamp("waived_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("invoice_reminders_level_idx").on(t.invoiceId, t.level)],
);

export type InvoiceReminder = typeof invoiceReminders.$inferSelect;

/**
 * Facture récurrente : modèle (une facture existante dont on reprend client, textes et lignes) et
 * rythme. Chaque échéance crée une nouvelle facture ; avec l'envoi automatique, elle est émise,
 * comptabilisée et envoyée sans intervention.
 */
export const recurringInvoices = pgTable(
  "recurring_invoices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    sourceInvoiceId: uuid("source_invoice_id")
      .notNull()
      .references(() => invoices.id, { onDelete: "cascade" }),
    intervalMonths: integer("interval_months").notNull(),
    nextDate: date("next_date", { mode: "string" }).notNull(),
    autoSend: boolean("auto_send").notNull().default(false),
    active: boolean("active").notNull().default(true),
    lastInvoiceId: uuid("last_invoice_id"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("recurring_invoices_due_idx").on(t.active, t.nextDate)],
);

export type RecurringInvoice = typeof recurringInvoices.$inferSelect;

/** Invitation d'une fiduciaire : lien à usage unique, envoyé à une adresse précise. */
export const fiduciaryInvitations = pgTable(
  "fiduciary_invitations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    invitedBy: uuid("invited_by").references(() => users.id, { onDelete: "set null" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    acceptedBy: uuid("accepted_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("fiduciary_invitations_org_idx").on(t.organizationId)],
);

/** Avis envoyé depuis l'application pendant la bêta. */
export const feedback = pgTable(
  "feedback",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    kind: text("kind").notNull(), // idea | problem | praise
    page: text("page"),
    message: text("message").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("feedback_created_idx").on(t.createdAt)],
);

/**
 * Clé d'API d'une entreprise (formule Pro+). Seule l'empreinte SHA-256 est gardée : la clé n'est
 * montrée qu'une fois, à sa création. Elle agit au nom de la personne qui l'a créée, tant que cette
 * personne peut facturer dans l'entreprise.
 */
export const apiKeys = pgTable(
  "api_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** Début de la clé (« il_live_ab12 »), pour la reconnaître dans la liste. */
    prefix: text("prefix").notNull(),
    keyHash: text("key_hash").notNull().unique(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [index("api_keys_org_idx").on(t.organizationId)],
);

export type ApiKey = typeof apiKeys.$inferSelect;

/** Adresse qui reçoit les événements de l'entreprise, signés avec son secret (chiffré ici). */
export const webhookEndpoints = pgTable(
  "webhook_endpoints",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    secretEnc: text("secret_enc").notNull(),
    events: jsonb("events").$type<string[]>().notNull(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    disabledAt: timestamp("disabled_at", { withTimezone: true }),
  },
  (t) => [index("webhook_endpoints_org_idx").on(t.organizationId)],
);

export type WebhookEndpoint = typeof webhookEndpoints.$inferSelect;

/** Envoi d'un événement à une adresse, rejoué avec un délai croissant tant qu'il échoue. */
export const webhookDeliveries = pgTable(
  "webhook_deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    endpointId: uuid("endpoint_id")
      .notNull()
      .references(() => webhookEndpoints.id, { onDelete: "cascade" }),
    event: text("event").notNull(),
    payload: jsonb("payload").notNull(),
    status: text("status").notNull().default("pending"), // pending | delivered | failed
    attempts: integer("attempts").notNull().default(0),
    lastStatus: integer("last_status"),
    lastError: text("last_error"),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index("webhook_deliveries_pending_idx").on(t.status, t.nextAttemptAt),
    index("webhook_deliveries_endpoint_idx").on(t.endpointId, t.createdAt),
  ],
);

/**
 * Facture fournisseur à payer : lue d'un justificatif, d'une e-facture reçue (XRechnung, ZUGFeRD,
 * Factur-X) ou saisie. Approuvée, elle est comptabilisée (charge et impôt préalable contre
 * fournisseurs) ; payée par le fichier pain.001 puis retrouvée dans le relevé, elle est soldée.
 */
export const supplierBills = pgTable(
  "supplier_bills",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "set null" }),
    supplierName: text("supplier_name").notNull(),
    /** Adresse du créancier, exigée par le virement (pain.001). */
    supplierStreet: text("supplier_street"),
    supplierPostalCode: text("supplier_postal_code"),
    supplierTown: text("supplier_town"),
    supplierCountry: text("supplier_country"),
    iban: text("iban"),
    bic: text("bic"),
    /** Référence structurée (QRR, RF…) ou communication libre du créancier. */
    paymentReference: text("payment_reference"),
    number: text("number"),
    issueDate: date("issue_date", { mode: "string" }).notNull(),
    dueDate: date("due_date", { mode: "string" }).notNull(),
    currency: text("currency").notNull().default("CHF"),
    totalCents: bigint("total_cents", { mode: "number" }).notNull(),
    vatCode: text("vat_code"),
    accountId: uuid("account_id").references(() => accounts.id, { onDelete: "set null" }),
    description: text("description"),
    /** draft | approved | scheduled (fichier de paiement produit) | paid */
    status: text("status").notNull().default("draft"),
    // manual | receipt | einvoice | expense (note de frais) | mileage (indemnité kilométrique)
    source: text("source").notNull().default("manual"),
    /** Note de frais : la personne de l'équipe à rembourser. */
    claimantId: uuid("claimant_id").references(() => users.id, { onDelete: "set null" }),
    /** Indemnité kilométrique : distance (en mètres) et taux par kilomètre (en centimes). */
    distanceMeters: integer("distance_meters"),
    ratePerKmCents: integer("rate_per_km_cents"),
    receiptId: uuid("receipt_id"),
    /** Cours figé à l'approbation pour une facture en devise. */
    fxRate: doublePrecision("fx_rate"),
    firstApprovedBy: uuid("first_approved_by").references(() => users.id, { onDelete: "set null" }),
    approvedBy: uuid("approved_by").references(() => users.id, { onDelete: "set null" }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    exportedAt: timestamp("exported_at", { withTimezone: true }),
    paidOn: date("paid_on", { mode: "string" }),
    journalEntryId: uuid("journal_entry_id"),
    paymentEntryId: uuid("payment_entry_id"),
    bankTransactionId: uuid("bank_transaction_id"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("supplier_bills_org_status_idx").on(t.organizationId, t.status, t.dueDate),
    uniqueIndex("supplier_bills_receipt_idx")
      .on(t.receiptId)
      .where(sql`${t.receiptId} is not null`),
    check("supplier_bills_positive", sql`${t.totalCents} > 0`),
  ],
);

export type SupplierBill = typeof supplierBills.$inferSelect;

/** Projet d'un client : le temps saisi s'y rattache, puis se facture. */
export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    /** Tarif horaire hors TVA, en centimes, repris sur chaque saisie. */
    hourlyRateCents: bigint("hourly_rate_cents", { mode: "number" }).notNull().default(0),
    /** Budget en heures, pour suivre l'avancement ; vide : sans budget. */
    budgetMinutes: integer("budget_minutes"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("projects_org_idx").on(t.organizationId, t.archivedAt)],
);

export type Project = typeof projects.$inferSelect;

/**
 * Temps passé sur un projet. Un chrono en cours a `startedAt` et pas encore de durée. Facturé, il
 * porte la facture : il n'est plus repris, et redevient facturable si le brouillon est supprimé.
 */
export const timeEntries = pgTable(
  "time_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    workDate: date("work_date", { mode: "string" }).notNull(),
    minutes: integer("minutes").notNull().default(0),
    description: text("description"),
    billable: boolean("billable").notNull().default(true),
    rateCents: bigint("rate_cents", { mode: "number" }).notNull().default(0),
    startedAt: timestamp("started_at", { withTimezone: true }),
    invoiceId: uuid("invoice_id").references(() => invoices.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [
    index("time_entries_project_idx").on(t.projectId, t.workDate),
    index("time_entries_user_running_idx").on(t.userId, t.startedAt),
    check("time_entries_minutes", sql`${t.minutes} >= 0 and ${t.minutes} <= 1440`),
  ],
);

export type TimeEntry = typeof timeEntries.$inferSelect;

/**
 * Ce qu'InvoiceLead envoie à CRMlead : l'état d'un devis ou d'une facture tiré d'un lead. Une ligne
 * par pièce en attente ; un nouvel état remplace l'envoi pas encore parti.
 */
export const crmleadOutbox = pgTable(
  "crmlead_outbox",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    invoiceId: uuid("invoice_id").notNull(),
    envelope: jsonb("envelope").notNull(),
    status: text("status").notNull().default("pending"), // pending | delivered | failed
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index("crmlead_outbox_pending_idx").on(t.status, t.nextAttemptAt),
    uniqueIndex("crmlead_outbox_one_pending_idx")
      .on(t.invoiceId)
      .where(sql`${t.status} = 'pending'`),
  ],
);
