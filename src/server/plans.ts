import { and, eq, gte, isNull, sql } from "drizzle-orm";
import type { Db } from "./db";
import { contacts, invoices, organizations, planUsage, recurringInvoices } from "./db/schema";

/**
 * Formules d'InvoiceLead (docs/PLAN.md, section 9, décidée le 1er octobre 2026) : Gratuit, Pro et
 * Pro+. Le Compte Lead (ERPlead) les nomme par leur code, « free », « pro » et « pro_plus » ; leur
 * rang y vaut 0, 10 et 20 (table plans d'ERPlead). Le code fait foi, le rang n'est qu'un repli.
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
    // Une place, comme dans ERPlead et les autres applications Lead (Pro+ : cinq).
    seats: 1,
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
 * vaut plus (planTooOld). `billingPlan` et `billingPlanUntil` : la formule payée dans InvoiceLead
 * (src/server/billing), qui vaut d'elle-même jusqu'à sa date. Sélectionner `planColumns` pour les
 * avoir toutes.
 */
export type OrgPlan = {
  leadPlan: string;
  entitlements: unknown;
  entitlementsAt?: Date | string | null;
  billingPlan?: string | null;
  billingPlanUntil?: Date | string | null;
};

/** Colonnes de la formule, à sélectionner ensemble partout où une formule est décidée. */
export const planColumns = {
  leadPlan: organizations.leadPlan,
  entitlements: organizations.entitlements,
  entitlementsAt: organizations.entitlementsAt,
  billingPlan: organizations.billingPlan,
  billingPlanUntil: organizations.billingPlanUntil,
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

/** La formule telle que le Compte Lead l'écrit dans les droits (`entitlements.plan`). */
type LeadPlanClaim = {
  code?: unknown;
  rank?: unknown;
  seats?: unknown;
  source?: unknown;
  valid_until?: unknown;
};
const leadPlanOf = (org: OrgPlan) =>
  (org.entitlements as { plan?: LeadPlanClaim } | null)?.plan ?? null;

/** Date de fin de la formule du Compte Lead en millisecondes ; NaN si elle n'en a pas. */
export function leadPlanUntil(org: OrgPlan): number {
  const until = leadPlanOf(org)?.valid_until;
  return typeof until === "string" ? Date.parse(until) : Number.NaN;
}

/**
 * La formule du Compte Lead a-t-elle passé sa date de fin (`valid_until`, calculée par ERPlead : fin
 * de période et trois jours de grâce, ou fin de l'héritage) ? Elle ne vaut alors plus rien ici, sans
 * attendre la relecture des droits : ni sa formule (leadTier), ni ses places (seatsOf), ni son texte
 * d'héritage (leadInherited). Une seule règle, pour que la page Formule, la liste des places et les
 * fonctions disent la même chose.
 */
export function leadPlanEnded(org: OrgPlan, now = Date.now()): boolean {
  const until = leadPlanUntil(org);
  return Number.isFinite(until) && until <= now;
}

/**
 * Formule du Compte Lead : son code (« pro_plus », « pro », toute autre valeur Gratuit), sinon son
 * rang (20 et plus Pro+, 10 et plus Pro), sinon la formule enregistrée à la connexion (lead_plan).
 * Jusqu'au 13.10.2026, le rang était lu comme 1 Pro et 2 Pro+ : un Pro d'ERPlead (rang 10) devenait
 * Pro+ ici. Échue (leadPlanEnded) : Gratuit.
 */
function leadTier(org: OrgPlan, now = Date.now()): Tier {
  const plan = leadPlanOf(org);
  if (leadPlanEnded(org, now)) return "free";
  const code = plan?.code;
  if (typeof code === "string" && code) {
    return code === "pro_plus" ? "proplus" : code === "pro" ? "pro" : "free";
  }
  const rank = Number(plan?.rank);
  if (Number.isFinite(rank)) return rank >= 20 ? "proplus" : rank >= 10 ? "pro" : "free";
  return org.leadPlan === "pro" ? "pro" : org.leadPlan === "pro_plus" ? "proplus" : "free";
}

/**
 * Formule payée dans InvoiceLead (abonnement Stripe, src/server/billing), tant que sa date tient :
 * fin de période plus trois jours de grâce.
 */
export function billingTier(org: OrgPlan, now = Date.now()): Tier {
  const plan = org.billingPlan;
  if (plan !== "pro" && plan !== "pro_plus") return "free";
  if (org.billingPlanUntil) {
    const until = new Date(org.billingPlanUntil).getTime();
    if (!Number.isFinite(until) || until <= now) return "free";
  }
  return plan === "pro_plus" ? "proplus" : "pro";
}

/**
 * Formule de l'entreprise DANS InvoiceLead : la meilleure de celle que donne le Compte Lead (ERPlead
 * calcule la formule propre à InvoiceLead, abonnements hérités compris) et de l'abonnement payé ici
 * (effet immédiat après paiement, même si le Compte Lead tarde à le confirmer). Un abonnement pris
 * dans une autre application Lead n'ouvre rien ici (décision d'Ève du 13.10.2026), sauf l'héritage
 * que le Compte Lead accorde jusqu'à la fin de la période déjà payée.
 */
export function tierOf(org: OrgPlan, now = Date.now()): Tier {
  const local = billingTier(org, now);
  const lead = planTooOld(org, now) ? "free" : leadTier(org, now);
  return RANK[local] >= RANK[lead] ? local : lead;
}

/** Code de la formule tel que le Compte Lead et Stripe l'écrivent (contrat data-plan-* des pages). */
export function planCode(tier: Tier): "free" | "pro" | "pro_plus" {
  return tier === "proplus" ? "pro_plus" : tier;
}

/**
 * Formule PROPRE lue au Compte Lead (plan.source autre que « family » : abonnement InvoiceLead déclaré,
 * formule offerte ou réglée dans ERPlead), avec sa date de fin si elle en a une ; null en Gratuit, pour
 * un héritage de la transition ou une formule trop ancienne pour être crue. La page Formule dit son
 * origine et sa date : elle ne se gère pas ici.
 */
export function leadOwnPlan(
  org: OrgPlan,
  now = Date.now(),
): { tier: Tier; until: Date | null } | null {
  const plan = leadPlanOf(org);
  if (plan?.source === "family" || planTooOld(org, now)) return null;
  const tier = leadTier(org, now);
  if (tier === "free") return null;
  const until = typeof plan?.valid_until === "string" ? new Date(plan.valid_until) : null;
  return { tier, until: until && Number.isFinite(until.getTime()) ? until : null };
}

/**
 * Abonnement hérité que le Compte Lead accorde encore (plan.source « family » : abonnement payé dans
 * une autre application Lead avant le 13.10.2026, jusqu'à la fin de sa période déjà payée) :
 * l'application et la date de fin, pour la page Formule. null quand il n'y en a pas, quand sa date
 * est passée (leadPlanEnded : l'entreprise est alors en Gratuit, et « Jusqu'au <date passée>, … vous
 * donne aussi Gratuit » serait faux) ou quand les droits sont trop anciens pour être crus.
 */
export function leadInherited(
  org: OrgPlan,
  now = Date.now(),
): { app: string; until: string } | null {
  const e = org.entitlements as {
    plan?: { source?: unknown; valid_until?: unknown };
    apps?: Record<string, { name?: string }>;
    subscriptions?: { app?: string; inherited?: boolean }[];
  } | null;
  const until = e?.plan?.valid_until;
  if (e?.plan?.source !== "family" || typeof until !== "string" || !until) return null;
  if (leadPlanEnded(org, now) || planTooOld(org, now)) return null;
  const code = e.subscriptions?.find((s) => s.inherited)?.app ?? "";
  return { app: e.apps?.[code]?.name ?? code, until };
}

/**
 * Formule déjà acquise par l'entreprise dans InvoiceLead (même règle que Greetlead `acquiredTier`) :
 * la meilleure de l'abonnement pris ici et de la formule propre lue au Compte Lead ; jamais l'héritage
 * de la transition (un client qui hérite de Pro jusqu'à la fin de sa période doit pouvoir s'abonner).
 * Aucune offre égale ou inférieure n'est faite, ni à l'écran ni au serveur (createCheckout).
 */
export function acquiredTier(org: OrgPlan, now = Date.now()): Tier {
  const local = billingTier(org, now);
  const lead = leadOwnPlan(org, now)?.tier ?? "free";
  return RANK[local] >= RANK[lead] ? local : lead;
}

/** L'offre (pro, pro_plus) apporte-t-elle plus que la formule acquise ? */
export function offerAbove(org: OrgPlan, plan: "pro" | "pro_plus", now = Date.now()): boolean {
  return RANK[plan === "pro_plus" ? "proplus" : "pro"] > RANK[acquiredTier(org, now)];
}

/** Les formules à proposer : celles strictement au-dessus de la formule acquise, dans l'ordre. */
export function planOffers(org: OrgPlan, now = Date.now()): ("pro" | "pro_plus")[] {
  return (["pro", "pro_plus"] as const).filter((plan) => offerAbove(org, plan, now));
}

/**
 * Lien « Passer à Pro » : la page Formule d'InvoiceLead, où l'abonnement se prend et se gère. `tier`
 * présélectionne la formule qui ouvre la fonction.
 */
export function upgradeUrl(locale: string, tier?: Tier | null): string {
  const plan = tier === "proplus" ? "pro_plus" : tier === "pro" ? "pro" : null;
  return `/${locale}/app/settings/plan${plan ? `?plan=${plan}` : ""}`;
}

/**
 * Places de l'entreprise dans InvoiceLead : celles de sa formule, ou davantage si le Compte Lead en
 * donne plus pour InvoiceLead. Les places du Compte Lead ne comptent plus quand ses droits sont trop
 * anciens ou que sa formule est échue (leadPlanEnded) : une entreprise héritière de Pro+ revenue en
 * Gratuit ne garde pas cinq places jusqu'à la relecture.
 */
export function seatsOf(org: OrgPlan, now = Date.now()): number {
  const own = PLANS[tierOf(org, now)].seats;
  if (planTooOld(org, now) || leadPlanEnded(org, now)) return own;
  const seats = Number(leadPlanOf(org)?.seats);
  return Number.isInteger(seats) && seats > 0 ? Math.max(seats, own) : own;
}

/** Première formule au-dessus de `tier` qui compte plus de `seats` places (Pro+ depuis Gratuit). */
export function tierWithMoreSeats(tier: Tier, seats: number): Tier | null {
  return TIERS.find((t) => RANK[t] > RANK[tier] && PLANS[t].seats > seats) ?? null;
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

/**
 * Pièce dans une autre devise que celle de l'entreprise, sans la multidevise (formule Pro) : une
 * nouvelle facture, un nouveau devis ou une nouvelle récurrence dans cette devise est refusé.
 */
export function foreignWithoutPro(org: OrgPlan & { currency: string }, currency: string): boolean {
  return currency !== org.currency && !featureAccess(org, "multiCurrency").allowed;
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
    .select({ id: organizations.id, ...planColumns, currency: organizations.currency })
    .from(organizations)
    .where(eq(organizations.id, organizationId));
  return row ?? null;
}

/** La même règle pour une entreprise dont on n'a que l'identifiant. */
export async function foreignWithoutProFor(
  database: Db,
  organizationId: string,
  currency: string,
): Promise<boolean> {
  const plan = await organizationPlan(database, organizationId);
  return !!plan && foreignWithoutPro(plan, currency);
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
