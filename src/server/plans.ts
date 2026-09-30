import { and, eq, gte, isNull, sql } from "drizzle-orm";
import type { Db } from "./db";
import { contacts, invoices, receipts } from "./db/schema";

/**
 * Formules de la famille Lead (docs/PLAN.md, section 9). Le rang vient du Compte Lead :
 * 0 Gratuit, 1 Pro, 2 Pro+. Les limites s'appliquent aux actions, jamais aux données déjà créées.
 */
export type Tier = "free" | "pro" | "proplus";

export type Feature = "bankImport" | "vatReturn" | "recurring" | "receipts" | "fiduciary";

type Limits = {
  invoicesPerMonth: number;
  contacts: number;
  receiptsPerMonth: number;
  /** Utilisateurs de l'entreprise ; les fiduciaires invitées ne comptent pas. */
  seats: number;
  features: Feature[];
  poweredBy: boolean;
};

const UNLIMITED = Number.POSITIVE_INFINITY;

export const LIMITS: Record<Tier, Limits> = {
  free: {
    invoicesPerMonth: 10,
    contacts: 50,
    receiptsPerMonth: 0,
    seats: 1,
    features: [],
    poweredBy: true,
  },
  pro: {
    invoicesPerMonth: UNLIMITED,
    contacts: UNLIMITED,
    receiptsPerMonth: 50,
    seats: 2,
    features: ["bankImport", "vatReturn", "recurring", "receipts", "fiduciary"],
    poweredBy: false,
  },
  proplus: {
    invoicesPerMonth: UNLIMITED,
    contacts: UNLIMITED,
    receiptsPerMonth: 300,
    seats: 5,
    features: ["bankImport", "vatReturn", "recurring", "receipts", "fiduciary"],
    poweredBy: false,
  },
};

type OrgPlan = { leadPlan: string; entitlements: unknown };

export function tierOf(org: OrgPlan): Tier {
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
  const seats = Number((org.entitlements as { plan?: { seats?: unknown } } | null)?.plan?.seats);
  return Number.isInteger(seats) && seats > 0 ? seats : LIMITS[tierOf(org)].seats;
}

export function hasFeature(org: OrgPlan, feature: Feature): boolean {
  return LIMITS[tierOf(org)].features.includes(feature);
}

const monthStart = (today: string) => `${today.slice(0, 7)}-01`;

export async function usage(database: Db, organizationId: string, today: string) {
  const [inv] = await database
    .select({ n: sql<number>`count(*)::int` })
    .from(invoices)
    .where(
      and(
        eq(invoices.organizationId, organizationId),
        eq(invoices.kind, "invoice"),
        eq(invoices.status, "issued"),
        gte(invoices.issuedAt, new Date(`${monthStart(today)}T00:00:00Z`)),
      ),
    );
  const [con] = await database
    .select({ n: sql<number>`count(*)::int` })
    .from(contacts)
    .where(and(eq(contacts.organizationId, organizationId), isNull(contacts.archivedAt)));
  const [rec] = await database
    .select({ n: sql<number>`count(*)::int` })
    .from(receipts)
    .where(
      and(
        eq(receipts.organizationId, organizationId),
        gte(receipts.createdAt, new Date(`${monthStart(today)}T00:00:00Z`)),
      ),
    );
  return { invoices: inv?.n ?? 0, contacts: con?.n ?? 0, receipts: rec?.n ?? 0 };
}

export type LimitKey = "invoice" | "contact" | "receipt";

/** Rend null si l'action est permise par la formule, sinon la limite atteinte. */
export async function limitReached(
  database: Db,
  org: OrgPlan & { id: string },
  key: LimitKey,
  today = new Date().toISOString().slice(0, 10),
): Promise<{ limit: number } | null> {
  const limits = LIMITS[tierOf(org)];
  const used = await usage(database, org.id, today);
  const pairs: Record<LimitKey, [number, number]> = {
    invoice: [used.invoices, limits.invoicesPerMonth],
    contact: [used.contacts, limits.contacts],
    receipt: [used.receipts, limits.receiptsPerMonth],
  };
  const [count, limit] = pairs[key];
  return count >= limit ? { limit } : null;
}
