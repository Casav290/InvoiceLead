import { NextRequest, type NextResponse } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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
    // Un départ silencieux qui trouve lead_probe revient tout de suite, sans le Compte Lead.
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
      expect([back.status, where(back)]).toEqual([303, `${APP}/fr`]);
      expect(where(back)).not.toContain("erreur");
      // lead_probe reste : la racine ne repart pas.
      expect(back.cookies.get("lead_probe")).toBeUndefined();
    }
    // Demande perdue (autre navigateur, cookies effacés), state illisible : la racine, jamais l'écran.
    const lost = await callback("/auth/lead/callback?error=login_required&state=abimé");
    expect(where(lost)).toBe(`${APP}/`);
    // Demande silencieuse sans son cookie, même avec un code : la page d'où elle part, sans relance.
    const orphan = await callback(`/auth/lead/callback?code=c&state=${state}`);
    expect(where(orphan)).toBe(`${APP}/fr`);
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
  });
});
