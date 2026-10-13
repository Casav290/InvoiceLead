/**
 * Adresses d'entrée d'InvoiceLead (règle commune de la famille Lead, « passer d'une application à
 * l'autre ») : la racine tapée (« / », « /fr », « /?lang=fr ») et /login sans langue. Une personne déjà
 * connectée au Compte Lead (ERPlead) arrive tout droit dans l'espace de son entreprise, sans écran ;
 * déconnectée, elle voit la page publique après un seul essai silencieux (OpenID Connect
 * `prompt=none`), jamais un écran d'erreur ni une boucle.
 *
 * Sans dépendance au serveur : le proxy s'en sert, les tests aussi.
 */
import { PROBE_COOKIE, SESSION_COOKIE } from "./cookies";

const LOCALES = ["de", "fr", "en"] as const;
type Locale = (typeof LOCALES)[number];

/** Racine du site : « / », « /fr », « /fr/ ». */
const HOME = /^\/(?:(de|fr|en)\/?)?$/i;
/** Adresse d'entrée des lanceurs de la famille, sans langue : « /login ». */
const LOGIN = /^\/login\/?$/i;

/**
 * Robots d'indexation et aperçus de liens : jamais d'essai silencieux, la page publique telle quelle.
 * Même liste dans toute la famille (HeadlessChrome n'en fait pas partie).
 */
export const BOT_UA =
  /(bot|crawler|spider|slurp|facebookexternalhit|embedly|whatsapp|skypeuripreview)/i;

/**
 * Page d'où part un essai silencieux, retrouvée s'il échoue : un chemin de ce site (racine, page
 * publique ou de l'application), avec sa recherche. Jamais une autre adresse (« // », « \ »), ni
 * d'espace, de « # », de guillemet ou de chevron.
 */
const FROM_PATH =
  /^\/(?:(?:de|fr|en)(?:\/[A-Za-z0-9_\-/]*)?)?(?:\?[A-Za-z0-9=&%._~+,:;!$'()*@/?|-]*)?$/;
export const FROM_MAX = 300;

export function safeFrom(value: string | null | undefined): string | undefined {
  if (!value || value.length > FROM_MAX || value.includes("//")) return undefined;
  return FROM_PATH.test(value) ? value : undefined;
}

/** Langue donnée par l'adresse (« /fr », « ?lang=fr »), ou undefined : l'arrivée prend celle du Compte Lead. */
export function addressLocale(pathLocale: string | undefined, search: string): Locale | undefined {
  const wanted = (pathLocale ?? new URLSearchParams(search).get("lang") ?? "").toLowerCase();
  return (LOCALES as readonly string[]).includes(wanted) ? (wanted as Locale) : undefined;
}

/** Ce que le proxy voit d'une requête. */
export type EntryRequest = {
  method: string;
  /** Chemin décodé (« /de/%61pp » est « /de/app » pour le routeur). */
  pathname: string;
  /** Recherche telle que reçue (« ?lang=fr »), ou "". */
  search: string;
  header: (name: string) => string | null;
  hasCookie: (name: string) => boolean;
};

export type EntryRedirect = { status: 303 | 307; location: string };

/**
 * Préchargement ou lecture du routeur de Next (en-tête RSC) : jamais suivi d'un départ vers le Compte
 * Lead, qui lancerait une connexion en arrière-plan.
 */
function prefetch(header: EntryRequest["header"]): boolean {
  return (
    header("rsc") !== null ||
    header("next-router-prefetch") !== null ||
    header("x-middleware-prefetch") !== null ||
    /prefetch|prerender/i.test(`${header("purpose") ?? ""} ${header("sec-purpose") ?? ""}`)
  );
}

/** Vraie navigation de document : la personne ouvre l'adresse (lien, barre d'adresse, favori). */
function documentNavigation(header: EntryRequest["header"]): boolean {
  return header("sec-fetch-mode") === "navigate" && header("sec-fetch-dest") === "document";
}

/**
 * Redirection d'une adresse d'entrée, ou null (le proxy continue comme avant).
 *
 * - Racine avec une session InvoiceLead : départ vers /auth/lead/start, qui vérifie la session et
 *   ouvre l'accueil de l'espace (`/xx/app`, langue de l'adresse ou du Compte Lead). Le départ, et non
 *   un renvoi direct vers /xx/app : une session fermée depuis par le Compte Lead (déconnexion de
 *   partout) mène alors à la page publique, pas à l'écran de connexion.
 * - Racine sans session : un seul essai silencieux, à cinq conditions (GET, vraie navigation de
 *   document, pas de préchargement, pas de cookie lead_probe, pas un robot ; InvoiceLead n'a pas
 *   d'application native). Le départ pose lead_probe : le retour sur la racine montre la page publique.
 * - /login sans langue : départ vers le Compte Lead, sans écran s'il est ouvert ; l'arrivée est dans
 *   la langue du Compte Lead, jamais celle du navigateur.
 */
export function entryRedirect(request: EntryRequest): EntryRedirect | null {
  const { header } = request;
  if (request.method !== "GET" || prefetch(header)) return null;

  if (LOGIN.test(request.pathname)) {
    // La page demandée (?next) suit ; le départ la vérifie (safeNext).
    const next = new URLSearchParams(request.search).get("next");
    return {
      status: 303,
      location: `/auth/lead/start${next ? `?${new URLSearchParams({ next })}` : ""}`,
    };
  }

  const home = HOME.exec(request.pathname);
  if (!home) return null;
  if (BOT_UA.test(header("user-agent") ?? "")) return null;
  const locale = addressLocale(home[1], request.search);
  const from =
    safeFrom(`${request.pathname}${request.search}`) ?? safeFrom(request.pathname) ?? "/";
  const query = new URLSearchParams({ prompt: "none", from, ...(locale ? { locale } : {}) });
  if (request.hasCookie(SESSION_COOKIE))
    return { status: 307, location: `/auth/lead/start?${query}` };
  if (request.hasCookie(PROBE_COOKIE) || !documentNavigation(header)) return null;
  return { status: 303, location: `/auth/lead/start?${query}` };
}

/**
 * Échecs d'un essai silencieux (`prompt=none`) : le Compte Lead n'a pas de session ouverte, ou il
 * voudrait montrer un écran. Ils ne viennent que d'un essai silencieux : retour sur la page d'où il
 * part, sans écran d'erreur ni nouvel essai.
 */
export const SILENT_ERRORS = [
  "login_required",
  "interaction_required",
  "consent_required",
  "account_selection_required",
] as const;

export function silentError(error: string | null | undefined): boolean {
  return (SILENT_ERRORS as readonly string[]).includes(error ?? "");
}
