/** Noms des cookies, partagés entre le proxy et le serveur. */
export const SESSION_COOKIE = "il_session";
export const LOGIN_COOKIE = "il_lead_login";

/**
 * Page à rouvrir une fois la déconnexion du Compte Lead finie : l'invitation de fiduciaire quittée
 * par « Changer de compte » (mauvaise adresse). Le Compte Lead ramène toujours à l'accueil (`/`) ;
 * le proxy y reprend cette page, une seule fois. Seule une adresse d'invitation est suivie.
 */
export const AFTER_LOGOUT_COOKIE = "il_after_logout";
export const AFTER_LOGOUT_PATH = /^\/(de|fr|en)\/invite\?token=[A-Za-z0-9_-]{20,100}$/;

/**
 * Cookie d'une demande de connexion, propre à cette demande (son `state`) : deux onglets qui se
 * connectent en même temps ne s'écrasent plus l'un l'autre.
 */
export function loginCookieName(state: string): string {
  return /^[A-Za-z0-9_-]{12,}$/.test(state)
    ? `${LOGIN_COOKIE}_${state.slice(0, 16)}`
    : LOGIN_COOKIE;
}
export const LOGIN_COOKIE_PATH = "/auth/lead";

/** En-tête posé par le proxy : la page de l'application demandée, pour y revenir après une reconnexion. */
export const REQUESTED_PATH_HEADER = "x-il-requested-path";
