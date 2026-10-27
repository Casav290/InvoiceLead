/**
 * Les cinq langues d'InvoiceLead (interface, e-mails, PDF, documents) : allemand, français, anglais,
 * italien, espagnol. Liste unique, sans dépendance : le proxy, le serveur, les composants et les tests
 * la lisent tous ici.
 */
export const LOCALES = ["de", "fr", "en", "it", "es"] as const;
export type AppLocale = (typeof LOCALES)[number];

/** Nom de chaque langue dans sa propre langue, pour le sélecteur. */
export const LOCALE_NAMES: Record<AppLocale, string> = {
  fr: "Français",
  de: "Deutsch",
  en: "English",
  it: "Italiano",
  es: "Español",
};

/** Ordre d'affichage du sélecteur (libellés natifs). */
export const LOCALE_MENU: readonly AppLocale[] = ["fr", "de", "en", "it", "es"];

/** Motif d'une langue dans une adresse ou une expression régulière : « de|fr|en|it|es ». */
export const LOCALE_PATTERN = LOCALES.join("|");

export function isLocale(value: unknown): value is AppLocale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/** Langue connue (« fr-CH » → « fr »), ou undefined. */
export function shortLocale(value: string | null | undefined): AppLocale | undefined {
  const short = (value ?? "").slice(0, 2).toLowerCase();
  return isLocale(short) ? short : undefined;
}

/** Balise HTML lang : « de-CH », « fr-CH » et « en-GB » comme avant, « it » et « es » sans pays. */
export function htmlLang(locale: string): string {
  if (locale === "en") return "en-GB";
  if (locale === "it" || locale === "es") return locale;
  return `${locale}-CH`;
}

/** Le texte de cette langue parmi les cinq ; une langue inconnue prend l'allemand (langue par défaut). */
export function localized<T>(locale: string, texts: Record<AppLocale, T>): T {
  return texts[isLocale(locale) ? locale : "de"];
}
