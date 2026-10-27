import { CHART_TEMPLATES } from "@/countries/ch/chart-of-accounts";
import { chartPack } from "@/countries/charts";

type Named = { nameDe: string; nameFr: string; nameEn?: string | null };

/**
 * Libellés italiens et espagnols des comptes des plans modèles (src/countries), retrouvés par leurs
 * libellés allemand, français et anglais : les comptes installés n'en gardent que trois (de, fr, en).
 */
const keyOf = (de: string, fr: string, en?: string | null) => `${de}\u0000${fr}\u0000${en ?? ""}`;

let templates: Map<string, { it: string; es: string }> | undefined;
function templateNames() {
  if (templates) return templates;
  templates = new Map();
  // Le plan suisse d'abord : un même libellé dans deux plans garde sa première traduction.
  for (const country of ["CH", "DE", "FR", "GB", "US"]) {
    for (const template of CHART_TEMPLATES) {
      for (const a of chartPack(country).templateAccounts(template)) {
        const key = keyOf(a.de, a.fr, a.en);
        if (!templates.has(key)) templates.set(key, { it: a.it, es: a.es });
      }
    }
  }
  return templates;
}

/**
 * Libellé d'un compte dans la langue de l'interface ; l'anglais retombe sur l'allemand s'il manque.
 * Italien et espagnol : le libellé du plan modèle ; un compte créé ou renommé par l'entreprise garde
 * le libellé qu'elle a saisi (le français, qui reprend l'allemand quand un seul est donné).
 */
export function accountName(account: Named, locale: string): string {
  if (locale === "fr") return account.nameFr;
  if (locale === "en") return account.nameEn || account.nameDe;
  if (locale === "it" || locale === "es") {
    const found = templateNames().get(keyOf(account.nameDe, account.nameFr, account.nameEn));
    return found?.[locale] || account.nameFr;
  }
  return account.nameDe;
}
