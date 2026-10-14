import { generateKeyPairSync, sign } from "node:crypto";
import { NextRequest, type NextResponse } from "next/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { leadAppItems } from "@/lib/lead-apps";
import { entryRedirect, safeFrom, silentError } from "@/lib/lead-entry";
import type { LeadClaims } from "@/server/lead-id/leadId";
import { claims } from "../support/claims";
import { testDb } from "../support/db";
import { setTestEnv } from "../support/env";

/**
 * Passer d'une application Lead à l'autre (règle commune de la famille) : la racine tapée et /login
 * mènent tout droit dans l'espace quand la session du Compte Lead est ouverte ; sinon un seul essai
 * silencieux (prompt=none), puis la page publique, jamais un écran d'erreur ni une boucle. Le proxy
 * et les routes /auth/lead/* sont appelés tels quels ; seul l'échange du code au Compte Lead est
 * simulé (finishLogin), et les cookies de next/headers suivent ceux de la requête.
 */
const ctx = vi.hoisted(() => ({
  database: null as unknown,
  jar: new Map<string, string>(),
  claims: null as unknown,
}));

vi.mock("@/server/db", () => ({ db: () => ctx.database }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (ctx.jar.has(name) ? { name, value: ctx.jar.get(name) } : undefined),
    getAll: () => [...ctx.jar].map(([name, value]) => ({ name, value })),
    has: (name: string) => ctx.jar.has(name),
  }),
  headers: async () => new Headers(),
}));
vi.mock("@/server/lead-id/leadId", async (original) => ({
  ...(await original<typeof import("@/server/lead-id/leadId")>()),
  finishLogin: async (
    query: { code?: string; state?: string; error?: string },
    saved: { state: string },
  ) => {
    if (query.error) throw new Error(`lead_id:${query.error}`);
    if (!query.code || query.state !== saved.state) throw new Error("lead_id:state_mismatch");
    return { claims: ctx.claims as LeadClaims, tokens: { id_token: "id-token", expires_in: 600 } };
  },
}));

const t = testDb();
ctx.database = t.database;
beforeAll(() => setTestEnv());
beforeEach(async () => {
  await t.reset();
  ctx.jar = new Map();
  ctx.claims = claims();
});
afterAll(() => t.close());

const APP = "https://invoicelead.io";
const CHROME =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/141.0.0.0 Safari/537.36";
/** Une vraie navigation de document : la personne tape l'adresse ou suit un lien. */
const NAVIGATE = {
  "user-agent": CHROME,
  "sec-fetch-mode": "navigate",
  "sec-fetch-dest": "document",
  "accept-language": "de-CH,de;q=0.9",
};

function request(
  path: string,
  {
    cookies = {},
    headers = NAVIGATE,
    method = "GET",
    body,
  }: {
    cookies?: Record<string, string>;
    headers?: Record<string, string>;
    method?: string;
    body?: FormData;
  } = {},
) {
  ctx.jar = new Map(Object.entries(cookies));
  const cookie = Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
  return new NextRequest(`${APP}${path}`, {
    method,
    headers: { ...headers, ...(cookie ? { cookie } : {}) },
    ...(body ? { body } : {}),
  });
}

const where = (response: Response) => response.headers.get("location") ?? "";

async function proxy(path: string, options?: Parameters<typeof request>[1]) {
  const { default: run } = await import("@/proxy");
  return run(request(path, options)) as NextResponse;
}
async function start(path: string, options?: Parameters<typeof request>[1]) {
  const { GET } = await import("@/app/auth/lead/start/route");
  return GET(request(path, options));
}
async function callback(path: string, options?: Parameters<typeof request>[1]) {
  const { GET } = await import("@/app/auth/lead/callback/route");
  return GET(request(path, options));
}

/** Cookies posés par une réponse (nom → valeur), sans ceux qu'elle efface. */
function setCookies(response: NextResponse): Record<string, string> {
  return Object.fromEntries(
    response.cookies
      .getAll()
      .filter((c) => c.value !== "")
      .map((c) => [c.name, c.value]),
  );
}

/** Une personne déjà connectée à InvoiceLead : le jeton de son cookie de session. */
async function openSession(locale = "fr") {
  const { attachLeadIdentity } = await import("@/server/auth/attach");
  const { createSession } = await import("@/server/auth/session");
  const { user, organization } = await attachLeadIdentity(t.database, claims({ locale }));
  const session = await createSession(t.database, {
    userId: user.id,
    organizationId: organization.id,
    idToken: null,
  });
  return session.token;
}

describe("racine tapée avec une session InvoiceLead : l'accueil de l'espace", () => {
  it("« /fr » mène à /fr/app, « / » à l'accueil dans la langue du Compte Lead", async () => {
    const token = await openSession("en");
    const home = await proxy("/fr", { cookies: { il_session: token } });
    expect(home.status).toBe(307);
    expect(where(home)).toBe(`${APP}/auth/lead/start?prompt=none&from=%2Ffr&locale=fr`);
    expect(home.headers.get("cache-control")).toBe("no-store");
    expect(home.headers.get("vary")).toBe("Cookie");
    const fr = await start("/auth/lead/start?prompt=none&from=%2Ffr&locale=fr", {
      cookies: { il_session: token },
    });
    expect([fr.status, where(fr)]).toEqual([303, `${APP}/fr/app`]);

    const root = await proxy("/", { cookies: { il_session: token } });
    expect(where(root)).toBe(`${APP}/auth/lead/start?prompt=none&from=%2F`);
    // Même avec un lead_probe resté là : la session passe avant.
    const en = await start("/auth/lead/start?prompt=none&from=%2F", {
      cookies: { il_session: token, lead_probe: "1" },
    });
    expect([en.status, where(en)]).toEqual([303, `${APP}/en/app`]);
    const lang = await proxy("/?lang=de", { cookies: { il_session: token } });
    expect(where(lang)).toBe(`${APP}/auth/lead/start?prompt=none&from=%2F%3Flang%3Dde&locale=de`);
  });

  it("/login sans langue : départ sans langue, l'accueil dans la langue du Compte Lead", async () => {
    const token = await openSession("en");
    const login = await proxy("/login");
    expect([login.status, where(login)]).toEqual([303, `${APP}/auth/lead/start`]);
    const deep = await proxy("/login?next=%2Ffr%2Fapp%2Finvoices");
    expect(where(deep)).toBe(`${APP}/auth/lead/start?next=%2Ffr%2Fapp%2Finvoices`);
    const inside = await start("/auth/lead/start", { cookies: { il_session: token } });
    expect(where(inside)).toBe(`${APP}/en/app`);
    // /fr/login reste la page de connexion, qui part avec sa langue (login/page.tsx).
    expect(where(await proxy("/fr/login"))).not.toContain("/auth/lead/start");
  });

  it("préchargement du navigateur (adresse tapée dans Chrome) : 204 sans cache, jamais la page publique", async () => {
    const token = await openSession("fr");
    const prerender = { ...NAVIGATE, "sec-purpose": "prefetch;prerender" };
    const cases: [string, Parameters<typeof request>[1]][] = [
      // Session InvoiceLead ouverte : la page publique préchargée serait montrée à l'appui sur Entrée.
      ["/fr", { headers: prerender, cookies: { il_session: token } }],
      ["/", { headers: prerender, cookies: { il_session: token } }],
      [
        "/",
        { headers: { ...NAVIGATE, "sec-purpose": "prefetch" }, cookies: { il_session: token } },
      ],
      // Session de 12 h expirée, Compte Lead peut-être ouvert : l'essai silencieux doit avoir lieu.
      ["/fr", { headers: prerender }],
      ["/", { headers: { "user-agent": CHROME, purpose: "prefetch" } }],
      // /login des lanceurs : jamais l'écran de connexion préchargé.
      ["/login", { headers: prerender }],
      ["/login", { headers: prerender, cookies: { il_session: token } }],
    ];
    for (const [path, options] of cases) {
      const response = await proxy(path, options);
      const label = `${path} ${JSON.stringify(options?.headers)}`;
      expect(response.status, label).toBe(204);
      expect(response.headers.get("location"), label).toBeNull();
      expect(response.headers.get("cache-control"), label).toBe("no-store");
      expect(response.headers.get("vary"), label).toBe("Cookie");
      expect(await response.text(), label).toBe("");
    }
    // La vraie navigation qui suit applique la règle d'entrée.
    const real = await proxy("/fr", { cookies: { il_session: token } });
    expect([real.status, where(real)]).toEqual([
      307,
      `${APP}/auth/lead/start?prompt=none&from=%2Ffr&locale=fr`,
    ]);
    // Lectures du routeur de Next (lien interne vers l'accueil) : inchangées, Next les sert.
    for (const header of ["rsc", "next-router-prefetch"]) {
      const next = await proxy("/fr", {
        headers: { ...NAVIGATE, [header]: "1" },
        cookies: { il_session: token },
      });
      expect(next.status, header).not.toBe(204);
      expect(where(next), header).not.toContain("/auth/lead/start");
    }
  });
});

describe("racine tapée sans session : un seul essai silencieux, puis la page publique", () => {
  it("le premier chargement essaie sans écran, le suivant montre la page publique", async () => {
    const first = await proxy("/");
    expect(first.status).toBe(303);
    expect(where(first)).toBe(`${APP}/auth/lead/start?prompt=none&from=%2F`);
    expect(first.headers.get("cache-control")).toBe("no-store");
    expect(first.headers.get("vary")).toBe("Cookie");

    const go = await start("/auth/lead/start?prompt=none&from=%2F");
    expect(go.status).toBe(303);
    const authorize = new URL(where(go));
    expect(authorize.origin + authorize.pathname).toBe("https://crmlead.io/oauth/authorize");
    expect(authorize.searchParams.get("prompt")).toBe("none");
    // Pas de langue dans l'adresse : le Compte Lead garde celle de la personne.
    expect(authorize.searchParams.get("ui_locales")).toBeNull();
    const probe = go.cookies.get("lead_probe");
    expect(probe).toMatchObject({
      value: "1",
      maxAge: 600,
      path: "/",
      sameSite: "lax",
      secure: true,
    });
    expect(probe?.httpOnly).toBe(false);
    const { openState } = await import("@/server/auth/login-state");
    expect(
      openState(authorize.searchParams.get("state"), process.env.SESSION_SECRET ?? ""),
    ).toMatchObject({
      silent: true,
      from: "/",
      auto: true,
    });

    // Retour sur la racine avec lead_probe : la page publique, sans repartir.
    const again = await proxy("/", { cookies: { lead_probe: "1" } });
    expect(where(again)).not.toContain("/auth/lead/start");
    const fr = await proxy("/fr", { cookies: { lead_probe: "1" } });
    expect(fr.status).toBe(200);
    // Un départ silencieux qui trouve lead_probe revient tout de suite, sans le Compte Lead ; le cookie
    // suffit, l'adresse reste propre (la marque ne sert qu'aux cookies refusés).
    const back = await start("/auth/lead/start?prompt=none&from=%2Ffr&locale=fr", {
      cookies: { lead_probe: "1" },
    });
    expect([back.status, where(back)]).toEqual([303, `${APP}/fr`]);
  });

  it("garde la langue de l'adresse : « /fr », « /fr/ », « /?lang=fr »", async () => {
    expect(where(await proxy("/fr"))).toBe(
      `${APP}/auth/lead/start?prompt=none&from=%2Ffr&locale=fr`,
    );
    expect(where(await proxy("/fr/"))).toBe(
      `${APP}/auth/lead/start?prompt=none&from=%2Ffr%2F&locale=fr`,
    );
    expect(where(await proxy("/?lang=fr"))).toBe(
      `${APP}/auth/lead/start?prompt=none&from=%2F%3Flang%3Dfr&locale=fr`,
    );
    const go = await start("/auth/lead/start?prompt=none&from=%2Ffr&locale=fr");
    expect(new URL(where(go)).searchParams.get("ui_locales")).toBe("fr");
  });

  it("robots, préchargements, lectures du routeur, HEAD et adresse non tapée : aucun départ", async () => {
    const cases: [string, Parameters<typeof request>[1]][] = [
      ["/", { headers: { ...NAVIGATE, "user-agent": "Mozilla/5.0 (compatible; Googlebot/2.1)" } }],
      ["/fr", { headers: { ...NAVIGATE, "user-agent": "facebookexternalhit/1.1" } }],
      ["/fr", { headers: { ...NAVIGATE, "user-agent": "WhatsApp/2.23" } }],
      ["/fr", { headers: { ...NAVIGATE, rsc: "1" } }],
      ["/fr", { headers: { ...NAVIGATE, "next-router-prefetch": "1" } }],
      ["/fr", { headers: { ...NAVIGATE, "sec-purpose": "prefetch;prerender" } }],
      ["/fr", { method: "HEAD" }],
      ["/fr", { headers: { "user-agent": CHROME } }],
      ["/fr", { headers: { ...NAVIGATE, "sec-fetch-dest": "iframe" } }],
      ["/fr", { cookies: { lead_probe: "1" } }],
    ];
    for (const [path, options] of cases) {
      const response = await proxy(path, options);
      expect(where(response), JSON.stringify(options)).not.toContain("/auth/lead/start");
    }
    // Googlebot : la page publique elle-même, sans redirection.
    const bot = await proxy("/fr", {
      headers: { ...NAVIGATE, "user-agent": "Mozilla/5.0 (compatible; Googlebot/2.1)" },
    });
    expect(bot.status).toBe(200);
  });

  it("échec silencieux : retour sur la page publique, sans écran d'erreur ni relance", async () => {
    const go = await start("/auth/lead/start?prompt=none&from=%2Ffr&locale=fr");
    const state = new URL(where(go)).searchParams.get("state") ?? "";
    const jar = { ...setCookies(go) };
    for (const error of ["login_required", "interaction_required", "consent_required"]) {
      const back = await callback(`/auth/lead/callback?error=${error}&state=${state}`, {
        cookies: jar,
      });
      // Le cookie lead_probe est revenu : il arrête l'essai suivant, l'adresse reste propre.
      expect([back.status, where(back)]).toEqual([303, `${APP}/fr`]);
      expect(where(back)).not.toContain("erreur");
      // lead_probe reste : la racine ne repart pas.
      expect(back.cookies.get("lead_probe")).toBeUndefined();
    }
    // Demande perdue (autre navigateur, cookies effacés), state illisible : la racine, jamais l'écran,
    // avec la marque (aucun cookie lead_probe n'est revenu).
    const lost = await callback("/auth/lead/callback?error=login_required&state=abimé");
    expect(where(lost)).toBe(`${APP}/?lead_probe=1`);
    // Demande silencieuse sans son cookie, même avec un code : la page d'où elle part, sans relance.
    const orphan = await callback(`/auth/lead/callback?code=c&state=${state}`);
    expect(where(orphan)).toBe(`${APP}/fr?lead_probe=1`);
    // Une connexion ordinaire qui échoue garde son écran d'erreur.
    const plain = await start("/auth/lead/start?locale=fr");
    const plainState = new URL(where(plain)).searchParams.get("state") ?? "";
    const refused = await callback(`/auth/lead/callback?error=access_denied&state=${plainState}`, {
      cookies: setCookies(plain),
    });
    expect(where(refused)).toContain("/fr/login?erreur=lead");
  });

  it("session fermée par le Compte Lead (cookie sans session) : la page publique, cookie effacé", async () => {
    const back = await start("/auth/lead/start?prompt=none&from=%2F", {
      cookies: { il_session: "fermee", lead_probe: "1" },
    });
    expect([back.status, where(back)]).toEqual([303, `${APP}/`]);
    expect(back.cookies.get("il_session")?.maxAge).toBe(0);
    // Sans lead_probe : l'essai silencieux part, le cookie mort effacé.
    const go = await start("/auth/lead/start?prompt=none&from=%2F", {
      cookies: { il_session: "fermee" },
    });
    expect(new URL(where(go)).searchParams.get("prompt")).toBe("none");
    expect(go.cookies.get("il_session")?.maxAge).toBe(0);
    // Une entrée fraîche n'efface jamais rien (n'importe quel site peut l'ouvrir).
    const fresh = await start("/auth/lead/start?prompt=none&fresh=1&from=%2F", {
      cookies: { il_session: "autre", lead_probe: "1" },
    });
    expect(fresh.cookies.get("il_session")).toBeUndefined();
  });
});

/**
 * Un navigateur qui refuse tous les cookies : chaque requête part sans cookie, et ce que les réponses
 * posent est perdu. Les redirections sont suivies comme par le navigateur ; le Compte Lead est simulé
 * (session ouverte ou non, mais ses cookies à lui ne comptent pas ici). Rend le chemin parcouru, le
 * nombre de passages par /oauth/authorize et la dernière réponse.
 */
async function cookielessVisit(path: string, { leadOpen = false } = {}) {
  let url = new URL(`${APP}${path}`);
  const trail: string[] = [];
  let authorizes = 0;
  for (let hop = 0; hop < 20; hop++) {
    trail.push(url.href);
    let response: Response;
    if (url.pathname === "/oauth/authorize") {
      authorizes += 1;
      const back = new URL(url.searchParams.get("redirect_uri") ?? `${APP}/auth/lead/callback`);
      back.searchParams.set("state", url.searchParams.get("state") ?? "");
      if (url.searchParams.get("prompt") === "none" && !leadOpen)
        back.searchParams.set("error", "login_required");
      else back.searchParams.set("code", `code-${hop}`);
      response = new Response(null, { status: 302, headers: { location: back.href } });
    } else if (url.origin !== APP) {
      throw new Error(`adresse inattendue : ${url.href}`);
    } else if (url.pathname === "/auth/lead/start") {
      response = await start(`${url.pathname}${url.search}`);
    } else if (url.pathname === "/auth/lead/callback") {
      response = await callback(`${url.pathname}${url.search}`);
    } else {
      response = await proxy(`${url.pathname}${url.search}`);
    }
    const location = response.headers.get("location");
    if (response.status < 300 || response.status >= 400 || !location)
      return { trail, authorizes, final: url, response };
    url = new URL(location, url);
  }
  return { trail, authorizes, final: url, response: null };
}

describe("cookies refusés : jamais de boucle", () => {
  it("racine sans session du Compte Lead : un seul essai silencieux, puis la page publique", async () => {
    for (const path of ["/", "/fr", "/?lang=fr"]) {
      const visit = await cookielessVisit(path);
      expect(visit.response, visit.trail.join("\n")).not.toBeNull();
      expect(visit.response?.status, visit.trail.join("\n")).toBe(200);
      expect(visit.authorizes, visit.trail.join("\n")).toBe(1);
      expect(visit.final.searchParams.get("lead_probe")).toBe("1");
      expect(visit.final.pathname).toMatch(/^\/(de|fr|en)$/);
      // Recharger la page publique ne repart pas vers le Compte Lead.
      const again = await cookielessVisit(`${visit.final.pathname}${visit.final.search}`);
      expect([again.authorizes, again.response?.status, again.trail.length]).toEqual([0, 200, 1]);
    }
  });

  it("Compte Lead ouvert mais cookies d'InvoiceLead refusés : la page publique, sans relance", async () => {
    const visit = await cookielessVisit("/fr", { leadOpen: true });
    expect([visit.authorizes, visit.response?.status]).toEqual([1, 200]);
    expect(`${visit.final.pathname}${visit.final.search}`).toBe("/fr?lead_probe=1");
  });

  it("départ silencieux dont la page de retour porte déjà la marque : aucun passage au Compte Lead", async () => {
    const go = await start("/auth/lead/start?prompt=none&from=%2Ffr%3Flead_probe%3D1&locale=fr");
    expect([go.status, where(go)]).toEqual([303, `${APP}/fr?lead_probe=1`]);
    // La racine marquée ne repart pas, même sans cookie.
    expect(where(await proxy("/fr?lead_probe=1"))).not.toContain("/auth/lead/start");
    expect(where(await proxy("/?lead_probe=1"))).not.toContain("/auth/lead/start");
  });

  it("/login avec le Compte Lead ouvert : au plus une relance, puis l'écran d'erreur (pas de boucle)", async () => {
    const visit = await cookielessVisit("/login", { leadOpen: true });
    expect(visit.response, visit.trail.join("\n")).not.toBeNull();
    expect(visit.authorizes).toBeLessThanOrEqual(2);
    expect(`${visit.final.pathname}${visit.final.search}`).toMatch(
      /^\/(de|fr|en)\/login\?erreur=session/,
    );
  });
});

describe("arrivée dans l'espace", () => {
  it("connectée au Compte Lead : l'espace de son entreprise, dans la langue du Compte Lead", async () => {
    ctx.claims = claims({ locale: "en" });
    const go = await start("/auth/lead/start?prompt=none&from=%2F");
    const state = new URL(where(go)).searchParams.get("state") ?? "";
    // Le cookie de la demande et lead_probe, posés par le départ, reviennent avec le code.
    const jar = setCookies(go);
    expect(jar.lead_probe).toBe("1");
    const back = await callback(`/auth/lead/callback?code=abc&state=${state}`, { cookies: jar });
    expect([back.status, where(back)]).toEqual([303, `${APP}/en/app`]);
    expect(back.cookies.get("il_session")?.value).toMatch(/.{20,}/);
    // Connectée : lead_probe effacé, la racine mène de nouveau dans l'espace.
    expect(back.cookies.get("lead_probe")?.maxAge).toBe(0);
  });

  it("la session garde le sid du Compte Lead (déconnexion de ce navigateur seulement)", async () => {
    ctx.claims = { ...claims(), sid: "sid-navigateur-a" };
    const go = await start("/auth/lead/start?locale=fr");
    const state = new URL(where(go)).searchParams.get("state") ?? "";
    const back = await callback(`/auth/lead/callback?code=abc&state=${state}`, {
      cookies: setCookies(go),
    });
    expect(where(back)).toBe(`${APP}/fr/app`);
    const { sessions } = await import("@/server/db/schema");
    const rows = await t.database.select().from(sessions);
    expect(rows.map((r) => r.leadSid)).toEqual(["sid-navigateur-a"]);
    // Un sid inutilisable (trop long, pas une chaîne) n'est pas gardé.
    await t.reset();
    ctx.claims = { ...claims(), sid: "x".repeat(300) };
    const go2 = await start("/auth/lead/start?locale=fr");
    const state2 = new URL(where(go2)).searchParams.get("state") ?? "";
    await callback(`/auth/lead/callback?code=abc&state=${state2}`, { cookies: setCookies(go2) });
    expect((await t.database.select().from(sessions)).map((r) => r.leadSid)).toEqual([null]);
  });

  it("langue absente ou inconnue : le français, jamais l'allemand", async () => {
    const { pickLocale, localeFromRequest } = await import("@/server/auth/login-cookie");
    const { appLocale } = await import("@/server/auth/attach");
    for (const value of [undefined, null, "", "it", "es", "xx"]) {
      expect(pickLocale(value), String(value)).toBe("fr");
      expect(appLocale(value ?? undefined), String(value)).toBe("fr");
    }
    expect(pickLocale("de")).toBe("de");
    expect(appLocale("de-CH")).toBe("de");
    expect(localeFromRequest(undefined, null)).toBe("fr");
    expect(localeFromRequest(undefined, "it-CH,it;q=0.9")).toBe("fr");
    // Compte Lead en italien, arrivée par /login sans langue : l'espace en français.
    ctx.claims = claims({ locale: "it" });
    const login = await start("/auth/lead/start");
    const state = new URL(where(login)).searchParams.get("state") ?? "";
    const back = await callback(`/auth/lead/callback?code=abc&state=${state}`, {
      cookies: setCookies(login),
    });
    expect(where(back)).toBe(`${APP}/fr/app`);
  });

  it("langue des documents d'une nouvelle entreprise : celle du Compte Lead, sinon l'allemand comme avant", async () => {
    // Le repli français ne vaut que pour la langue d'arrivée (users.locale). La langue par défaut
    // des factures, devis et contacts (organizations.default_locale) garde l'ancienne règle.
    const { attachLeadIdentity } = await import("@/server/auth/attach");
    const cases: [string | undefined, string, string][] = [
      ["it", "fr", "de"],
      ["es-ES", "fr", "de"],
      [undefined, "fr", "de"],
      ["fr-CH", "fr", "fr"],
      ["en", "en", "en"],
      ["de-CH", "de", "de"],
    ];
    for (const [locale, userLocale, documentLocale] of cases) {
      const tag = String(locale);
      const { user, organization } = await attachLeadIdentity(
        t.database,
        claims({ locale, sub: `sub-${tag}`, email: `${tag}@atelier.test`, org: `org-${tag}` }),
      );
      expect(user.locale, tag).toBe(userLocale);
      expect(organization.defaultLocale, tag).toBe(documentLocale);
    }
    // Une collègue en italien qui arrive ensuite ne change pas la langue des documents.
    const { organization } = await attachLeadIdentity(
      t.database,
      claims({ locale: "it", sub: "sub-collegue", email: "bea@atelier.test", org: "org-fr-CH" }),
    );
    expect(organization.defaultLocale).toBe("fr");
  });

  it("la langue de l'adresse passe avant celle du Compte Lead, jamais celle du navigateur", async () => {
    ctx.claims = claims({ locale: "fr-CH" });
    // /login des lanceurs : navigateur en allemand, Compte Lead en français.
    const login = await start("/auth/lead/start");
    const state = new URL(where(login)).searchParams.get("state") ?? "";
    const back = await callback(`/auth/lead/callback?code=abc&state=${state}`, {
      cookies: setCookies(login),
    });
    expect(where(back)).toBe(`${APP}/fr/app`);
    // Demande revenue sans son cookie : la relance part sans langue, l'arrivée garde celle du Compte Lead.
    const again = await callback(`/auth/lead/callback?code=abc&state=${state}`);
    expect(where(again)).toBe(`${APP}/auth/lead/start?retry=1`);
    // Langue donnée par l'adresse : elle reste.
    const de = await start("/auth/lead/start?locale=de");
    const deState = new URL(where(de)).searchParams.get("state") ?? "";
    const deBack = await callback(`/auth/lead/callback?code=abc&state=${deState}`, {
      cookies: setCookies(de),
    });
    expect(where(deBack)).toBe(`${APP}/de/app`);
  });

  it("la déconnexion pose lead_probe : la racine montre ensuite la page publique", async () => {
    const token = await openSession();
    const { POST } = await import("@/app/auth/lead/logout/route");
    const body = new FormData();
    body.set("locale", "fr");
    const out = await POST(
      request("/auth/lead/logout", { method: "POST", cookies: { il_session: token }, body }),
    );
    expect(out.status).toBe(303);
    expect(out.cookies.get("lead_probe")).toMatchObject({ value: "1", maxAge: 600 });
    expect(out.cookies.get("il_session")?.maxAge).toBe(0);
  });

  it("le lanceur a six entrées, sans « Bientôt » ni mise à niveau", () => {
    const items = leadAppItems("invoicelead", "fr");
    expect(items).toHaveLength(6);
    expect(items.map((i) => i.code)).toEqual([
      "erplead",
      "scanlead",
      "crmlead",
      "projectlead",
      "invoicelead",
      "greetlead",
    ]);
    expect(items.every((i) => i.current || i.href?.startsWith("https://"))).toBe(true);
    expect(Object.keys(items[0] ?? {})).not.toContain("state");
  });
});

/**
 * Déconnexion annoncée par ERPlead (OpenID Connect Back-Channel Logout), route appelée telle quelle avec
 * un `logout_token` signé. ERPlead est mis en ligne en dernier : tant que celui de production n'envoie
 * pas de `sid`, une déconnexion ferme toutes les sessions de la personne (repli sûr), jamais une
 * erreur 500 ni une session laissée ouverte. Avec un `sid` : ce navigateur seulement.
 */
describe("déconnexion annoncée par ERPlead (route back-channel)", () => {
  // Émetteur des tests (setTestEnv : LEAD_ID_ISSUER) ; sa clé publique est servie par un faux JWKS.
  const ISS = "https://crmlead.io";
  const KID = "passage-backchannel";
  const key = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const other = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const EVENT = { "http://schemas.openid.net/event/backchannel-logout": {} };

  function logoutToken(claims: Record<string, unknown>, signer = key.privateKey, kid = KID) {
    const now = Math.floor(Date.now() / 1000);
    const head = Buffer.from(JSON.stringify({ alg: "RS256", kid })).toString("base64url");
    const body = Buffer.from(
      JSON.stringify({ iss: ISS, aud: "invoicelead", iat: now, exp: now + 120, ...claims }),
    ).toString("base64url");
    const sig = sign("sha256", Buffer.from(`${head}.${body}`), signer).toString("base64url");
    return `${head}.${body}.${sig}`;
  }

  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url === `${ISS}/oauth/jwks`
          ? Response.json({ keys: [{ ...key.publicKey.export({ format: "jwk" }), kid: KID }] })
          : new Response("{}", { status: 404 }),
      ),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  async function post(token?: string) {
    const { POST } = await import("@/app/auth/lead/backchannel-logout/route");
    const body = new FormData();
    if (token !== undefined) body.set("logout_token", token);
    return POST(request("/auth/lead/backchannel-logout", { method: "POST", headers: {}, body }));
  }

  /**
   * Ada sur trois sessions : navigateur A (bureau), navigateur B (téléphone), et une session ouverte
   * avant le `sid` (aucun). Bob, collègue, a sa propre session venue du même navigateur A.
   */
  async function devices() {
    const { attachLeadIdentity } = await import("@/server/auth/attach");
    const { createSession } = await import("@/server/auth/session");
    const ada = await attachLeadIdentity(t.database, claims());
    const bob = await attachLeadIdentity(
      t.database,
      claims({ sub: "sub-bob", email: "bob@atelier.test", name: "Bob", org_role: "user" }),
    );
    const open = (userId: string, leadSid: string | null) =>
      createSession(t.database, {
        userId,
        organizationId: ada.organization.id,
        idToken: null,
        leadSid,
      });
    await open(ada.user.id, "sid-a");
    await open(ada.user.id, "sid-b");
    await open(ada.user.id, null);
    await open(bob.user.id, "sid-a");
    const left = async (userId: string) => {
      const { sessions } = await import("@/server/db/schema");
      const { eq } = await import("drizzle-orm");
      return (await t.database.select().from(sessions).where(eq(sessions.userId, userId)))
        .map((s) => s.leadSid ?? "aucun")
        .sort();
    };
    return { ada: () => left(ada.user.id), bob: () => left(bob.user.id) };
  }

  it("ERPlead d'aujourd'hui, sans sid : toutes les sessions de la personne tombent", async () => {
    const who = await devices();
    const out = await post(
      logoutToken({ sub: "sub-ada", org: "org-atelier", lead_status: "logout", events: EVENT }),
    );
    expect(out.status).toBe(200);
    expect(await who.ada()).toEqual([]);
    // Sa collègue n'est pas touchée, même venue du même navigateur.
    expect(await who.bob()).toEqual(["sid-a"]);
  });

  it("avec sid : les sessions de ce navigateur et les anciennes sans sid, pas l'autre appareil", async () => {
    const who = await devices();
    const out = await post(
      logoutToken({
        sub: "sub-ada",
        org: "org-atelier",
        lead_status: "logout",
        sid: "sid-a",
        events: EVENT,
      }),
    );
    expect(out.status).toBe(200);
    expect(await who.ada()).toEqual(["sid-b"]);
    expect(await who.bob()).toEqual(["sid-a"]);
    // Le téléphone se déconnecte à son tour : plus rien.
    await post(logoutToken({ sub: "sub-ada", lead_status: "logout", sid: "sid-b", events: EVENT }));
    expect(await who.ada()).toEqual([]);
  });

  it("sid inutilisable (nombre, vide, trop long) : repli sûr, toutes ses sessions", async () => {
    for (const sid of [42, "", "x".repeat(300), { id: "sid-a" }]) {
      await t.reset();
      const who = await devices();
      const out = await post(
        logoutToken({ sub: "sub-ada", lead_status: "logout", sid, events: EVENT }),
      );
      expect(out.status, JSON.stringify(sid)).toBe(200);
      expect(await who.ada(), JSON.stringify(sid)).toEqual([]);
    }
  });

  it("départ (disabled) : toutes ses sessions, même avec un sid", async () => {
    const who = await devices();
    const out = await post(
      logoutToken({
        sub: "sub-ada",
        org: "org-atelier",
        lead_status: "disabled",
        sid: "sid-a",
        events: EVENT,
      }),
    );
    expect(out.status).toBe(200);
    expect(await who.ada()).toEqual([]);
  });

  it("jeton refusé : 400, aucune session ne tombe ; personne inconnue : 200 sans erreur", async () => {
    const who = await devices();
    const base = { sub: "sub-ada", lead_status: "logout", events: EVENT };
    const refused = [
      undefined,
      "",
      "pas-un-jeton",
      logoutToken(base, other.privateKey),
      logoutToken({ ...base, events: undefined }),
      logoutToken({ ...base, nonce: "n" }),
      logoutToken({ ...base, iat: Math.floor(Date.now() / 1000) - 600 }),
      logoutToken({ ...base, aud: "crmlead" }),
      logoutToken({ ...base, sub: 7 }),
    ];
    for (const token of refused) {
      const out = await post(token);
      expect(out.status, String(token).slice(0, 40)).toBe(400);
    }
    expect(await who.ada()).toEqual(["aucun", "sid-a", "sid-b"]);
    const unknown = await post(
      logoutToken({ sub: "sub-inconnu", lead_status: "logout", sid: "sid-a", events: EVENT }),
    );
    expect(unknown.status).toBe(200);
    expect(await who.ada()).toEqual(["aucun", "sid-a", "sid-b"]);
  });

  const jwksReads = () =>
    vi.mocked(fetch).mock.calls.filter(([url]) => String(url) === `${ISS}/oauth/jwks`).length;
  const LOGOUT = { sub: "sub-ada", lead_status: "logout", events: EVENT };

  it("des jetons forgés à clé inventée ne font pas relire les clés d'ERPlead à chaque requête", async () => {
    const who = await devices();
    expect((await post(logoutToken({ ...LOGOUT, sid: "sid-b" }))).status).toBe(200);
    expect(await who.ada()).toEqual(["sid-a"]);
    const before = jwksReads();
    // Émetteur et audience attendus (sinon le jeton serait écarté avant la lecture des clés), signature bidon.
    const forged = (kid: string) =>
      [
        Buffer.from(JSON.stringify({ alg: "RS256", kid })).toString("base64url"),
        Buffer.from(JSON.stringify({ iss: ISS, aud: "invoicelead", ...LOGOUT })).toString(
          "base64url",
        ),
        "c2ln",
      ].join(".");
    // En série puis en rafale : au plus une relecture pour l'ensemble.
    for (let i = 0; i < 10; i++) expect((await post(forged(`forged-${i}`))).status).toBe(400);
    const burst = await Promise.all(
      Array.from({ length: 10 }, (_, i) => post(forged(`burst-${i}`))),
    );
    expect(burst.map((r) => r.status)).toEqual(Array(10).fill(400));
    expect(jwksReads() - before).toBeLessThanOrEqual(1);
    expect(await who.ada()).toEqual(["sid-a"]);
    // Une vraie notification d'ERPlead passe toujours.
    expect((await post(logoutToken({ ...LOGOUT, sid: "sid-a" }))).status).toBe(200);
    expect(await who.ada()).toEqual([]);
  });

  it("une clé tournée par ERPlead est relue, au plus une fois toutes les 30 secondes", async () => {
    const ROTATED = "passage-backchannel-rotated";
    const rotated = { ...other.publicKey.export({ format: "jwk" }), kid: ROTATED };
    let published: unknown[] = [{ ...key.publicKey.export({ format: "jwk" }), kid: KID }];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url === `${ISS}/oauth/jwks`
          ? Response.json({ keys: published })
          : new Response("{}", { status: 404 }),
      ),
    );
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(Date.now() + 2 * 3_600_000); // cache d'une heure échu : une relecture
      expect((await post(logoutToken(LOGOUT))).status).toBe(200);
      expect(jwksReads()).toBe(1);
      published = [...published, rotated];
      // Relu il y a 5 s : pas de nouvelle lecture pour une clé inconnue.
      vi.setSystemTime(Date.now() + 5_000);
      expect((await post(logoutToken(LOGOUT, other.privateKey, ROTATED))).status).toBe(400);
      expect(jwksReads()).toBe(1);
      // 30 s après la dernière lecture : la nouvelle clé est lue et le jeton accepté.
      vi.setSystemTime(Date.now() + 26_000);
      expect((await post(logoutToken(LOGOUT, other.privateKey, ROTATED))).status).toBe(200);
      expect(jwksReads()).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("garde-fous", () => {
  it("safeFrom : un chemin de ce site, jamais une autre adresse", () => {
    for (const ok of [
      "/",
      "/fr",
      "/fr/",
      "/?lang=fr",
      "/de/pricing",
      "/fr/app/invoices?kind=quote",
    ])
      expect(safeFrom(ok)).toBe(ok);
    for (const bad of [
      "",
      "//evil.example",
      "/\\evil.example",
      "https://evil.example/",
      "/fr//evil",
      "/it",
      "/fr#x",
      "/fr?a=<b>",
      `/fr?${"a".repeat(400)}`,
    ])
      expect(safeFrom(bad), bad).toBeUndefined();
  });

  it("une page de retour étrangère est ignorée : la racine", async () => {
    const go = await start("/auth/lead/start?prompt=none&from=https%3A%2F%2Fevil.example%2F", {
      cookies: { lead_probe: "1" },
    });
    expect(where(go)).toBe(`${APP}/`);
    // Sans cookie : la racine aussi, avec la marque, jamais l'adresse étrangère.
    const bare = await start(
      "/auth/lead/start?prompt=none&from=https%3A%2F%2Fevil.example%2F%3Flead_probe%3D1",
    );
    expect(new URL(where(bare)).origin).toBe("https://crmlead.io");
    expect(where(bare)).not.toContain("evil.example");
  });

  it("seules les erreurs de prompt=none comptent comme un essai silencieux manqué", () => {
    expect(silentError("login_required")).toBe(true);
    expect(silentError("account_selection_required")).toBe(true);
    expect(silentError("access_denied")).toBe(false);
    expect(silentError(null)).toBe(false);
  });

  it("entryRedirect ne touche ni aux pages de l'application ni aux envois", () => {
    const base = {
      search: "",
      header: (name: string) => (NAVIGATE as Record<string, string>)[name] ?? null,
      hasCookie: () => false,
    };
    expect(entryRedirect({ ...base, method: "GET", pathname: "/fr/app" })).toBeNull();
    expect(entryRedirect({ ...base, method: "GET", pathname: "/fr/pricing" })).toBeNull();
    expect(entryRedirect({ ...base, method: "POST", pathname: "/" })).toBeNull();
    expect(entryRedirect({ ...base, method: "GET", pathname: "/" })).toEqual({
      status: 303,
      location: "/auth/lead/start?prompt=none&from=%2F",
    });
    // Préchargement du navigateur d'une adresse d'entrée : 204 (Chrome l'abandonne), pas une page.
    const prefetching = {
      ...base,
      method: "GET",
      header: (name: string) =>
        name === "sec-purpose"
          ? "prefetch;prerender"
          : ((NAVIGATE as Record<string, string>)[name] ?? null),
    };
    expect(entryRedirect({ ...prefetching, pathname: "/" })).toEqual({ status: 204 });
    expect(entryRedirect({ ...prefetching, pathname: "/login" })).toEqual({ status: 204 });
    expect(entryRedirect({ ...prefetching, pathname: "/fr/pricing" })).toBeNull();
    expect(entryRedirect({ ...prefetching, pathname: "/fr/app" })).toBeNull();
  });
});
