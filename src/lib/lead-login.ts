/**
 * Liens « Connexion » et « Créer un compte » des pages publiques : tout droit vers le Compte Lead,
 * sans passer par /login ou /signup (une page de plus, vide, le temps de repartir). Liens simples,
 * jamais préchargés : un préchargement ouvrirait une demande de connexion à lui seul.
 *
 * `back` : la page ou l'invitation à retrouver après la connexion (`{ next }` ou `{ invite }`), sur
 * l'écran d'erreur de la connexion : tous ses liens y ramènent, pas seulement son bouton.
 */
export function leadLoginHref(
  locale: string,
  signup = false,
  back: Record<string, string> = {},
): string {
  return `/auth/lead/start?${new URLSearchParams({ locale, ...(signup ? { signup: "1" } : {}), ...back })}`;
}
