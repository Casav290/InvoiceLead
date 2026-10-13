/**
 * La formule telle que le Compte Lead (ERPlead) la donne dans `claims.lead.plan` : table plans
 * d'ERPlead, rangs 0, 10 et 20, une place en Pro, cinq en Pro+. `tier` : 0 Gratuit, 1 Pro, 2 Pro+.
 */
export function leadPlan(tier: number) {
  const plans = [
    { code: "free", name: "Gratuit", rank: 0, seats: 1 },
    { code: "pro", name: "Pro", rank: 10, seats: 1 },
    { code: "pro_plus", name: "Pro+", rank: 20, seats: 5 },
  ] as const;
  const plan = plans[tier];
  if (!plan) throw new Error(`formule inconnue : ${tier}`);
  return { ...plan };
}
