/**
 * « Continuer avec Google » dans l'app Android / iOS d'InvoiceLead (30.10.2026). Contrat d'ERPlead :
 * ~/projets/erplead-google-app/docs/GOOGLE-APP.md ; ce qui en revient à InvoiceLead : docs/GOOGLE-APP.md.
 *
 * Google refuse sa connexion dans une vue web (« disallowed_useragent »). Dans l'app (coque Capacitor
 * qui ouvre https://invoicelead.io), le bouton Google de l'écran du Compte Lead mène donc à la page
 * relais d'InvoiceLead (`/lead-auth/google?start&back`), qui ouvre `start` dans le navigateur du
 * téléphone (`Browser.open` : SFSafariViewController, Custom Tab). La connexion Google finie, ERPlead
 * rend la main à l'app par son lien de retour `io.invoicelead.app://lead-auth?code=…` ; le code de l'app,
 * sur toutes ses pages, ferme ce navigateur et mène la vue web au rachat d'ERPlead
 * (`/auth/google/app/redeem?code=…`), qui ouvre la session (preuve : le cookie HttpOnly de la vue web,
 * qu'InvoiceLead ne lit jamais) et reprend la connexion de l'app comme après un mot de passe.
 *
 * Tout ici est sans dépendance (ni React, ni Next, ni DOM réel) : les composants de
 * components/native/LeadAppAuth.tsx le branchent sur `window`, les tests sur un faux pont Capacitor.
 * Hors de l'app (aucun pont Capacitor natif), rien ne s'installe et rien ne change.
 */

/** Schéma du lien de retour : l'identifiant de l'app (appId Capacitor, liste fermée d'ERPlead). */
export const APP_SCHEME = "io.invoicelead.app";
/** Seul lien accepté : ce schéma, l'hôte `lead-auth`, et ses paramètres (`code`, ou `error`). */
export const RETURN_PREFIX = `${APP_SCHEME}://lead-auth?`;
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
/** Empreintes des liens déjà traités (getLaunchUrl rend le même lien à chaque page). */
export const SEEN_KEY = "invoicelead.leadAuth.seen";
const SEEN_MAX = 20;
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
 * Le lien de retour de l'app, ou null pour tout autre lien (autre schéma, autre hôte, ancien
 * `io.crmlead.app://sso`, adresse web) : ceux-là sont ignorés. Un lien de l'app sans code valable
 * (`error=expired`, code abîmé) rend `{ kind: "error" }` : retour à l'écran de connexion.
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
 * Google (`<émetteur>/auth/google/app/start?…`), `back` son écran de connexion (`<émetteur>/login?…`).
 * Sinon null : rien n'est ouvert (ni navigateur, ni adresse étrangère).
 */
export function relayTargets(
  issuer: string | null,
  start: unknown,
  back: unknown,
): { start: string; back: string } | null {
  if (!issuer || !fromIssuer(issuer, start, "/auth/google/app/start")) return null;
  if (!fromIssuer(issuer, back, "/login")) return null;
  return { start, back };
}

/** La connexion ordinaire de l'app (départ vers le Compte Lead), dans la langue donnée. */
export function loginFallback(locale?: string | null): string {
  return locale && /^[a-z]{2}$/.test(locale)
    ? `/auth/lead/start?${new URLSearchParams({ locale })}`
    : "/auth/lead/start";
}

// ------------------------------------------------------------------ pont Capacitor

type Handle = unknown;
/** Ce que le pont natif de Capacitor met dans la page (window.Capacitor, sans paquet npm). */
export type CapacitorBridge = {
  isNativePlatform?: () => boolean;
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
  };
};
type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;
/** Ce que ce module lit de `window`. */
export type AppWindow = {
  Capacitor?: CapacitorBridge;
  location: { replace: (url: string) => void };
  localStorage?: StorageLike;
  sessionStorage?: StorageLike;
  setTimeout: (fn: () => void, ms: number) => unknown;
  __invoiceleadLeadAuth?: ListenerState;
};
type ListenerState = { ready: Promise<boolean>; received: boolean };

/** Les modules natifs de l'app (App, Browser), seulement dans l'app : le pont dit « natif ». */
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
/** Marque le lien comme traité ; rend false s'il l'était déjà (cette page ou une précédente). */
function firstTime(win: AppWindow, url: string): boolean {
  const key = fingerprint(url);
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
 * Écoute du lien de retour, à installer au démarrage de chaque page de l'app : `appUrlOpen` (app
 * ouverte ou en arrière-plan) et `getLaunchUrl` (app relancée par le lien). Une seule fois par page
 * (les appels suivants rendent la même promesse) ; chaque lien n'est traité qu'une fois, toutes pages
 * confondues. Pour le lien de l'app : `Browser.close()` (erreur ignorée), puis le rachat d'ERPlead
 * avec le code, ou l'écran de connexion. Rend une promesse : true si le lien de lancement a mené
 * ailleurs (la page ne doit plus rien faire), false sinon (hors de l'app, aucun lien, autre lien).
 */
export function listenForReturn(
  win: AppWindow,
  opts: { issuer: string | null | undefined; locale?: string | null },
): Promise<boolean> {
  const existing = win.__invoiceleadLeadAuth;
  if (existing) return existing.ready;
  const state: ListenerState = { ready: Promise.resolve(false), received: false };
  win.__invoiceleadLeadAuth = state;
  const issuer = issuerOrigin(opts.issuer);
  const plugins = nativePlugins(win);
  const app = plugins?.App;
  if (!issuer || !plugins || !app || typeof app.addListener !== "function") return state.ready;

  const handle = (url: unknown): boolean => {
    const link = parseReturnLink(url);
    if (!link || !firstTime(win, url as string)) return false;
    state.received = true;
    quietly(() => plugins.Browser?.close?.());
    const back = takeBack(win, issuer);
    win.location.replace(
      link.kind === "code" ? redeemUrl(issuer, link.code) : (back ?? loginFallback(opts.locale)),
    );
    return true;
  };
  try {
    app.addListener("appUrlOpen", (e) => {
      handle(e?.url);
    });
  } catch {
    return state.ready;
  }
  const launch = (async () => {
    try {
      const r = await app.getLaunchUrl?.();
      return handle(r?.url);
    } catch {
      return false;
    }
  })();
  state.ready = Promise.race([
    launch,
    new Promise<boolean>((done) => {
      win.setTimeout(() => done(false), LAUNCH_TIMEOUT_MS);
    }),
  ]);
  return state.ready;
}

export type RelayOutcome = "opened" | "outside" | "invalid";

/**
 * La page relais : dans l'app, `back` gardé, l'écoute du retour posée, puis `start` dans le
 * navigateur du téléphone ; refermé sans retour, l'écran de connexion d'ERPlead (`back`). Hors de
 * l'app : `back` tout de suite. `start` ou `back` étrangers : la connexion ordinaire de l'app.
 */
export function startRelay(
  win: AppWindow,
  opts: {
    issuer: string | null | undefined;
    start: unknown;
    back: unknown;
    locale?: string | null;
  },
): RelayOutcome {
  const issuer = issuerOrigin(opts.issuer);
  const targets = relayTargets(issuer, opts.start, opts.back);
  if (!issuer || !targets) {
    win.location.replace(loginFallback(opts.locale));
    return "invalid";
  }
  const plugins = nativePlugins(win);
  const browser = plugins?.Browser;
  if (!plugins?.App || !browser || typeof browser.open !== "function") {
    win.location.replace(targets.back);
    return "outside";
  }
  try {
    storage(win, "sessionStorage")?.setItem(BACK_KEY, targets.back);
  } catch {
    // Sans stockage : un échec ramène à la connexion ordinaire de l'app.
  }
  void listenForReturn(win, { issuer, locale: opts.locale });
  const giveUp = () => {
    if (!win.__invoiceleadLeadAuth?.received) win.location.replace(targets.back);
  };
  try {
    browser.addListener?.("browserFinished", () => {
      win.setTimeout(giveUp, FINISHED_GRACE_MS);
    });
  } catch {
    // Sans cette annonce, le lien « Retour » de la page reste.
  }
  try {
    browser.open({ url: targets.start }).catch(giveUp);
  } catch {
    giveUp();
  }
  return "opened";
}
