/**
 * Liens « Connexion » et « Créer un compte » des pages publiques : tout droit vers le Compte Lead,
 * sans passer par /login ou /signup (une page de plus, vide, le temps de repartir). Liens simples,
 * jamais préchargés : un préchargement ouvrirait une demande de connexion à lui seul.
 */
export function leadLoginHref(locale: string, signup = false): string {
  return `/auth/lead/start?${new URLSearchParams({ locale, ...(signup ? { signup: "1" } : {}) })}`;
}
