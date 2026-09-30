import type { VatCode } from "../ch/vat";

/**
 * États-Unis : pas de TVA mais une sales tax fixée par l'État et les collectivités, au taux du
 * lieu de livraison. L'entreprise saisit son taux combiné (État, comté, ville) ; les codes
 * « exempt » et « export » valent 0. La sales tax payée sur les achats n'est pas récupérable : elle
 * reste dans le coût.
 */
export function salesTaxRateBp(code: VatCode, localRateBp: number | null | undefined): number {
  if (code === "exempt" || code === "export") return 0;
  return localRateBp ?? 0;
}

/** Numéro d'employeur fédéral (EIN) : 9 chiffres, « 12-3456789 ». */
export function isValidEin(input: string): boolean {
  const v = input.replace(/[\s-]/g, "");
  if (!/^\d{9}$/.test(v)) return false;
  // Préfixes jamais attribués par l'IRS.
  return ![
    "00",
    "07",
    "08",
    "09",
    "17",
    "18",
    "19",
    "28",
    "29",
    "49",
    "69",
    "70",
    "78",
    "79",
    "89",
    "96",
    "97",
  ].includes(v.slice(0, 2));
}

export const formatEin = (input: string) => {
  const v = input.replace(/[\s-]/g, "");
  return `${v.slice(0, 2)}-${v.slice(2)}`;
};

/** Code ZIP : 5 chiffres, ou ZIP+4. */
export const isValidZip = (input: string) => /^\d{5}(-\d{4})?$/.test(input.trim());

/** États, district fédéral et territoires (codes postaux USPS). */
export const US_STATES = [
  "AL",
  "AK",
  "AZ",
  "AR",
  "CA",
  "CO",
  "CT",
  "DE",
  "DC",
  "FL",
  "GA",
  "HI",
  "ID",
  "IL",
  "IN",
  "IA",
  "KS",
  "KY",
  "LA",
  "ME",
  "MD",
  "MA",
  "MI",
  "MN",
  "MS",
  "MO",
  "MT",
  "NE",
  "NV",
  "NH",
  "NJ",
  "NM",
  "NY",
  "NC",
  "ND",
  "OH",
  "OK",
  "OR",
  "PA",
  "RI",
  "SC",
  "SD",
  "TN",
  "TX",
  "UT",
  "VT",
  "VA",
  "WA",
  "WV",
  "WI",
  "WY",
  "PR",
  "GU",
  "VI",
  "AS",
  "MP",
] as const;

export const isUsState = (v: string) => (US_STATES as readonly string[]).includes(v.toUpperCase());
