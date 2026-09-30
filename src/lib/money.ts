/**
 * Montants en centimes (Rappen) entiers, jamais en nombres à virgule. Affichage à la suisse :
 * « 2'361.99 » en allemand, « 2 361.99 » en français, comme sur les bulletins et relevés bancaires.
 */
export function formatAmount(cents: number, locale: string, currency = "CHF"): string {
  const parts = new Intl.NumberFormat(`${locale.slice(0, 2)}-CH`, {
    style: "currency",
    currency,
    currencyDisplay: "code",
  }).formatToParts(cents / 100);
  return parts
    .filter((p) => p.type !== "currency")
    .map((p) => p.value)
    .join("")
    .trim();
}

export function formatMoney(cents: number, locale: string, currency = "CHF"): string {
  return `${currency} ${formatAmount(cents, locale, currency)}`;
}

/** TVA d'un montant hors taxe, arrondie au centime (arrondi commercial). `rateBp` en points de base : 810 = 8,1 %. */
export function vatOf(netCents: number, rateBp: number): number {
  return Math.round((netCents * rateBp) / 10_000);
}
