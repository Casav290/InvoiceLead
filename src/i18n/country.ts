/**
 * Libellés selon le pays de l'entreprise, indépendamment de la langue de l'interface.
 *
 * Le message de base (`net`, `vat.normal`) est celui de la Suisse, premier marché : une entreprise
 * suisse le lit toujours, sans changement. Ses variantes portent un suffixe, essayé dans l'ordre :
 * celui du pays (`netDe`, `netFr`, `netGb`, `netUs`), puis `netIntl` pour toute entreprise hors de
 * Suisse (l'allemand d'Allemagne : Angebot, Ausgaben, USt, Steuerberater, Cent). Sans variante,
 * le message de base reste.
 *
 * Hors de Suisse, les guillemets suisses de l'allemand («Bank») deviennent ceux de l'Allemagne
 * („Bank“), dans tous les messages ; les guillemets français, entourés d'espaces fines, ne changent pas.
 */

const SUFFIXES: Record<string, readonly string[]> = {
  DE: ["De", "Intl"],
  FR: ["Fr", "Intl"],
  GB: ["Gb", "Intl"],
  US: ["Us", "Intl"],
};

/** Suffixes essayés pour une entreprise de ce pays ; aucun pour la Suisse (ou un pays inconnu). */
export function countrySuffixes(country: string | null | undefined): readonly string[] {
  return SUFFIXES[country ?? ""] ?? [];
}

/** Forme minimale d'un traducteur next-intl (getTranslations, useTranslations, createTranslator). */
export type Translator = {
  // biome-ignore lint/suspicious/noExplicitAny: signature commune des traducteurs next-intl
  (key: any, ...rest: any[]): string;
  // biome-ignore lint/suspicious/noExplicitAny: idem
  has(key: any): boolean;
  // biome-ignore lint/suspicious/noExplicitAny: idem
  rich(key: any, ...rest: any[]): unknown;
  // biome-ignore lint/suspicious/noExplicitAny: idem
  markup(key: any, ...rest: any[]): string;
  // biome-ignore lint/suspicious/noExplicitAny: idem
  raw(key: any): any;
};

/** «Bank» → „Bank“ (guillemets suisses collés au mot, ceux de l'allemand de Suisse). */
export function germanQuotes(text: string): string {
  return text
    .replace(/«(?![\s\u00a0\u202f])/g, "\u201e")
    .replace(/(?<![\s\u00a0\u202f])»/g, "\u201c");
}

/** Clé effectivement lue pour ce pays : la première variante présente, sinon la clé de base. */
export function countryKey(
  t: Pick<Translator, "has">,
  key: string,
  country: string | null | undefined,
) {
  for (const suffix of countrySuffixes(country)) {
    const variant = `${key}${suffix}`;
    if (t.has(variant)) return variant;
  }
  return key;
}

/**
 * Le même traducteur, qui lit la variante du pays quand elle existe. Pour la Suisse, le traducteur
 * est rendu tel quel.
 */
export function forCountry<T extends Translator>(t: T, country: string | null | undefined): T {
  if (countrySuffixes(country).length === 0) return t;
  const pick = (key: string) => countryKey(t, key, country);
  const wrapped = ((key: string, ...rest: unknown[]) =>
    germanQuotes(t(pick(key), ...rest))) as unknown as T;
  wrapped.has = (key: string) => t.has(key);
  wrapped.rich = (key: string, ...rest: unknown[]) => t.rich(pick(key), ...rest);
  wrapped.markup = (key: string, ...rest: unknown[]) => germanQuotes(t.markup(pick(key), ...rest));
  wrapped.raw = (key: string) => t.raw(pick(key));
  return wrapped;
}
