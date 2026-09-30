import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  check,
  customType,
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
    vatRateBp: integer("vat_rate_bp").notNull().default(0),
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
    method: text("method").notNull().default("bank"), // bank | cash | other
    note: text("note"),
    journalEntryId: uuid("journal_entry_id"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [
    index("invoice_payments_invoice_idx").on(t.invoiceId),
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
    vatRateBp: integer("vat_rate_bp"),
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
    status: text("status").notNull().default("new"), // new | read | error | matched | posted
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
