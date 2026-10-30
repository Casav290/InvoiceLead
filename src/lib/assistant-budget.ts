/**
 * Mois où l'assistant IA de la formule gratuite revient (« novembre », « November »), dans la langue
 * de l'interface : `resetOn` est le 1er du mois suivant (« AAAA-MM-01 », UTC, src/server/plans.ts).
 * Même texte dans la bulle et sur la page Assistant.
 */
export function budgetMonth(resetOn: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { month: "long", timeZone: "UTC" }).format(
    new Date(`${resetOn}T00:00:00Z`),
  );
}

/** Ce que la bulle et la page Assistant montrent de la formule gratuite (BudgetView, src/server/plans.ts). */
export type SharedBudget = { left: number; exhausted: boolean; resetOn: string; requests: number };

const BUDGET_EVENT = "invoicelead:assistant-budget";

/**
 * La bulle et la boîte de la page Assistant consomment le même budget : chacune annonce le compteur que
 * le serveur lui rend après un tour, l'autre le reprend aussitôt dans le même onglet (sans recharger la
 * page). Sur l'écran Assistant, les deux compteurs disent donc la même chose, et la bulle se ferme
 * quand la boîte atteint le budget.
 */
export function shareBudget(budget: SharedBudget): void {
  window.dispatchEvent(new CustomEvent<SharedBudget>(BUDGET_EVENT, { detail: budget }));
}

/** Écoute le compteur annoncé par l'autre ; rend la fonction qui arrête l'écoute. */
export function onSharedBudget(fn: (budget: SharedBudget) => void): () => void {
  const listener = (e: Event) => fn((e as CustomEvent<SharedBudget>).detail);
  window.addEventListener(BUDGET_EVENT, listener);
  return () => window.removeEventListener(BUDGET_EVENT, listener);
}
