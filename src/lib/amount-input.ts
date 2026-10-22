import { formatAmount } from "./money";

/**
 * Lit un montant saisi à la main en centimes : « 1'200.50 », « 1 200,50 », « 1200 », « 99.9 ».
 * Rend null si la saisie n'est pas un montant positif ou nul avec au plus deux décimales.
 */
export function parseAmountToCents(input: string): number | null {
  const compact = input.replace(/[\s'’  ]/g, "").replace(",", ".");
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(compact)) return null;
  const [units = "0", decimals = ""] = compact.split(".");
  return Number(units) * 100 + Number(decimals.padEnd(2, "0"));
}

/**
 * Montant prérempli dans un champ, relu ensuite par parseAmountToCents : « 1'200.50 » en Suisse,
 * sans séparateur de milliers ailleurs, avec la virgule décimale en Allemagne et en France
 * (« 1200,50 ») et le point au Royaume-Uni et aux États-Unis (« 1200.50 »).
 */
export function formatAmountInput(cents: number, country: string | null | undefined): string {
  if (!country || country === "CH") return formatAmount(cents, "ch");
  const plain = (cents / 100).toFixed(2);
  return country === "DE" || country === "FR" ? plain.replace(".", ",") : plain;
}
