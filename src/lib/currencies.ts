/**
 * Devises de facturation. La comptabilité reste tenue dans la monnaie de l'entreprise (celle de son
 * pays) : une pièce en devise est convertie au cours figé à son émission.
 */
export const CURRENCIES = ["CHF", "EUR", "USD", "GBP"] as const;
export type Currency = (typeof CURRENCIES)[number];

export const isCurrency = (v: unknown): v is Currency =>
  typeof v === "string" && (CURRENCIES as readonly string[]).includes(v);

/** Montant en centimes de devise converti en centimes de la monnaie de l'entreprise. */
export const toHome = (cents: number, rate: number | null | undefined) =>
  rate ? Math.round(cents * rate) : cents;

/** Cours saisi (« 0.9412 » ou « 0,9412 »), positif et raisonnable, sinon null. */
export function parseFxRate(value: string): number | null {
  const v = value.trim().replace(",", ".");
  if (!/^\d{1,6}(\.\d{1,8})?$/.test(v)) return null;
  const n = Number(v);
  return n > 0 && n < 100000 ? n : null;
}

/** Cours affiché avec quatre décimales au moins, sans zéros inutiles au-delà. */
export function formatFxRate(rate: number): string {
  const s = rate.toFixed(6).replace(/0+$/, "");
  const [int, dec = ""] = s.split(".");
  return `${int}.${dec.padEnd(4, "0")}`;
}

/**
 * Parts d'une pièce en devise, converties au cours de la pièce. La créance est le total converti ; un
 * écart d'arrondi entre elle et la somme des parts va sur le chiffre d'affaires du dernier taux,
 * jamais sur la TVA, qui doit rester la TVA convertie.
 */
export function convertDocument(
  groups: { netCents: number; vatCents: number }[],
  totalCents: number,
  rate: number,
): { receivableCents: number; groups: { netCents: number; vatCents: number }[] } {
  const receivableCents = toHome(totalCents, rate);
  const converted = groups.map((g) => ({
    netCents: toHome(g.netCents, rate),
    vatCents: toHome(g.vatCents, rate),
  }));
  const last = converted[converted.length - 1];
  if (last) {
    const sum = converted.reduce((s, g) => s + g.netCents + g.vatCents, 0);
    last.netCents += receivableCents - sum;
  }
  return { receivableCents, groups: converted };
}

/**
 * Paiement d'une facture en devise : l'argent reçu au cours du jour, la créance soldée au cours de la
 * facture. Le dernier paiement solde exactement ce qui reste de la créance convertie.
 */
export function paymentFx(input: {
  amountCents: number;
  paymentRate: number | null;
  invoiceRate: number;
  settles: boolean;
  remainingReceivableCents: number;
}): { moneyCents: number; receivableCents: number; differenceCents: number } {
  const moneyCents = toHome(input.amountCents, input.paymentRate ?? input.invoiceRate);
  const receivableCents = input.settles
    ? input.remainingReceivableCents
    : toHome(input.amountCents, input.invoiceRate);
  return { moneyCents, receivableCents, differenceCents: moneyCents - receivableCents };
}
