import { eq } from "drizzle-orm";
import { type AppLocale, isLocale } from "@/i18n/locales";
import type { Db } from "./db";
import { users } from "./db/schema";

/**
 * Langue choisie par la personne (sélecteur de l'espace connecté, Assistant IA) : gardée dans son
 * compte (users.chosen_locale), elle sert à chaque arrivée sans langue dans l'adresse (lanceurs,
 * racine), avant celle du Compte Lead.
 */
export async function chooseLocale(database: Db, userId: string, locale: string): Promise<boolean> {
  if (!isLocale(locale)) return false;
  await database
    .update(users)
    .set({ chosenLocale: locale, updatedAt: new Date() })
    .where(eq(users.id, userId));
  return true;
}

/** Langue gardée dans le compte de la personne, ou null. */
export async function chosenLocale(database: Db, userId: string): Promise<AppLocale | null> {
  const [row] = await database
    .select({ chosenLocale: users.chosenLocale })
    .from(users)
    .where(eq(users.id, userId));
  return isLocale(row?.chosenLocale) ? row.chosenLocale : null;
}
