/** Noms des cookies, partagés entre le proxy et le serveur. */
export const SESSION_COOKIE = "il_session";
export const LOGIN_COOKIE = "il_lead_login";
export const LOGIN_COOKIE_PATH = "/auth/lead";

/** En-tête posé par le proxy : la page de l'application demandée, pour y revenir après une reconnexion. */
export const REQUESTED_PATH_HEADER = "x-il-requested-path";
