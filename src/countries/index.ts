import { type VatCode, vatRateBp as vatRateBpCh } from "./ch/vat";
import { vatRateBpDe } from "./de/vat";
import { vatRateBpFr } from "./fr/vat";
import { vatRateBpGb } from "./gb/vat";

/**
 * Pays pris en charge. Chaque pack pays porte ses taux datés, sa devise, son bulletin de paiement et
 * le format des montants ; la comptabilité et la TVA restent suisses tant que le pack ne les a pas.
 */
export const COUNTRIES = ["CH", "DE", "FR", "GB"] as const;
export type Country = (typeof COUNTRIES)[number];

export type CountryPack = {
  code: Country;
  currency: "CHF" | "EUR" | "GBP";
  /**
   * Bulletin imprimé sous la facture : QR-facture suisse, GiroCode (EPC) de virement SEPA, ou rien
   * (coordonnées bancaires seules, au Royaume-Uni).
   */
  paymentSlip: "qr-bill" | "epc-qr" | "none";
  /** Montants : 1'234.50 en Suisse, 1.234,50 en Allemagne, 1 234,50 en France, 1,234.50 au Royaume-Uni. */
  amounts: "ch" | "de" | "fr" | "en";
  /** Dates : 30.09.2026 ou 30/09/2026. */
  dates: "dot" | "slash";
  /** Comptabilité en partie double, décompte TVA et import bancaire camt disponibles. */
  accounting: boolean;
  vatRateBp: (code: VatCode, serviceDate: string) => number;
};

const PACKS: Record<Country, CountryPack> = {
  CH: {
    code: "CH",
    currency: "CHF",
    paymentSlip: "qr-bill",
    amounts: "ch",
    dates: "dot",
    accounting: true,
    vatRateBp: vatRateBpCh,
  },
  DE: {
    code: "DE",
    currency: "EUR",
    paymentSlip: "epc-qr",
    amounts: "de",
    dates: "dot",
    accounting: true,
    vatRateBp: vatRateBpDe,
  },
  FR: {
    code: "FR",
    currency: "EUR",
    paymentSlip: "epc-qr",
    amounts: "fr",
    dates: "slash",
    accounting: true,
    vatRateBp: vatRateBpFr,
  },
  GB: {
    code: "GB",
    currency: "GBP",
    paymentSlip: "none",
    amounts: "en",
    dates: "slash",
    accounting: true,
    vatRateBp: vatRateBpGb,
  },
};

export function isCountry(value: unknown): value is Country {
  return (COUNTRIES as readonly unknown[]).includes(value);
}

/** Pack d'un pays ; un pays inconnu retombe sur la Suisse. */
export function countryPack(code: string | null | undefined): CountryPack {
  return isCountry(code) ? PACKS[code] : PACKS.CH;
}
