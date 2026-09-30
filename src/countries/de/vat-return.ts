/**
 * Umsatzsteuer-Voranmeldung (UStVA) : Kennzahlen du formulaire, tirées des mêmes totaux que le
 * décompte suisse. Bases en centimes (le formulaire les arrondit à l'euro entier au dépôt ELSTER).
 */
export const DE_FIGURE_ORDER = ["81", "86", "35", "21", "48", "66", "83"] as const;

/** Kennzahlen qui portent une base et une taxe (taxe gardée sous « 81t » ; Kz 36 pour 35). */
export const DE_TAXED_FIGURES = ["81", "86", "35"];

/** Kennzahlen toujours affichées, même à zéro. */
export const DE_ALWAYS_SHOWN = ["81", "66", "83"];

export type VatAggregates = {
  byRate: Map<number, { base: number; tax: number }>;
  /** Exportations et prestations à l'étranger (code « export »). */
  exports: number;
  /** Chiffre d'affaires à 0 % hors exportations (code « exempt »). */
  exempt: number;
  inputVat: number;
};

export function ustvaFigures(a: VatAggregates): Record<string, number> {
  const at = (bp: number) => a.byRate.get(bp) ?? { base: 0, tax: 0 };
  const other = [...a.byRate.entries()].filter(([bp]) => bp !== 1900 && bp !== 700);
  const collected = [...a.byRate.values()].reduce((s, v) => s + v.tax, 0);
  const due = collected - a.inputVat;
  return {
    "81": at(1900).base,
    "81t": at(1900).tax,
    "86": at(700).base,
    "86t": at(700).tax,
    "35": other.reduce((s, [, v]) => s + v.base, 0),
    "35t": other.reduce((s, [, v]) => s + v.tax, 0),
    "21": a.exports,
    "48": a.exempt,
    "66": a.inputVat,
    "83": due,
    // Totaux communs, lus par la validation et l'échéance.
    "399": collected,
    "479": a.inputVat,
    "500": Math.max(0, due),
    "510": Math.max(0, -due),
  };
}

/** Échéance de la Voranmeldung : le 10 du mois qui suit la période (sans prolongation). */
export function ustvaDueDate(periodEnd: string): string {
  const d = new Date(`${periodEnd}T00:00:00Z`);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 10)).toISOString().slice(0, 10);
}
