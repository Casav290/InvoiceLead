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
