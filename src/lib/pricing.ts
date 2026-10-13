/**
 * Les trois formules d'InvoiceLead telles que les montrent la page Tarifs et la page Formule. Prix
 * hors TVA, en euros (src/server/billing/stripe.ts, PRICES) ; l'année vaut dix mois.
 */
export const PRICE_CARDS = [
  { key: "free", plan: null, monthly: 0, yearly: null, highlighted: false },
  { key: "pro", plan: "pro", monthly: 19, yearly: 190, highlighted: false },
  { key: "proPlus", plan: "pro_plus", monthly: 39, yearly: 390, highlighted: true },
] as const;

export type PriceCardKey = (typeof PRICE_CARDS)[number]["key"];

/**
 * Lignes sans étiquette « Bientôt » (index dans pricing.plans.*.features) : fonctions déjà
 * disponibles et limites de la formule, décidées le 1er octobre 2026 (docs/PLAN.md, section 9).
 * En Pro+, plusieurs sociétés, la connexion bancaire directe, eBill, l'archivage GeBüV et le
 * support prioritaire restent à venir.
 */
export const AVAILABLE: Record<PriceCardKey, number[]> = {
  free: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
  pro: [0, 1, 2, 3, 4, 5, 6, 7],
  proPlus: [0, 1, 2],
};

/** « 19 € », « 190 € » : les montants entiers de la page Tarifs. */
export const euros = (n: number) => `${n} €`;
