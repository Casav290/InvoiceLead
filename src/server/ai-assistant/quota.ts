import { and, count, eq, gt, gte, isNull, sql } from "drizzle-orm";
import type { Db } from "../db";
import { assistantUsage } from "../db/schema";
import {
  ASSISTANT_TOKENS,
  type AssistantBudget,
  assistantBudget,
  type OrgPlan,
  requestsLeft,
} from "../plans";

/** 40 messages par heure et par personne, 400 par jour (UTC) et par entreprise, toutes formules. */
export const USER_PER_HOUR = 40;
export const ORG_PER_DAY = 400;

export type Who = { organizationId: string; userId: string };

/**
 * Questions de la page Assistant (comptabilité, src/server/assistant.ts) : inscrites dans ce même
 * journal, avec ce seul « outil », pour que la formule gratuite n'ait qu'un compteur de jetons
 * (plans.ts, assistantBudget). Elles ne comptent pas dans les 40 messages par heure ni les 400 par
 * jour de la bulle, qui n'existaient pas pour cette page.
 */
export const BOOKS_PAGE = "books_page";
const bubbleMessage = sql`not (${assistantUsage.tools} @> array[${BOOKS_PAGE}]::text[])`;

/**
 * Un tour réservé et pas encore fini : sa ligne du journal n'a encore ni jeton ni erreur (recordUsage
 * la complète à la fin, échec compris). Il compte comme en cours pendant le délai d'un tour de la
 * bulle (run.ts, DEADLINE_MS, 290 s ; la page Assistant attend l'IA 60 s au plus) et une marge : une
 * fonction arrêtée en plein tour ne bloque pas l'entreprise plus longtemps.
 */
export const PENDING_MS = 305_000;

/** Formule gratuite : l'entreprise (sa formule) et le jour dont le mois est lu (UTC). */
export type FreeCheck = { org: OrgPlan & { id: string }; today: string };

async function pendingTurns(tx: Db, organizationId: string, now: Date) {
  const u = assistantUsage;
  const [row] = await tx
    .select({ n: count() })
    .from(u)
    .where(
      and(
        eq(u.organizationId, organizationId),
        isNull(u.error),
        eq(u.inputTokens, 0),
        eq(u.outputTokens, 0),
        eq(u.cacheReadTokens, 0),
        eq(u.cacheWriteTokens, 0),
        gt(u.createdAt, new Date(now.getTime() - PENDING_MS)),
      ),
    );
  return row?.n ?? 0;
}

/**
 * Formule gratuite (L4), sous le verrou de l'entreprise : la consommation du mois, plus une
 * demande-type par tour encore en cours (bulle et page Assistant). Au budget, rend le budget (atteint)
 * et rien ne part au modèle ; sinon null (formule sans limite comprise, sans lecture du journal).
 * Des demandes lancées ensemble ne passent donc pas toutes sous le budget ; un tour commencé peut le
 * dépasser un peu (ses jetons ne sont connus qu'à la fin), le suivant est refusé.
 */
async function freeLimitReached(
  tx: Db,
  free: FreeCheck | null,
  now: Date,
): Promise<AssistantBudget | null> {
  const budget = free && (await assistantBudget(tx, free.org, free.today));
  if (!budget) return null;
  const pending = await pendingTurns(tx, free.org.id, now);
  const used = budget.used + pending * ASSISTANT_TOKENS.perRequest;
  if (used < budget.limit) return null;
  return { ...budget, used, left: requestsLeft({ used, limit: budget.limit }), exhausted: true };
}

/** Compte puis inscrit sous le verrou de l'entreprise : deux onglets en même temps ne passent pas. */
function underOrgLock<T>(database: Db, organizationId: string, fn: (tx: Db) => Promise<T>) {
  return database.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`assistant:${organizationId}`}))`);
    return fn(tx as unknown as Db);
  });
}

/**
 * Réserve un message de la bulle : compte puis inscrit, sous le verrou de l'entreprise. Formule
 * gratuite d'abord (`free`, budget du mois, tours en cours compris), puis les 40 messages par heure et
 * les 400 par jour. Rend l'id de la ligne à compléter, ou la limite atteinte (rien n'est inscrit).
 */
export async function reserveMessage(
  database: Db,
  who: Who,
  now = new Date(),
  free: FreeCheck | null = null,
): Promise<
  { id: number } | { limit: "user" | "org" } | { limit: "free"; budget: AssistantBudget }
> {
  return underOrgLock(database, who.organizationId, async (tx) => {
    const full = await freeLimitReached(tx, free, now);
    if (full) return { limit: "free" as const, budget: full };
    const hourAgo = new Date(now.getTime() - 3_600_000);
    const [mine] = await tx
      .select({ n: count() })
      .from(assistantUsage)
      .where(
        and(
          eq(assistantUsage.userId, who.userId),
          gte(assistantUsage.createdAt, hourAgo),
          bubbleMessage,
        ),
      );
    if ((mine?.n ?? 0) >= USER_PER_HOUR) return { limit: "user" as const };
    const day = new Date(`${now.toISOString().slice(0, 10)}T00:00:00Z`);
    const [org] = await tx
      .select({ n: count() })
      .from(assistantUsage)
      .where(
        and(
          eq(assistantUsage.organizationId, who.organizationId),
          gte(assistantUsage.createdAt, day),
          bubbleMessage,
        ),
      );
    if ((org?.n ?? 0) >= ORG_PER_DAY) return { limit: "org" as const };
    const [row] = await tx
      .insert(assistantUsage)
      .values({ organizationId: who.organizationId, userId: who.userId, createdAt: now })
      .returning({ id: assistantUsage.id });
    if (!row) throw new Error("assistant_usage_not_saved");
    return { id: row.id };
  });
}

/**
 * Réserve une question de la page Assistant avant l'appel à l'IA, sous le même verrou et avec le même
 * budget que la bulle (tours en cours compris) ; ni les 40 par heure ni les 400 par jour, qui
 * n'existaient pas pour cette page. Rend l'id de la ligne (recordUsage la complète), ou le budget
 * atteint (rien n'est inscrit).
 */
export async function reserveBooksQuestion(
  database: Db,
  who: Who,
  free: FreeCheck,
  now = new Date(),
): Promise<{ id: number } | { limit: "free"; budget: AssistantBudget }> {
  return underOrgLock(database, who.organizationId, async (tx) => {
    const full = await freeLimitReached(tx, free, now);
    if (full) return { limit: "free" as const, budget: full };
    const [row] = await tx
      .insert(assistantUsage)
      .values({
        organizationId: who.organizationId,
        userId: who.userId,
        tools: [BOOKS_PAGE],
        createdAt: now,
      })
      .returning({ id: assistantUsage.id });
    if (!row) throw new Error("assistant_usage_not_saved");
    return { id: row.id };
  });
}

export type UsageReport = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  tools: string[];
  error: string | null;
};

/** Complète la ligne du message : jetons consommés, outils appelés, erreur. Jamais le contenu. */
export async function recordUsage(database: Db, id: number, report: UsageReport) {
  await database
    .update(assistantUsage)
    .set({
      inputTokens: report.inputTokens,
      outputTokens: report.outputTokens,
      cacheReadTokens: report.cacheReadTokens,
      cacheWriteTokens: report.cacheWriteTokens,
      tools: report.tools.slice(0, 50),
      error: report.error,
    })
    .where(eq(assistantUsage.id, id));
}
