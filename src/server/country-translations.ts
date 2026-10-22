import "server-only";
import { getTranslations } from "next-intl/server";
import { forCountry } from "@/i18n/country";
import { getSession } from "./auth/session";

/** getTranslations, avec les variantes du pays de l'entreprise (src/i18n/country.ts). */
export async function getCountryTranslations(
  options: { locale: string; namespace: string },
  country: string | null | undefined,
) {
  return forCountry(await getTranslations(options), country);
}

/**
 * Pour generateMetadata, rendu à part de la page : le pays de l'entreprise de la session (lue une
 * seule fois par requête), la Suisse sans session.
 */
export async function getSessionCountryTranslations(options: {
  locale: string;
  namespace: string;
}) {
  const session = await getSession();
  return getCountryTranslations(options, session?.organization.country);
}
