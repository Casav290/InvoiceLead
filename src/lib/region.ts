/**
 * Région de la personne qui ouvre une entreprise dans InvoiceLead, et ce qu'elle donne par défaut :
 * pays de l'entreprise (parmi les packs pris en charge) et devise. Sans dépendance au serveur.
 *
 * Ordre de lecture : l'en-tête de Vercel `x-vercel-ip-country` (pays de l'adresse IP), puis la région
 * de la première langue d'Accept-Language qui en porte une (« fr-FR » → FR), puis celle de la langue du
 * Compte Lead (« it-CH » → CH). Rien de tout cela : aucun défaut, l'entreprise reste suisse en CHF
 * comme avant.
 */
import { COUNTRIES, type Country } from "@/countries";
import type { Currency } from "./currencies";

/** Pays dont la monnaie est l'euro (zone euro et pays liés par un accord monétaire). */
export const EURO_COUNTRIES: ReadonlySet<string> = new Set([
  "AT",
  "BE",
  "CY",
  "DE",
  "EE",
  "ES",
  "FI",
  "FR",
  "GR",
  "HR",
  "IE",
  "IT",
  "LT",
  "LU",
  "LV",
  "MT",
  "NL",
  "PT",
  "SI",
  "SK",
  "AD",
  "MC",
  "SM",
  "VA",
]);

const ISO2 = /^[A-Z]{2}$/;

/** Pays d'une balise de langue (« fr-FR », « es_419 » non) ou undefined. */
function tagCountry(tag: string | null | undefined): string | undefined {
  const parts = (tag ?? "").trim().split(/[-_]/);
  const region = parts.find((p, i) => i > 0 && /^[A-Za-z]{2}$/.test(p));
  return region ? region.toUpperCase() : undefined;
}

export function regionCountry(input: {
  ipCountry?: string | null;
  acceptLanguage?: string | null;
  accountLocale?: string | null;
}): string | undefined {
  const ip = (input.ipCountry ?? "").trim().toUpperCase();
  // « XX » (inconnu) et « T1 » (Tor) ne disent rien.
  if (ISO2.test(ip) && ip !== "XX") return ip;
  const ranked = (input.acceptLanguage ?? "")
    .split(",")
    .map((part) => {
      const [tag = "", ...params] = part.trim().split(";");
      const q = Number(params.find((p) => p.trim().startsWith("q="))?.split("=")[1] ?? 1);
      return { tag, q: Number.isFinite(q) ? q : 0 };
    })
    .filter((r) => r.q > 0)
    .sort((a, b) => b.q - a.q);
  for (const r of ranked) {
    const c = tagCountry(r.tag);
    if (c) return c;
  }
  return tagCountry(input.accountLocale);
}

export type RegionDefaults = {
  /** Pays de l'entreprise (pack) : CH, DE, FR, GB, US. */
  country: Country;
  /** Devise du pack, celle de la comptabilité. */
  currency: Currency;
  /** Devise de la région si elle diffère de celle du pack (zone euro sans pack) ; null sinon. */
  regionCurrency: Currency | null;
};

/**
 * Défauts d'une nouvelle entreprise selon la région : CH/LI → Suisse en CHF ; Allemagne, France (et
 * Monaco) → leur pack en EUR ; GB → GBP ; US → USD ; autre pays de la zone euro → pack suisse (le seul
 * qui reste tant que le pays n'a pas le sien) mais l'euro proposé par défaut et jamais réservé à Pro.
 * Région inconnue ou hors de ces pays : undefined (l'entreprise reste suisse en CHF).
 */
export function regionDefaults(region: string | null | undefined): RegionDefaults | undefined {
  const c = (region ?? "").toUpperCase();
  if (c === "LI") return { country: "CH", currency: "CHF", regionCurrency: null };
  if (c === "MC") return { country: "FR", currency: "EUR", regionCurrency: null };
  if ((COUNTRIES as readonly string[]).includes(c)) {
    const country = c as Country;
    const currency: Currency =
      country === "CH" ? "CHF" : country === "GB" ? "GBP" : country === "US" ? "USD" : "EUR";
    return { country, currency, regionCurrency: null };
  }
  if (EURO_COUNTRIES.has(c)) return { country: "CH", currency: "CHF", regionCurrency: "EUR" };
  return undefined;
}

/** Devise par défaut d'une nouvelle pièce sans client qui impose la sienne. */
export function defaultDocumentCurrency(org: {
  currency: string;
  regionCurrency?: string | null;
}): string {
  return org.regionCurrency || org.currency;
}

/**
 * Devises jamais réservées à Pro pour cette entreprise : celle de son pays (comptabilité) et celle de
 * la région d'où elle a été ouverte.
 */
export function homeCurrencies(org: {
  currency: string;
  regionCurrency?: string | null;
}): string[] {
  return org.regionCurrency && org.regionCurrency !== org.currency
    ? [org.currency, org.regionCurrency]
    : [org.currency];
}
