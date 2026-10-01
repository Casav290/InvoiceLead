import { and, eq, gte, isNull, sql } from "drizzle-orm";
import type { Db } from "./db";
import { contacts, invoices, organizations, planUsage, recurringInvoices } from "./db/schema";

/**
 * Formules de la famille Lead (docs/PLAN.md, section 9, décidée le 1er octobre 2026). Le rang vient
 * du Compte Lead : 0 Gratuit, 1 Pro, 2 Pro+.
 *
 * Rien n'est caché à une formule : une fonction d'une formule supérieure reste visible, grisée, avec
 * sa marque et le lien de mise à niveau. La formule gratuite reçoit de petites allocations (20
 * lectures de pièces, 10 questions, 5 relances, 1 relevé bancaire par mois, 1 facture récurrente
 * active). Les limites s'appliquent aux nouvelles actions, jamais aux données déjà créées.
 */
export type Tier = "free" | "pro" | "proplus";

const TIERS: Tier[] = ["free", "pro", "proplus"];
const RANK: Record<Tier, number> = { free: 0, pro: 1, proplus: 2 };

/** Fonctions réservées à une formule, sans allocation gratuite. */
export type Feature =
  /** Décompte TVA préparé, relu par l'IA et validé (TVA, UStVA, CA3, MTD, sales tax). */
  | "vatReturn"
  /** Devis, factures et factures fournisseurs saisies dans une autre devise que celle de l'entreprise. */
  | "multiCurrency"
  /** Invitation d'une fiduciaire. */
  | "fiduciary"
  /** 2e et 3e relances, rappel courtois, rythme selon le profil de paiement du client. */
  | "reminderLevels"
  /** Relances envoyées seules chaque matin. */
  | "reminderAuto"
  /** Frais de rappel et intérêts moratoires. */
  | "reminderCharges"
  /** Récapitulatif du pilote automatique par e-mail, le lundi. */
  | "autopilotDigest"
  /** Clés d'API, serveur MCP et webhooks. */
  | "api";

export const FEATURE_TIER: Record<Feature, Tier> = {
  vatReturn: "pro",
  multiCurrency: "pro",
  fiduciary: "pro",
  reminderLevels: "pro",
  reminderAuto: "pro",
  reminderCharges: "pro",
  autopilotDigest: "pro",
  api: "proplus",
};

/**
 * Allocations. Par mois civil (UTC) : factures émises, lectures de pièces par l'IA (tickets de
 * notes de frais, justificatifs déposés ou relus, un seul compteur ; les e-factures, lues sans IA,
 * n'y comptent pas), questions à l'assistant, relances, imports de relevés. En tout : contacts
 * actifs, factures récurrentes actives.
 */
export type Quota =
  | "invoices"
  | "contacts"
  | "aiReads"
  | "assistant"
  | "reminders"
  | "bankImports"
  | "recurring";

/** Allocations tenues par un compteur réservé avant l'action (table plan_usage). */
export const METERED = ["aiReads", "assistant", "reminders", "bankImports"] as const;
export type MeteredQuota = (typeof METERED)[number];

const UNLIMITED = Number.POSITIVE_INFINITY;

type Plan = {
  quotas: Record<Quota, number>;
  /** Utilisateurs de l'entreprise ; les fiduciaires invitées ne comptent pas. */
  seats: number;
  poweredBy: boolean;
};

export const PLANS: Record<Tier, Plan> = {
  free: {
    quotas: {
      invoices: 10,
      contacts: 50,
      aiReads: 20,
      assistant: 10,
      reminders: 5,
      bankImports: 1,
      recurring: 1,
    },
    seats: 1,
    poweredBy: true,
  },
  pro: {
    quotas: {
      invoices: UNLIMITED,
      contacts: UNLIMITED,
      aiReads: 50,
      assistant: UNLIMITED,
      reminders: UNLIMITED,
      bankImports: UNLIMITED,
      recurring: UNLIMITED,
    },
    seats: 2,
    poweredBy: false,
  },
  proplus: {
    quotas: {
      invoices: UNLIMITED,
      contacts: UNLIMITED,
      aiReads: 300,
      assistant: UNLIMITED,
      reminders: UNLIMITED,
      bankImports: UNLIMITED,
      recurring: UNLIMITED,
    },
    seats: 5,
    poweredBy: false,
  },
};

/**
 * Formule d'une entreprise telle qu'enregistrée. `entitlementsAt` dit quand le Compte Lead l'a donnée
 * (connexion, ou relecture par plan-refresh.ts) ; quand il est connu et trop ancien, la formule ne
 * vaut plus (planTooOld).
 */
export type OrgPlan = {
  leadPlan: string;
  entitlements: unknown;
  entitlementsAt?: Date | string | null;
};
type Org = OrgPlan & { id: string };

/** Une formule plus récente que ceci n'est pas relue : la durée d'une session web. */
export const PLAN_FRESH_MS = 12 * 3_600_000;
/**
 * Au-delà, sans nouvelle du Compte Lead, la formule enregistrée ne vaut plus : l'entreprise est
 * traitée en formule gratuite jusqu'à la prochaine relecture (tâche quotidienne, API) ou connexion.
 */
export const PLAN_MAX_AGE_MS = 72 * 3_600_000;

/** Âge de la formule enregistrée en millisecondes ; Infinity si on ne sait pas quand elle a été lue. */
export function planAge(org: OrgPlan, now = Date.now()): number {
  if (!org.entitlementsAt) return Number.POSITIVE_INFINITY;
  const at = new Date(org.entitlementsAt).getTime();
  return Number.isFinite(at) ? now - at : Number.POSITIVE_INFINITY;
}

/**
 * Formule trop ancienne pour être crue : seulement quand l'objet porte sa date de lecture (une ligne
 * d'entreprise complète, ou une sélection qui la demande).
 */
export function planTooOld(org: OrgPlan, now = Date.now()): boolean {
  return org.entitlementsAt !== undefined && planAge(org, now) > PLAN_MAX_AGE_MS;
}

/**
 * Accès à une fonction ou à une allocation : permis ou non, formule actuelle, formule qui l'ouvre
 * (ou relève la limite ; null s'il n'y en a pas), et pour une allocation l'usage et la limite
 * (Infinity : sans limite).
 */
export type Access = {
  allowed: boolean;
  tier: Tier;
  upgradeTo: Tier | null;
  used: number;
  limit: number;
};

export function tierOf(org: OrgPlan): Tier {
  if (planTooOld(org)) return "free";
  const rank = Number((org.entitlements as { plan?: { rank?: unknown } } | null)?.plan?.rank);
  if (rank >= 2) return "proplus";
  if (rank === 1) return "pro";
  if (Number.isFinite(rank)) return "free";
  return org.leadPlan === "pro" ? "pro" : org.leadPlan === "pro_plus" ? "proplus" : "free";
}

/** Lien « Passer à Pro » : celui du Compte Lead, ou la page de facturation de la famille. */
export function upgradeUrl(org: OrgPlan): string {
  const url = (org.entitlements as { apps?: { invoicelead?: { upgrade_url?: unknown } } } | null)
    ?.apps?.invoicelead?.upgrade_url;
  return typeof url === "string" && url.startsWith("https://")
    ? url
    : "https://scanlead.io/billing";
}

/** Places de l'entreprise : celles du Compte Lead quand il les donne, sinon celles de la formule. */
export function seatsOf(org: OrgPlan): number {
  if (planTooOld(org)) return PLANS.free.seats;
  const seats = Number((org.entitlements as { plan?: { seats?: unknown } } | null)?.plan?.seats);
  return Number.isInteger(seats) && seats > 0 ? seats : PLANS[tierOf(org)].seats;
}

/** Mention « Créé avec InvoiceLead » sur les documents de la formule gratuite. */
export function poweredBy(org: OrgPlan): boolean {
  return PLANS[tierOf(org)].poweredBy;
}

/** Fonction réservée : permise dès sa formule, sinon grisée avec la marque de cette formule. */
export function featureAccess(org: OrgPlan, feature: Feature): Access {
  const tier = tierOf(org);
  const needed = FEATURE_TIER[feature];
  const allowed = RANK[tier] >= RANK[needed];
  return {
    allowed,
    tier,
    upgradeTo: allowed ? null : needed,
    used: 0,
    limit: allowed ? UNLIMITED : 0,
  };
}

function quotaResult(tier: Tier, quota: Quota, used: number): Access {
  const limit = PLANS[tier].quotas[quota];
  return {
    allowed: used < limit,
    tier,
    upgradeTo: TIERS.find((t) => RANK[t] > RANK[tier] && PLANS[t].quotas[quota] > limit) ?? null,
    used,
    limit,
  };
}

const todayUtc = () => new Date().toISOString().slice(0, 10);
/** Mois civil des compteurs, le même que celui des factures émises : « AAAA-MM » (UTC). */
export const periodOf = (today: string) => today.slice(0, 7);
const monthStart = (today: string) => new Date(`${periodOf(today)}-01T00:00:00Z`);

async function countIssued(database: Db, organizationId: string, today: string) {
  const [row] = await database
    .select({ n: sql<number>`count(*)::int` })
    .from(invoices)
    .where(
      and(
        eq(invoices.organizationId, organizationId),
        eq(invoices.kind, "invoice"),
        eq(invoices.status, "issued"),
        gte(invoices.issuedAt, monthStart(today)),
      ),
    );
  return row?.n ?? 0;
}

async function countContacts(database: Db, organizationId: string) {
  const [row] = await database
    .select({ n: sql<number>`count(*)::int` })
    .from(contacts)
    .where(and(eq(contacts.organizationId, organizationId), isNull(contacts.archivedAt)));
  return row?.n ?? 0;
}

async function countRecurring(database: Db, organizationId: string) {
  const [row] = await database
    .select({ n: sql<number>`count(*)::int` })
    .from(recurringInvoices)
    .where(
      and(eq(recurringInvoices.organizationId, organizationId), eq(recurringInvoices.active, true)),
    );
  return row?.n ?? 0;
}

async function meteredUsage(database: Db, organizationId: string, today: string) {
  const rows = await database
    .select({ key: planUsage.key, used: planUsage.used })
    .from(planUsage)
    .where(
      and(eq(planUsage.organizationId, organizationId), eq(planUsage.period, periodOf(today))),
    );
  return new Map(rows.map((r) => [r.key, r.used]));
}

/** Usage d'une allocation ce mois-ci (ou en tout pour les contacts et les récurrences actives). */
export async function quotaAccess(
  database: Db,
  org: Org,
  quota: Quota,
  today = todayUtc(),
): Promise<Access> {
  const tier = tierOf(org);
  const used =
    quota === "invoices"
      ? await countIssued(database, org.id, today)
      : quota === "contacts"
        ? await countContacts(database, org.id)
        : quota === "recurring"
          ? await countRecurring(database, org.id)
          : ((await meteredUsage(database, org.id, today)).get(quota) ?? 0);
  return quotaResult(tier, quota, used);
}

/** Toutes les allocations d'un coup, pour le tableau de bord et les écrans qui les affichent. */
export async function planUsageOf(
  database: Db,
  org: Org,
  today = todayUtc(),
): Promise<Record<Quota, Access>> {
  const tier = tierOf(org);
  const [issued, live, recurring, metered] = await Promise.all([
    countIssued(database, org.id, today),
    countContacts(database, org.id),
    countRecurring(database, org.id),
    meteredUsage(database, org.id, today),
  ]);
  const m = (q: MeteredQuota) => quotaResult(tier, q, metered.get(q) ?? 0);
  return {
    invoices: quotaResult(tier, "invoices", issued),
    contacts: quotaResult(tier, "contacts", live),
    recurring: quotaResult(tier, "recurring", recurring),
    aiReads: m("aiReads"),
    assistant: m("assistant"),
    reminders: m("reminders"),
    bankImports: m("bankImports"),
  };
}

/**
 * Réserve une unité d'une allocation mensuelle avant l'action, en un seul ordre SQL : au-delà de
 * la limite, rien n'est compté et l'accès est refusé. Deux demandes en même temps ne peuvent donc
 * pas dépasser la limite. Les formules sans limite comptent aussi (usage affiché, changement de
 * formule en cours de mois).
 */
export async function consumeQuota(
  database: Db,
  org: Org,
  quota: MeteredQuota,
  today = todayUtc(),
): Promise<Access> {
  const tier = tierOf(org);
  const limit = PLANS[tier].quotas[quota];
  if (limit <= 0) return quotaResult(tier, quota, 0);
  const target = [planUsage.organizationId, planUsage.period, planUsage.key];
  const values = { organizationId: org.id, period: periodOf(today), key: quota, used: 1 };
  const set = { used: sql`${planUsage.used} + 1`, updatedAt: new Date() };
  const rows = await database
    .insert(planUsage)
    .values(values)
    .onConflictDoUpdate(
      Number.isFinite(limit)
        ? { target, set, setWhere: sql`${planUsage.used} < ${limit}` }
        : { target, set },
    )
    .returning({ used: planUsage.used });
  const [row] = rows;
  if (!row) {
    const access = await quotaAccess(database, org, quota, today);
    return { ...access, allowed: false };
  }
  return { ...quotaResult(tier, quota, row.used - 1), used: row.used, allowed: true };
}

/** Rend l'unité réservée quand l'action n'a pas eu lieu (panne du fournisseur d'IA, envoi échoué). */
export async function refundQuota(
  database: Db,
  organizationId: string,
  quota: MeteredQuota,
  today = todayUtc(),
): Promise<void> {
  await database
    .update(planUsage)
    .set({ used: sql`greatest(${planUsage.used} - 1, 0)`, updatedAt: new Date() })
    .where(
      and(
        eq(planUsage.organizationId, organizationId),
        eq(planUsage.period, periodOf(today)),
        eq(planUsage.key, quota),
      ),
    );
}

/** Formule d'une entreprise, pour les traitements qui n'ont que son identifiant. */
export async function organizationPlan(
  database: Db,
  organizationId: string,
): Promise<(Org & { currency: string }) | null> {
  const [row] = await database
    .select({
      id: organizations.id,
      leadPlan: organizations.leadPlan,
      entitlements: organizations.entitlements,
      entitlementsAt: organizations.entitlementsAt,
      currency: organizations.currency,
    })
    .from(organizations)
    .where(eq(organizations.id, organizationId));
  return row ?? null;
}

/**
 * Verrou transactionnel par entreprise et par allocation : compte puis crée sans qu'une seconde
 * demande simultanée passe entre les deux (factures émises du mois, contacts, récurrences actives).
 */
export async function lockQuota(database: Db, organizationId: string, quota: Quota) {
  await database.execute(
    sql`select pg_advisory_xact_lock(hashtext(${`${organizationId}:${quota}`}))`,
  );
}
