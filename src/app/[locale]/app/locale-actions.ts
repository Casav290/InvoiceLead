"use server";

import { isLocale } from "@/i18n/locales";
import { requireSession } from "@/server/auth/guard";
import { db } from "@/server/db";
import { chooseLocale } from "@/server/user-locale";

/**
 * Langue choisie avec le sélecteur de l'espace connecté : gardée dans le compte de la personne
 * (users.chosen_locale, src/server/user-locale.ts), elle sert à chaque arrivée sans langue dans
 * l'adresse (lanceurs, racine), avant celle du Compte Lead. Le sélecteur change ensuite d'adresse
 * lui-même (même page, autre langue).
 */
export async function chooseLocaleAction(locale: string): Promise<boolean> {
  if (!isLocale(locale)) return false;
  const { user } = await requireSession(locale);
  return chooseLocale(db(), user.id, locale);
}
