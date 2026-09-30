/**
 * Montants en centimes (Rappen) entiers, jamais en nombres à virgule.
 *
 * Formatage fait main, et non par `Intl` : les données ICU changent d'une version de Node à l'autre
 * (le français de Suisse passe de « 2 361.99 » à « 2'361.99 » entre Node 22.22 et 22.23), et une facture
 * doit s'afficher à l'identique partout. Style « ch » (franc, en allemand comme en français) :
 * apostrophe pour les milliers, point pour les décimales. Style « de » (euro, Allemagne) : point pour
 * les milliers, virgule pour les décimales. Style « fr » (euro, France) : espace insécable pour les
 * milliers, virgule pour les décimales.
 */
export type AmountStyle = "ch" | "de" | "fr";

export function formatAmount(cents: number, style: AmountStyle = "ch"): string {
  if (!Number.isSafeInteger(cents)) throw new Error(`Montant invalide : ${cents}`);
  const abs = Math.abs(cents);
  // France : espace insécable (U+00A0, présente dans les polices standard des PDF) et virgule.
  const [thousands, decimal] =
    style === "de" ? [".", ","] : style === "fr" ? ["\u00a0", ","] : ["'", "."];
  const units = Math.floor(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, thousands);
  const decimals = (abs % 100).toString().padStart(2, "0");
  return `${cents < 0 ? "-" : ""}${units}${decimal}${decimals}`;
}

export function formatMoney(cents: number, currency = "CHF", style: AmountStyle = "ch"): string {
  return `${currency} ${formatAmount(cents, style)}`;
}

/**
 * Arrondi commercial au centime, symétrique : la moitié s'éloigne de zéro, pour les avoirs comme pour
 * les factures (Math.round arrondirait −0,5 vers zéro et fausserait un avoir d'un centime).
 */
export function roundHalfAwayFromZero(value: number): number {
  return Math.sign(value) * Math.round(Math.abs(value));
}

/** TVA d'un montant hors taxe, arrondie au centime. `rateBp` en points de base : 810 = 8,1 %. */
export function vatOf(netCents: number, rateBp: number): number {
  return roundHalfAwayFromZero((netCents * rateBp) / 10_000) + 0;
}
