import { and, eq, isNull, lt, or, sql } from "drizzle-orm";
import { hasInvoiceLeadAccess } from "./auth/attach";
import type { Db } from "./db";
import { organizations } from "./db/schema";
import { env } from "./env";
import { appToken, type LeadEntitlements } from "./lead-id/leadId";
import { leadPlanUntil, PLAN_FRESH_MS, planAge, planColumns } from "./plans";

/**
 * La formule d'une entreprise n'est écrite qu'à la connexion web. Une entreprise qui n'utilise plus
 * que l'API, le serveur MCP ou la tâche quotidienne garderait donc sans fin une formule résiliée.
 * Ici, une formule de plus de 12 h est relue au Compte Lead ; sans réponse, elle vaut encore 72 h
 * (PLAN_MAX_AGE_MS), puis l'entreprise est traitée en formule gratuite (tierOf).
 */

type Refreshable = {
  id: string;
  leadOrg: string | null;
  leadPlan: string;
  entitlements: unknown;
  entitlementsAt: Date | string | null;
};

/** Pas plus d'une tentative toutes les 10 minutes par entreprise quand le Compte Lead ne répond pas. */
const RETRY_MS = 10 * 60_000;
/** Une page ou une requête d'API n'attend pas le Compte Lead plus longtemps que ceci. */
const WAIT_MS = 5_000;
const attempts = new Map<string, number>();

/**
 * Droits à jour d'une organisation du Compte Lead, avec le jeton d'application « billing », ou null.
 * Plus de jeton d'échange ici : depuis la liaison sans clé, un jeton d'échange est lié à une
 * organisation et à une application cible, et ne lit plus que sa propre organisation.
 */
async function fetchEntitlements(leadOrg: string): Promise<LeadEntitlements | null> {
  const issuer = env().LEAD_ID_ISSUER.replace(/\/+$/, "");
  const url = `${issuer}/api/lead-id/v1/entitlements?${new URLSearchParams({ org: leadOrg })}`;
  try {
    const r = await fetch(url, {
      headers: { authorization: `Bearer ${await appToken("billing")}` },
    });
    if (!r.ok) return null;
    const body = (await r.json()) as (LeadEntitlements & { org?: string }) | null;
    if (!body || typeof body !== "object" || !body.plan || !body.apps) return null;
    const { org: _org, ...lead } = body;
    return lead;
  } catch {
    // Compte Lead injoignable : la formule enregistrée vaut encore (PLAN_MAX_AGE_MS).
    return null;
  }
}

/** Droits relus tout de suite (écran « Applications Lead »), enregistrés ; null si le Compte Lead est muet. */
export async function refreshEntitlementsNow(
  database: Db,
  org: Refreshable,
  now = Date.now(),
): Promise<LeadEntitlements | null> {
  if (!org.leadOrg) return null;
  const lead = await fetchEntitlements(org.leadOrg);
  if (!lead) return null;
  await database
    .update(organizations)
    .set({
      leadPlan: lead.plan?.code ?? "free",
      hasAccess: hasInvoiceLeadAccess({ lead }),
      entitlements: lead,
      entitlementsAt: new Date(now),
      updatedAt: new Date(now),
    })
    .where(eq(organizations.id, org.id));
  return lead;
}

/**
 * La formule du Compte Lead a passé sa date de fin (valid_until) depuis sa dernière lecture : elle
 * vaut Gratuit ici (leadPlanEnded), mais ERPlead l'a peut-être renouvelée entre-temps. Une fois relue
 * après cette date, plus rien à relire avant 12 h, même si elle reste échue.
 */
function endedSinceRead(org: Refreshable, now: number): boolean {
  const until = leadPlanUntil(org);
  return Number.isFinite(until) && until <= now && now - planAge(org, now) < until;
}

/**
 * Relit la formule au Compte Lead si celle enregistrée a plus de 12 h, ou si sa date de fin est passée
 * depuis sa lecture, et l'enregistre. Rend l'entreprise à jour, ou telle quelle quand la formule est
 * récente ou le Compte Lead muet.
 */
export async function refreshPlan<T extends Refreshable>(
  database: Db,
  org: T,
  now = Date.now(),
): Promise<T> {
  if (!org.leadOrg) return org;
  if (planAge(org, now) <= PLAN_FRESH_MS && !endedSinceRead(org, now)) return org;
  const last = attempts.get(org.id);
  if (last !== undefined && now - last < RETRY_MS) return org;
  attempts.set(org.id, now);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const lead = await Promise.race([
    fetchEntitlements(org.leadOrg),
    new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), WAIT_MS);
    }),
  ]).finally(() => clearTimeout(timer));
  if (!lead) return org;
  attempts.delete(org.id);
  const values = {
    leadPlan: lead.plan?.code ?? "free",
    hasAccess: hasInvoiceLeadAccess({ lead }),
    entitlements: lead,
    entitlementsAt: new Date(now),
  };
  await database
    .update(organizations)
    .set({ ...values, updatedAt: new Date(now) })
    .where(eq(organizations.id, org.id));
  return { ...org, ...values };
}

/**
 * Tâche quotidienne, avant les relances, les récurrences, les webhooks et le récapitulatif : relit
 * les formules payantes enregistrées depuis plus de 12 h. Une formule gratuite n'a rien à perdre.
 */
export async function refreshStalePlans(
  database: Db,
  now = Date.now(),
  limit = 500,
): Promise<{ refreshed: number; stale: number }> {
  const rows = await database
    .select({
      id: organizations.id,
      leadOrg: organizations.leadOrg,
      ...planColumns,
    })
    .from(organizations)
    .where(
      and(
        or(
          isNull(organizations.entitlementsAt),
          lt(organizations.entitlementsAt, new Date(now - PLAN_FRESH_MS)),
        ),
        or(
          sql`${organizations.leadPlan} <> 'free'`,
          sql`coalesce(${organizations.entitlements} #>> '{plan,rank}', '0') <> '0'`,
        ),
      ),
    )
    .limit(limit);
  let refreshed = 0;
  let silent = 0;
  for (const org of rows) {
    const after = await refreshPlan(database, org, now);
    if (after !== org) {
      refreshed += 1;
      silent = 0;
    } else if (++silent >= 3) {
      // Compte Lead muet trois fois de suite : inutile d'attendre pour chaque entreprise.
      break;
    }
  }
  return { refreshed, stale: rows.length - refreshed };
}

/** Pour les tests : oublie les tentatives récentes. */
export function forgetRefreshAttempts() {
  attempts.clear();
}
