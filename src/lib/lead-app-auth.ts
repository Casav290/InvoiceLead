/**
 * « Continuer avec Google » dans l'app Android / iOS d'InvoiceLead (30.10.2026, révisé le même jour :
 * liens VÉRIFIÉS, choix d'Ève). Contrat d'ERPlead : ~/projets/erplead-google-app/docs/GOOGLE-APP.md ; ce
 * qui en revient à InvoiceLead : docs/GOOGLE-APP.md.
 *
 * Google refuse sa connexion dans une vue web (« disallowed_useragent »). Dans l'app (coque Capacitor
 * qui ouvre https://invoicelead.io), le bouton Google de l'écran du Compte Lead mène donc à la page
 * relais d'InvoiceLead (`/lead-auth/google?start&back`), qui ouvre `start` dans le navigateur sûr du
 * téléphone : sur iOS 17.4+, le module natif `LeadAuthSession` (ASWebAuthenticationSession avec retour
 * https, `&m=auto`) ; sur iOS 15 à 17.3 ou si la session échoue, Safari (`&m=tap` : ERPlead finit sur
 * une page à bouton) ; sur Android, un Custom Tab (`Browser.open`, `&m=auto`). La connexion Google
 * finie, ERPlead rend la main à l'app par SON lien https réservé par Apple et Google :
 * `https://invoicelead.io/lead-auth/return?code=…` (Universal Link, App Link vérifié, ou adresse rendue
 * par la session iOS). Le code de l'app, sur toutes ses pages, ferme le Custom Tab (Android) et mène la
 * vue web au rachat d'ERPlead (`/auth/google/app/redeem?code=…`), qui ouvre la session (preuve : le
 * cookie HttpOnly de la vue web, qu'InvoiceLead ne lit jamais) et reprend la connexion de l'app comme
 * après un mot de passe. Plus aucun schéma propre (`io.invoicelead.app://…`) n'est accepté.
 *
 * Un lien n'est suivi que pendant une connexion Google EN COURS : la page relais de cette vue web l'attend
 * (navigateur ouvert), ou une connexion notée par une page relais il y a moins de 15 min (app relancée par
 * son lien). Tout autre lien (page web, courriel, code QR, autre app, ancien lien que la coque redonne par
 * getLaunchUrl) ne fait rien : ni navigateur fermé, ni page quittée. Sur la page relais, le lien de
 * lancement est toujours d'avant ce départ (ERPlead vient de remplacer le cookie verifier) : jamais suivi.
 *
 * Tout ici est sans dépendance (ni React, ni Next, ni DOM réel) : les composants de
 * components/native/LeadAppAuth.tsx le branchent sur `window`, les tests sur un faux pont Capacitor.
 * Hors de l'app (aucun pont Capacitor natif), rien ne s'installe et rien ne change.
 */

/**
 * Le site de l'app en production, ÉCRIT ICI (jamais lu du serveur ni d'une variable) : c'est le domaine
 * associé à l'app par Apple (apple-app-site-association) et Google (assetlinks.json), liste fermée d'ERPlead.
 */
export const APP_ORIGIN = "https://invoicelead.io";
/** Chemin du lien de retour (fixe, contrat d'ERPlead) ; la même adresse sert la page de repli. */
export const RETURN_PATH = "/lead-auth/return";
/** Le lien de retour : `https://invoicelead.io/lead-auth/return`. */
export const RETURN_URL = `${APP_ORIGIN}${RETURN_PATH}`;
/** Seul lien accepté : le lien de retour suivi de ses paramètres (`code` ou `error`, et `locale`). */
export const RETURN_PREFIX = `${RETURN_URL}?`;
/** La page relais, sans langue, telle qu'ERPlead la nomme (APP_LINKS d'ERPlead). */
export const RELAY_PATH = "/lead-auth/google";
/** Un code de transfert d'ERPlead : 32 octets en base64url. */
export const CODE_PATTERN = /^[A-Za-z0-9_-]{43}$/;
/**
 * Navigateur du téléphone refermé sans lien de retour : délai avant de rouvrir l'écran de connexion.
 * Sur Android, la fermeture de l'onglet peut être annoncée juste avant le lien de retour.
 */
export const FINISHED_GRACE_MS = 1500;
/** Lecture du lien de lancement : au-delà, l'écran de connexion de l'app part comme avant. */
export const LAUNCH_TIMEOUT_MS = 1500;
/** L'écran de connexion d'ERPlead à rouvrir si la personne abandonne (gardé par la page relais). */
export const BACK_KEY = "invoicelead.leadAuth.back";
/**
 * Empreintes des liens AVEC CODE déjà vus (getLaunchUrl rend le même lien à chaque page), sans échéance.
 * Le lien d'erreur (`?error=expired`) est toujours le même : jamais gardé, sinon la deuxième demande
 * expirée ne ramènerait plus à l'écran de connexion.
 */
export const SEEN_KEY = "invoicelead.leadAuth.seen";
const SEEN_MAX = 20;
/**
 * Connexion Google en cours, notée par la page relais juste avant d'ouvrir le navigateur du téléphone
 * (localStorage : l'app relancée par son lien la retrouve) : `{ t, stale, s, m }`, l'heure, l'empreinte
 * du lien de lancement de la page relais (ancien lien, jamais pris pour le retour de cette connexion),
 * l'empreinte de son départ (`start`) et la façon dont le navigateur a été ouvert : `auto` (session iOS
 * 17.4+), `tap` (navigateur par défaut d'iOS), `tab` (Custom Tab Android). Départ et façon servent à la
 * MÊME page relais rechargée (iOS : processus de la vue web tué, Capacitor recharge son adresse) : elle
 * garde la connexion et ne rouvre jamais le départ, à usage unique.
 */
export const PENDING_KEY = "invoicelead.leadAuth.pending";
/** Au-delà, ERPlead refuserait le code (départ et cookie verifier : 10 min) : plus rien n'est attendu. */
export const PENDING_TTL_MS = 15 * 60 * 1000;
const URL_MAX = 4096;

/** L'émetteur du Compte Lead (LEAD_ID_ISSUER, ex. https://erplead.io), sans « / » final, ou null. */
export function issuerOrigin(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const u = new URL(value);
    const local = u.hostname === "localhost" || u.hostname === "127.0.0.1";
    if (u.protocol !== "https:" && !(u.protocol === "http:" && local)) return null;
    if (u.pathname !== "/" || u.search || u.hash || u.username || u.password) return null;
    return u.origin;
  } catch {
    return null;
  }
}

export type ReturnLink = { kind: "code"; code: string } | { kind: "error" };

/**
 * Le lien de retour de l'app, ou null pour tout autre lien (schéma propre `io.invoicelead.app://…`,
 * ancien `io.crmlead.app://sso`, autre hôte, autre chemin, autre page du site) : ceux-là sont ignorés.
 * Un lien de retour sans code valable (`error=expired`, code abîmé) rend `{ kind: "error" }` : retour à
 * l'écran de connexion.
 */
export function parseReturnLink(url: unknown): ReturnLink | null {
  if (typeof url !== "string" || url.length > URL_MAX || !url.startsWith(RETURN_PREFIX))
    return null;
  const query = url.slice(RETURN_PREFIX.length).split("#")[0] ?? "";
  const code = new URLSearchParams(query).get("code");
  return code !== null && CODE_PATTERN.test(code) ? { kind: "code", code } : { kind: "error" };
}

/** Le rachat d'ERPlead, dans la vue web (navigation de premier niveau, le cookie verifier part avec). */
export function redeemUrl(issuer: string, code: string): string {
  if (!CODE_PATTERN.test(code)) throw new Error("code de transfert mal formé");
  return `${issuer}/auth/google/app/redeem?code=${code}`;
}

/** Une adresse d'ERPlead qui commence par `<émetteur><chemin>?`, telle qu'ERPlead l'écrit. */
function fromIssuer(issuer: string, value: unknown, path: string): value is string {
  if (typeof value !== "string" || value.length > URL_MAX) return false;
  if (!value.startsWith(`${issuer}${path}?`)) return false;
  // Ni espace, ni guillemet, ni chevron, ni barre oblique inverse.
  if (/[\s"'<>\\`]/.test(value)) return false;
  try {
    return new URL(value).origin === issuer;
  } catch {
    return false;
  }
}

/**
 * `start` et `back` de la page relais, s'ils viennent bien d'ERPlead : `start` est son départ vers
 * Google (`<émetteur>/auth/google/app/start?…`, sans mode : c'est l'app qui l'ajoute), `back` son écran de
 * connexion (`<émetteur>/login?…`). Sinon null : rien n'est ouvert (ni navigateur, ni adresse étrangère).
 */
export function relayTargets(
  issuer: string | null,
  start: unknown,
  back: unknown,
): { start: string; back: string } | null {
  if (!issuer || !fromIssuer(issuer, start, "/auth/google/app/start")) return null;
  if (new URL(start).searchParams.has("m")) return null;
  if (!fromIssuer(issuer, back, "/login")) return null;
  return { start, back };
}

/**
 * Le départ avec la façon dont l'app ouvre le navigateur (`m`, noté par ERPlead dans l'état Google) :
 * `auto` (session iOS 17.4+, Custom Tab Android : ERPlead finit par une redirection vers le lien de
 * retour) ou `tap` (Safari : ERPlead finit par une page à bouton, seul un lien touché ouvre l'app).
 */
export function withMode(start: string, mode: "auto" | "tap"): string {
  return `${start}&m=${mode}`;
}

/** La connexion ordinaire de l'app (départ vers le Compte Lead), dans la langue donnée. */
export function loginFallback(locale?: string | null): string {
  return locale && /^[a-z]{2}$/.test(locale)
    ? `/auth/lead/start?${new URLSearchParams({ locale })}`
    : "/auth/lead/start";
}

// ------------------------------------------------------------------ pont Capacitor

type Handle = unknown;
/**
 * Module natif iOS de l'app (`LeadAuthSession`, dépôt mobile, ios/App/App/LeadAuthSession.swift) :
 * ASWebAuthenticationSession avec retour https (iOS 17.4+) ; l'hôte et le chemin du retour sont écrits
 * dans le code Swift. Refus : `code` = canceled, unavailable, busy, bad_url, failed.
 */
export type LeadAuthSessionPlugin = {
  isAvailable?: () => Promise<{ https?: boolean } | null | undefined>;
  start?: (o: { url: string }) => Promise<{ url?: string } | null | undefined>;
  /**
   * Facultatif (contrat § 1 ; présent dans le module d'InvoiceLead 1.0.2) : l'issue de la session de ce
   * même départ, pour la page relais rechargée ; refus `none` s'il n'y a rien à reprendre. N'ouvre jamais rien.
   */
  resume?: (o: { url: string }) => Promise<{ url?: string } | null | undefined>;
  openExternal?: (o: { url: string }) => Promise<{ opened?: boolean } | null | undefined>;
};
/** Ce que le pont natif de Capacitor met dans la page (window.Capacitor, sans paquet npm). */
export type CapacitorBridge = {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
  Plugins?: {
    App?: {
      addListener?: (event: "appUrlOpen", cb: (e: { url?: string } | undefined) => void) => Handle;
      getLaunchUrl?: () => Promise<{ url?: string } | null | undefined>;
    };
    Browser?: {
      open?: (o: { url: string }) => Promise<unknown>;
      close?: () => Promise<unknown>;
      addListener?: (event: "browserFinished", cb: () => void) => Handle;
    };
    LeadAuthSession?: LeadAuthSessionPlugin;
  };
};
type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;
/** Ce que ce module lit de `window`. */
export type AppWindow = {
  Capacitor?: CapacitorBridge;
  location: { replace: (url: string) => void; pathname?: string; search?: string };
  localStorage?: StorageLike;
  sessionStorage?: StorageLike;
  setTimeout: (fn: () => void, ms: number) => unknown;
  /** L'horloge (essais) ; sinon Date.now. */
  now?: () => number;
  __invoiceleadLeadAuth?: ListenerState;
};
/**
 * D'où vient un lien : `open` (appUrlOpen, ou adresse rendue par la session iOS), `launch` (lien de
 * lancement), `page` (adresse de la page de retour ouverte par la vue web elle-même).
 */
type Via = "open" | "launch" | "page";
type ListenerState = {
  ready: Promise<boolean>;
  /** Un lien a été suivi : la page part (rachat ou écran de connexion). */
  received: boolean;
  /** Page relais : son lien de lancement est d'avant ce départ, jamais suivi. */
  relay: boolean;
  /**
   * La même page relais, rechargée pendant sa connexion (même départ, connexion fraîche) : son lien de
   * lancement peut être le retour attendu (sauf l'ancien noté), et rien n'est rouvert.
   */
  again: boolean;
  /** La page relais a ouvert le navigateur du téléphone et attend le lien de retour. */
  armed: boolean;
  /** Empreinte du lien de l'app rendu par getLaunchUrl à ce chargement, s'il y en a un. */
  launchKey: string | null;
  /** Le traitement d'un lien (§ 3b du contrat), posé dans l'app seulement ; true s'il a été suivi. */
  follow: ((url: unknown, via: Via) => boolean) | null;
};

/** Les modules natifs de l'app (App, Browser, LeadAuthSession), seulement dans l'app : le pont dit « natif ». */
export function nativePlugins(win: AppWindow): NonNullable<CapacitorBridge["Plugins"]> | null {
  try {
    const cap = win.Capacitor;
    if (!cap || typeof cap.isNativePlatform !== "function" || cap.isNativePlatform() !== true)
      return null;
    return cap.Plugins ?? null;
  } catch {
    return null;
  }
}

/** La plateforme de l'app (« ios », « android »), ou null. */
export function platformOf(win: AppWindow): string | null {
  try {
    const p = win.Capacitor?.getPlatform?.();
    return typeof p === "string" ? p : null;
  } catch {
    return null;
  }
}

function storage(win: AppWindow, kind: "localStorage" | "sessionStorage"): StorageLike | null {
  try {
    return win[kind] ?? null;
  } catch {
    return null;
  }
}

/** Empreinte courte (FNV-1a, 32 bits) : le code lui-même n'est jamais gardé. */
export function fingerprint(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

const memorySeen = new WeakMap<AppWindow, Set<string>>();
function seenList(win: AppWindow): string[] {
  try {
    const raw = storage(win, "localStorage")?.getItem(SEEN_KEY);
    const list: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}
/** Marque un lien avec code comme vu ; rend false s'il l'était déjà (cette page ou une précédente). */
function firstTime(win: AppWindow, key: string): boolean {
  const memory = memorySeen.get(win) ?? new Set<string>();
  memorySeen.set(win, memory);
  const stored = seenList(win);
  if (memory.has(key) || stored.includes(key)) return false;
  memory.add(key);
  try {
    storage(win, "localStorage")?.setItem(
      SEEN_KEY,
      JSON.stringify([...stored, key].slice(-SEEN_MAX)),
    );
  } catch {
    // Stockage refusé : la mémoire de la page suffit à cette page.
  }
  return true;
}

const clock = (win: AppWindow) => (typeof win.now === "function" ? win.now() : Date.now());
/** Façon d'ouvrir le navigateur sûr : session iOS (`auto`), navigateur par défaut iOS (`tap`), Custom Tab (`tab`). */
type OpenMode = "auto" | "tap" | "tab";
type Pending = { t: number; stale: string | null; s: string | null; m: OpenMode | null };
const shortText = (x: unknown) => (typeof x === "string" && x.length <= 40 ? x : null);
/** La connexion Google en cours (moins de PENDING_TTL_MS), ou null. */
function readPending(win: AppWindow): Pending | null {
  try {
    const raw = storage(win, "localStorage")?.getItem(PENDING_KEY);
    const v: unknown = raw ? JSON.parse(raw) : null;
    if (!v || typeof v !== "object") return null;
    const { t, stale, s, m } = v as { t?: unknown; stale?: unknown; s?: unknown; m?: unknown };
    const age = typeof t === "number" ? clock(win) - t : Number.NaN;
    if (!(age >= 0 && age < PENDING_TTL_MS)) return null;
    return {
      t: t as number,
      stale: shortText(stale),
      s: shortText(s),
      m: m === "auto" || m === "tap" || m === "tab" ? m : null,
    };
  } catch {
    return null;
  }
}
function writePending(win: AppWindow, pending: Pending): void {
  try {
    storage(win, "localStorage")?.setItem(PENDING_KEY, JSON.stringify(pending));
  } catch {
    // Sans stockage : seule la page relais (en mémoire) attend le lien.
  }
}
function clearPending(win: AppWindow): void {
  try {
    storage(win, "localStorage")?.removeItem(PENDING_KEY);
  } catch {
    // rien à effacer
  }
}

/** La page relais (`/<langue>/lead-auth/google`) ? */
export function isRelayPath(pathname: unknown): boolean {
  return typeof pathname === "string" && /^(?:\/[a-z]{2})?\/lead-auth\/google\/?$/.test(pathname);
}

/** Le départ `start` de l'adresse de la page relais (gardé dans l'adresse, aucun replaceState), ou null. */
function addressStart(win: AppWindow): string | null {
  try {
    const search = typeof win.location.search === "string" ? win.location.search : "";
    return new URLSearchParams(search).get("start");
  } catch {
    return null;
  }
}

/**
 * La connexion en cours, si la page relais est la MÊME, rechargée pendant cette connexion (iOS :
 * webViewWebContentProcessDidTerminate → bridge.reset() puis webView.reload(), même adresse) : connexion
 * fraîche notée avec l'empreinte de ce même départ. ERPlead fait un départ neuf, à usage unique, à chaque
 * « Continuer avec Google » : une autre page relais (autre départ) est toujours une nouvelle connexion.
 */
function reloadedConnection(win: AppWindow, start: string | null): Pending | null {
  const pending = readPending(win);
  return start && pending?.s === fingerprint(start) ? pending : null;
}

/**
 * La page devient page relais (dès la pose de l'écoute, avant tout lien) : rechargée pendant sa
 * connexion, celle-ci reste en cours ; sinon, ERPlead vient de remplacer le cookie verifier et une
 * connexion notée avant ne peut plus aboutir (son code serait refusé et brûlerait ce nouveau départ) :
 * effacée.
 */
function enterRelay(win: AppWindow, state: ListenerState): void {
  state.relay = true;
  state.again = reloadedConnection(win, addressStart(win)) !== null;
  if (!state.again) clearPending(win);
}

/** L'écran de connexion gardé par la page relais (vérifié de nouveau à la lecture), puis oublié. */
function takeBack(win: AppWindow, issuer: string): string | null {
  const s = storage(win, "sessionStorage");
  try {
    const back = s?.getItem(BACK_KEY) ?? null;
    s?.removeItem(BACK_KEY);
    return fromIssuer(issuer, back, "/login") ? back : null;
  } catch {
    return null;
  }
}

function quietly(run: (() => unknown) | undefined): void {
  try {
    const out = run?.();
    if (out && typeof (out as Promise<unknown>).catch === "function")
      (out as Promise<unknown>).catch(() => {});
  } catch {
    // Android : souvent rien à fermer.
  }
}

/**
 * Écoute du lien de retour, à installer au démarrage de chaque page de l'app : `appUrlOpen` (Universal
 * Link ou App Link, app ouverte ou en arrière-plan) et `getLaunchUrl` (app relancée par le lien). Une
 * seule fois par page (les appels suivants rendent la même promesse). Un lien n'est suivi que s'il est
 * ATTENDU : reçu par `appUrlOpen` (ou rendu par la session iOS) sur la page relais qui a ouvert le
 * navigateur, ou pendant une connexion notée il y a moins de 15 min (jamais le lien de lancement de la
 * page relais, ni celui qu'elle a noté comme ancien). Alors : connexion effacée, `Browser.close()` sur
 * Android (erreur ignorée), puis le rachat d'ERPlead avec le code, ou l'écran de connexion. Un lien avec
 * code n'est jamais suivi deux fois, toutes pages confondues ; un lien inattendu ne fait rien. Rend une
 * promesse, une fois le lien de lancement lu (au plus LAUNCH_TIMEOUT_MS) : true si un lien a mené
 * ailleurs (la page ne doit plus rien faire), false sinon (hors de l'app, aucun lien, autre lien). Ce
 * lien peut être celui de `appUrlOpen` : l'app relancée par son lien (Android : activité neuve ; iOS : app
 * terminée par le système), Capacitor garde l'évènement (`retainUntilConsumed`) et le livre à la
 * première écoute, AVANT de répondre à getLaunchUrl (appels natifs traités dans l'ordre) ; le lien de
 * lancement, le même, est alors déjà vu (ou absent).
 */
export function listenForReturn(
  win: AppWindow,
  opts: { issuer: string | null | undefined; locale?: string | null; relay?: boolean },
): Promise<boolean> {
  const existing = win.__invoiceleadLeadAuth;
  if (existing) {
    if (opts.relay && !existing.relay) enterRelay(win, existing);
    return existing.ready;
  }
  const state: ListenerState = {
    ready: Promise.resolve(false),
    received: false,
    relay: false,
    again: false,
    armed: false,
    launchKey: null,
    follow: null,
  };
  win.__invoiceleadLeadAuth = state;
  if (opts.relay === true || isRelayPath(win.location.pathname)) enterRelay(win, state);
  const issuer = issuerOrigin(opts.issuer);
  const plugins = nativePlugins(win);
  const app = plugins?.App;
  if (!issuer || !plugins || !app || typeof app.addListener !== "function") return state.ready;
  const android = platformOf(win) === "android";

  /** Le lien est-il le retour d'une connexion en cours ? */
  const expected = (via: Via, key: string): boolean => {
    if (via === "open" && state.armed) return true;
    if (via === "launch" && state.relay && !state.again) return false;
    const pending = readPending(win);
    return !!pending && !(via === "launch" && pending.stale === key);
  };
  const follow = (url: unknown, via: Via): boolean => {
    const link = parseReturnLink(url);
    if (!link) return false;
    const key = fingerprint(url as string);
    if (link.kind === "code" && !firstTime(win, key)) return false;
    if (state.received || !expected(via, key)) return false;
    state.received = true;
    state.armed = false;
    clearPending(win);
    // Android : le Custom Tab peut rester au-dessus de l'app. iOS : rien à fermer (session ou Safari).
    if (android) quietly(() => plugins.Browser?.close?.());
    const back = takeBack(win, issuer);
    win.location.replace(
      link.kind === "code" ? redeemUrl(issuer, link.code) : (back ?? loginFallback(opts.locale)),
    );
    return true;
  };
  try {
    app.addListener("appUrlOpen", (e) => {
      follow(e?.url, "open");
    });
  } catch {
    return state.ready;
  }
  state.follow = follow;
  const launch = (async () => {
    try {
      const r = await app.getLaunchUrl?.();
      if (parseReturnLink(r?.url)) state.launchKey = fingerprint(r?.url as string);
      return follow(r?.url, "launch");
    } catch {
      return false;
    }
  })();
  state.ready = Promise.race([
    launch,
    new Promise<boolean>((done) => {
      win.setTimeout(() => done(false), LAUNCH_TIMEOUT_MS);
    }),
  ]).then((launched) => launched || state.received);
  return state.ready;
}

/**
 * Départ automatique d'une page de l'app (l'écran de connexion de l'app vers le Compte Lead) : il attend
 * la lecture du lien de lancement (au plus LAUNCH_TIMEOUT_MS ; hors de l'app, tout de suite), puis ne part
 * PAS si un lien de retour a été pris (contrat § 3b, 6) : l'app relancée par son lien arrive sans session
 * sur cet écran, et ce départ annulerait le rachat encore en route (code brûlé, écran de connexion
 * d'ERPlead). `live` : la page est-elle encore là ? Rend true si la page est partie vers `href`.
 */
export async function departUnlessReturned(
  win: AppWindow,
  opts: {
    issuer: string | null | undefined;
    locale?: string | null;
    href: string;
    live?: () => boolean;
  },
): Promise<boolean> {
  const returned = await listenForReturn(win, { issuer: opts.issuer, locale: opts.locale });
  if (returned || (opts.live && !opts.live())) return false;
  win.location.replace(opts.href);
  return true;
}

export type ReturnPageOutcome = "followed" | "ignored" | "outside";

/**
 * La page de retour dans l'app (`/<langue>/lead-auth/return?…`, où mène `/lead-auth/return` quand la vue
 * web de l'app l'ouvre elle-même) : son adresse est traitée comme le lien de retour reçu (`RETURN_URL`
 * suivi de ses paramètres), avec les mêmes règles (connexion en cours, une seule fois). Lien non suivi :
 * l'app (`/<langue>/app`). Hors de l'app : la page de repli `/lead-auth/return` (qui efface le code de
 * l'adresse).
 */
export async function followReturnPage(
  win: AppWindow,
  opts: { issuer: string | null | undefined; locale: string },
): Promise<ReturnPageOutcome> {
  const search = typeof win.location.search === "string" ? win.location.search : "";
  if (!nativePlugins(win)) {
    win.location.replace(`${RETURN_PATH}${search}`);
    return "outside";
  }
  const handled = await listenForReturn(win, opts);
  const state = win.__invoiceleadLeadAuth;
  if (handled || state?.received) return "followed";
  if (search.startsWith("?") && state?.follow?.(`${RETURN_URL}${search}`, "page"))
    return "followed";
  win.location.replace(`/${/^[a-z]{2}$/.test(opts.locale) ? opts.locale : "de"}/app`);
  return "ignored";
}

export type RelayOutcome = "opened" | "outside" | "invalid";

/** Le code d'un refus d'un module natif (Capacitor : `call.reject(message, code)`), ou null. */
function refusal(e: unknown): string | null {
  const code = (e as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : null;
}

/**
 * La page relais : dans l'app, `back` gardé, l'écoute du retour posée, le lien de lancement lu (au plus
 * LAUNCH_TIMEOUT_MS ; jamais suivi ici), la connexion notée « en cours » (avec l'empreinte du départ et la
 * façon d'ouvrir), puis `start` dans le navigateur sûr du téléphone :
 * - iOS 17.4+ (`LeadAuthSession.isAvailable().https`) : `LeadAuthSession.start(start&m=auto)` ; l'adresse
 *   rendue suit les règles du lien de retour ; annulée → `back` ; autre refus → navigateur par défaut ;
 * - iOS 15 à 17.3 : `LeadAuthSession.openExternal(start&m=tap)` (le navigateur par défaut du téléphone :
 *   Safari, ou celui choisi par la personne), puis `onSafari()` pour l'écran ;
 * - iOS sans le module : `back` ;
 * - Android : `Browser.open(start&m=auto)` (Custom Tab) ; refermé sans retour (1,5 s de grâce) → `back`.
 * La MÊME page relais rechargée pendant sa connexion (contrat § 3a, page relais qui garde son adresse) :
 * rien n'est effacé ni rouvert (le départ d'ERPlead est à usage unique) ; son lien de lancement est la
 * réponse attendue, sauf l'ancien noté ; navigateur par défaut : son texte, et le lien attendu ; Android :
 * la fin du Custom Tab écoutée ; session iOS : `LeadAuthSession.resume(start&m=auto)` si le module l'a
 * (adresse rendue → règles du lien de retour ; `failed` → navigateur par défaut ; autre refus → `back`),
 * sinon `back` (le résultat de la session est perdu avec la page).
 * Hors de l'app : `back` tout de suite. `start` ou `back` étrangers : la connexion ordinaire de l'app.
 */
export function startRelay(
  win: AppWindow,
  opts: {
    issuer: string | null | undefined;
    start: unknown;
    back: unknown;
    locale?: string | null;
    /**
     * iOS : la connexion se finit dans le navigateur par défaut (« touchez « Ouvrir InvoiceLead » ») ;
     * aussi à la page relais rechargée pendant cette connexion.
     */
    onSafari?: () => void;
  },
): RelayOutcome {
  const issuer = issuerOrigin(opts.issuer);
  const targets = relayTargets(issuer, opts.start, opts.back);
  if (!issuer || !targets) {
    win.location.replace(loginFallback(opts.locale));
    return "invalid";
  }
  const plugins = nativePlugins(win);
  const platform = platformOf(win);
  const browser = plugins?.Browser;
  const session = plugins?.LeadAuthSession;
  const ios =
    platform === "ios" &&
    typeof session?.isAvailable === "function" &&
    typeof session.start === "function" &&
    typeof session.openExternal === "function";
  const android = platform === "android" && typeof browser?.open === "function";
  if (!plugins?.App || !(ios || android)) {
    win.location.replace(targets.back);
    return "outside";
  }
  try {
    storage(win, "sessionStorage")?.setItem(BACK_KEY, targets.back);
  } catch {
    // Sans stockage : un échec ramène à la connexion ordinaire de l'app.
  }
  // L'écoute (gabarit ou ici) a décidé dès sa pose : nouvelle connexion (celle notée avant, son lien et
  // son code, ne peut plus aboutir : effacée), ou la même page rechargée pendant sa connexion (gardée).
  const ready = listenForReturn(win, { issuer, locale: opts.locale, relay: true });
  const state = win.__invoiceleadLeadAuth;
  const startKey = fingerprint(targets.start);
  const again = state?.again ? reloadedConnection(win, targets.start) : null;
  if (!again) {
    if (state) state.again = false;
    clearPending(win);
  }
  /** La façon d'ouvrir, notée avec la connexion de ce départ (pour un rechargement de la page). */
  const noteMode = (m: OpenMode) => {
    const pending = readPending(win);
    if (pending?.s === startKey) writePending(win, { ...pending, m });
  };
  const giveUp = () => {
    if (state?.received) return;
    if (state) state.armed = false;
    clearPending(win);
    win.location.replace(targets.back);
  };
  /**
   * Le navigateur par défaut (iOS 15 à 17.3, ou session refusée) : ERPlead finit par une page à bouton.
   */
  const safari = () => {
    noteMode("tap");
    try {
      session
        ?.openExternal?.({ url: withMode(targets.start, "tap") })
        .then((r) => {
          if (r?.opened === false) giveUp();
          else opts.onSafari?.();
        })
        .catch(giveUp);
    } catch {
      giveUp();
    }
  };
  /** iOS 17.4+ : la session rend l'adresse de retour ; annulée, l'écran de connexion ; sinon Safari. */
  const iosSession = () => {
    try {
      session
        ?.start?.({ url: withMode(targets.start, "auto") })
        .then((r) => {
          if (!state?.follow?.(r?.url, "open")) giveUp();
        })
        .catch((e: unknown) => {
          if (refusal(e) === "canceled") giveUp();
          else safari();
        });
    } catch {
      safari();
    }
  };
  const open = () => {
    if (android) {
      try {
        browser?.open?.({ url: withMode(targets.start, "auto") }).catch(giveUp);
      } catch {
        giveUp();
      }
      return;
    }
    try {
      session
        ?.isAvailable?.()
        .then((r) => (r?.https === true ? iosSession() : safari()))
        .catch(safari);
    } catch {
      safari();
    }
  };
  /**
   * La même page rechargée pendant sa connexion : rien n'est rouvert (un second passage du départ
   * montrerait « La demande a expiré »). Session iOS : son issue reprise par `resume` si le module l'a,
   * sinon perdue avec la page → `back`.
   */
  const resumeAfterReload = (mode: OpenMode | null) => {
    if (state) state.armed = true;
    if (android) return;
    if (mode === "tap") {
      opts.onSafari?.();
      return;
    }
    if (mode !== "auto" || typeof session?.resume !== "function") {
      giveUp();
      return;
    }
    try {
      session
        .resume({ url: withMode(targets.start, "auto") })
        .then((r) => {
          if (!state?.follow?.(r?.url, "open")) giveUp();
        })
        .catch((e: unknown) => {
          if (refusal(e) === "failed") safari();
          else giveUp();
        });
    } catch {
      giveUp();
    }
  };
  if (android)
    try {
      browser?.addListener?.("browserFinished", () => {
        win.setTimeout(giveUp, FINISHED_GRACE_MS);
      });
    } catch {
      // Sans cette annonce, le lien « Retour » de la page reste.
    }
  // Le lien de lancement de ce chargement (ancien retour) est lu AVANT de noter la connexion : il
  // n'est jamais pris pour le retour de celle-ci. Page rechargée : la connexion déjà notée reste telle
  // quelle (son heure, son ancien lien), son lien de lancement a pu la terminer.
  void ready.then(() => {
    if (state?.received) return;
    if (again) {
      resumeAfterReload(again.m);
      return;
    }
    writePending(win, {
      t: clock(win),
      stale: state?.launchKey ?? null,
      s: startKey,
      m: android ? "tab" : "auto",
    });
    if (state) state.armed = true;
    open();
  });
  return "opened";
}
