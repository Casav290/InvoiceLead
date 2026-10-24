import { and, count, eq, gte, sql } from "drizzle-orm";
import type { Db } from "../db";
import { assistantUsage } from "../db/schema";

/** 40 messages par heure et par personne, 400 par jour (UTC) et par entreprise, toutes formules. */
export const USER_PER_HOUR = 40;
export const ORG_PER_DAY = 400;

export type Who = { organizationId: string; userId: string };

/**
 * Réserve un message : compte puis inscrit, sous un verrou de l'entreprise (deux onglets en même
 * temps ne passent pas la limite). Rend l'id de la ligne à compléter, ou la limite atteinte.
 */
export async function reserveMessage(
  database: Db,
  who: Who,
  now = new Date(),
): Promise<{ id: number } | { limit: "user" | "org" }> {
  return database.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`assistant:${who.organizationId}`}))`,
    );
    const hourAgo = new Date(now.getTime() - 3_600_000);
    const [mine] = await tx
      .select({ n: count() })
      .from(assistantUsage)
      .where(and(eq(assistantUsage.userId, who.userId), gte(assistantUsage.createdAt, hourAgo)));
    if ((mine?.n ?? 0) >= USER_PER_HOUR) return { limit: "user" as const };
    const day = new Date(`${now.toISOString().slice(0, 10)}T00:00:00Z`);
    const [org] = await tx
      .select({ n: count() })
      .from(assistantUsage)
      .where(
        and(
          eq(assistantUsage.organizationId, who.organizationId),
          gte(assistantUsage.createdAt, day),
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
