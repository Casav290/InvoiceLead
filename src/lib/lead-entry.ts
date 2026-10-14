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

/**
 * Marque d'un essai silencieux déjà fait, dans l'adresse de retour (« ?lead_probe=1 ») : le cookie
 * lead_probe ne suffit pas quand le navigateur refuse les cookies (rien n'est gardé, et la racine
 * repartirait vers le Compte Lead à chaque chargement). Avec cette marque, la racine montre la page
 * publique et le départ silencieux revient tout de suite, même sans aucun cookie. Rien de secret.
 * Elle n'est ajoutée que si le cookie lead_probe n'est pas revenu (silentReturn) : un navigateur
 * ordinaire garde une adresse propre (« /fr »).
 */
export const PROBE_PARAM = "lead_probe";

/** La recherche (« ?lang=fr&lead_probe=1 ») ou l'adresse porte-t-elle la marque ? */
export function hasProbeMarker(searchOrPath: string | null | undefined): boolean {
  const value = searchOrPath ?? "";
  const at = value.indexOf("?");
  const search = at >= 0 ? value.slice(at + 1) : value;
  return new URLSearchParams(search).has(PROBE_PARAM);
}

/** La page de retour d'un essai silencieux manqué, avec la marque (les autres paramètres restent). */
export function withProbeMarker(path: string): string {
  if (hasProbeMarker(path.includes("?") ? path : "")) return path;
  return `${path}${path.includes("?") ? "&" : "?"}${PROBE_PARAM}=1`;
}

/**
 * Page de retour d'un essai silencieux manqué ou déjà fait. Le cookie lead_probe est revenu avec la
 * requête : il suffit à arrêter l'essai suivant, l'adresse reste telle quelle. Sinon (cookies refusés,
 * ou demande perdue) : la marque dans l'adresse, seule garde contre une boucle.
 */
export function silentReturn(from: string, probeCookie: boolean): string {
  return probeCookie ? from : withProbeMarker(from);
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

/**
 * Réponse du proxy à une adresse d'entrée : une redirection, ou 204 sans contenu pour un préchargement
 * du navigateur (voir browserPrefetch).
 */
export type EntryResponse = { status: 303 | 307; location: string } | { status: 204 };

/**
 * Lecture ou préchargement du routeur de Next (lien interne) : jamais suivi d'un départ vers le Compte
 * Lead, qui lancerait une connexion en arrière-plan. Next sert la page telle quelle.
 */
function nextRouter(header: EntryRequest["header"]): boolean {
  return (
    header("rsc") !== null ||
    header("next-router-prefetch") !== null ||
    header("x-middleware-prefetch") !== null
  );
}

/**
 * Préchargement du navigateur (« Sec-Purpose: prefetch;prerender », « Purpose: prefetch ») : Chrome
 * précharge l'adresse qu'on tape quand il devine qu'on va l'ouvrir, et montre cette page à l'appui sur
 * Entrée. Une adresse d'entrée n'y répond ni par une page (la page publique ou l'écran de connexion
 * resteraient affichés à la place de l'espace) ni par un départ vers le Compte Lead : 204 sans
 * contenu ni cache, que Chrome abandonne ; la vraie navigation applique ensuite la règle d'entrée.
 */
function browserPrefetch(header: EntryRequest["header"]): boolean {
  return /prefetch|prerender/i.test(`${header("purpose") ?? ""} ${header("sec-purpose") ?? ""}`);
}

const NO_CONTENT = { status: 204 } as const;

/** Vraie navigation de document : la personne ouvre l'adresse (lien, barre d'adresse, favori). */
function documentNavigation(header: EntryRequest["header"]): boolean {
  return header("sec-fetch-mode") === "navigate" && header("sec-fetch-dest") === "document";
}

/**
 * Redirection d'une adresse d'entrée (ou 204 pour un préchargement du navigateur), ou null (le proxy
 * continue comme avant).
 *
 * - Racine avec une session InvoiceLead : départ vers /auth/lead/start, qui vérifie la session et
 *   ouvre l'accueil de l'espace (`/xx/app`, langue de l'adresse ou du Compte Lead). Le départ, et non
 *   un renvoi direct vers /xx/app : une session fermée depuis par le Compte Lead (déconnexion de
 *   partout) mène alors à la page publique, pas à l'écran de connexion.
 * - Racine sans session : un seul essai silencieux, à six conditions (GET, vraie navigation de
 *   document, pas de préchargement, pas de cookie lead_probe, pas de marque « lead_probe » dans
 *   l'adresse, pas un robot ; InvoiceLead n'a pas d'application native). Le départ pose lead_probe ;
 *   si le cookie ne revient pas (cookies refusés), le retour porte la marque : la racine montre la page
 *   publique dans les deux cas.
 * - /login sans langue : départ vers le Compte Lead, sans écran s'il est ouvert ; l'arrivée est dans
 *   la langue du Compte Lead, jamais celle du navigateur.
 * - Préchargement du navigateur de la racine ou de /login (pas d'un robot) : 204, avec ou sans
 *   session ; la page publique préchargée serait sinon montrée à la place de l'espace.
 */
export function entryRedirect(request: EntryRequest): EntryResponse | null {
  const { header } = request;
  if (request.method !== "GET" || nextRouter(header)) return null;

  if (LOGIN.test(request.pathname)) {
    if (browserPrefetch(header)) return NO_CONTENT;
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
  if (browserPrefetch(header)) return NO_CONTENT;
  const locale = addressLocale(home[1], request.search);
  const from =
    safeFrom(`${request.pathname}${request.search}`) ?? safeFrom(request.pathname) ?? "/";
  const query = new URLSearchParams({ prompt: "none", from, ...(locale ? { locale } : {}) });
  if (request.hasCookie(SESSION_COOKIE))
    return { status: 307, location: `/auth/lead/start?${query}` };
  // Essai déjà fait : cookie lead_probe, ou marque dans l'adresse (cookies refusés). Page publique.
  if (
    request.hasCookie(PROBE_COOKIE) ||
    hasProbeMarker(request.search) ||
    !documentNavigation(header)
  )
    return null;
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
