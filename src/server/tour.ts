import "server-only";
import { and, eq } from "drizzle-orm";
import type { Db } from "./db";
import { users } from "./db/schema";

/**
 * Visite guidée (04.11.2026, drizzle/0050_visite_guidee.sql) : elle s'ouvre seule au premier passage
 * d'une personne (users.tour_pending), une seule fois, sur tous ses appareils. Dès l'ouverture, le
 * navigateur appelle markTourSeenAction (app/[locale]/app/tour-actions.ts), qui passe ici. « Revoir la
 * visite » n'écrit rien. Rend vrai si la visite était encore due.
 */
export async function markTourSeen(database: Db, userId: string): Promise<boolean> {
  const rows = await database
    .update(users)
    .set({ tourPending: false, tourSeenAt: new Date() })
    .where(and(eq(users.id, userId), eq(users.tourPending, true)))
    .returning({ id: users.id });
  return rows.length > 0;
}
