import type { VatAggregates } from "../de/vat-return";

/**
 * Relevé de sales tax d'une période : ventes brutes, ventes non taxables (exonérées ou hors de
 * l'État), ventes taxables et taxe perçue, à reporter sur la déclaration de l'État. La sales tax
 * payée sur les achats n'est pas récupérable : aucune déduction.
 */
export const US_FIGURE_ORDER = ["S1", "S2", "S3", "S4"] as const;

export const US_TAXED_FIGURES = ["S3"];

export const US_ALWAYS_SHOWN = ["S1", "S3", "S4"];

export function salesTaxFigures(a: VatAggregates): Record<string, number> {
  const collected = [...a.byRate.values()].reduce((s, v) => s + v.tax, 0);
  const taxable = [...a.byRate.values()].reduce((s, v) => s + v.base, 0);
  const nonTaxable = a.exports + a.exempt;
  return {
    S1: taxable + nonTaxable,
    S2: nonTaxable,
    S3: taxable,
    S3t: collected,
    S4: collected,
    // Totaux communs, lus par la validation et l'échéance.
    "399": collected,
    "479": 0,
    "500": collected,
    "510": 0,
  };
}

/** Échéance usuelle : le 20 du mois qui suit la période (varie selon l'État). */
export function salesTaxDueDate(periodEnd: string): string {
  const d = new Date(`${periodEnd}T00:00:00Z`);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 20)).toISOString().slice(0, 10);
}
