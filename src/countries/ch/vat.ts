/**
 * Taux de TVA suisses, datés. Le taux applicable dépend de la date (ou de la période) de la prestation,
 * pas de la date de la facture. Les hausses annoncées (AVS dès 2028, armée dès 2029) seront ajoutées ici
 * une fois votées, avec leur date d'entrée en vigueur.
 */
export const VAT_CODES = ["normal", "reduced", "lodging", "exempt", "export"] as const;
export type VatCode = (typeof VAT_CODES)[number];

type RatePeriod = {
  from: string;
  to: string | null;
  bp: Record<"normal" | "reduced" | "lodging", number>;
};

/** Taux en points de base (810 = 8,1 %). Bornes incluses, dates ISO. */
const PERIODS: RatePeriod[] = [
  { from: "2018-01-01", to: "2023-12-31", bp: { normal: 770, reduced: 250, lodging: 370 } },
  { from: "2024-01-01", to: null, bp: { normal: 810, reduced: 260, lodging: 380 } },
];

/**
 * Taux d'un code TVA à une date de prestation. « exempt » (exclu du champ de l'impôt, art. 21 LTVA) et
 * « export » (exonéré, art. 23 LTVA) valent 0.
 */
export function vatRateBp(code: VatCode, serviceDate: string): number {
  if (code === "exempt" || code === "export") return 0;
  const period = PERIODS.find(
    (p) => serviceDate >= p.from && (p.to === null || serviceDate <= p.to),
  );
  if (!period) throw new Error(`Aucun taux de TVA connu au ${serviceDate}`);
  return period.bp[code];
}

/** « 8.1 % » ou « 8,1 % » selon la langue. */
export function formatRate(bp: number, locale: string): string {
  // Jusqu'à trois décimales (sales tax de 8,875 %), zéros finaux retirés : 8.1, 20, 8.875.
  const value = (bp / 100).toFixed(3).replace(/\.?0+$/, "");
  return `${locale.startsWith("fr") ? value.replace(".", ",") : value} %`;
}
