import { and, eq, isNull, lt, or } from "drizzle-orm";
import type { Db } from "./db";
import { memberships } from "./db/schema";

/** Activité : la dernière venue n'est réécrite qu'au plus une fois par heure. */
export const SEEN_EVERY_MS = 3_600_000;

/**
 * Dernière venue de la personne dans InvoiceLead pour cette entreprise, gardée sur son adhésion
 * (memberships.last_seen_at, Réglages → Équipe) : elle reste après la fin des sessions. Écrite à
 * chaque arrivée (ouverture de session), à chaque changement d'entreprise et, avec `olderThanMs`,
 * pendant l'activité seulement si la dernière date est plus ancienne.
 */
export async function touchMembership(
  database: Db,
  organizationId: string,
  userId: string,
  olderThanMs = 0,
): Promise<void> {
  const now = new Date();
  await database
    .update(memberships)
    .set({ lastSeenAt: now })
    .where(
      and(
        eq(memberships.organizationId, organizationId),
        eq(memberships.userId, userId),
        ...(olderThanMs > 0
          ? [
              or(
                isNull(memberships.lastSeenAt),
                lt(memberships.lastSeenAt, new Date(now.getTime() - olderThanMs)),
              ),
            ]
          : []),
      ),
    );
}
