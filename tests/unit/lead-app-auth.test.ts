import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { NextRequest, type NextResponse } from "next/server";
import { beforeAll, describe, expect, it } from "vitest";
import {
  type AppWindow,
  BACK_KEY,
  FINISHED_GRACE_MS,
  followReturnPage,
  isRelayPath,
  issuerOrigin,
  LAUNCH_TIMEOUT_MS,
  listenForReturn,
  loginFallback,
  PENDING_KEY,
  PENDING_TTL_MS,
  parseReturnLink,
  RELAY_PATH,
  RETURN_PATH,
  RETURN_URL,
  redeemUrl,
  relayTargets,
  SEEN_KEY,
  startRelay,
  withMode,
} from "@/lib/lead-app-auth";
import { isAppAuthAgent, isNativeAgent } from "@/lib/native";
import { returnPageScript } from "@/server/lead-app-return";
import { setTestEnv } from "../support/env";

/**
 * « Continuer avec Google » dans l'app Android / iOS (lib/lead-app-auth.ts, contrat d'ERPlead
 * docs/GOOGLE-APP.md révisé le 30.10.2026 : liens VÉRIFIÉS) : le lien de retour
 * `https://invoicelead.io/lead-auth/return?code=…` (Universal Link, App Link vérifié, adresse rendue par
 * la session iOS) mène la vue web au rachat d'ERPlead, une seule fois, pendant une connexion en cours ;
 * tout autre lien (dont l'ancien schéma propre) est ignoré ; hors de l'app, rien ne change. Le pont
 * Capacitor est simulé (window.Capacitor, comme l'injecte la coque native : isNativePlatform,
 * getPlatform, Plugins.App, Plugins.Browser, et sur iOS le module de l'app Plugins.LeadAuthSession).
 */

const ISSUER = "https://erplead.io";
const CODE = "Abc_DEF-123456789012345678901234567890abcde";
const RETOUR = "https://invoicelead.io/lead-auth/return";
const LINK = `${RETOUR}?code=${CODE}&locale=it`;
const START = `${ISSUER}/auth/google/app/start?d=invoicelead.${"x".repeat(43)}`;
const START2 = `${ISSUER}/auth/google/app/start?d=invoicelead.${"y".repeat(43)}`;
const AUTO = `${START}&m=auto`;
const TAP = `${START}&m=tap`;
const ERROR_LINK = `${RETOUR}?error=expired&locale=it`;
const codeLink = (c: string) => `${RETOUR}?code=${c}&locale=it`;
const REDEEM = `${ISSUER}/auth/google/app/redeem?code=${CODE}`;
const NOW = Date.UTC(2026, 9, 30, 12, 0, 0);
const BACK = `${ISSUER}/login?next=%2Foauth%2Fauthorize%3Fclient_id%3Dinvoicelead&locale=it`;

type Storage = {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
};
function memoryStorage(seed?: Map<string, string>): Storage & { map: Map<string, string> } {
  const map = seed ?? new Map<string, string>();
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => {
      map.set(k, String(v));
    },
    removeItem: (k) => {
      map.delete(k);
    },
  };
}

type SessionEnd = { url: string } | { error: string };

/** Une page de l'app (ou d'un navigateur ordinaire si native = false), avec son faux pont. */
function fakePage(
  opts: {
    native?: boolean;
    bridge?: boolean;
    app?: boolean;
    browser?: boolean;
    /** Plateforme de l'app : « android » (défaut), « ios », ou aucune. */
    platform?: "ios" | "android" | null;
    /** iOS : module LeadAuthSession « https » (17.4+, défaut), « old » (15 à 17.3), « none » (absent). */
    session?: "https" | "old" | "none";
    launch?: string | null;
    launchFails?: boolean;
    launchHangs?: boolean;
    /** Lien de lancement rendu plus tard (resolveLaunch). */
    launchLater?: boolean;
    closeFails?: boolean;
    openFails?: boolean;
    /** iOS : Safari refuse de s'ouvrir (openExternal → { opened: false }). */
    externalRefused?: boolean;
    local?: Map<string, string>;
    /** sessionStorage de la page. */
    tab?: Map<string, string>;
    /** Chemin de la page (la page relais : /it/lead-auth/google). */
    pathname?: string;
    search?: string;
    now?: number;
  } = {},
) {
  const { native = true, bridge = true, app = true, browser = true } = opts;
  const platform = opts.platform === undefined ? "android" : opts.platform;
  const replaced: string[] = [];
  const opened: string[] = [];
  const sessions: string[] = [];
  const externals: string[] = [];
  let closed = 0;
  const listeners: Record<string, ((e?: { url?: string }) => void)[]> = {};
  const timers: { fn: () => void; ms: number }[] = [];
  let resolveLaunch: (url: string | null) => void = () => {};
  const later = new Promise<{ url?: string } | undefined>((done) => {
    resolveLaunch = (url) => done(url ? { url } : undefined);
  });
  let endSession: ((end: SessionEnd) => void) | null = null;
  const on = (name: string) => (event: string, cb: (e?: { url?: string }) => void) => {
    const key = `${name}.${event}`;
    listeners[key] = [...(listeners[key] ?? []), cb];
    return { remove: async () => {} };
  };
  const win: AppWindow = {
    location: {
      replace: (u: string) => void replaced.push(u),
      pathname: opts.pathname ?? "/it/app",
      search: opts.search ?? "",
    },
    now: () => opts.now ?? NOW,
    localStorage: memoryStorage(opts.local),
    sessionStorage: memoryStorage(opts.tab),
    setTimeout: (fn: () => void, ms: number) => {
      timers.push({ fn, ms });
      return timers.length;
    },
  };
  const iosSession =
    platform === "ios" && (opts.session ?? "https") !== "none"
      ? {
          LeadAuthSession: {
            isAvailable: async () => ({ https: (opts.session ?? "https") === "https" }),
            start: ({ url }: { url: string }) => {
              sessions.push(url);
              return new Promise<{ url?: string }>((resolve, reject) => {
                endSession = (end) =>
                  "url" in end
                    ? resolve({ url: end.url })
                    : reject(Object.assign(new Error(end.error), { code: end.error }));
              });
            },
            openExternal: async ({ url }: { url: string }) => {
              externals.push(url);
              return { opened: !opts.externalRefused };
            },
          },
        }
      : {};
  if (bridge)
    win.Capacitor = {
      isNativePlatform: () => native,
      ...(platform ? { getPlatform: () => platform } : {}),
      Plugins: {
        ...(app
          ? {
              App: {
                addListener: on("App") as never,
                getLaunchUrl: () =>
                  opts.launchLater
                    ? later
                    : opts.launchHangs
                      ? new Promise(() => {})
                      : opts.launchFails
                        ? Promise.reject(new Error("no bridge"))
                        : Promise.resolve(opts.launch ? { url: opts.launch } : undefined),
              },
            }
          : {}),
        ...(browser
          ? {
              Browser: {
                open: async ({ url }: { url: string }) => {
                  if (opts.openFails) throw new Error("no browser");
                  opened.push(url);
                },
                close: async () => {
                  closed++;
                  if (opts.closeFails) throw new Error("nothing to close");
                },
                addListener: on("Browser") as never,
              },
            }
          : {}),
        ...iosSession,
      },
    };
  const emit = (key: string, e?: { url?: string }) => {
    for (const cb of listeners[key] ?? []) cb(e);
  };
  return {
    win,
    replaced,
    opened,
    sessions,
    externals,
    closed: () => closed,
    listeners,
    timers,
    appUrlOpen: (url: string) => emit("App.appUrlOpen", { url }),
    resolveLaunch: (url: string | null) => resolveLaunch(url),
    browserFinished: () => emit("Browser.browserFinished"),
    finishSession: (end: SessionEnd) => endSession?.(end),
    runTimers: () => {
      for (const t of timers.splice(0)) t.fn();
    },
  };
}
const flush = () => new Promise((r) => setTimeout(r, 0));
/** Un texte tel que la page de repli l'écrit (HTML échappé). */
const esc = (t: string) =>
  t
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

/** La page relais d'une connexion Google dans l'app : écoute (gabarit), puis startRelay (page). */
async function relayPage(
  opts: Parameters<typeof fakePage>[0] & { start?: string; onSafari?: () => void } = {},
) {
  const p = fakePage({ pathname: `/it${RELAY_PATH}`, ...opts });
  void listenForReturn(p.win, { issuer: ISSUER, locale: "it" });
  expect(
    startRelay(p.win, {
      issuer: ISSUER,
      start: opts.start ?? START,
      back: BACK,
      locale: "it",
      onSafari: opts.onSafari,
    }),
  ).toBe("opened");
  await flush();
  return p;
}
/** Une connexion Google notée par une page relais d'un chargement précédent (app relancée). */
function pendingSince(local: Map<string, string>, ageMs: number, stale: string | null = null) {
  local.set(PENDING_KEY, JSON.stringify({ t: NOW - ageMs, stale }));
  return local;
}

describe("lien de retour vérifié (https://invoicelead.io/lead-auth/return)", () => {
  it("lien de retour : adresse exacte https://invoicelead.io/lead-auth/return, code de 43 caractères → rachat d'ERPlead ; schéma propre io.invoicelead.app refusé", () => {
    expect(RETURN_URL).toBe(RETOUR);
    expect(RETURN_PATH).toBe("/lead-auth/return");
    expect(parseReturnLink(LINK)).toEqual({ kind: "code", code: CODE });
    expect(parseReturnLink(`${RETOUR}?code=${CODE}`)).toEqual({ kind: "code", code: CODE });
    expect(parseReturnLink(`${LINK}#x`)).toEqual({ kind: "code", code: CODE });
    expect(redeemUrl(ISSUER, CODE)).toBe(REDEEM);
    expect(() => redeemUrl(ISSUER, "court")).toThrow();
    // Lien de retour sans code valable : retour à l'écran de connexion.
    for (const url of [
      ERROR_LINK,
      `${RETOUR}?code=${CODE.slice(1)}`,
      `${RETOUR}?code=${CODE}x`,
      `${RETOUR}?code=${CODE.slice(1)}%2F`,
      `${RETOUR}?`,
    ])
      expect(parseReturnLink(url), url).toEqual({ kind: "error" });
    // Tout autre lien : ignoré, dont le schéma propre de la première version (jamais publiée).
    for (const url of [
      `io.invoicelead.app://lead-auth?code=${CODE}`,
      "io.invoicelead.app://lead-auth?error=expired",
      `io.crmlead.app://sso?code=${CODE}`,
      `https://crmlead.io/lead-auth/return?code=${CODE}`,
      `http://invoicelead.io/lead-auth/return?code=${CODE}`,
      `https://www.invoicelead.io/lead-auth/return?code=${CODE}`,
      `https://invoicelead.io.evil.example/lead-auth/return?code=${CODE}`,
      `https://invoicelead.io/lead-auth/return/x?code=${CODE}`,
      `https://invoicelead.io/lead-auth/returnx?code=${CODE}`,
      `https://invoicelead.io/it/lead-auth/return?code=${CODE}`,
      `https://invoicelead.io/lead-auth/google?code=${CODE}`,
      `https://INVOICELEAD.IO/lead-auth/return?code=${CODE}`,
      RETOUR,
      `x${LINK}`,
      `${LINK}${"a".repeat(5000)}`,
      "",
      null,
      undefined,
      42,
    ])
      expect(parseReturnLink(url), String(url)).toBeNull();
  });

  it("Android : appUrlOpen pendant une connexion en cours (page relais) : le lien ferme le Custom Tab et mène au rachat d'ERPlead avec le code, une seule fois", async () => {
    const local = new Map<string, string>();
    const p = await relayPage({ local });
    expect(p.opened).toEqual([AUTO]);
    expect(p.listeners["App.appUrlOpen"]).toHaveLength(1);
    expect(JSON.parse(local.get(PENDING_KEY) ?? "null")).toEqual({ t: NOW, stale: null });
    p.appUrlOpen(LINK);
    expect(p.closed()).toBe(1);
    expect(p.replaced).toEqual([REDEEM]);
    // La connexion en cours est effacée par le premier lien suivi.
    expect(local.has(PENDING_KEY)).toBe(false);
    // Le même lien une seconde fois (appUrlOpen répété) : rien de plus.
    p.appUrlOpen(LINK);
    expect(p.replaced).toHaveLength(1);
    expect(p.closed()).toBe(1);
    // L'écoute ne se pose qu'une fois par page, quel que soit le nombre d'appels.
    await listenForReturn(p.win, { issuer: ISSUER, locale: "it" });
    expect(p.listeners["App.appUrlOpen"]).toHaveLength(1);
    // Le code lui-même n'est pas gardé (empreinte seulement).
    expect(JSON.stringify([...local])).not.toContain(CODE);
    expect(JSON.parse(local.get(SEEN_KEY) ?? "[]")).toHaveLength(1);
  });

  it("lien de lancement (app relancée par le lien) : rachat une seule fois, même si appUrlOpen le donne aussi et sur la page suivante", async () => {
    const local = new Map<string, string>();
    // La page relais a noté la connexion, puis Android a fermé l'app pendant la connexion Google.
    const relay = await relayPage({ local });
    expect(relay.opened).toEqual([AUTO]);
    const first = fakePage({ launch: LINK, local, now: NOW + 60_000 });
    expect(await listenForReturn(first.win, { issuer: ISSUER, locale: "fr" })).toBe(true);
    expect(first.replaced).toEqual([REDEEM]);
    expect(first.closed()).toBe(1);
    first.appUrlOpen(LINK);
    expect(first.replaced).toHaveLength(1);
    // Page suivante (retour de l'autorisation dans l'app) : la coque redonne le dernier lien.
    const next = fakePage({ launch: LINK, local, now: NOW + 70_000 });
    expect(await listenForReturn(next.win, { issuer: ISSUER, locale: "fr" })).toBe(false);
    expect(next.replaced).toEqual([]);
    expect(next.closed()).toBe(0);
    // Connexion suivante dont la page relais n'a pas pu lire son lien de lancement (ancien lien inconnu) :
    // l'ancien lien, déjà suivi une fois, ne l'est jamais plus.
    const unknown = fakePage({ launch: LINK, local: pendingSince(local, 10_000, null), now: NOW });
    expect(await listenForReturn(unknown.win, { issuer: ISSUER, locale: "fr" })).toBe(false);
    expect(unknown.replaced).toEqual([]);
    expect(unknown.closed()).toBe(0);
    // Une nouvelle connexion (nouvelle page relais) : son lien est suivi.
    const other = codeLink("Z".repeat(43));
    const again = await relayPage({ local, launch: LINK, start: START2, now: NOW + 80_000 });
    expect(again.replaced).toEqual([]);
    again.appUrlOpen(other);
    expect(again.replaced).toEqual([`${ISSUER}/auth/google/app/redeem?code=${"Z".repeat(43)}`]);
    expect(JSON.parse(local.get(SEEN_KEY) ?? "[]")).toHaveLength(2);
  });

  it("liens étrangers ou mal formés ignorés : schéma propre, autre hôte, autre chemin, http, ancien io.crmlead.app://sso", async () => {
    const p = await relayPage({ launch: `io.crmlead.app://sso?code=${CODE}` });
    for (const url of [
      `io.invoicelead.app://lead-auth?code=${CODE}`,
      `io.crmlead.app://sso?code=${CODE}`,
      `https://projectlead.io/lead-auth/return?code=${CODE}`,
      `https://invoicelead.io/lead-auth/autre?code=${CODE}`,
      `http://invoicelead.io/lead-auth/return?code=${CODE}`,
      "https://invoicelead.io/fr/app",
      "",
    ])
      p.appUrlOpen(url);
    expect(p.replaced).toEqual([]);
    expect(p.closed()).toBe(0);
    // La connexion attend toujours son lien.
    p.appUrlOpen(LINK);
    expect(p.replaced).toEqual([REDEEM]);
  });

  it("lien de retour sans code valable (error=expired, code abîmé) : écran de connexion gardé par la page relais, sinon connexion ordinaire", async () => {
    const withBack = await relayPage();
    withBack.appUrlOpen(ERROR_LINK);
    expect(withBack.closed()).toBe(1);
    expect(withBack.replaced).toEqual([BACK]);
    expect(withBack.win.sessionStorage?.getItem(BACK_KEY)).toBeNull();

    // App relancée (connexion notée, plus de `back` : sessionStorage perdu avec l'app).
    const without = fakePage({ local: pendingSince(new Map(), 60_000) });
    await listenForReturn(without.win, { issuer: ISSUER, locale: "it" });
    without.appUrlOpen(`${RETOUR}?code=abime`);
    expect(without.replaced).toEqual(["/auth/lead/start?locale=it"]);

    // Un `back` gardé mais étranger n'est jamais suivi.
    const forged = fakePage({
      local: pendingSince(new Map(), 60_000),
      tab: new Map([[BACK_KEY, "https://evil.example/login?x"]]),
    });
    await listenForReturn(forged.win, { issuer: ISSUER, locale: "es" });
    forged.appUrlOpen(ERROR_LINK);
    expect(forged.replaced).toEqual(["/auth/lead/start?locale=es"]);
    expect(loginFallback(undefined)).toBe("/auth/lead/start");
    expect(loginFallback("x/../y")).toBe("/auth/lead/start");
  });

  it("deux demandes expirées de suite : le lien d'erreur (toujours le même) ramène chaque fois à l'écran de connexion", async () => {
    const local = new Map<string, string>();
    const first = await relayPage({ local });
    first.appUrlOpen(ERROR_LINK);
    expect(first.replaced).toEqual([BACK]);
    expect(first.closed()).toBe(1);
    // Des jours plus tard, une autre connexion expire aussi (la coque redonne l'ancien lien d'erreur à
    // getLaunchUrl : jamais suivi sur la page relais) ; le lien d'erreur, identique, ferme encore le
    // navigateur et ramène à l'écran de connexion.
    const second = await relayPage({ local, launch: ERROR_LINK, now: NOW + 3 * 86_400_000 });
    expect(second.replaced).toEqual([]);
    expect(second.opened).toEqual([AUTO]);
    second.appUrlOpen(ERROR_LINK);
    expect(second.closed()).toBe(1);
    expect(second.replaced).toEqual([BACK]);
    // Le lien d'erreur n'est jamais gardé comme vu.
    expect(JSON.parse(local.get(SEEN_KEY) ?? "[]")).toEqual([]);
  });

  it("lien de retour reçu sans connexion en cours (page web, courriel, autre app) : ignoré, ni navigateur fermé ni page quittée", async () => {
    // La personne rédige une facture ; un lien piégé (page web qui mène au lien de retour de l'app).
    const local = new Map<string, string>();
    for (const platform of ["android", "ios"] as const) {
      const p = fakePage({ local, platform, pathname: "/fr/app/invoices/new" });
      expect(await listenForReturn(p.win, { issuer: ISSUER, locale: "fr" })).toBe(false);
      p.appUrlOpen(LINK);
      p.appUrlOpen(ERROR_LINK);
      p.appUrlOpen(`${RETOUR}?code=abime`);
      expect(p.replaced, platform).toEqual([]);
      expect(p.closed()).toBe(0);
    }
    // Ni par le lien de lancement.
    const launched = fakePage({ local, launch: codeLink("L".repeat(43)) });
    expect(await listenForReturn(launched.win, { issuer: ISSUER, locale: "fr" })).toBe(false);
    expect(launched.replaced).toEqual([]);
    // Connexion notée il y a plus de 15 min (abandonnée) : plus rien n'est attendu.
    const old = fakePage({ local: pendingSince(new Map(), PENDING_TTL_MS + 1000) });
    await listenForReturn(old.win, { issuer: ISSUER, locale: "fr" });
    old.appUrlOpen(codeLink("O".repeat(43)));
    expect(old.replaced).toEqual([]);
    expect(old.closed()).toBe(0);
    // Valeur abîmée ou heure à venir : aucune connexion en cours.
    for (const raw of [
      "{",
      "null",
      JSON.stringify({ t: NOW + 60_000 }),
      JSON.stringify({ t: "x" }),
    ]) {
      const bad = fakePage({ local: new Map([[PENDING_KEY, raw]]) });
      await listenForReturn(bad.win, { issuer: ISSUER, locale: "fr" });
      bad.appUrlOpen(codeLink("B".repeat(43)));
      expect(bad.replaced, raw).toEqual([]);
    }
  });

  it("page relais d'une nouvelle connexion : l'ancien lien que rend getLaunchUrl (app relancée) n'est jamais suivi ; le navigateur s'ouvre et le nouveau lien mène au rachat", async () => {
    for (const layoutFirst of [true, false]) {
      const local = new Map<string, string>();
      // 1re connexion : page relais (connexion notée), puis Android ferme l'app pendant Google ; le
      // lien de retour relance l'app, mais une redirection serveur l'emmène au Compte Lead sans
      // qu'une page d'InvoiceLead ne lise ce lien.
      await relayPage({ local });
      // 2e essai : ERPlead a posé un NOUVEAU cookie verifier ; la page relais redonne l'ancien lien
      // (Android : lien de lancement de l'activité), jamais vu, connexion notée il y a 2 min.
      const p = fakePage({ local, launch: LINK, pathname: `/it${RELAY_PATH}`, now: NOW + 120_000 });
      if (layoutFirst) void listenForReturn(p.win, { issuer: ISSUER, locale: "it" });
      startRelay(p.win, { issuer: ISSUER, start: START2, back: BACK, locale: "it" });
      await flush();
      expect(p.replaced, String(layoutFirst)).toEqual([]);
      expect(p.closed()).toBe(0);
      expect(p.opened).toEqual([withMode(START2, "auto")]);
      // L'ancien lien, noté comme d'avant cette connexion.
      expect(JSON.parse(local.get(PENDING_KEY) ?? "null")).toMatchObject({ t: NOW + 120_000 });
      expect(JSON.parse(local.get(PENDING_KEY) ?? "null").stale).toBeTruthy();
      p.appUrlOpen(LINK);
      expect(p.replaced).toEqual([]);
      const fresh = codeLink("N".repeat(43));
      p.appUrlOpen(fresh);
      expect(p.closed()).toBe(1);
      expect(p.replaced).toEqual([`${ISSUER}/auth/google/app/redeem?code=${"N".repeat(43)}`]);
    }
    // Rechargement d'une page pendant la connexion : l'ancien lien noté par la page relais n'est pas pris
    // pour le retour (iOS : dernier lien ouvert) ; un autre lien de lancement (app relancée) l'est.
    const local = new Map<string, string>();
    await relayPage({ local, launch: ERROR_LINK });
    const reload = fakePage({ local, launch: ERROR_LINK, now: NOW + 30_000 });
    expect(await listenForReturn(reload.win, { issuer: ISSUER, locale: "it" })).toBe(false);
    expect(reload.replaced).toEqual([]);
    const relaunched = fakePage({ local, launch: LINK, now: NOW + 40_000 });
    expect(await listenForReturn(relaunched.win, { issuer: ISSUER, locale: "it" })).toBe(true);
    expect(relaunched.replaced).toEqual([REDEEM]);
    expect(isRelayPath(`/it${RELAY_PATH}`)).toBe(true);
    expect(isRelayPath(RELAY_PATH)).toBe(true);
    expect(isRelayPath("/it/lead-auth/google/x")).toBe(false);
    expect(isRelayPath("/it/app")).toBe(false);
  });

  it("page relais : un lien de lancement rendu après le délai n'est jamais pris pour le retour de cette connexion", async () => {
    const local = new Map<string, string>();
    const p = fakePage({ local, launchLater: true, pathname: `/it${RELAY_PATH}` });
    void listenForReturn(p.win, { issuer: ISSUER, locale: "it" });
    startRelay(p.win, { issuer: ISSUER, start: START, back: BACK, locale: "it" });
    await flush();
    expect(p.opened).toEqual([]);
    // Le lien de lancement tarde : au bout de LAUNCH_TIMEOUT_MS, la connexion part quand même.
    expect(p.timers.map((t) => t.ms)).toContain(LAUNCH_TIMEOUT_MS);
    p.runTimers();
    await flush();
    expect(p.opened).toEqual([AUTO]);
    expect(local.has(PENDING_KEY)).toBe(true);
    // Puis la coque rend l'ancien lien : ni navigateur fermé, ni rachat, la connexion attend toujours.
    p.resolveLaunch(LINK);
    await flush();
    expect(p.replaced).toEqual([]);
    expect(p.closed()).toBe(0);
    expect(local.has(PENDING_KEY)).toBe(true);
    const fresh = codeLink("F".repeat(43));
    p.appUrlOpen(fresh);
    expect(p.replaced).toEqual([`${ISSUER}/auth/google/app/redeem?code=${"F".repeat(43)}`]);
  });

  it("Browser.close en erreur (Android : rien à fermer) : le rachat a lieu quand même", async () => {
    const p = await relayPage({ closeFails: true });
    p.appUrlOpen(LINK);
    await flush();
    expect(p.closed()).toBe(1);
    expect(p.replaced).toEqual([REDEEM]);
  });

  it("lien de lancement illisible ou en retard : la page continue (false), sans rien ouvrir", async () => {
    const fails = fakePage({ launchFails: true });
    expect(await listenForReturn(fails.win, { issuer: ISSUER })).toBe(false);
    const hangs = fakePage({ launchHangs: true });
    const ready = listenForReturn(hangs.win, { issuer: ISSUER });
    expect(hangs.timers.map((t) => t.ms)).toContain(LAUNCH_TIMEOUT_MS);
    hangs.runTimers();
    expect(await ready).toBe(false);
    expect([...fails.replaced, ...hangs.replaced]).toEqual([]);
  });
});

describe("iOS : module LeadAuthSession de l'app", () => {
  it("iOS 17.4+ : la session s'ouvre sur start&m=auto, l'adresse rendue mène au rachat une seule fois, sans Browser.open ni Browser.close", async () => {
    const local = new Map<string, string>();
    let safari = 0;
    const p = await relayPage({ local, platform: "ios", onSafari: () => safari++ });
    expect(p.sessions).toEqual([AUTO]);
    expect(p.opened).toEqual([]);
    expect(p.externals).toEqual([]);
    expect(JSON.parse(local.get(PENDING_KEY) ?? "null")).toEqual({ t: NOW, stale: null });
    p.finishSession({ url: LINK });
    await flush();
    expect(p.replaced).toEqual([REDEEM]);
    expect(p.closed()).toBe(0);
    expect(local.has(PENDING_KEY)).toBe(false);
    expect(safari).toBe(0);
    // Le même lien redonné ensuite (appUrlOpen, lancement de la page suivante) : rien de plus.
    p.appUrlOpen(LINK);
    const next = fakePage({ platform: "ios", local, launch: LINK, now: NOW + 5000 });
    expect(await listenForReturn(next.win, { issuer: ISSUER, locale: "it" })).toBe(false);
    expect([...p.replaced, ...next.replaced]).toEqual([REDEEM]);
    // Lien d'erreur rendu par la session (départ rejoué) : l'écran de connexion de l'app.
    const expired = await relayPage({ platform: "ios" });
    expired.finishSession({ url: ERROR_LINK });
    await flush();
    expect(expired.replaced).toEqual([BACK]);
  });

  it("iOS : session annulée → écran de connexion d'ERPlead (back), connexion effacée", async () => {
    const local = new Map<string, string>();
    const p = await relayPage({ local, platform: "ios" });
    expect(local.has(PENDING_KEY)).toBe(true);
    p.finishSession({ error: "canceled" });
    await flush();
    expect(p.replaced).toEqual([BACK]);
    expect(p.externals).toEqual([]);
    expect(local.has(PENDING_KEY)).toBe(false);
    // Un lien arrivé ensuite n'est plus attendu.
    p.appUrlOpen(LINK);
    expect(p.replaced).toEqual([BACK]);
  });

  it("iOS : session refusée (association absente, occupée…) → Safari sur start&m=tap ; le lien touché dans Safari (appUrlOpen) mène au rachat", async () => {
    for (const error of ["failed", "busy", "unavailable", "bad_url", "inconnu"]) {
      const local = new Map<string, string>();
      let safari = 0;
      const p = await relayPage({ local, platform: "ios", onSafari: () => safari++ });
      p.finishSession({ error });
      await flush();
      expect(p.externals, error).toEqual([TAP]);
      expect(safari).toBe(1);
      expect(p.replaced).toEqual([]);
      expect(local.has(PENDING_KEY)).toBe(true);
      // « Ouvrir InvoiceLead » touché dans Safari : Universal Link → appUrlOpen sur la page relais.
      p.appUrlOpen(LINK);
      expect(p.replaced).toEqual([REDEEM]);
      expect(p.closed()).toBe(0);
    }
  });

  it("iOS 15 à 17.3 : Safari sur start&m=tap, l'écran dit de toucher « Ouvrir InvoiceLead », puis le lien (appUrlOpen ou lancement) mène au rachat", async () => {
    const local = new Map<string, string>();
    let safari = 0;
    const p = await relayPage({ local, platform: "ios", session: "old", onSafari: () => safari++ });
    expect(p.sessions).toEqual([]);
    expect(p.externals).toEqual([TAP]);
    expect(safari).toBe(1);
    p.appUrlOpen(LINK);
    expect(p.replaced).toEqual([REDEEM]);
    // App tuée pendant Safari : relancée par le lien touché (getLaunchUrl), la connexion notée suffit.
    const local2 = new Map<string, string>();
    await relayPage({ local: local2, platform: "ios", session: "old" });
    const relaunched = fakePage({
      platform: "ios",
      local: local2,
      launch: codeLink("S".repeat(43)),
      now: NOW + 90_000,
    });
    expect(await listenForReturn(relaunched.win, { issuer: ISSUER, locale: "it" })).toBe(true);
    expect(relaunched.replaced).toEqual([
      `${ISSUER}/auth/google/app/redeem?code=${"S".repeat(43)}`,
    ]);
    // Safari refuse de s'ouvrir : l'écran de connexion.
    const refused = await relayPage({ platform: "ios", session: "old", externalRefused: true });
    expect(refused.replaced).toEqual([BACK]);
  });

  it("iOS sans le module LeadAuthSession : écran de connexion d'ERPlead, rien n'est ouvert", async () => {
    for (const p of [
      fakePage({ platform: "ios", session: "none" }),
      fakePage({ platform: null }),
      fakePage({ platform: "android", browser: false }),
    ]) {
      expect(startRelay(p.win, { issuer: ISSUER, start: START, back: BACK, locale: "it" })).toBe(
        "outside",
      );
      await flush();
      expect(p.replaced).toEqual([BACK]);
      expect([...p.opened, ...p.sessions, ...p.externals]).toEqual([]);
      expect(p.win.localStorage?.getItem(PENDING_KEY)).toBeNull();
    }
  });

  it("iOS : adresse rendue par la session qui n'est pas le lien de retour → écran de connexion, aucun rachat", async () => {
    for (const url of [
      `io.invoicelead.app://lead-auth?code=${CODE}`,
      `https://evil.example/lead-auth/return?code=${CODE}`,
      "",
    ]) {
      const p = await relayPage({ platform: "ios" });
      p.finishSession({ url });
      await flush();
      expect(p.replaced, url).toEqual([BACK]);
    }
  });
});

describe("hors de l'app, rien ne change", () => {
  it("hors de l'app (aucun pont natif) : aucune écoute, aucun lien suivi, aucune navigation", async () => {
    for (const p of [
      fakePage({ bridge: false }),
      fakePage({ native: false }),
      fakePage({ app: false, browser: false }),
    ]) {
      expect(await listenForReturn(p.win, { issuer: ISSUER, locale: "fr" })).toBe(false);
      expect(p.listeners["App.appUrlOpen"]).toBeUndefined();
      p.appUrlOpen(LINK);
      expect(p.replaced).toEqual([]);
    }
    // Sans émetteur configuré : rien non plus, même dans l'app.
    const noIssuer = fakePage({ launch: LINK });
    expect(await listenForReturn(noIssuer.win, { issuer: undefined })).toBe(false);
    expect(noIssuer.listeners["App.appUrlOpen"]).toBeUndefined();
    expect(noIssuer.replaced).toEqual([]);
  });

  it("page relais hors de l'app (navigateur ordinaire) : l'écran de connexion d'ERPlead, sans rien ouvrir", () => {
    for (const p of [
      fakePage({ bridge: false }),
      fakePage({ native: false }),
      fakePage({ native: false, platform: "ios" }),
      fakePage({ app: false }),
    ]) {
      expect(startRelay(p.win, { issuer: ISSUER, start: START, back: BACK, locale: "it" })).toBe(
        "outside",
      );
      expect([...p.opened, ...p.sessions, ...p.externals]).toEqual([]);
      expect(p.replaced).toEqual([BACK]);
      expect(p.win.sessionStorage?.getItem(BACK_KEY)).toBeNull();
    }
  });

  it("agent de l'app : LeadAppAuth/2 seulement avec InvoiceLeadApp ; LeadAppAuth/1, anciennes versions et navigateurs comme avant", () => {
    const ios =
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148";
    expect(isAppAuthAgent(`${ios} InvoiceLeadApp LeadAppAuth/2`)).toBe(true);
    expect(isAppAuthAgent(`${ios} InvoiceLeadApp LeadAppAuth/3`)).toBe(true);
    // Première version (schéma propre, jamais publiée) : une ancienne version, comme chez ERPlead.
    expect(isAppAuthAgent(`${ios} InvoiceLeadApp LeadAppAuth/1`)).toBe(false);
    expect(isAppAuthAgent(`${ios} InvoiceLeadApp`)).toBe(false);
    expect(isAppAuthAgent(`${ios} InvoiceLeadApp LeadAppAuth/0`)).toBe(false);
    expect(isAppAuthAgent(`${ios} InvoiceLeadApp XLeadAppAuth/2`)).toBe(false);
    expect(isAppAuthAgent(`${ios} LeadAppAuth/2`)).toBe(false);
    expect(isAppAuthAgent(null)).toBe(false);
    expect(isNativeAgent(`${ios} InvoiceLeadApp LeadAppAuth/2`)).toBe(true);
  });
});

describe("page relais (/lead-auth/google?start&back)", () => {
  it("Android : page relais dans l'app : back gardé, Custom Tab ouvert sur start&m=auto ; refermé sans retour → back", async () => {
    // Une connexion notée par une page relais précédente : effacée, celle-ci la remplace.
    const local = pendingSince(new Map(), 60_000, "ancien");
    const p = fakePage({ local });
    expect(startRelay(p.win, { issuer: ISSUER, start: START, back: BACK, locale: "it" })).toBe(
      "opened",
    );
    await flush();
    expect(p.opened).toEqual([AUTO]);
    expect(p.win.sessionStorage?.getItem(BACK_KEY)).toBe(BACK);
    expect(p.listeners["App.appUrlOpen"]).toHaveLength(1);
    expect(JSON.parse(local.get(PENDING_KEY) ?? "null")).toEqual({ t: NOW, stale: null });
    expect(p.replaced).toEqual([]);
    p.browserFinished();
    expect(p.replaced).toEqual([]);
    expect(p.timers.map((t) => t.ms)).toContain(FINISHED_GRACE_MS);
    p.runTimers();
    expect(p.replaced).toEqual([BACK]);
    // Abandonnée : plus aucune connexion en cours.
    expect(local.has(PENDING_KEY)).toBe(false);
  });

  it("navigateur refermé puis lien de retour (Android) : le rachat l'emporte, pas de retour à l'écran de connexion", async () => {
    const p = fakePage();
    startRelay(p.win, { issuer: ISSUER, start: START, back: BACK, locale: "it" });
    await flush();
    p.browserFinished();
    p.appUrlOpen(LINK);
    p.runTimers();
    expect(p.replaced).toEqual([REDEEM]);
    expect(p.closed()).toBe(1);
  });

  it("page relais, navigateur par défaut d'iOS (openExternal) : le texte dit « votre navigateur », jamais « Safari », cinq langues, avec le bouton « Ouvrir InvoiceLead » de la page d'ERPlead", () => {
    // UIApplication.open ouvre le navigateur par défaut (Safari, ou Chrome, Firefox… choisi depuis iOS 14).
    const expected: Record<string, [string, string]> = {
      fr: ["votre navigateur", "«\u202fOuvrir InvoiceLead\u202f»"],
      de: ["Ihrem Browser", "„InvoiceLead öffnen“"],
      en: ["your browser", "“Open InvoiceLead”"],
      it: ["nel tuo browser", "«Apri InvoiceLead»"],
      es: ["tu navegador", "«Abrir InvoiceLead»"],
    };
    for (const [locale, [browser, button]] of Object.entries(expected)) {
      const messages = JSON.parse(
        readFileSync(join(process.cwd(), "messages", `${locale}.json`), "utf8"),
      );
      const text: string = messages.leadAppAuth.relaySafari;
      expect(text, locale).not.toMatch(/safari/i);
      expect(text, locale).toContain(browser);
      expect(text, locale).toContain(button);
    }
  });

  it("navigateur du téléphone impossible à ouvrir : retour à l'écran de connexion d'ERPlead", async () => {
    const local = new Map<string, string>();
    const p = fakePage({ openFails: true, local });
    startRelay(p.win, { issuer: ISSUER, start: START, back: BACK, locale: "it" });
    await flush();
    expect(p.replaced).toEqual([BACK]);
    expect(local.has(PENDING_KEY)).toBe(false);
  });

  it("page relais : start ou back étrangers, ou start avec un mode déjà posé → rien n'est ouvert, connexion ordinaire de l'app", () => {
    const bad: [unknown, unknown][] = [
      ["https://evil.example/auth/google/app/start?d=x", BACK],
      ["https://erplead.io.evil.example/auth/google/app/start?d=x", BACK],
      ["http://erplead.io/auth/google/app/start?d=x", BACK],
      ["https://erplead.io/auth/google/app/startx?d=x", BACK],
      ["https://erplead.io/auth/google/app/start", BACK],
      ['https://erplead.io/auth/google/app/start?d=x"><script>', BACK],
      ["https://erplead.io/auth/google/app/start?d= x", BACK],
      ["javascript:alert(1)//https://erplead.io/auth/google/app/start?", BACK],
      [`${START}&m=tap`, BACK],
      [`${ISSUER}/auth/google/app/start?m=auto&d=x`, BACK],
      [START, "https://evil.example/login?next=x"],
      [START, "https://erplead.io/logout?x"],
      [START, "https://erplead.io/login"],
      [START, "https://erplead.io@evil.example/login?x"],
      [START, "https://erplead.io/login?x\\y"],
      [`${START}${"x".repeat(5000)}`, BACK],
      [undefined, BACK],
      [START, ["a", "b"]],
    ];
    for (const [start, back] of bad) {
      expect(relayTargets(ISSUER, start, back), `${start} ${back}`).toBeNull();
      for (const platform of ["android", "ios"] as const) {
        const p = fakePage({ platform });
        expect(startRelay(p.win, { issuer: ISSUER, start, back, locale: "it" })).toBe("invalid");
        expect([...p.opened, ...p.sessions, ...p.externals]).toEqual([]);
        expect(p.replaced).toEqual(["/auth/lead/start?locale=it"]);
      }
    }
    expect(relayTargets(ISSUER, START, BACK)).toEqual({ start: START, back: BACK });
    expect(relayTargets(null, START, BACK)).toBeNull();
    expect(withMode(START, "auto")).toBe(AUTO);
    expect(withMode(START, "tap")).toBe(TAP);
  });

  it("émetteur : LEAD_ID_ISSUER (https, sans chemin), sinon rien", () => {
    expect(issuerOrigin("https://erplead.io")).toBe("https://erplead.io");
    expect(issuerOrigin("https://erplead.io/")).toBe("https://erplead.io");
    expect(issuerOrigin("http://localhost:4010")).toBe("http://localhost:4010");
    for (const v of [
      "http://erplead.io",
      "https://erplead.io/x",
      "https://u:p@erplead.io",
      "erplead.io",
      "",
      undefined,
      null,
    ])
      expect(issuerOrigin(v), String(v)).toBeNull();
  });
});

describe("page de retour /lead-auth/return", () => {
  beforeAll(() => setTestEnv());

  it("dans l'app : l'adresse de la page suit les règles du lien de retour (connexion en cours → rachat ; sinon l'app) ; hors de l'app → page de repli", async () => {
    const search = `?code=${CODE}&locale=it`;
    // Connexion en cours (notée par la page relais) : rachat, une seule fois.
    const local = pendingSince(new Map(), 30_000);
    const inApp = fakePage({ local, pathname: "/it/lead-auth/return", search });
    expect(await followReturnPage(inApp.win, { issuer: ISSUER, locale: "it" })).toBe("followed");
    expect(inApp.replaced).toEqual([REDEEM]);
    expect(local.has(PENDING_KEY)).toBe(false);
    // Rechargée : déjà suivi → l'app.
    const again = fakePage({
      local: pendingSince(local, 1000),
      pathname: "/it/lead-auth/return",
      search,
    });
    expect(await followReturnPage(again.win, { issuer: ISSUER, locale: "it" })).toBe("ignored");
    expect(again.replaced).toEqual(["/it/app"]);
    // Sans connexion en cours (lien piégé ouvert dans la vue web) : l'app, aucun rachat.
    const trap = fakePage({ pathname: "/fr/lead-auth/return", search });
    expect(await followReturnPage(trap.win, { issuer: ISSUER, locale: "fr" })).toBe("ignored");
    expect(trap.replaced).toEqual(["/fr/app"]);
    // Lien d'erreur pendant une connexion : l'écran de connexion de l'app.
    const expired = fakePage({
      local: pendingSince(new Map(), 1000),
      pathname: "/es/lead-auth/return",
      search: "?error=expired&locale=es",
    });
    expect(await followReturnPage(expired.win, { issuer: ISSUER, locale: "es" })).toBe("followed");
    expect(expired.replaced).toEqual(["/auth/lead/start?locale=es"]);
    // Hors de l'app : la page de repli, qui efface le code de l'adresse.
    const outside = fakePage({ bridge: false, pathname: "/it/lead-auth/return", search });
    expect(await followReturnPage(outside.win, { issuer: ISSUER, locale: "it" })).toBe("outside");
    expect(outside.replaced).toEqual([`/lead-auth/return${search}`]);
    // Dans l'app sans émetteur : l'app (jamais la page de repli, qui y ramènerait).
    const noIssuer = fakePage({ local: pendingSince(new Map(), 1000), search });
    expect(await followReturnPage(noIssuer.win, { issuer: null, locale: "it" })).toBe("ignored");
    expect(noIssuer.replaced).toEqual(["/it/app"]);
  });

  it("page de repli : 200 sans redirection, no-store, no-referrer, noindex, aucun script tiers, code jamais dans la page, cinq langues, phrase Android", async () => {
    const { GET } = await import("@/app/lead-auth/return/route");
    const get = async (query: string, headers: Record<string, string> = {}) => {
      const r = await GET(
        new NextRequest(`https://invoicelead.io/lead-auth/return${query}`, { headers }),
      );
      return { r, html: await r.text() };
    };
    const iphone = { "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X)" };
    const android = { "user-agent": "Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/140.0" };
    const titles = {
      fr: "Revenez dans InvoiceLead",
      de: "Zurück zu InvoiceLead",
      en: "Return to InvoiceLead",
      it: "Torna su InvoiceLead",
      es: "Vuelve a InvoiceLead",
    };
    const google = {
      fr: "«\u202fContinuer avec Google\u202f»",
      de: "„Weiter mit Google“",
      en: "“Continue with Google”",
      it: "«Continua con Google»",
      es: "«Continuar con Google»",
    };
    for (const [locale, title] of Object.entries(titles)) {
      const { r, html } = await get(`?code=${CODE}&locale=${locale}`, iphone);
      expect(r.status, locale).toBe(200);
      expect(r.headers.get("location")).toBeNull();
      expect(r.headers.get("content-type")).toBe("text/html; charset=utf-8");
      expect(r.headers.get("cache-control")).toBe("no-store");
      expect(r.headers.get("referrer-policy")).toBe("no-referrer");
      expect(r.headers.get("x-robots-tag")).toBe("noindex");
      expect(html).toContain(`<h1>${title}</h1>`);
      expect(html).toContain(google[locale as keyof typeof google]);
      expect(html).toContain("App Store");
      expect(html).not.toContain(CODE);
      expect(html).not.toContain("data-android");
      // Un seul script, dans la page, sans source externe ; aucun lien, aucun bouton.
      expect(html.match(/<script/g)).toHaveLength(1);
      expect(html).not.toMatch(/<script[^>]*\bsrc=/);
      expect(html).not.toMatch(/<a\b|<button|<form|<iframe|<img|<link/);
      expect(html).toContain('<meta name="referrer" content="no-referrer">');
    }
    // Phrase Android : « Ouvrir par défaut ».
    const fr = await get(`?code=${CODE}&locale=fr`, android);
    expect(fr.html).toContain("Réglages &gt; Applications &gt; InvoiceLead &gt; Ouvrir par défaut");
    expect(fr.html).toContain("data-android");
    // Sans langue : celle du navigateur ; lien d'erreur : la même page.
    const de = await get("?error=expired", { ...iphone, "accept-language": "de-CH,de;q=0.9" });
    expect(de.html).toContain('<html lang="de-CH">');
    expect(de.html).toContain("<h1>Zurück zu InvoiceLead</h1>");
    // Langue inconnue ou piégée : jamais reprise telle quelle.
    const odd = await get(`?locale=${encodeURIComponent('"><script>x</script>')}`, iphone);
    expect(odd.html).not.toContain("<script>x");
    expect(odd.html.match(/<script/g)).toHaveLength(1);
  });

  it("page de repli sur iPhone et iPad (iPad en mode ordinateur compris) : le remède d'iOS (appui long sur « Ouvrir InvoiceLead », puis « Ouvrir dans InvoiceLead », Safari comme navigateur par défaut), cinq langues ; ni sur Android ni sur un autre appareil", async () => {
    const { GET } = await import("@/app/lead-auth/return/route");
    const page = async (locale: string, ua: string) =>
      (
        await GET(
          new NextRequest(`https://invoicelead.io/lead-auth/return?code=${CODE}&locale=${locale}`, {
            headers: { "user-agent": ua },
          }),
        )
      ).text();
    const agents = {
      iphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 16_7 like Mac OS X) AppleWebKit/605.1.15",
      ipad: "Mozilla/5.0 (iPad; CPU OS 17_2 like Mac OS X) AppleWebKit/605.1.15",
      // iPad en mode ordinateur (par défaut depuis iPadOS 13) : l'agent d'un Mac.
      desktopIpad:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15",
      chromeIos:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0 Mobile/15E148 Safari/604.1",
    };
    const remedy: Record<string, string[]> = {
      fr: [
        "Sur iPhone ou iPad",
        "appuyez longuement sur «\u202fOuvrir InvoiceLead\u202f»",
        "«\u202fOuvrir dans InvoiceLead\u202f»",
        "Safari comme navigateur par défaut",
      ],
      de: [
        "Auf dem iPhone oder iPad",
        "„InvoiceLead öffnen“ gedrückt",
        "„In InvoiceLead öffnen“",
        "Safari als Standardbrowser",
      ],
      en: [
        "On iPhone or iPad",
        "press and hold “Open InvoiceLead”",
        "“Open in InvoiceLead”",
        "Safari as the default browser",
      ],
      it: [
        "Su iPhone o iPad",
        "tieni premuto «Apri InvoiceLead»",
        "«Apri in InvoiceLead»",
        "Safari come browser predefinito",
      ],
      es: [
        "En iPhone o iPad",
        "mantén pulsado «Abrir InvoiceLead»",
        "«Abrir en InvoiceLead»",
        "Safari como navegador predeterminado",
      ],
    };
    for (const [locale, parts] of Object.entries(remedy))
      for (const [name, ua] of Object.entries(agents)) {
        const html = await page(locale, ua);
        expect(html, `${locale} ${name}`).toContain("<p data-ios>");
        for (const part of parts) expect(html, `${locale} ${name}`).toContain(esc(part));
        expect(html).not.toContain("data-android");
        expect(html).not.toContain(CODE);
      }
    // Android : la phrase Android seule ; ordinateur Windows ou Linux : ni l'une ni l'autre.
    const android = await page("fr", "Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/140.0");
    expect(android).toContain("data-android");
    expect(android).not.toContain("data-ios");
    const windows = await page("it", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/140.0");
    expect(windows).not.toMatch(/data-ios|data-android/);
  });

  it("page de repli : son script efface le code de l'adresse hors de l'app, et mène l'app à /<langue>/lead-auth/return avec la même recherche", () => {
    const run = (capacitor: unknown) => {
      const replaced: string[] = [];
      const states: unknown[][] = [];
      const html = { className: "" };
      const window = { Capacitor: capacitor };
      runInNewContext(returnPageScript("it"), {
        window,
        document: { documentElement: html },
        location: { search: `?code=${CODE}&locale=it`, replace: (u: string) => replaced.push(u) },
        history: { replaceState: (...a: unknown[]) => states.push(a) },
      });
      return { replaced, states, html };
    };
    // Navigateur (aucun pont, ou pont non natif) : l'adresse devient /lead-auth/return, sans code.
    for (const cap of [undefined, { isNativePlatform: () => false }, { isNativePlatform: 1 }]) {
      const out = run(cap);
      expect(out.replaced).toEqual([]);
      expect(out.states).toEqual([[null, "", "/lead-auth/return"]]);
    }
    // Dans l'app : la page de l'app suit le lien (même recherche), l'écran de repli est masqué.
    const app = run({ isNativePlatform: () => true });
    expect(app.replaced).toEqual([`/it/lead-auth/return?code=${CODE}&locale=it`]);
    expect(app.states).toEqual([]);
    expect(app.html.className).toBe("app");
  });
});

describe("fichiers d'association (.well-known)", () => {
  it("apple-app-site-association et assetlinks.json : JSON exact du contrat (App ID X6K5247J6G.io.invoicelead.app, paquet io.invoicelead.app, Play App Signing et clé d'envoi), application/json", async () => {
    const aasa = await import("@/app/.well-known/apple-app-site-association/route");
    const links = await import("@/app/.well-known/assetlinks.json/route");
    const a = aasa.GET();
    expect(a.status).toBe(200);
    expect(a.headers.get("content-type")).toBe("application/json");
    expect(aasa.dynamic).toBe("force-static");
    expect(await a.json()).toEqual({
      applinks: {
        details: [
          {
            appIDs: ["X6K5247J6G.io.invoicelead.app"],
            components: [
              {
                "/": "/lead-auth/return",
                comment: "Retour de « Continuer avec Google » (Compte Lead) vers l'app",
              },
            ],
          },
        ],
      },
      webcredentials: { apps: ["X6K5247J6G.io.invoicelead.app"] },
    });
    const l = links.GET();
    expect(l.status).toBe(200);
    expect(l.headers.get("content-type")).toBe("application/json");
    expect(await l.json()).toEqual([
      {
        relation: ["delegate_permission/common.handle_all_urls"],
        target: {
          namespace: "android_app",
          package_name: "io.invoicelead.app",
          sha256_cert_fingerprints: [
            "88:49:FC:61:6B:A1:B0:A9:8D:87:E4:0E:B3:DE:4C:CD:18:4C:AA:61:1C:93:0C:1A:95:4D:2F:CE:94:0B:7F:54",
            "7B:E5:3E:52:B6:BB:67:F5:F2:FB:93:4B:A4:4A:58:D9:AA:BC:EE:EC:B3:B7:41:F3:BC:36:97:6B:F0:EF:80:F6",
          ],
        },
      },
    ]);
  });
});

describe("proxy : page relais sans langue, lien de retour et fichiers d'association hors du proxy", () => {
  beforeAll(() => setTestEnv());
  const APP_UA =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 InvoiceLeadApp LeadAppAuth/2";
  async function proxy(path: string, extra: Record<string, string> = {}) {
    const { default: run } = await import("@/proxy");
    return run(
      new NextRequest(`https://invoicelead.io${path}`, {
        headers: { "user-agent": APP_UA, "accept-language": "de-CH,de;q=0.9", ...extra },
      }),
    ) as NextResponse;
  }

  it("/lead-auth/google sans langue → la page relais dans la langue de back, paramètres gardés", async () => {
    const search = `?${new URLSearchParams({ start: START, back: BACK })}`;
    const r = await proxy(`${RELAY_PATH}${search}`);
    expect(r.status).toBe(307);
    const to = new URL(r.headers.get("location") ?? "");
    expect(to.pathname).toBe(`/it${RELAY_PATH}`);
    expect(to.searchParams.get("start")).toBe(START);
    expect(to.searchParams.get("back")).toBe(BACK);
    expect(r.headers.get("cache-control")).toBe("no-store");
    // Sans langue dans back : celle de l'app (cookie, puis téléphone).
    const plain = await proxy(`${RELAY_PATH}?start=x`);
    expect(new URL(plain.headers.get("location") ?? "").pathname).toBe(`/de${RELAY_PATH}`);
    const chosen = await proxy(`${RELAY_PATH}?back=nope`, { cookie: "NEXT_LOCALE=es" });
    expect(new URL(chosen.headers.get("location") ?? "").pathname).toBe(`/es${RELAY_PATH}`);
  });

  it("proxy : /lead-auth/return et /.well-known/… hors du proxy (aucune langue, aucune redirection) ; la page relais et les pages de l'app y restent", async () => {
    const { config } = await import("@/proxy");
    const matched = new RegExp(`^${config.matcher}$`);
    for (const path of [
      "/lead-auth/return",
      "/.well-known/apple-app-site-association",
      "/.well-known/assetlinks.json",
    ])
      expect(matched.test(path), path).toBe(false);
    for (const path of ["/lead-auth/google", "/it/lead-auth/return", "/it/app", "/", "/de/login"])
      expect(matched.test(path), path).toBe(true);
  });
});
