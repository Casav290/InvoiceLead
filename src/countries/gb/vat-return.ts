import type { VatAggregates } from "../de/vat-return";

/**
 * Déclaration de TVA britannique (Making Tax Digital, neuf cases). Les cases 2, 8 et 9 ne
 * concernent plus que l'Irlande du Nord depuis le Brexit et restent à zéro. Les cases 6 et 7 sont
 * en livres entières au dépôt ; elles sont gardées en pence ici. Le dépôt à HMRC passe par l'API
 * MTD, qui demande l'enregistrement d'InvoiceLead comme logiciel reconnu.
 */
export const GB_FIGURE_ORDER = ["1", "2", "3", "4", "5", "6", "7", "8", "9"] as const;

export const GB_TAXED_FIGURES: string[] = [];

export const GB_ALWAYS_SHOWN = ["1", "3", "4", "5", "6", "7"];

export function mtdFigures(
  a: VatAggregates & { turnoverNet: number; purchasesNet: number },
): Record<string, number> {
  const collected = [...a.byRate.values()].reduce((s, v) => s + v.tax, 0);
  const due = collected - a.inputVat;
  return {
    "1": collected,
    "2": 0,
    "3": collected,
    "4": a.inputVat,
    "5": Math.abs(due),
    "6": a.turnoverNet,
    "7": a.purchasesNet,
    "8": 0,
    "9": 0,
    // Totaux communs, lus par la validation et l'échéance.
    "399": collected,
    "400": a.inputVat,
    "479": a.inputVat,
    "500": Math.max(0, due),
    "510": Math.max(0, -due),
  };
}

/** Échéance MTD : un mois civil et sept jours après la fin de la période (fin du mois suivant + 7). */
export function mtdDueDate(periodEnd: string): string {
  const d = new Date(`${periodEnd}T00:00:00Z`);
  const due = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 2, 0));
  due.setUTCDate(due.getUTCDate() + 7);
  return due.toISOString().slice(0, 10);
}
