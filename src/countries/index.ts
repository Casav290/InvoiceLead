import { type VatCode, vatRateBp as vatRateBpCh } from "./ch/vat";
import { vatRateBpDe } from "./de/vat";

/**
 * Pays pris en charge. Chaque pack pays porte ses taux datés, sa devise, son bulletin de paiement et
 * le format des montants ; la comptabilité et la TVA restent suisses tant que le pack ne les a pas.
 */
export const COUNTRIES = ["CH", "DE"] as const;
export type Country = (typeof COUNTRIES)[number];

export type CountryPack = {
  code: Country;
  currency: "CHF" | "EUR";
  /** Bulletin imprimé sous la facture : QR-facture suisse, ou code GiroCode (EPC) de virement SEPA. */
  paymentSlip: "qr-bill" | "epc-qr";
  /** Montants : 1'234.50 en Suisse, 1.234,50 en Allemagne. */
  amounts: "ch" | "de";
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
    accounting: true,
    vatRateBp: vatRateBpCh,
  },
  DE: {
    code: "DE",
    currency: "EUR",
    paymentSlip: "epc-qr",
    amounts: "de",
    accounting: true,
    vatRateBp: vatRateBpDe,
  },
};

export function isCountry(value: unknown): value is Country {
  return (COUNTRIES as readonly unknown[]).includes(value);
}

/** Pack d'un pays ; un pays inconnu retombe sur la Suisse. */
export function countryPack(code: string | null | undefined): CountryPack {
  return isCountry(code) ? PACKS[code] : PACKS.CH;
}
