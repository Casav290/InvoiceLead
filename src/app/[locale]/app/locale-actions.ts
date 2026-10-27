"use server";

import { eq } from "drizzle-orm";
import { isLocale } from "@/i18n/locales";
import { requireSession } from "@/server/auth/guard";
import { db } from "@/server/db";
import { users } from "@/server/db/schema";

/**
 * Langue choisie avec le sélecteur de l'espace connecté : gardée dans le compte de la personne
 * (users.chosen_locale), elle sert à chaque arrivée sans langue dans l'adresse (lanceurs, racine), avant
 * celle du Compte Lead. Le sélecteur change ensuite d'adresse lui-même (même page, autre langue).
 */
export async function chooseLocaleAction(locale: string): Promise<boolean> {
  if (!isLocale(locale)) return false;
  const { user } = await requireSession(locale);
  await db()
    .update(users)
    .set({ chosenLocale: locale, updatedAt: new Date() })
    .where(eq(users.id, user.id));
  return true;
}
