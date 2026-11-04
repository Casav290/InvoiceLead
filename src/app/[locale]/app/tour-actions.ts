"use server";

import { requireSession } from "@/server/auth/guard";
import { db } from "@/server/db";
import { markTourSeen } from "@/server/tour";

/**
 * La visite guidée s'est ouverte seule (premier passage) : retenu dans le compte de la personne
 * connectée (users.tour_pending à faux, src/server/tour.ts), pour qu'elle ne se rouvre sur aucun appareil.
 */
export async function markTourSeenAction(locale: string): Promise<boolean> {
  const { user } = await requireSession(locale);
  return markTourSeen(db(), user.id);
}
