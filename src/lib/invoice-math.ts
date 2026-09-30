/**
 * Calcul d'une facture suisse, partagé par l'écran (aperçu en direct) et le serveur (montants
 * enregistrés). Prix hors TVA, quantités en millièmes, montants en centimes entiers.
 *
 * La TVA se calcule par taux sur la somme des lignes de ce taux, puis s'arrondit au centime : c'est
 * ce que montre la facture (récapitulatif par taux, art. 26 LTVA) et ce que reprend le décompte.
 */
import { roundHalfAwayFromZero, vatOf } from "./money";

export type LineInput = { quantityMilli: number; unitPriceCents: number; vatRateBp: number };

export type VatBreakdown = { rateBp: number; netCents: number; vatCents: number };

export type InvoiceTotals = {
  lines: number[];
  netCents: number;
  vat: VatBreakdown[];
  vatCents: number;
  totalCents: number;
};

export function lineNetCents(quantityMilli: number, unitPriceCents: number): number {
  return roundHalfAwayFromZero((quantityMilli * unitPriceCents) / 1000) + 0;
}

export function computeTotals(lines: LineInput[]): InvoiceTotals {
  const nets = lines.map((l) => lineNetCents(l.quantityMilli, l.unitPriceCents));
  const byRate = new Map<number, number>();
  lines.forEach((l, i) => {
    byRate.set(l.vatRateBp, (byRate.get(l.vatRateBp) ?? 0) + (nets[i] ?? 0));
  });
  const vat = [...byRate.entries()]
    .sort(([a], [b]) => b - a)
    .map(([rateBp, netCents]) => ({ rateBp, netCents, vatCents: vatOf(netCents, rateBp) }));
  const netCents = nets.reduce((s, n) => s + n, 0);
  const vatCents = vat.reduce((s, v) => s + v.vatCents, 0);
  return { lines: nets, netCents, vat, vatCents, totalCents: netCents + vatCents };
}

/** « 1.5 », « 2,25 », « 1'000 » → millièmes ; au plus trois décimales, positif ou négatif. */
export function parseQuantityToMilli(input: string): number | null {
  const compact = input.replace(/[\s'\u2019\u00a0\u202f]/g, "").replace(",", ".");
  if (!/^-?\d{1,7}(\.\d{1,3})?$/.test(compact)) return null;
  const negative = compact.startsWith("-");
  const [units = "0", decimals = ""] = compact.replace("-", "").split(".");
  const milli = Number(units) * 1000 + Number(decimals.padEnd(3, "0"));
  return negative ? -milli : milli;
}

/** 1500 → « 1.5 », 2000 → « 2 ». */
export function formatQuantity(milli: number): string {
  const sign = milli < 0 ? "-" : "";
  const abs = Math.abs(milli);
  const units = Math.floor(abs / 1000);
  const decimals = (abs % 1000).toString().padStart(3, "0").replace(/0+$/, "");
  return `${sign}${units}${decimals ? `.${decimals}` : ""}`;
}
