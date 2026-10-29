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
