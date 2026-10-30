import { NextRequest, type NextResponse } from "next/server";
import { beforeAll, describe, expect, it } from "vitest";
import {
  APP_SCHEME,
  type AppWindow,
  BACK_KEY,
  FINISHED_GRACE_MS,
  issuerOrigin,
  LAUNCH_TIMEOUT_MS,
  listenForReturn,
  loginFallback,
  parseReturnLink,
  RELAY_PATH,
  redeemUrl,
  relayTargets,
  SEEN_KEY,
  startRelay,
} from "@/lib/lead-app-auth";
import { isAppAuthAgent, isNativeAgent } from "@/lib/native";
import { setTestEnv } from "../support/env";

/**
 * « Continuer avec Google » dans l'app Android / iOS (lib/lead-app-auth.ts, contrat d'ERPlead
 * docs/GOOGLE-APP.md) : le lien de retour `io.invoicelead.app://lead-auth?code=…` ferme le navigateur
 * du téléphone et mène la vue web au rachat d'ERPlead, une seule fois ; tout autre lien est ignoré ;
 * hors de l'app, rien ne change. Le pont Capacitor est simulé (window.Capacitor, comme l'injecte la
 * coque native : isNativePlatform, Plugins.App, Plugins.Browser).
 */

const ISSUER = "https://erplead.io";
const CODE = "Abc_DEF-123456789012345678901234567890abcde";
const LINK = `${APP_SCHEME}://lead-auth?code=${CODE}`;
const START = `${ISSUER}/auth/google/app/start?d=invoicelead.${"x".repeat(43)}`;
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

/** Une page de l'app (ou d'un navigateur ordinaire si native = false), avec son faux pont. */
function fakePage(
  opts: {
    native?: boolean;
    bridge?: boolean;
    app?: boolean;
    browser?: boolean;
    launch?: string | null;
    launchFails?: boolean;
    launchHangs?: boolean;
    closeFails?: boolean;
    openFails?: boolean;
    local?: Map<string, string>;
    session?: Map<string, string>;
  } = {},
) {
  const { native = true, bridge = true, app = true, browser = true } = opts;
  const replaced: string[] = [];
  const opened: string[] = [];
  let closed = 0;
  const listeners: Record<string, ((e?: { url?: string }) => void)[]> = {};
  const timers: { fn: () => void; ms: number }[] = [];
  const on = (name: string) => (event: string, cb: (e?: { url?: string }) => void) => {
    const key = `${name}.${event}`;
    listeners[key] = [...(listeners[key] ?? []), cb];
    return { remove: async () => {} };
  };
  const win: AppWindow = {
    location: { replace: (u: string) => void replaced.push(u) },
    localStorage: memoryStorage(opts.local),
    sessionStorage: memoryStorage(opts.session),
    setTimeout: (fn: () => void, ms: number) => {
      timers.push({ fn, ms });
      return timers.length;
    },
  };
  if (bridge)
    win.Capacitor = {
      isNativePlatform: () => native,
      Plugins: {
        ...(app
          ? {
              App: {
                addListener: on("App") as never,
                getLaunchUrl: () =>
                  opts.launchHangs
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
      },
    };
  const emit = (key: string, e?: { url?: string }) => {
    for (const cb of listeners[key] ?? []) cb(e);
  };
  return {
    win,
    replaced,
    opened,
    closed: () => closed,
    listeners,
    timers,
    appUrlOpen: (url: string) => emit("App.appUrlOpen", { url }),
    browserFinished: () => emit("Browser.browserFinished"),
    runTimers: () => {
      for (const t of timers.splice(0)) t.fn();
    },
  };
}
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("lien de retour de l'app (io.invoicelead.app://lead-auth)", () => {
  it("lien de retour : schéma exact io.invoicelead.app, hôte lead-auth, code de 43 caractères → rachat d'ERPlead", () => {
    expect(parseReturnLink(LINK)).toEqual({ kind: "code", code: CODE });
    expect(parseReturnLink(`${LINK}#x`)).toEqual({ kind: "code", code: CODE });
    expect(redeemUrl(ISSUER, CODE)).toBe(`https://erplead.io/auth/google/app/redeem?code=${CODE}`);
    expect(() => redeemUrl(ISSUER, "court")).toThrow();
    // Lien de l'app sans code valable : retour à l'écran de connexion.
    for (const url of [
      `${APP_SCHEME}://lead-auth?error=expired`,
      `${APP_SCHEME}://lead-auth?code=${CODE.slice(1)}`,
      `${APP_SCHEME}://lead-auth?code=${CODE}x`,
      `${APP_SCHEME}://lead-auth?code=${CODE.slice(1)}%2F`,
      `${APP_SCHEME}://lead-auth?`,
    ])
      expect(parseReturnLink(url), url).toEqual({ kind: "error" });
    // Tout autre lien : ignoré.
    for (const url of [
      `io.crmlead.app://lead-auth?code=${CODE}`,
      `io.crmlead.app://sso?code=${CODE}`,
      `io.scanlead.app://lead-auth?code=${CODE}`,
      `${APP_SCHEME}://sso?code=${CODE}`,
      `${APP_SCHEME}://lead-auth/x?code=${CODE}`,
      `${APP_SCHEME}://lead-auth.evil?code=${CODE}`,
      `${APP_SCHEME}.evil://lead-auth?code=${CODE}`,
      `IO.INVOICELEAD.APP://lead-auth?code=${CODE}`,
      `${APP_SCHEME}://lead-auth`,
      `https://invoicelead.io/lead-auth?code=${CODE}`,
      `x${LINK}`,
      `${LINK}${"a".repeat(5000)}`,
      "",
      null,
      undefined,
      42,
    ])
      expect(parseReturnLink(url), String(url)).toBeNull();
  });

  it("appUrlOpen : le lien de l'app ferme le navigateur du téléphone et mène au rachat d'ERPlead avec le code, une seule fois", async () => {
    const local = new Map<string, string>();
    const p = fakePage({ local });
    expect(await listenForReturn(p.win, { issuer: ISSUER, locale: "it" })).toBe(false);
    expect(p.listeners["App.appUrlOpen"]).toHaveLength(1);
    p.appUrlOpen(LINK);
    expect(p.closed()).toBe(1);
    expect(p.replaced).toEqual([`${ISSUER}/auth/google/app/redeem?code=${CODE}`]);
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
    const first = fakePage({ launch: LINK, local });
    expect(await listenForReturn(first.win, { issuer: ISSUER, locale: "fr" })).toBe(true);
    expect(first.replaced).toEqual([`${ISSUER}/auth/google/app/redeem?code=${CODE}`]);
    expect(first.closed()).toBe(1);
    first.appUrlOpen(LINK);
    expect(first.replaced).toHaveLength(1);
    // Page suivante (retour de l'autorisation dans l'app) : iOS redonne le dernier lien à getLaunchUrl.
    const next = fakePage({ launch: LINK, local });
    expect(await listenForReturn(next.win, { issuer: ISSUER, locale: "fr" })).toBe(false);
    expect(next.replaced).toEqual([]);
    expect(next.closed()).toBe(0);
    // Un nouveau lien (nouvelle connexion) est traité.
    const other = `${APP_SCHEME}://lead-auth?code=${"Z".repeat(43)}`;
    next.appUrlOpen(other);
    expect(next.replaced).toEqual([`${ISSUER}/auth/google/app/redeem?code=${"Z".repeat(43)}`]);
    expect(JSON.parse(local.get(SEEN_KEY) ?? "[]")).toHaveLength(2);
  });

  it("liens étrangers ou mal formés ignorés : autre schéma, autre hôte, ancien io.crmlead.app://sso, adresse web", async () => {
    const p = fakePage({ launch: `io.crmlead.app://sso?code=${CODE}` });
    expect(await listenForReturn(p.win, { issuer: ISSUER, locale: "de" })).toBe(false);
    for (const url of [
      `io.crmlead.app://sso?code=${CODE}`,
      `io.projectlead.app://lead-auth?code=${CODE}`,
      `${APP_SCHEME}://sso?code=${CODE}`,
      `${APP_SCHEME}://lead-auth/autre?code=${CODE}`,
      `https://invoicelead.io/fr/app`,
      "",
    ])
      p.appUrlOpen(url);
    expect(p.replaced).toEqual([]);
    expect(p.closed()).toBe(0);
  });

  it("lien de l'app sans code valable (error=expired, code abîmé) : écran de connexion gardé par la page relais, sinon connexion ordinaire", async () => {
    const withBack = fakePage({ session: new Map([[BACK_KEY, BACK]]) });
    await listenForReturn(withBack.win, { issuer: ISSUER, locale: "it" });
    withBack.appUrlOpen(`${APP_SCHEME}://lead-auth?error=expired`);
    expect(withBack.closed()).toBe(1);
    expect(withBack.replaced).toEqual([BACK]);
    expect(withBack.win.sessionStorage?.getItem(BACK_KEY)).toBeNull();

    const without = fakePage();
    await listenForReturn(without.win, { issuer: ISSUER, locale: "it" });
    without.appUrlOpen(`${APP_SCHEME}://lead-auth?code=abime`);
    expect(without.replaced).toEqual(["/auth/lead/start?locale=it"]);

    // Un `back` gardé mais étranger n'est jamais suivi.
    const forged = fakePage({ session: new Map([[BACK_KEY, "https://evil.example/login?x"]]) });
    await listenForReturn(forged.win, { issuer: ISSUER, locale: "es" });
    forged.appUrlOpen(`${APP_SCHEME}://lead-auth?error=expired`);
    expect(forged.replaced).toEqual(["/auth/lead/start?locale=es"]);
    expect(loginFallback(undefined)).toBe("/auth/lead/start");
    expect(loginFallback("x/../y")).toBe("/auth/lead/start");
  });

  it("Browser.close en erreur (Android : rien à fermer) : le rachat a lieu quand même", async () => {
    const p = fakePage({ closeFails: true });
    await listenForReturn(p.win, { issuer: ISSUER });
    p.appUrlOpen(LINK);
    await flush();
    expect(p.closed()).toBe(1);
    expect(p.replaced).toEqual([`${ISSUER}/auth/google/app/redeem?code=${CODE}`]);
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
      fakePage({ browser: false }),
    ]) {
      expect(startRelay(p.win, { issuer: ISSUER, start: START, back: BACK, locale: "it" })).toBe(
        "outside",
      );
      expect(p.opened).toEqual([]);
      expect(p.replaced).toEqual([BACK]);
      expect(p.win.sessionStorage?.getItem(BACK_KEY)).toBeNull();
    }
  });

  it("agent de l'app : LeadAppAuth/1 seulement avec InvoiceLeadApp ; anciennes versions et navigateurs comme avant", () => {
    const ios =
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148";
    expect(isAppAuthAgent(`${ios} InvoiceLeadApp LeadAppAuth/1`)).toBe(true);
    expect(isAppAuthAgent(`${ios} InvoiceLeadApp LeadAppAuth/2`)).toBe(true);
    expect(isAppAuthAgent(`${ios} InvoiceLeadApp`)).toBe(false);
    expect(isAppAuthAgent(`${ios} InvoiceLeadApp LeadAppAuth/0`)).toBe(false);
    expect(isAppAuthAgent(`${ios} InvoiceLeadApp XLeadAppAuth/1`)).toBe(false);
    expect(isAppAuthAgent(`${ios} LeadAppAuth/1`)).toBe(false);
    expect(isAppAuthAgent(null)).toBe(false);
    expect(isNativeAgent(`${ios} InvoiceLeadApp LeadAppAuth/1`)).toBe(true);
  });
});

describe("page relais (/lead-auth/google?start&back)", () => {
  it("page relais dans l'app : back gardé, navigateur du téléphone ouvert sur start ; refermé sans retour → back", async () => {
    const p = fakePage();
    expect(startRelay(p.win, { issuer: ISSUER, start: START, back: BACK, locale: "it" })).toBe(
      "opened",
    );
    await flush();
    expect(p.opened).toEqual([START]);
    expect(p.win.sessionStorage?.getItem(BACK_KEY)).toBe(BACK);
    expect(p.listeners["App.appUrlOpen"]).toHaveLength(1);
    expect(p.replaced).toEqual([]);
    p.browserFinished();
    expect(p.replaced).toEqual([]);
    expect(p.timers.map((t) => t.ms)).toContain(FINISHED_GRACE_MS);
    p.runTimers();
    expect(p.replaced).toEqual([BACK]);
  });

  it("navigateur refermé puis lien de retour (Android) : le rachat l'emporte, pas de retour à l'écran de connexion", async () => {
    const p = fakePage();
    startRelay(p.win, { issuer: ISSUER, start: START, back: BACK, locale: "it" });
    await flush();
    p.browserFinished();
    p.appUrlOpen(LINK);
    p.runTimers();
    expect(p.replaced).toEqual([`${ISSUER}/auth/google/app/redeem?code=${CODE}`]);
    expect(p.closed()).toBe(1);
  });

  it("navigateur du téléphone impossible à ouvrir : retour à l'écran de connexion d'ERPlead", async () => {
    const p = fakePage({ openFails: true });
    startRelay(p.win, { issuer: ISSUER, start: START, back: BACK, locale: "it" });
    await flush();
    expect(p.replaced).toEqual([BACK]);
  });

  it("page relais : start ou back étrangers → rien n'est ouvert, connexion ordinaire de l'app", () => {
    const bad: [unknown, unknown][] = [
      ["https://evil.example/auth/google/app/start?d=x", BACK],
      ["https://erplead.io.evil.example/auth/google/app/start?d=x", BACK],
      ["http://erplead.io/auth/google/app/start?d=x", BACK],
      ["https://erplead.io/auth/google/app/startx?d=x", BACK],
      ["https://erplead.io/auth/google/app/start", BACK],
      ['https://erplead.io/auth/google/app/start?d=x"><script>', BACK],
      ["https://erplead.io/auth/google/app/start?d= x", BACK],
      ["javascript:alert(1)//https://erplead.io/auth/google/app/start?", BACK],
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
      const p = fakePage();
      expect(startRelay(p.win, { issuer: ISSUER, start, back, locale: "it" })).toBe("invalid");
      expect(p.opened).toEqual([]);
      expect(p.replaced).toEqual(["/auth/lead/start?locale=it"]);
    }
    expect(relayTargets(ISSUER, START, BACK)).toEqual({ start: START, back: BACK });
    expect(relayTargets(null, START, BACK)).toBeNull();
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

describe("proxy : la page relais sans langue", () => {
  beforeAll(() => setTestEnv());
  const APP_UA =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 InvoiceLeadApp LeadAppAuth/1";
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
});
