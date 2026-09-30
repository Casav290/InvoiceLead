import { type VatCode, vatRateBp as vatRateBpCh } from "./ch/vat";
import { vatRateBpDe } from "./de/vat";
import { vatRateBpFr } from "./fr/vat";
import { vatRateBpGb } from "./gb/vat";
import { salesTaxRateBp } from "./us/tax";

/**
 * Pays pris en charge. Chaque pack pays porte ses taux datés, sa devise, son bulletin de paiement et
 * le format des montants ; la comptabilité et la TVA restent suisses tant que le pack ne les a pas.
 */
export const COUNTRIES = ["CH", "DE", "FR", "GB", "US"] as const;
export type Country = (typeof COUNTRIES)[number];

export type CountryPack = {
  code: Country;
  currency: "CHF" | "EUR" | "GBP" | "USD";
  /**
   * Bulletin imprimé sous la facture : QR-facture suisse, GiroCode (EPC) de virement SEPA, ou rien
   * (coordonnées bancaires seules, au Royaume-Uni).
   */
  paymentSlip: "qr-bill" | "epc-qr" | "none";
  /** Montants : 1'234.50 en Suisse, 1.234,50 en Allemagne, 1 234,50 en France, 1,234.50 au Royaume-Uni. */
  amounts: "ch" | "de" | "fr" | "en";
  /** Dates : 30.09.2026, 30/09/2026 ou, aux États-Unis, 09/30/2026. */
  dates: "dot" | "slash" | "us";
  /** Format du papier des PDF. */
  paper: "A4" | "LETTER";
  /** Impôt sur les ventes : TVA récupérable, ou sales tax américaine (non récupérable sur les achats). */
  tax: "vat" | "salesTax";
  /** Comptabilité en partie double, décompte TVA et import bancaire camt disponibles. */
  accounting: boolean;
  /** Taux d'un code à une date ; `localRateBp` est le taux propre à l'entreprise (sales tax). */
  vatRateBp: (code: VatCode, serviceDate: string, localRateBp?: number | null) => number;
};

const PACKS: Record<Country, CountryPack> = {
  CH: {
    code: "CH",
    currency: "CHF",
    paymentSlip: "qr-bill",
    amounts: "ch",
    dates: "dot",
    paper: "A4",
    tax: "vat",
    accounting: true,
    vatRateBp: vatRateBpCh,
  },
  DE: {
    code: "DE",
    currency: "EUR",
    paymentSlip: "epc-qr",
    amounts: "de",
    dates: "dot",
    paper: "A4",
    tax: "vat",
    accounting: true,
    vatRateBp: vatRateBpDe,
  },
  FR: {
    code: "FR",
    currency: "EUR",
    paymentSlip: "epc-qr",
    amounts: "fr",
    dates: "slash",
    paper: "A4",
    tax: "vat",
    accounting: true,
    vatRateBp: vatRateBpFr,
  },
  GB: {
    code: "GB",
    currency: "GBP",
    paymentSlip: "none",
    amounts: "en",
    dates: "slash",
    paper: "A4",
    tax: "vat",
    accounting: true,
    vatRateBp: vatRateBpGb,
  },
  US: {
    code: "US",
    currency: "USD",
    paymentSlip: "none",
    amounts: "en",
    dates: "us",
    paper: "LETTER",
    tax: "salesTax",
    accounting: true,
    vatRateBp: (code, _date, localRateBp) => salesTaxRateBp(code, localRateBp),
  },
};

export function isCountry(value: unknown): value is Country {
  return (COUNTRIES as readonly unknown[]).includes(value);
}

/** Pack d'un pays ; un pays inconnu retombe sur la Suisse. */
export function countryPack(code: string | null | undefined): CountryPack {
  return isCountry(code) ? PACKS[code] : PACKS.CH;
}
