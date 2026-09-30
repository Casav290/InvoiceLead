import type { VatAggregates } from "../de/vat-return";

/**
 * Déclaration CA3 (formulaire 3310-CA3-SD) : lignes tirées des mêmes totaux que les autres pays.
 * Opérations imposables en A1, non imposables en E2 (prestations intracommunautaires surtout,
 * à ventiler à la main vers E1 ou F2 le cas échéant), TVA brute par taux, TVA déductible, solde.
 */
export const FR_FIGURE_ORDER = [
  "A1",
  "E2",
  "08",
  "9B",
  "09",
  "OT",
  "16",
  "19",
  "20",
  "23",
  "28",
  "25",
] as const;

/** Lignes qui portent une base et une taxe (taxe gardée sous « 08t »). */
export const FR_TAXED_FIGURES = ["08", "9B", "09", "OT"];

export const FR_ALWAYS_SHOWN = ["A1", "16", "23"];

export function ca3Figures(a: VatAggregates & { inputInvest: number }): Record<string, number> {
  const at = (bp: number) => a.byRate.get(bp) ?? { base: 0, tax: 0 };
  const other = [...a.byRate.entries()].filter(([bp]) => ![2000, 1000, 550].includes(bp));
  const collected = [...a.byRate.values()].reduce((s, v) => s + v.tax, 0);
  const taxable = [...a.byRate.values()].reduce((s, v) => s + v.base, 0);
  const inputMaterial = a.inputVat - a.inputInvest;
  const due = collected - a.inputVat;
  return {
    A1: taxable,
    E2: a.exports + a.exempt,
    "08": at(2000).base,
    "08t": at(2000).tax,
    "9B": at(1000).base,
    "9Bt": at(1000).tax,
    "09": at(550).base,
    "09t": at(550).tax,
    OT: other.reduce((s, [, v]) => s + v.base, 0),
    OTt: other.reduce((s, [, v]) => s + v.tax, 0),
    "16": collected,
    "19": a.inputInvest,
    "20": inputMaterial,
    "23": a.inputVat,
    "28": Math.max(0, due),
    "25": Math.max(0, -due),
    // Totaux communs, lus par la validation et l'échéance.
    "399": collected,
    "400": inputMaterial,
    "405": a.inputInvest,
    "479": a.inputVat,
    "500": Math.max(0, due),
    "510": Math.max(0, -due),
  };
}

/** Échéance indicative : le 15 du mois qui suit la période (le SIE fixe le jour exact, du 15 au 24). */
export function ca3DueDate(periodEnd: string): string {
  const d = new Date(`${periodEnd}T00:00:00Z`);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 15)).toISOString().slice(0, 10);
}
