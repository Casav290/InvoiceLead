/**
 * Parcours du lot 5 (01.10.2026) : chaque défaut corrigé, rejoué de bout en bout sur la pile locale
 * (InvoiceLead 3300, CRMlead 3301). Une étape par défaut, nommée d'après lui. Lot 6 : IL-FIDU-ORG,
 * IL-INVITE-SWITCH, IL-STRIPE-AFTER-EXPIRY, IL-DOWNLOAD-AFTER-EXPIRY, IL-NEXT-LONG-NO-COOKIE,
 * IL-ASTERISK, CRM-TEAM-INVITE-SHARED-BROWSER, CRM-EXISTING-APP-ACCOUNTS-EMAILS (désinscrits,
 * conseils rallumés, 113 rejouée) et CRM-SHARED-NEXT-REPLAY (Google). Intégration du lot 6 :
 * SW-RETOUR-OFFLINE, CRM-THEME-FROM-IL, CRM-LEAD-EMAILS-HTML, et dans CRM-EXISTING-APP-ACCOUNTS-EMAILS les
 * comptes inscrits sur CRMlead puis passés par InvoiceLead, et les notifications réglées par la personne.
 *
 *   node scripts/lead-login-live/e2e-login5.mjs <dossier des captures>
 *
 * Variables :
 * - CRM_LOG : journal de CRMlead 3301 (emails simulés) ;
 * - CRM_REPO : dépôt CRMlead (lien d'import produit par CRMlead, migration 113 rejouée) ;
 * - CRM_GOOGLE (+ CRM_GOOGLE_LOG) : un second CRMlead sur la même base, lancé avec
 *   GOOGLE_CLIENT_ID=x GOOGLE_CLIENT_SECRET=y GOOGLE_AUTH_URL=http://127.0.0.1:8942/auth
 *   GOOGLE_TOKEN_URL=http://127.0.0.1:8942/token GOOGLE_USERINFO_URL=http://127.0.0.1:8942/userinfo
 *   (le faux Google tourne dans ce script, port GOOGLE_PORT). Sans elle, les étapes Google sont sautées ;
 * - CRM_MAILCAP (+ CRM_MAILCAP_FILE) : un CRMlead sur la même base qui capture ses emails au lieu de les envoyer
 *   (crochet resend-capture.mjs, voir son en-tête ; PUBLIC_URL = son adresse). Sans elle, CRM-LEAD-EMAILS-HTML
 *   est sautée ;
 * - IL_URL : un autre InvoiceLead que celui de 3300 (son adresse de retour déclarée dans CRMlead) ;
 * - ONLY=<motif> : seulement les étapes dont le nom correspond ; DEBUG_NAV=1 : navigations de l'étape
 *   « envoi après expiration ».
 *
 * Comptes : eve+e2e5-<étape>-<horodatage>@example.test.
 *
 * Lot 7 : IL-RESET-SHARED-DEVICE, IL-CALLBACK-REPLAY, IL-RETRY-PER-REQUEST, IL-LOGIN-PAGES-BOUNDS, et dans
 * CRM-TEAM-INVITE-EMAIL la preuve de l'administrateur (X-Lead-Id-Token). Les liens d'import longs d'une même
 * machine comptent pour un seul réseau (20 pages gardées par heure, login-pages.ts) : entre deux rejeux
 * rapprochés, vider login_pages (`delete from login_pages where client is not null`).
 *
 * Intégration du lot 7 (pile reconstruite) : CRM-FIRSTBYTE-ACCEPT-LANGUAGE (premier octet sans ui_locales),
 * CRM-STALE-RELOAD-ONE-DEPARTURE (vieil écran rechargé, un seul départ), IL-ERROR-SCREEN-LINKS (liens de l'écran
 * d'erreur), IL-FIDU-CRM-IMPORT (lien d'import d'une fiduciaire), CRM-FORGOT-THROTTLE (adresses 192.0.2.x et
 * 198.18-19.x.x en X-Forwarded-For, compteurs effacés ensuite), CRM-113-LEGACY-COLLEAGUES (collègues invités par
 * CRMlead), CRM-MEMBERS-PROOF (preuve de l'administrateur, renvoi) et, avec CRM_GOOGLE, CRM-REAUTH-GOOGLE-2FA.
 *
 * Intégration du lot 8 (pile reconstruite) : CRM-BACK-AFTER-DETOUR (Retour depuis la page demandée après un détour par
 * l'inscription, le mot de passe oublié ou « Se connecter », et avec CRM_GOOGLE après Google), CRM-RESET-2FA (mot de
 * passe oublié avec la 2FA : le code avant InvoiceLead), IL-CALLBACK-LOGOUT-CSRF (lien vers le retour posé ailleurs),
 * CRM-SIGNUP-UNKNOWN-APP (client enregistré hors de la liste, serveur de retour lancé par ce script, client effacé
 * ensuite), dans CRM-LEAD-EMAILS-HTML les carrés de la marque (seul celui de l'application en couleur), et avec
 * CRM_GOOGLE : CRM-GOOGLE-UNCONFIRMED (compte ouvert d'avance sur une adresse jamais confirmée, puis la session
 * InvoiceLead de son auteur) et CRM-GOOGLE-INVITED (collègue invité qui passe par Google avant son lien).
 */
import { execFileSync } from "node:child_process";
import { createHash, createHmac, hkdfSync, randomBytes, randomUUID } from "node:crypto";
import { readFileSync, unlinkSync, writeFileSync } from "node:fs";
import http from "node:http";

// Le travailleur de service de CRMlead passe par le réseau du contexte : couper CRMlead le coupe aussi.
process.env.PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS = "1";
const { chromium } = await import("playwright");

const SP = process.argv[2] ?? "/tmp";
const IL = process.env.IL_URL ?? "http://localhost:3300",
  CRM = "http://localhost:3301";
const CRM_G = process.env.CRM_GOOGLE ?? "";
const CRM_REPO = process.env.CRM_REPO ?? "";
const GPORT = Number(process.env.GOOGLE_PORT ?? 8942);
const GOOGLE = `http://127.0.0.1:${GPORT}`;
const CRM_PORTS = ["3301", ...(CRM_G ? [new URL(CRM_G).port] : [])];

const sql = (db, q) =>
  execFileSync("psql", ["-U", "postgres", "-h", "localhost", "-d", db, "-tA", "-c", q])
    .toString()
    .trim();
const crmq = (q) => sql("crmlead_e2e", q);
const ilq = (q) => sql("invoicelead_test", q);
const sha = (s) => createHash("sha256").update(s).digest("hex");
const log = (file) => (file ? readFileSync(file, "utf8") : "");
const crmLog = () => log(process.env.CRM_LOG ?? `${SP}/crm.log`);
const gLog = () => log(process.env.CRM_GOOGLE_LOG);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stamp = Date.now();
const mail = (label) => `eve+e2e5-${label}-${stamp}@example.test`;
const PASS = `Tr3s-l0ng-e2e5-${stamp}`;

// ---------- faux Google (étapes Google seulement) ----------
let persona = { sub: "g-0", email: mail("g0"), action: "hold" };
const codes = new Map();
const gServer = CRM_G
  ? http
      .createServer(async (req, res) => {
        const u = new URL(req.url, GOOGLE);
        const json = (status, body) => {
          res.writeHead(status, { "Content-Type": "application/json" });
          res.end(JSON.stringify(body));
        };
        if (u.pathname === "/auth") {
          const back = u.searchParams.get("redirect_uri");
          const state = encodeURIComponent(u.searchParams.get("state") ?? "");
          const code = randomBytes(12).toString("hex");
          codes.set(code, { ...persona });
          const ok = `${back}?code=${code}&state=${state}`;
          if (persona.action === "auto") {
            res.writeHead(302, { Location: ok });
            return res.end();
          }
          res.writeHead(200, { "Content-Type": "text/html" });
          return res.end(
            `<!doctype html><title>Google</title><a id="ok" href="${ok}">Continuer</a> <a id="deny" href="${back}?error=access_denied&state=${state}">Annuler</a>`,
          );
        }
        if (u.pathname === "/token" && req.method === "POST") {
          let body = "";
          for await (const ch of req) body += ch;
          const who = codes.get(new URLSearchParams(body).get("code"));
          if (!who) return json(400, { error: "invalid_grant" });
          const at = `at_${randomBytes(8).toString("hex")}`;
          codes.set(at, who);
          return json(200, { access_token: at, expires_in: 3600, token_type: "Bearer" });
        }
        if (u.pathname === "/userinfo") {
          const who = codes.get((req.headers.authorization ?? "").replace(/^Bearer\s+/, ""));
          if (!who) return json(401, { error: "invalid_token" });
          return json(200, { sub: who.sub, email: who.email, email_verified: true, name: "E2E5" });
        }
        json(404, { error: "not_found" });
      })
      .listen(GPORT, "127.0.0.1")
  : null;

// ---------- relevés : CRMlead visible sur un écran demandé par InvoiceLead ? ----------
const events = [];
const isBad = (e) =>
  e.crmBrand ||
  e.tagline ||
  e.ssr ||
  /CRMlead/.test(e.title) ||
  e.crmIcon ||
  e.crmHead ||
  e.dashboard;
async function newCtx(browser, locale, tag) {
  const ctx = await browser.newContext({ locale, viewport: { width: 1280, height: 900 } });
  await ctx.exposeBinding("__e2e5", (_s, e) => events.push({ tag, ...e }));
  await ctx.addInitScript((ports) => {
    const snap = (why) => {
      try {
        if (location.hostname !== "localhost" || !ports.includes(location.port)) return;
        const leaves = Array.from(document.querySelectorAll("body *")).filter(
          (e) => e.children.length === 0,
        );
        // Toutes les icônes de l'onglet, l'icône d'écran d'accueil et le manifeste (pas seulement la première).
        const heads = Array.from(
          document.querySelectorAll(
            'link[rel~="icon"], link[rel="apple-touch-icon"], link[rel="manifest"]',
          ),
        ).map((l) => l.getAttribute("href") ?? "");
        const appTitle =
          document
            .querySelector('meta[name="apple-mobile-web-app-title"]')
            ?.getAttribute("content") ?? "";
        const text = document.body?.innerText ?? "";
        window.__e2e5({
          why,
          url: location.pathname + location.search,
          title: document.title,
          crmBrand: leaves.some(
            (e) => e.textContent?.trim() === "CRMlead" && e.getBoundingClientRect().height > 0,
          ),
          tagline: text.includes("ne laisse aucun lead sans suite"),
          ssr: !!document.getElementById("ssr"),
          crmIcon: heads.some((h) => /favicon|apple-touch|manifest/.test(h)),
          crmHead: /CRMlead/.test(appTitle),
          dashboard: /Mes actions|My actions|Pipeline/.test(text),
          text: text.replace(/\s+/g, " ").slice(0, 80),
        });
      } catch {}
    };
    snap("init");
    document.addEventListener("DOMContentLoaded", () => snap("dcl"));
    new MutationObserver(() => snap("mut")).observe(document, {
      subtree: true,
      childList: true,
      characterData: true,
    });
  }, CRM_PORTS);
  return ctx;
}
/** Aucun écran de CRMlead depuis `from` (relevés de ce contexte, filtrés par adresse au besoin). */
function neutralSince(from, tag, keep = () => true) {
  const seen = events.slice(from).filter((e) => e.tag === tag && keep(e));
  const bad = seen.filter(isBad);
  if (bad.length) {
    const uniq = [
      ...new Map(seen.map((e) => [`${e.url}|${e.title}|${e.text.slice(0, 40)}`, e])).values(),
    ];
    const flags = (e) =>
      ["crmBrand", "tagline", "ssr", "crmIcon", "crmHead", "dashboard"]
        .filter((k) => e[k])
        .join("+");
    for (const e of uniq.slice(0, 15))
      console.log(
        `  ${isBad(e) ? "!!" : "  "} ${e.url.slice(0, 70)} | ${e.title} | ${flags(e)} | ${e.text}`,
      );
  }
  if (bad.length)
    throw new Error(
      `CRMlead visible (${bad.length}) : ${bad[0].url} | ${bad[0].title} | ${bad[0].text}`,
    );
}

const results = {};
async function step(name, fn) {
  // ONLY=<motif> : seulement les étapes dont le nom correspond.
  if (process.env.ONLY && !new RegExp(process.env.ONLY).test(name)) return;
  try {
    await fn();
    results[name] = "ok";
  } catch (e) {
    results[name] = `ERREUR ${String(e).split("\n")[0].slice(0, 300)}`;
  }
  console.log(`=== ${name}: ${results[name]}`);
}
const expect = (cond, what) => {
  if (!cond) throw new Error(what);
};
const at = (prefix) => (u) => u.href.startsWith(prefix);
async function waitAt(page, prefix, what, timeout = 25000) {
  await page.waitForURL(at(prefix), { timeout }).catch(() => {
    throw new Error(`${what} : obtenu ${page.url()} (attendu ${prefix}…)`);
  });
}
async function dropCookies(ctx, drop) {
  const keep = (await ctx.cookies()).filter((c) => !drop(c.name));
  await ctx.clearCookies();
  await ctx.addCookies(keep);
}
async function signupFromIl(page, locale, label) {
  const email = mail(label);
  await page.goto(`${IL}/auth/lead/start?locale=${locale}&signup=1`);
  await waitAt(page, `${CRM}/signup`, "inscription");
  await page.fill("#auth-account", `E2E5 ${label}`);
  await page.fill("#auth-name", "Eve E2E5");
  await page.fill("#auth-email", email);
  await page.fill("#auth-password", PASS);
  await page.locator("form button").last().click();
  await waitAt(page, `${IL}/${locale}/app`, "arrivée après inscription", 30000);
  return email;
}
async function passwordLogin(page, email, pass = PASS) {
  await page.waitForSelector("#auth-password");
  await page.fill("#auth-email", email);
  await page.fill("#auth-password", pass);
  await page.locator("form button").last().click();
}
/** Départ d'InvoiceLead, sans le suivre : l'adresse /oauth/authorize (pour `base`) et son `next`. */
async function ilAuthorize(ctx, query, base = CRM) {
  const s = await ctx.request.get(`${IL}/auth/lead/start?${query}`, { maxRedirects: 0 });
  const u = new URL(s.headers().location);
  return { url: `${base}${u.pathname}${u.search}`, next: u.pathname + u.search };
}
/**
 * Jeton d'identité que le Compte Lead (`base`) remet à InvoiceLead pour la personne connectée dans ce
 * contexte : la preuve que l'administrateur agit lui-même (`X-Lead-Id-Token` de l'API members).
 */
async function idTokenOf(ctx, base = CRM) {
  const verifier = randomBytes(32).toString("base64url");
  const redirect = `${IL}/auth/lead/callback`;
  const q = new URLSearchParams({
    response_type: "code",
    client_id: "invoicelead",
    redirect_uri: redirect,
    scope: "openid email profile lead",
    state: randomBytes(12).toString("base64url"),
    nonce: randomBytes(12).toString("base64url"),
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
  });
  const a = await ctx.request.get(`${base}/oauth/authorize?${q}`, { maxRedirects: 0 });
  const code = new URL(a.headers().location ?? "/", base).searchParams.get("code");
  if (!code) throw new Error(`jeton d'identité : ${a.status()} ${a.headers().location}`);
  const t = await ctx.request.post(`${base}/oauth/token`, {
    form: {
      grant_type: "authorization_code",
      code,
      redirect_uri: redirect,
      code_verifier: verifier,
      client_id: "invoicelead",
      client_secret: process.env.LEAD_ID_CLIENT_SECRET ?? "lid_test_e2e_secret",
    },
  });
  const out = await t.json().catch(() => ({}));
  if (!out.id_token) throw new Error(`jeton d'identité : ${t.status()}`);
  return out.id_token;
}
function resetLink(email, next) {
  const token = randomBytes(32).toString("base64url");
  crmq(`select 1 from auth_token_issue('reset', '${email}', '${sha(token)}', '1 hour'::interval)`);
  return `${CRM}/mot-de-passe?jeton=${token}&next=${encodeURIComponent(next)}`;
}
/** Invitation de fiduciaire dans l'entreprise du propriétaire, pour `email`. */
function fiduciaryInvite(owner, email) {
  const token = randomBytes(32).toString("base64url");
  ilq(
    `insert into fiduciary_invitations (organization_id, email, token_hash, expires_at)
     select m.organization_id, '${email}', '${sha(token)}', now() + interval '7 days'
       from memberships m join users u on u.id = m.user_id where u.email = '${owner}' limit 1`,
  );
  return token;
}
const accepted = (token) =>
  ilq(
    `select accepted_at is not null from fiduciary_invitations where token_hash = '${sha(token)}'`,
  );
const ilLogout = (page) =>
  page.evaluate(() => {
    const f = document.createElement("form");
    f.method = "post";
    f.action = "/auth/lead/logout";
    document.body.append(f);
    f.submit();
  });
async function waitLog(read, pattern, ms = 10000) {
  for (let t = 0; t < ms; t += 250) {
    const hit = read()
      .split("\n")
      .find((l) => pattern.test(l));
    if (hit) return hit;
    await sleep(250);
  }
  return null;
}

const browser = await chromium.launch();

// Propriétaire d'une entreprise InvoiceLead : les invitations de fiduciaire viennent de lui.
const ownCtx = await newCtx(browser, "fr-CH", "own");
const ownPage = await ownCtx.newPage();
const OWNER = await signupFromIl(ownPage, "fr", "owner");

await step("SW-OAUTH : hors connexion, l'écran neutre et jamais l'accueil de CRMlead", async () => {
  const ctx = await newCtx(browser, "de-CH", "sw");
  const p = await ctx.newPage();
  const email = await signupFromIl(p, "de", "sw");
  if (!ctx.serviceWorkers().some((w) => w.url().startsWith(CRM)))
    await ctx.waitForEvent("serviceworker", { timeout: 15000 });
  await sleep(1500);
  const from = events.length;
  await ctx.clearCookies();
  const cut = (r) => r.abort("internetdisconnected");
  await ctx.route(`${CRM}/**`, cut);
  const res = await p.goto(`${IL}/de/app/invoices`);
  expect(p.url().startsWith(`${CRM}/oauth/authorize?`), `hors connexion : ${p.url()}`);
  expect(res?.status() === 503, `statut ${res?.status()}`);
  expect((await p.title()) === "Lead-Konto", `titre « ${await p.title()} »`);
  const body = await p.locator("body").innerText();
  expect(!/CRMlead/.test(body) && /Keine Internetverbindung/.test(body), `page : ${body}`);
  // Pas d'icône de CRMlead : une icône vide (data:) et celle d'écran d'accueil des quatre carrés, rien d'autre.
  const offHeads = await p
    .locator('link[rel~="icon"], link[rel="apple-touch-icon"], link[rel="manifest"]')
    .evaluateAll((ls) => ls.map((l) => `${l.rel}=${l.getAttribute("href")}`));
  expect(
    offHeads.every((h) => /^icon=data:/.test(h) || h === "apple-touch-icon=/lead-touch-icon.png"),
    `icône de CRMlead : ${offHeads.join(" ")}`,
  );
  await ctx.unroute(`${CRM}/**`, cut);
  await p.getByText("Erneut versuchen").click();
  await waitAt(p, `${CRM}/login?next=`, "Réessayer");
  expect((await p.title()) === "Lead-Konto", `titre après Réessayer « ${await p.title()} »`);
  await passwordLogin(p, email);
  await waitAt(p, `${IL}/de/app/invoices`, "après la connexion");
  // Déconnexion depuis InvoiceLead, hors connexion : /oauth/logout reste neutre.
  await ctx.route(`${CRM}/**`, cut);
  await ilLogout(p);
  await waitAt(p, `${CRM}/oauth/logout?`, "déconnexion");
  await p.waitForLoadState();
  const out = await p.locator("body").innerText();
  expect(
    !/CRMlead/.test(out) && /Lead/.test(await p.title()),
    `déconnexion : ${await p.title()} ${out}`,
  );
  await ctx.unroute(`${CRM}/**`, cut);
  await p.getByText(/Réessayer|Retry/).click();
  await waitAt(p, IL, "retour sur InvoiceLead après la déconnexion");
  neutralSince(from, "sw");
  // Visite directe de CRMlead hors connexion : son cadre, comme avant.
  await ctx.route(`${CRM}/**`, cut);
  for (const path of ["/", "/login"]) {
    await p.goto(`${CRM}${path}`).catch(() => {});
    expect(/CRMlead/.test(await p.title()), `CRMlead direct ${path} : « ${await p.title()} »`);
  }
  await ctx.unroute(`${CRM}/**`, cut);
  await ctx.close();
});

await step(
  "SW-RETOUR-OFFLINE : hors connexion au second saut d'un retour de Google sans trace, jamais l'accueil de CRMlead",
  async () => {
    const K = "crmlead.leadid.next";
    const RETOUR = /\/(login|signup)\?.*retour=/;
    const off = (r) => r.abort("internetdisconnected");
    for (const withApp of [true, false]) {
      const tag = withApp ? "swoff" : "swoff-direct";
      const ctx = await newCtx(browser, "de-CH", tag);
      const p = await ctx.newPage();
      // Le travailleur de service est installé par une première visite (ici, l'inscription depuis InvoiceLead).
      const email = await signupFromIl(p, "de", tag);
      if (!ctx.serviceWorkers().some((w) => w.url().startsWith(CRM)))
        await ctx.waitForEvent("serviceworker", { timeout: 15000 });
      await ctx.clearCookies();
      if (withApp) {
        await p.goto(`${IL}/de/app/invoices`);
        await waitAt(p, `${CRM}/login?next=`, "écran Lead-Konto");
        await p.waitForFunction((k) => !!sessionStorage.getItem(k), K, { timeout: 10000 });
      } else {
        await p.goto(`${CRM}/login`);
      }
      await p.waitForFunction(() => navigator.serviceWorker?.controller != null, null, {
        timeout: 15000,
      });
      // Départ vers Google tel que parkForSso + markSsoStart le font ; au retour, plus aucun cookie.
      await p.evaluate(
        ([k, app]) => {
          const raw = sessionStorage.getItem(k);
          if (app && raw) sessionStorage.setItem(`${k}.sso-parked`, raw);
          else sessionStorage.removeItem(`${k}.sso-parked`);
          sessionStorage.removeItem(k);
          sessionStorage.setItem(`${k}.sso`, String(Date.now()));
        },
        [K, withApp],
      );
      await ctx.clearCookies();
      const from = events.length;
      await ctx.route(RETOUR, off);
      const res = await p.goto(`${CRM}/api/auth/sso/google/callback?error=access_denied`);
      expect(/retour=(inconnu|orphelin)/.test(p.url()), `${tag} : adresse ${p.url()}`);
      expect(res?.status() === 503, `${tag} : statut ${res?.status()}`);
      expect((await p.title()) === "Lead-Konto", `${tag} : titre « ${await p.title()} »`);
      const body = await p.locator("body").innerText();
      expect(
        !/CRMlead/.test(body) && /Keine Internetverbindung/.test(body),
        `${tag} : page ${body}`,
      );
      const heads = await p
        .locator('link[rel~="icon"], link[rel="apple-touch-icon"], link[rel="manifest"]')
        .evaluateAll((ls) => ls.map((l) => `${l.rel}=${l.getAttribute("href")}`));
      expect(
        heads.every((h) => /^icon=data:/.test(h) || h === "apple-touch-icon=/lead-touch-icon.png"),
        `${tag} : icônes ${heads.join(" ")}`,
      );
      const parked = await p.evaluate((k) => sessionStorage.getItem(`${k}.sso-parked`), K);
      expect(!withApp || !!parked, `${tag} : la demande garée a disparu`);
      // CRMlead direct : l'écran de connexion d'avant (CRMlead, à bon droit) peut encore se redessiner après `from`.
      neutralSince(from, tag, withApp ? undefined : (e) => e.url.includes("retour="));
      // Réseau revenu : « Erneut versuchen » recharge la même adresse, la page « retour » tranche.
      await ctx.unroute(RETOUR, off);
      await p.getByText("Erneut versuchen").click();
      if (withApp) {
        await waitAt(p, `${CRM}/login?next=%2Foauth%2Fauthorize`, "réseau revenu");
        expect((await p.title()) === "Lead-Konto", `réseau revenu : « ${await p.title()} »`);
        await passwordLogin(p, email);
        await waitAt(p, `${IL}/de/app/invoices`, "page demandée");
        neutralSince(from, tag, (e) => !e.url.startsWith("/de/"));
      } else {
        await p.waitForURL((u) => u.href.startsWith(`${CRM}/login`) && !RETOUR.test(u.href), {
          timeout: 15000,
        });
        await p.waitForFunction(() => /CRMlead/.test(document.title), null, { timeout: 10000 });
        expect(!p.url().includes("next="), `direct : ${p.url()}`);
      }
      await ctx.close();
    }
  },
);

await step(
  "CRM-THEME-FROM-IL : couleur et icône d'écran d'accueil de l'application, CRMlead direct inchangé",
  async () => {
    const PLUM = "rgb(122, 46, 103)",
      GREEN = "rgb(15, 111, 112)";
    const ctx = await newCtx(browser, "fr-CH", "thm");
    const p = await ctx.newPage();
    const look = () =>
      p.evaluate(() => ({
        app: document.documentElement.dataset.leadApp ?? "",
        button: getComputedStyle(Array.from(document.querySelectorAll("form button")).pop())
          .backgroundColor,
        touch: Array.from(document.querySelectorAll('link[rel="apple-touch-icon"]')).map((l) =>
          l.getAttribute("href"),
        ),
        manifest: !!document.querySelector('link[rel="manifest"]'),
      }));
    const from = events.length;
    // Premier octet : la page servie porte déjà la couleur et l'icône neutre.
    const first = await (
      await ctx.request.get(`${IL}/auth/lead/start?locale=fr&next=%2Ffr%2Fapp%2Finvoices`)
    ).text();
    expect(
      /<html[^>]*data-lead-app="invoicelead"/.test(first) &&
        /<link rel="apple-touch-icon"[^>]*href="\/lead-touch-icon.png"/.test(first) &&
        !/apple-touch-icon.png"|rel="manifest"/.test(first),
      `premier octet : ${first.match(/<html[^>]*>/)?.[0]} ${first.match(/<link rel="apple-touch-icon"[^>]*>/g)}`,
    );
    for (const path of ["/fr/app/invoices", "signup", "forgot"]) {
      if (path.startsWith("/")) {
        await p.goto(`${IL}${path}`);
        await waitAt(p, `${CRM}/login?next=`, "écran");
      } else if (path === "signup") {
        await p.getByRole("link", { name: /Créer un compte/ }).click();
        await waitAt(p, `${CRM}/signup?next=`, "inscription");
      } else {
        await p.goto(`${IL}/fr/app/invoices`);
        await waitAt(p, `${CRM}/login?next=`, "écran");
        await p.getByRole("link", { name: /oublié/ }).click();
        await waitAt(p, `${CRM}/mot-de-passe?`, "mot de passe oublié");
      }
      await p.waitForSelector("form button");
      const l = await look();
      expect(l.app === "invoicelead", `${path} : data-lead-app « ${l.app} »`);
      expect(l.button === PLUM, `${path} : bouton ${l.button}`);
      expect(
        l.touch.length === 1 && l.touch[0] === "/lead-touch-icon.png" && !l.manifest,
        `${path} : icônes ${l.touch} manifeste ${l.manifest}`,
      );
      if (path.startsWith("/")) {
        const link = await p
          .getByRole("link", { name: /Créer un compte/ })
          .evaluate((e) => getComputedStyle(e).color);
        expect(link === PLUM, `${path} : lien ${link}`);
      }
    }
    neutralSince(from, "thm");
    const icon = await ctx.request.get(`${CRM}/lead-touch-icon.png`);
    expect(
      icon.ok() && icon.headers()["content-type"] === "image/png",
      `/lead-touch-icon.png ${icon.status()}`,
    );
    // CRMlead ouvert directement : son vert, son icône CL et son manifeste, sans data-lead-app.
    const d = await browser.newContext({ locale: "fr-CH" });
    const q = await d.newPage();
    await q.goto(`${CRM}/login`);
    await q.waitForSelector("form button");
    const dl = await q.evaluate(() => ({
      app: document.documentElement.dataset.leadApp ?? "",
      button: getComputedStyle(Array.from(document.querySelectorAll("form button")).pop())
        .backgroundColor,
      touch: Array.from(document.querySelectorAll('link[rel="apple-touch-icon"]')).map((l) =>
        l.getAttribute("href"),
      ),
      manifest: !!document.querySelector('link[rel="manifest"]'),
      title: document.title,
    }));
    expect(
      !dl.app &&
        dl.button === GREEN &&
        dl.touch.join() === "/apple-touch-icon.png" &&
        dl.manifest &&
        /CRMlead/.test(dl.title),
      `CRMlead direct : ${JSON.stringify(dl)}`,
    );
    await Promise.all([ctx.close(), d.close()]);
  },
);

await step(
  "CRM-FIRSTBYTE-LANG-META : premier octet dans la langue demandée, sans accroche CRMlead",
  async () => {
    const ctx = await browser.newContext({
      userAgent: "Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)",
    });
    const head = (html) => ({
      lang: html.match(/<html lang="([^"]*)"/)?.[1],
      title: html.match(/<title>([^<]*)<\/title>/)?.[1],
      desc: html.match(/<meta name="description" content="([^"]*)"/)?.[1] ?? "",
      crm: html.replace(/Scanlead, CRMlead, ProjectLead/g, "").includes("CRMlead"),
      tagline: html.includes("aucun lead sans suite"),
    });
    const preview = await ctx.request.get(`${IL}/de/signup`);
    const h = head(await preview.text());
    expect(preview.url().startsWith(`${CRM}/signup?`), `aperçu : ${preview.url()}`);
    expect(
      h.lang === "de" && !h.tagline && !h.crm && h.title === "Lead-Konto",
      `aperçu : ${JSON.stringify(h)}`,
    );
    for (const l of ["de", "en", "fr", "it"]) {
      const next = encodeURIComponent(`/oauth/authorize?client_id=invoicelead&ui_locales=${l}`);
      for (const path of [
        `/login?next=${next}`,
        `/signup?next=${next}`,
        `/mot-de-passe?next=${next}`,
        `/verification?app=invoicelead&lang=${l}&jeton=x`,
      ]) {
        const x = head(await (await ctx.request.get(`${CRM}${path}`)).text());
        expect(x.lang === l && !x.tagline && !x.crm, `${path} : ${JSON.stringify(x)}`);
      }
    }
    const direct = head(await (await ctx.request.get(`${CRM}/login`)).text());
    expect(
      direct.lang === "fr" && direct.tagline && /CRMlead/.test(direct.title),
      `CRMlead direct : ${JSON.stringify(direct)}`,
    );
    await ctx.close();
  },
);

await step(
  "CRM-SESSIONSTORAGE-3H : une demande d'InvoiceLead restée dans l'onglet ne détourne pas CRMlead",
  async () => {
    const ctx = await browser.newContext({ locale: "fr-CH" });
    const email = mail("ssn");
    const r = await ctx.request.post(`${CRM}/api/auth/signup`, {
      data: { accountName: "E2E5 direct", name: "Eve", email, password: PASS, locale: "fr" },
      headers: { origin: CRM },
    });
    expect(r.ok(), `inscription directe ${r.status()}`);
    const KEY = "crmlead.leadid.next";
    // Connexion d'InvoiceLead laissée en plan dans l'onglet, vieille de `minutes`.
    const abandon = async (minutes) => {
      await ctx.clearCookies();
      const p = await ctx.newPage();
      await p.goto(`${IL}/auth/lead/start?locale=fr&next=%2Ffr%2Fapp%2Finvoices`);
      await waitAt(p, `${CRM}/login?next=`, "écran de connexion d'InvoiceLead");
      await p.waitForFunction((k) => sessionStorage.getItem(k), KEY);
      await p.evaluate(
        ([k, m]) => {
          const v = JSON.parse(sessionStorage.getItem(k));
          v.at = Date.now() - m * 60000;
          sessionStorage.setItem(k, JSON.stringify(v));
        },
        [KEY, minutes],
      );
      return p;
    };
    const crmScreen = async (p, what) => {
      await p.waitForSelector("#auth-password");
      await sleep(500);
      const text = await p.locator("body").innerText();
      expect(
        /CRMlead/.test(await p.title()) && !/InvoiceLead/.test(text),
        `${what} : écran « ${await p.title()} » ${text.slice(0, 120)}`,
      );
    };
    const landsInCrm = async (p, what) => {
      await passwordLogin(p, email);
      await p
        .waitForURL((u) => u.href.startsWith(CRM) && !/\/login|\/oauth\//.test(u.pathname), {
          timeout: 20000,
        })
        .catch(() => {});
      await sleep(2500);
      expect(p.url().startsWith(CRM) && !/oauth/.test(p.url()), `${what} : arrivée ${p.url()}`);
      await p.close();
    };
    // A : /login tapé.
    let p = await abandon(60);
    await p.goto(`${CRM}/login`);
    await crmScreen(p, "A");
    await landsInCrm(p, "A");
    // B : favori /board, demande de 20 minutes puis d'une heure.
    for (const m of [20, 60]) {
      p = await abandon(m);
      await p.goto(`${CRM}/board`);
      await crmScreen(p, `B ${m} min`);
      await landsInCrm(p, `B ${m} min`);
    }
    // C : demande garée pour Google, puis retour de Google sans demande (connexion directe annulée).
    for (const visitLoginFirst of [true, false]) {
      p = await abandon(5);
      await p.evaluate((k) => {
        sessionStorage.setItem(`${k}.sso-parked`, sessionStorage.getItem(k));
        sessionStorage.removeItem(k);
      }, KEY);
      if (visitLoginFirst) await p.goto(`${CRM}/login`);
      await p.goto(
        `${CRM}/api/auth/sso/google/callback?error=access_denied&state=${"A".repeat(24)}`,
      );
      await waitAt(p, `${CRM}/login?sso=canceled`, "retour de Google annulé");
      await crmScreen(p, `C${visitLoginFirst ? "" : " sans /login"}`);
      await landsInCrm(p, "C");
    }
    // C, contrôle : le vrai retour d'InvoiceLead (même demande dans l'adresse) reste neutre et y mène.
    p = await abandon(5);
    const next = new URL(p.url()).searchParams.get("next");
    await p.evaluate((k) => {
      sessionStorage.setItem(`${k}.sso-parked`, sessionStorage.getItem(k));
      sessionStorage.removeItem(k);
    }, KEY);
    await p.goto(`${CRM}/login?sso=canceled&next=${encodeURIComponent(next)}`);
    await p.waitForSelector("#auth-password");
    expect(!/CRMlead/.test(await p.title()), `contrôle : titre ${await p.title()}`);
    await passwordLogin(p, email);
    await waitAt(p, `${IL}/fr/app/invoices`, "contrôle : InvoiceLead");
    await p.close();
    // D : connecté à CRMlead dans un autre onglet, puis CRMlead tapé dans le premier.
    p = await abandon(60);
    const other = await ctx.newPage();
    await other.goto(`${CRM}/login`);
    await landsInCrm(other, "D, autre onglet");
    await p.goto(`${CRM}/`);
    await sleep(3000);
    expect(p.url().startsWith(CRM) && !/oauth/.test(p.url()), `D : ${p.url()}`);
    await ctx.close();
  },
);

await step(
  "IL-EXPIRED-REQUEST : la demande revient sans son cookie (plus de 3 h, autre navigateur)",
  async () => {
    const ctx = await newCtx(browser, "fr-CH", "exp");
    const p = await ctx.newPage();
    const email = await signupFromIl(p, "fr", "exp");
    const from = events.length;
    // S1 : écran resté ouvert plus de trois heures (cookie de la demande échu).
    await ctx.clearCookies();
    await p.goto(`${IL}/fr/app/quotes?status=draft`);
    await waitAt(p, `${CRM}/login?next=`, "S1 écran");
    await dropCookies(ctx, (n) => n.startsWith("il_lead_login_"));
    await passwordLogin(p, email);
    await waitAt(p, `${IL}/fr/app/quotes?status=draft`, "S1 arrivée");
    // S2 : demande faite en allemand, lien de réinitialisation ouvert dans un navigateur anglais.
    await ctx.clearCookies();
    await p.goto(`${IL}/de/app/invoices?status=open`);
    await waitAt(p, `${CRM}/login?next=`, "S2 écran");
    const link = resetLink(email, new URL(p.url()).searchParams.get("next"));
    const other = await newCtx(browser, "en-US", "exp");
    const q = await other.newPage();
    await q.goto(link);
    await q.fill("#auth-password", `${PASS}-2`);
    await q.locator("form button").last().click();
    await waitAt(q, `${IL}/de/app/invoices?status=open`, "S2 arrivée");
    await other.close();
    // Invitation : cookie de la demande perdu, la personne revient sur l'invitation.
    await ctx.clearCookies();
    const token = fiduciaryInvite(OWNER, email);
    await p.goto(`${IL}/fr/invite?token=${token}`);
    await p.locator(`a[href*="invite=${token}"]`).click();
    await waitAt(p, `${CRM}/login?next=`, "invitation écran");
    await dropCookies(ctx, (n) => n.startsWith("il_lead_login_"));
    await passwordLogin(p, email, `${PASS}-2`);
    await waitAt(p, `${IL}/fr/invite?token=${token}`, "invitation arrivée");
    await p.locator('[data-testid="invite-accept"]').waitFor();
    neutralSince(from, "exp");
    await ctx.close();
  },
);

/**
 * Liens d'import de CRMlead à rouvrir après une reconnexion : un lien ordinaire, le plus long
 * qu'InvoiceLead admet (2 200 caractères pour `d`) et, avec CRM_REPO, celui que CRMlead produit pour
 * le lead le plus long qu'il admet.
 */
function importLinks() {
  const id = randomUUID();
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const payload = (description) => ({
    v: 1,
    kind: "quote",
    lead: {
      id,
      title:
        "Rénovation de la façade, isolation des combles et remplacement des fenêtres du bâtiment B",
    },
    contact: {
      id: `lead:${id}`,
      kind: "company",
      name: "Menuiserie Dupont & Fils Sàrl, atelier de Lausanne",
      contactPerson: "Jean-Philippe Dupont-Morel",
      email: "jean-philippe.dupont-morel@menuiserie-dupont-et-fils.ch",
      phone: "+41 21 555 12 34",
      country: "CH",
      language: "fr",
    },
    lines: [{ description, quantity: 1, unit: "flat", unitPriceCents: 1250000, vatCode: "normal" }],
  });
  const links = [
    `/fr/app/import/crmlead?d=${enc(payload("Rénovation de la façade, isolation des combles et remplacement des fenêtres du bâtiment B, y compris échafaudage et évacuation"))}`,
  ];
  // Le plus long qu'InvoiceLead admet dans chaque champ, raccourci par la fin jusqu'aux 2 200 caractères
  // que CRMlead garantit pour `d` (description de 500 caractères au plus).
  const big = payload("Rénovation complète, façade et toiture. ".repeat(13).slice(0, 500));
  big.lead.title = "Façade, combles et fenêtres du bâtiment B — ".repeat(5).slice(0, 200);
  big.contact.name = "Menuiserie Dupont & Fils Sàrl, atelier de Lausanne ".repeat(4).slice(0, 200);
  while (enc(big).length > 2200) big.lines[0].description = big.lines[0].description.slice(0, -1);
  links.push(`/fr/app/import/crmlead?d=${enc(big)}`);
  // Le lien que CRMlead produit pour le lead le plus long qu'il admet (titre de 300 idéogrammes…).
  if (CRM_REPO) {
    const f = `${SP}/tmp-e2e5-link.mts`;
    writeFileSync(
      f,
      `import { invoiceLeadLink } from ${JSON.stringify(`${CRM_REPO}/src/lib/invoiceLeadLink.ts`)}
const q = '"'.repeat(20)
const lead = { id: ${JSON.stringify(id)}, title: q + '見積'.repeat(140), company: 'Société à responsabilité limitée « Très »'.repeat(7).slice(0, 250),
  company_country: 'CH', amount: 990000,
  contacts: [{ is_primary: true, first_name: 'É'.repeat(120), last_name: 'Ø'.repeat(120),
    email: 'a'.repeat(64) + '@' + ('b'.repeat(60) + '.').repeat(3) + 'c'.repeat(${254 - 64 - 1 - 61 * 3 - 3}) + '.ch', phone: '+41 '.repeat(10) }] }
console.log(invoiceLeadLink(lead, 'invoice', 'fr'))`,
    );
    const made = execFileSync("npx", ["tsx", f], { cwd: CRM_REPO }).toString().trim();
    unlinkSync(f);
    const path = made.replace("https://invoicelead.io", "");
    expect(path.length <= 2400, `lien de CRMlead : ${path.length} caractères`);
    links.push(path);
  }
  return links;
}

await step("IL-NEXT-500 : un lien d'import long survit à la reconnexion", async () => {
  const ctx = await newCtx(browser, "fr-CH", "imp");
  const p = await ctx.newPage();
  await signupFromIl(p, "fr", "imp");
  const links = importLinks();
  console.log(`  longueurs : ${links.map((l) => l.length).join(", ")}`);
  for (const link of links)
    for (const mode of ["sans cookie", "cookie invalide"]) {
      await dropCookies(ctx, (n) => n === "il_session");
      if (mode === "cookie invalide")
        await ctx.addCookies([{ name: "il_session", value: `bogus${stamp}`, url: IL }]);
      await p.goto(`${IL}${link}`);
      await p.waitForURL(at(`${IL}/fr/app/import/crmlead?d=`), { timeout: 25000 }).catch(() => {});
      expect(p.url() === `${IL}${link}`, `${link.length} car., ${mode} : ${p.url().slice(0, 90)}`);
      await p
        .locator('[data-testid="crm-import"]')
        .waitFor({ timeout: 10000 })
        .catch(async () => {
          const body = (await p.locator("body").innerText()).replace(/\s+/g, " ");
          throw new Error(
            `${link.length} car., ${mode} : formulaire absent, ${body.slice(0, 160)}`,
          );
        });
    }
  await ctx.close();
});

await step(
  "IL-POST-AFTER-EXPIRY : un envoi après expiration reconnecte et revient sur la page",
  async () => {
    const ctx = ownCtx;
    const p = ownPage;
    const errors = [];
    p.on("pageerror", (e) => errors.push(String(e)));
    if (process.env.DEBUG_NAV)
      p.on(
        "framenavigated",
        (f) =>
          f === p.mainFrame() &&
          console.log(`  nav ${Date.now() % 100000} ${f.url().slice(0, 100)}`),
      );
    if (process.env.DEBUG_NAV)
      p.on(
        "request",
        (r) =>
          r.isNavigationRequest() &&
          console.log(`  req ${Date.now() % 100000} ${r.method()} ${r.url().slice(0, 100)}`),
      );
    const statuses = [];
    p.on("response", (r) => r.url().startsWith(IL) && statuses.push(r.status()));
    // La page est déjà à cette adresse : on attend qu'elle soit rouverte au retour du Compte Lead.
    const relogin = (target) =>
      p
        .waitForResponse(
          (r) =>
            r.url() === target &&
            !!r.request().redirectedFrom()?.url().startsWith(`${IL}/auth/lead/callback?`),
          { timeout: 25000 },
        )
        .then(() => p.waitForEvent("load"))
        .catch(() => {
          throw new Error(`pas de retour sur ${target} après reconnexion (${p.url()})`);
        });
    const expire = async (mode) => {
      if (mode === "cookie disparu") await dropCookies(ctx, (n) => n === "il_session");
      else
        ilq(`delete from sessions where user_id = (select id from users where email = '${OWNER}')`);
    };
    for (const mode of ["cookie disparu", "session effacée"]) {
      await p.goto(`${IL}/fr/app/contacts/new`);
      await p.fill("#contact-name", `Client ${mode}`);
      await expire(mode);
      errors.length = 0;
      let back = relogin(`${IL}/fr/app/contacts/new`);
      await p.locator('[data-testid="contact-save"]').click();
      await back;
      await p.locator('[data-testid="contact-form"]').waitFor({ timeout: 15000 });
      const body = await p.locator("body").innerText();
      expect(
        !/couldn.t load/i.test(body) && errors.length === 0,
        `contact, ${mode} : ${errors[0] ?? body.slice(0, 100)}`,
      );
      expect(p.url() === `${IL}/fr/app/contacts/new`, `contact, ${mode} : ${p.url()}`);
      // Export (POST seulement) : retour sur la page des factures, jamais un 405.
      await p.waitForLoadState("networkidle");
      await p.goto(`${IL}/fr/app/accounting/bills`);
      await expire(mode);
      statuses.length = 0;
      back = relogin(`${IL}/fr/app/accounting/bills`);
      await p.evaluate(() => {
        const f = document.createElement("form");
        f.method = "post";
        f.action = location.pathname.replace(/\/bills.*/, "/bills/export");
        document.body.append(f);
        f.submit();
      });
      await back;
      expect(
        p.url() === `${IL}/fr/app/accounting/bills` && !statuses.includes(405),
        `export, ${mode} : ${p.url()} ${statuses.join(",")}`,
      );
    }
    const cold = await browser.newContext();
    const r = await cold.request.get(`${IL}/fr/app/invoices`, { maxRedirects: 0 });
    expect(
      r.status() === 307 && r.headers().location.endsWith("/fr/login?next=%2Ffr%2Fapp%2Finvoices"),
      `page sans cookie : ${r.status()} ${r.headers().location}`,
    );
    await cold.close();
  },
);

await step(
  "IL-INVITE-NEXT : session échue avant « Accepter », erreur de connexion : l'invitation reste",
  async () => {
    const ctx = await newCtx(browser, "fr-CH", "inv");
    const p = await ctx.newPage();
    const email = await signupFromIl(p, "fr", "inv");
    const from = events.length;
    const t1 = fiduciaryInvite(OWNER, email);
    await p.goto(`${IL}/fr/invite?token=${t1}`);
    await p.locator('[data-testid="invite-accept"]').waitFor();
    ilq(`delete from sessions where user_id = (select id from users where email = '${email}')`);
    await p.locator('[data-testid="invite-accept"]').click();
    await waitAt(p, `${IL}/fr/invite?token=${t1}`, "S1 retour sur l'invitation");
    await p.locator('[data-testid="invite-accept"]').waitFor();
    expect(accepted(t1) === "f", "S1 : acceptée sans le clic");
    await p.locator('[data-testid="invite-accept"]').click();
    await waitAt(p, `${IL}/fr/app`, "S1 second clic");
    expect(accepted(t1) === "t", "S1 : pas acceptée après le clic");
    // S2 : retour du Compte Lead en erreur pendant la connexion d'une invitation. Un code refusé (déjà
    // échangé, échu) est relancé une fois sans écran : la personne arrive sur l'invitation.
    const t2 = fiduciaryInvite(OWNER, email);
    const callbackFor = async (token) => {
      await dropCookies(ctx, (n) => n === "il_session");
      const { url } = await ilAuthorize(ctx, `locale=fr&invite=${token}`);
      const back = await ctx.request.get(url, { maxRedirects: 0 });
      const cb = new URL(back.headers().location);
      expect(cb.href.startsWith(`${IL}/auth/lead/callback?`), `S2 retour : ${cb.href}`);
      return cb;
    };
    const refused = await callbackFor(t2);
    refused.searchParams.set("code", "falsifie");
    await p.goto(refused.href);
    await waitAt(p, `${IL}/fr/invite?token=${t2}`, "S2 code refusé : relance sans écran");
    // Connexion refusée au Compte Lead : l'écran d'erreur, qui garde l'invitation pour « Réessayer ».
    const cb = await callbackFor(t2);
    cb.searchParams.delete("code");
    cb.searchParams.set("error", "access_denied");
    await p.goto(cb.href);
    await waitAt(p, `${IL}/fr/login?erreur=lead&invite=${t2}`, "S2 écran d'erreur");
    // En-tête et pied de page de l'écran gardent aussi l'invitation, la langue aussi.
    for (const zone of ["header", "footer"]) {
      const hrefs = await p
        .locator(`${zone} a[href^="/auth/lead/start"]`)
        .evaluateAll((as) => as.map((a) => a.getAttribute("href")));
      expect(
        hrefs.length === 2 && hrefs.every((h) => h.includes(`invite=${t2}`)),
        `S2 ${zone} : ${hrefs.join(" ")}`,
      );
    }
    const de = await p.locator('header a[hreflang="de"]').getAttribute("href");
    expect(de === `/de/login?erreur=lead&invite=${t2}`, `S2 langue : ${de}`);
    const retry = p.locator(`a[href*="/auth/lead/start"][href*="invite=${t2}"]`).first();
    await retry.click();
    await waitAt(p, `${IL}/fr/invite?token=${t2}`, "S2 Réessayer");
    neutralSince(from, "inv");
    await ctx.close();
  },
);

await step(
  "IL-SECOND-TAB-10MIN : l'onglet d'origine revient plus de 10 minutes après, aussi pour une invitation",
  async () => {
    const ctx = await newCtx(browser, "fr-CH", "tab");
    const setup = await ctx.newPage();
    const email = await signupFromIl(setup, "fr", "tab");
    await setup.close();
    const from = events.length;
    const run = async (start, landing, dropTrace) => {
      await ctx.clearCookies();
      const origin = await ctx.newPage();
      await origin.goto(`${IL}/auth/lead/start?locale=fr&${start}`);
      await waitAt(origin, `${CRM}/login?next=`, "écran d'origine");
      await origin.getByRole("link", { name: /Mot de passe oublié/ }).click();
      await waitAt(origin, `${CRM}/mot-de-passe?next=`, "mot de passe oublié");
      // L'adresse change avant l'écran (transition du routeur) : sans cette attente, l'email allait parfois
      // dans le champ de la connexion qui s'en va, et le formulaire partait vide.
      await origin.getByRole("heading", { name: /Mot de passe oublié/ }).waitFor();
      await origin.fill("#auth-email", email);
      await origin.locator("form button").last().click();
      await origin.getByText(/Si un compte existe/).waitFor();
      const mailTab = await ctx.newPage();
      await mailTab.goto(resetLink(email, new URL(origin.url()).searchParams.get("next")));
      await mailTab.fill("#auth-password", PASS);
      await mailTab.locator("form button").last().click();
      await waitAt(mailTab, `${IL}${landing}`, "onglet de l'email");
      const trace = (await ctx.cookies()).find((c) => c.name.endsWith("_ok"));
      expect(trace && trace.expires > Date.now() / 1000 + 3 * 3600, `trace : ${trace?.expires}`);
      // Plus de dix minutes plus tard (ou la trace effacée) : l'écran d'origine reprend la demande.
      if (dropTrace) await dropCookies(ctx, (n) => n.endsWith("_ok"));
      await origin.bringToFront();
      await origin.evaluate(() => window.dispatchEvent(new Event("focus")));
      await waitAt(origin, `${IL}${landing}`, `onglet d'origine${dropTrace ? " sans trace" : ""}`);
      await origin.close();
      await mailTab.close();
    };
    await run("next=%2Ffr%2Fapp%2Fquotes", "/fr/app/quotes", true);
    for (const dropTrace of [false, true]) {
      const token = fiduciaryInvite(OWNER, email);
      await run(`invite=${token}`, `/fr/invite?token=${token}`, dropTrace);
    }
    neutralSince(from, "tab");
    await ctx.close();
  },
);

await step(
  "BOTH-COOKIE-431 (InvoiceLead) : 60 demandes abandonnées, la connexion marche encore",
  async () => {
    const ctx = await newCtx(browser, "fr-CH", "ck");
    for (let i = 0; i < 60; i++)
      await ctx.request.get(
        `${IL}/auth/lead/start?locale=fr&next=${encodeURIComponent(`/fr/app/invoices?n=${i}&${"x".repeat(200)}`)}`,
        { maxRedirects: 0 },
      );
    const pending = (await ctx.cookies()).filter((c) =>
      /^il_lead_login_[A-Za-z0-9_-]{16}$/.test(c.name),
    );
    const bytes = pending.reduce((s, c) => s + c.name.length + c.value.length + 2, 0);
    expect(pending.length <= 5 && bytes <= 6000, `${pending.length} cookies, ${bytes} octets`);
    // Lecture du routeur de Next (en-tête RSC et son paramètre `_rsc`) : rien n'est posé.
    const rsc = await ctx.request.get(`${IL}/auth/lead/start?locale=fr&next=%2Ffr%2Fapp&_rsc`, {
      maxRedirects: 0,
      headers: { rsc: "1" },
    });
    expect(rsc.status() === 204 && !rsc.headers()["set-cookie"], `lecture RSC : ${rsc.status()}`);
    const p = await ctx.newPage();
    await p.goto(`${IL}/fr/app/invoices?n=final`);
    await waitAt(p, `${CRM}/login?next=`, "écran");
    await passwordLogin(p, OWNER);
    await waitAt(p, `${IL}/fr/app/invoices?n=final`, "arrivée");
    await ctx.close();
  },
);

await step(
  "CRM-TEAM-INVITE-EMAIL : un collègue invité depuis InvoiceLead ne voit jamais CRMlead",
  async () => {
    const ctx = await newCtx(browser, "fr-CH", "mgr");
    const p = await ctx.newPage();
    const manager = await signupFromIl(p, "fr", "mgr");
    const account = crmq(`select account_id from users where email = '${manager}'`);
    crmq(
      `insert into lead_subscriptions (account_id, source_app, external_id, app_plan, plan_code, status)
     values ('${account}', 'scanlead', 'e2e5-${stamp}', 'pro_plus', 'pro_plus', 'active') on conflict do nothing`,
    );
    // Reconnexion silencieuse : InvoiceLead relit la formule (Pro+, places).
    await dropCookies(ctx, (n) => n === "il_session");
    await p.goto(`${IL}/fr/app/settings/team`);
    await waitAt(p, `${IL}/fr/app/settings/team`, "équipe");
    const colleague = mail("coll");
    const form = p.locator('[data-testid="member-invite"]');
    await form.locator('input[name="name"]').fill("Collègue E2E5");
    await form.locator('input[name="email"]').fill(colleague);
    await form.locator('[data-testid="member-invite-submit"]').click();
    const line = await waitLog(crmLog, new RegExp(`à ${colleague.replace(/[+.]/g, "\\$&")} — `));
    expect(line && /InvoiceLead/.test(line) && !/CRMlead/.test(line), `email : ${line}`);
    // Le lien de l'email n'est pas journalisé : le dernier jeton d'invitation reçoit une valeur connue.
    const token = `jeton-e2e5-${stamp}`;
    crmq(
      `update auth_tokens set token_hash = '${sha(token)}' where id = (select id from auth_tokens
       where user_id = (select id from users where email = '${colleague}') and purpose = 'invite'
       order by created_at desc limit 1)`,
    );
    const cctx = await newCtx(browser, "fr-CH", "coll");
    const from = events.length;
    const c = await cctx.newPage();
    const first = await c.goto(`${CRM}/invitation?jeton=${token}&app=invoicelead&lang=fr`);
    const html = (await first.text()).replace(/Scanlead, CRMlead, ProjectLead/g, "");
    expect(!html.includes("CRMlead"), "premier octet de l'invitation : CRMlead");
    // Rechargée hors connexion : la page neutre, pas l'accueil de CRMlead gardé en cache.
    if (!cctx.serviceWorkers().some((w) => w.url().startsWith(CRM)))
      await cctx.waitForEvent("serviceworker", { timeout: 15000 });
    await sleep(1500);
    const cut = (r) => r.abort("internetdisconnected");
    await cctx.route(`${CRM}/**`, cut);
    const off = await c.reload();
    expect(
      off?.status() === 503 && (await c.title()) === "Compte Lead",
      `hors connexion : ${off?.status()} ${await c.title()}`,
    );
    await cctx.unroute(`${CRM}/**`, cut);
    await c.reload();
    await c.fill("#auth-password", PASS);
    await c.locator("form button").last().click();
    await waitAt(c, `${IL}/fr/app`, "arrivée du collègue");
    neutralSince(from, "coll");
    const prefs = crmq(
      `select p.digest || '|' || p.weekly_report from notification_prefs p join users u on u.id = p.user_id where u.email = '${colleague}'`,
    );
    expect(prefs === "off|false", `réglages du collègue : ${prefs}`);
    await p.reload();
    await p.getByText(colleague).first().waitFor({ timeout: 10000 });
    await cctx.close();
    // Le secret d'InvoiceLead seul ne fait plus entrer personne : il faut la preuve de l'administrateur.
    const cc = await ctx.request.post(`${CRM}/oauth/token`, {
      form: {
        grant_type: "client_credentials",
        client_id: "invoicelead",
        client_secret: process.env.LEAD_ID_CLIENT_SECRET ?? "lid_test_e2e_secret",
        scope: "members",
      },
    });
    const bearer = { authorization: `Bearer ${(await cc.json()).access_token}` };
    const [org, inviter] = crmq(
      `select account_id || '|' || id from users where email = '${manager}'`,
    ).split("|");
    const intruder = mail("intrus");
    const tries = [
      ["sans preuve", {}],
      ["jeton d'une autre personne", { "x-lead-id-token": await idTokenOf(ownCtx) }],
      ["jeton falsifié", { "x-lead-id-token": "a.b.c" }],
    ];
    for (const [label, proof] of tries) {
      const r = await ctx.request.post(`${CRM}/api/lead-id/v1/members/invite`, {
        headers: { ...bearer, ...proof },
        data: { org, inviter, email: intruder, name: "Intrus" },
      });
      const body = await r.json().catch(() => ({}));
      expect(
        r.status() === 403 && body.error === "inviter_proof",
        `${label} : ${r.status()} ${body.error}`,
      );
    }
    expect(crmq(`select count(*) from users where email = '${intruder}'`) === "0", "intrus invité");
    // La portée members n'est donnée qu'à InvoiceLead, ni à Scanlead, ni à ProjectLead, ni par défaut.
    const holders = crmq(
      `select string_agg(client_id, ',' order by client_id) from lead_id_clients where 'members' = any(scopes)`,
    );
    expect(holders === "invoicelead", `portée members : ${holders}`);
    const byDefault = crmq(
      `select coalesce(column_default, '') from information_schema.columns where table_name = 'lead_id_clients' and column_name = 'scopes'`,
    );
    expect(!byDefault.includes("members"), `valeur par défaut : ${byDefault}`);
    // Contrôle : une invitation faite dans CRMlead reste celle de CRMlead.
    const direct = mail("coll-crm");
    const r = await ctx.request.post(`${CRM}/api/users`, {
      data: { email: direct, name: "Direct" },
      headers: { origin: CRM },
    });
    expect(r.status() === 201, `invitation CRMlead : ${r.status()}`);
    const dl = await waitLog(crmLog, new RegExp(`à ${direct.replace(/[+.]/g, "\\$&")} — `));
    expect(dl && /sur CRMlead/.test(dl), `email CRMlead : ${dl}`);
    await ctx.close();
  },
);

// Le HTML des emails n'est pas journalisé : un CRMlead à part (CRM_MAILCAP) les écrit dans CRM_MAILCAP_FILE.
const MAILCAP = process.env.CRM_MAILCAP ?? "";
if (!MAILCAP) console.log("=== CRM-LEAD-EMAILS-HTML : sautée (CRM_MAILCAP absent)");
else
  await step(
    "CRM-LEAD-EMAILS-HTML : emails du Compte Lead pour InvoiceLead, ni « CRMlead » ni son vert ; CRMlead direct inchangé",
    async () => {
      const file = process.env.CRM_MAILCAP_FILE ?? "";
      expect(file, "CRM_MAILCAP_FILE manquant");
      const sent = (to, n = 1) =>
        readFileSync(file, "utf8")
          .split("\n")
          .filter(Boolean)
          .map((l) => JSON.parse(l))
          .filter((m) => m.to.includes(to))[n - 1];
      const mailTo = async (to, n = 1) => {
        for (let i = 0; i < 40 && !sent(to, n); i++) await sleep(250);
        return sent(to, n);
      };
      const words = (h) =>
        h
          .replace(/<style[\s\S]*?<\/style>/g, "")
          .replace(/<[^>]+>/g, " ")
          .replace(/\s+/g, " ");
      /**
       * Au nom du Compte Lead : la marque des quatre carrés, aucun « CRMlead », la couleur de l'application. Seul le
       * carré de l'application qui envoie (`lit`) est en couleur ; « CL » reste neutre, jamais blanc sur le vert de
       * l'icône de CRMlead (lot 8) : la recherche de ce vert porte sur tout l'email, carrés compris.
       */
      const leadMail = (label, m, button, lit = "IL") => {
        expect(m, `${label} : aucun email`);
        const squares = [...m.html.matchAll(/<div style="([^"]*)">(SL|CL|PL|IL)<\/div>/g)];
        expect(squares.length === 4, `${label} : marque de la famille (${squares.length})`);
        for (const [, style, sq] of squares) {
          const neutral = /background:#fff;border:1px solid #cfcac4;color:#57534e/.test(style);
          expect(
            sq === lit ? !neutral && /color:#fff/.test(style) : neutral,
            `${label} : carré ${sq} ${neutral ? "neutre" : "en couleur"} (${style.slice(0, 70)})`,
          );
        }
        const h = m.html.replace(/<div style="[^"]*">(SL|CL|PL|IL)<\/div>/g, "");
        expect(
          !/CRMlead/i.test(h + m.text + m.subject) && !/#0E6D6E|#0f6e70/i.test(m.html),
          `${label} : ${(m.html.match(/.{60}(CRMlead|#0E6D6E|#0f6e70).{20}/i) ?? [m.subject])[0]}`,
        );
        if (lit === "IL") {
          const il = squares.find((x) => x[2] === "IL")?.[1] ?? "";
          expect(/background:#7a2e67;color:#fff/i.test(il), `${label} : IL pas en prune (${il})`);
          expect(/#7a2e67/i.test(h), `${label} : pas la couleur d'InvoiceLead`);
        }
        if (button) expect(words(h).includes(button), `${label} : bouton « ${button} » absent`);
      };
      const H = { headers: { origin: MAILCAP } };
      const ctx = await browser.newContext();
      const admin = mail("cap-adm");
      const s = await ctx.request.post(`${MAILCAP}/api/auth/signup`, {
        data: {
          accountName: "E2E5 emails",
          name: "Eve",
          email: admin,
          password: PASS,
          locale: "fr",
          app: "invoicelead",
        },
        ...H,
      });
      expect(s.ok(), `inscription ${s.status()}`);
      leadMail("confirmation d'adresse", await mailTo(admin));
      const [org, inviter] = crmq(
        `select account_id || '|' || id from users where email = '${admin}'`,
      ).split("|");
      crmq(
        `insert into lead_subscriptions (account_id, source_app, external_id, app_plan, plan_code, status)
         values ('${org}', 'scanlead', 'e2e5-cap-${stamp}', 'pro_plus', 'pro_plus', 'active') on conflict do nothing`,
      );
      const tok = await ctx.request.post(`${MAILCAP}/oauth/token`, {
        form: {
          grant_type: "client_credentials",
          client_id: "invoicelead",
          client_secret: process.env.LEAD_ID_CLIENT_SECRET ?? "lid_test_e2e_secret",
          scope: "members",
        },
      });
      // La preuve de l'administrateur (son jeton d'identité, comme InvoiceLead l'envoie) : sans elle, 403.
      const bearer = {
        authorization: `Bearer ${(await tok.json()).access_token}`,
        "x-lead-id-token": await idTokenOf(ctx, MAILCAP),
      };
      // Invitation d'un collègue par InvoiceLead (Réglages → Équipe appelle cette route), dans trois langues.
      const labels = {
        fr: "Choisir mon mot de passe",
        de: "Mein Passwort wählen",
        en: "Choose my password",
      };
      let deId = "";
      for (const l of Object.keys(labels)) {
        const to = mail(`cap-coll-${l}`);
        const r = await ctx.request.post(`${MAILCAP}/api/lead-id/v1/members/invite`, {
          headers: bearer,
          data: { org, inviter, email: to, name: `Collègue ${l}`, locale: l },
        });
        expect(r.status() === 201, `invitation ${l} : ${r.status()}`);
        if (l === "de") deId = (await r.json()).id;
        const m = await mailTo(to);
        leadMail(`invitation (${l})`, m, labels[l]);
        expect(/\/invitation\?jeton=[^"]+app=invoicelead/.test(m.html), `invitation (${l}) : lien`);
      }
      const again = await ctx.request.post(`${MAILCAP}/api/lead-id/v1/members/${deId}/invite`, {
        headers: bearer,
        data: { org, inviter, locale: "de" },
      });
      expect(again.ok(), `relance : ${again.status()}`);
      leadMail("relance (de)", await mailTo(mail("cap-coll-de"), 2), labels.de);
      // Mot de passe oublié depuis l'écran du Compte Lead d'InvoiceLead.
      // Comme l'écran (appNextForSso) : « + » de la requête envoyé en « %20 ».
      const { next } = await ilAuthorize(ctx, "locale=fr", MAILCAP);
      const f = await ctx.request.post(`${MAILCAP}/api/auth/forgot`, {
        data: { email: admin, next: next.replace(/\+/g, "%20") },
        ...H,
      });
      expect(f.ok(), `mot de passe oublié : ${f.status()}`);
      leadMail("réinitialisation", await mailTo(admin, 2));
      // ProjectLead : seul « PL » en couleur, toujours sans le vert de CRMlead.
      const pctx = await browser.newContext();
      const pl = mail("cap-pl");
      const sp = await pctx.request.post(`${MAILCAP}/api/auth/signup`, {
        data: {
          accountName: "E2E5 PL",
          name: "Eve",
          email: pl,
          password: PASS,
          locale: "fr",
          app: "projectlead",
        },
        ...H,
      });
      expect(sp.ok(), `inscription ProjectLead ${sp.status()}`);
      leadMail("confirmation ProjectLead", await mailTo(pl), undefined, "PL");
      await pctx.close();
      // Contrôle : CRMlead ouvert directement garde « Rejoindre CRMlead » et son vert.
      const d = await browser.newContext();
      const direct = mail("cap-direct");
      const ds = await d.request.post(`${MAILCAP}/api/auth/signup`, {
        data: {
          accountName: "E2E5 direct",
          name: "Eve",
          email: direct,
          password: PASS,
          locale: "fr",
        },
        ...H,
      });
      expect(ds.ok(), `inscription directe ${ds.status()}`);
      const dv = await mailTo(direct);
      expect(
        dv && /CRMlead/.test(dv.html) && /#0E6D6E/i.test(dv.html) && /icon-192\.png/.test(dv.html),
        "confirmation directe : CRMlead, son vert et son icône",
      );
      crmq(
        `insert into lead_subscriptions (account_id, source_app, external_id, app_plan, plan_code, status)
         select account_id, 'scanlead', 'e2e5-capd-${stamp}', 'pro_plus', 'pro_plus', 'active' from users where email = '${direct}'`,
      );
      const colD = mail("cap-coll-direct");
      const di = await d.request.post(`${MAILCAP}/api/users`, {
        data: { email: colD, name: "Direct" },
        ...H,
      });
      expect(di.status() === 201, `invitation directe : ${di.status()}`);
      const dm = await mailTo(colD);
      expect(
        dm && words(dm.html).includes("Rejoindre CRMlead") && /#0E6D6E/i.test(dm.html),
        "invitation directe : « Rejoindre CRMlead » en vert",
      );
      await Promise.all([ctx.close(), d.close()]);
    },
  );

await step(
  "CRM-EXISTING-APP-ACCOUNTS-EMAILS : comptes ouverts depuis InvoiceLead avant le lot, rendus muets par 113",
  async () => {
    expect(CRM_REPO, "CRM_REPO manquant");
    const make = async (label, realLead) => {
      const ctx = await browser.newContext({ locale: "fr-CH" });
      const email = mail(label);
      // Comme le faisait CRMlead en production avant ce lot : inscription sans application.
      const r = await ctx.request.post(`${CRM}/api/auth/signup`, {
        data: { accountName: `E2E5 ${label}`, name: "Eve", email, password: PASS, locale: "fr" },
        headers: { origin: CRM },
      });
      expect(r.ok(), `inscription ${r.status()}`);
      if (realLead) {
        const l = await ctx.request.post(`${CRM}/api/leads`, {
          data: { title: "Un vrai lead" },
          headers: { origin: CRM },
        });
        expect(l.ok(), `lead ${l.status()}`);
      }
      await ctx.clearCookies();
      const p = await ctx.newPage();
      await p.goto(`${IL}/auth/lead/start?locale=fr`);
      await waitAt(p, `${CRM}/login?next=`, "écran");
      await passwordLogin(p, email);
      await waitAt(p, `${IL}/fr/app`, "arrivée");
      await ctx.close();
      return email;
    };
    /** Inscription et première connexion depuis InvoiceLead vieillies de deux jours. */
    const backdate = (email) => {
      crmq(
        `update lead_id_refresh set created_at = created_at - interval '2 days' where user_id = (select id from users where email = '${email}')`,
      );
      crmq(`update users set created_at = created_at - interval '2 days' where email = '${email}'`);
    };
    /** Session CRMlead de cette personne, pour régler elle-même ses préférences. */
    const signedIn = async (email) => {
      const c = await browser.newContext();
      const r = await c.request.post(`${CRM}/api/auth/login`, {
        data: { email, password: PASS },
        headers: { origin: CRM },
      });
      expect(r.ok(), `connexion de ${email} : ${r.status()}`);
      return c;
    };
    const quiet = await make("legacy", false);
    const kept = await make("legacy-lead", true);
    // Le lendemain, « Ne plus recevoir ces conseils » dans l'email de CRMlead.
    const unsub = await make("legacy-unsub", false);
    backdate(unsub);
    crmq(
      `insert into lifecycle_prefs (user_id, account_id) select id, account_id from users where email = '${unsub}' on conflict do nothing`,
    );
    const tok = crmq(
      `select p.token from lifecycle_prefs p join users u on u.id = p.user_id where u.email = '${unsub}'`,
    );
    const pub = await browser.newContext();
    const ask = await pub.request.get(`${CRM}/api/public/lifecycle/unsubscribe?t=${tok}`);
    const done = await pub.request.post(`${CRM}/api/public/lifecycle/unsubscribe?t=${tok}`, {
      headers: { origin: CRM },
    });
    expect(
      ask.status() === 200 && done.status() === 200,
      `désinscription ${ask.status()} ${done.status()}`,
    );
    await pub.close();
    // Conseils rallumés par la personne elle-même, après coup : son choix reste.
    const tipsOn = await make("legacy-tips-on", false);
    backdate(tipsOn);
    const ct = await signedIn(tipsOn);
    const on = await ct.request.put(`${CRM}/api/lifecycle/prefs`, {
      data: { tips: true },
      headers: { origin: CRM },
    });
    expect(on.ok(), `conseils rallumés : ${on.status()}`);
    await ct.close();
    // Compte CRMlead direct, jamais passé par une application.
    const direct = mail("legacy-direct");
    const dc = await browser.newContext();
    const dr = await dc.request.post(`${CRM}/api/auth/signup`, {
      data: {
        accountName: "E2E5 direct 113",
        name: "Eve",
        email: direct,
        password: PASS,
        locale: "fr",
      },
      headers: { origin: CRM },
    });
    expect(dr.ok(), `inscription directe ${dr.status()}`);
    await dc.close();
    // Inscrite sur CRMlead (son écran de bienvenue vu), puis InvoiceLead ouvert dans le quart d'heure, sans vrai
    // lead : une utilisatrice directe de CRMlead, jamais rendue muette.
    const welcomed = mail("direct-then-il");
    const wc = await browser.newContext({ locale: "fr-CH" });
    const wp = await wc.newPage();
    await wp.goto(`${CRM}/signup`);
    await wp.fill("#auth-account", "E2E5 direct puis InvoiceLead");
    await wp.fill("#auth-name", "Eve");
    await wp.fill("#auth-email", welcomed);
    await wp.fill("#auth-password", PASS);
    await wp.locator("form button").last().click();
    await waitAt(wp, `${CRM}/bienvenue`, "écran de bienvenue de CRMlead");
    const marked = () =>
      crmq(
        `select count(*) from onboarding_marks o join users u on u.id = o.user_id where u.email = '${welcomed}'`,
      ) !== "0";
    for (let i = 0; i < 40 && !marked(); i++) await sleep(250);
    expect(marked(), "bienvenue de CRMlead non relevée");
    await wp.goto(`${IL}/auth/lead/start?locale=fr`);
    await waitAt(wp, `${IL}/fr/app`, "InvoiceLead ouvert dans la foulée");
    await wc.close();
    // Ouvert depuis InvoiceLead avant le lot, notifications réglées par la personne : son choix reste.
    const handSet = await make("legacy-hand-set", false);
    backdate(handSet);
    const ch = await signedIn(handSet);
    const hs = await ch.request.put(`${CRM}/api/notifications/prefs`, {
      data: { digest: "weekly" },
      headers: { origin: CRM },
    });
    expect(hs.ok(), `récapitulatif hebdomadaire choisi : ${hs.status()}`);
    await ch.close();
    const replay = () =>
      execFileSync("psql", [
        "-U",
        "postgres",
        "-h",
        "localhost",
        "-d",
        "crmlead_e2e",
        "-q",
        "-v",
        "ON_ERROR_STOP=1",
        "-f",
        `${CRM_REPO}/db/113_free_plan_all_apps.sql`,
      ]);
    replay();
    const prefs = (email) =>
      crmq(
        `select coalesce(p.digest, '-') || '|' || coalesce(p.weekly_report::text, '-') || '|' || coalesce(l.tips::text, '-')
         from users u left join notification_prefs p on p.user_id = u.id left join lifecycle_prefs l on l.user_id = u.id
        where u.email = '${email}'`,
      );
    expect(prefs(quiet) === "off|false|false", `compte InvoiceLead : ${prefs(quiet)}`);
    expect(prefs(unsub) === "off|false|false", `compte InvoiceLead désinscrit : ${prefs(unsub)}`);
    expect(!/false/.test(prefs(kept)), `compte CRMlead avec un vrai lead : ${prefs(kept)}`);
    expect(!/^off|false\|/.test(prefs(tipsOn)), `conseils rallumés : ${prefs(tipsOn)}`);
    expect(!/false/.test(prefs(direct)), `compte CRMlead direct : ${prefs(direct)}`);
    expect(
      !/off|false/.test(prefs(welcomed)),
      `inscrite sur CRMlead puis InvoiceLead : ${prefs(welcomed)}`,
    );
    expect(
      /^weekly\|true\|/.test(prefs(handSet)) && !/false/.test(prefs(handSet)),
      `notifications réglées par la personne : ${prefs(handSet)}`,
    );
    // Rejouée, 113 ne repasse jamais sur un compte traité : le rapport du lundi rallumé reste.
    const cq = await signedIn(quiet);
    const wr = await cq.request.put(`${CRM}/api/notifications/prefs`, {
      data: { weeklyReport: true },
      headers: { origin: CRM },
    });
    expect(wr.ok(), `rapport du lundi rallumé : ${wr.status()}`);
    await cq.close();
    replay();
    expect(prefs(quiet).split("|")[1] === "true", `113 rejouée : ${prefs(quiet)}`);
  },
);

// ---------- lot 6 (InvoiceLead) : entreprise, personne et page retrouvées ----------
/** Personne et entreprise de la session InvoiceLead de ce navigateur (« email|entreprise »), ou "". */
async function ilWho(ctx) {
  const t = (await ctx.cookies()).find((c) => c.name === "il_session")?.value;
  if (!t) return "";
  return ilq(
    `select u.email || '|' || o.name from sessions s join users u on u.id = s.user_id
       join organizations o on o.id = s.organization_id
      where s.id = '${sha(decodeURIComponent(t))}' and s.expires_at > now()`,
  );
}
/** La page `target` rouverte au retour du Compte Lead (après un envoi ou un clic). */
const reopened = (page, target) =>
  page
    .waitForResponse(
      (r) =>
        r.url() === target &&
        !!r.request().redirectedFrom()?.url().startsWith(`${IL}/auth/lead/callback?`),
      { timeout: 25000 },
    )
    .then(() => page.waitForEvent("load"))
    .catch(() => {
      throw new Error(`pas de retour sur ${target} après reconnexion (${page.url()})`);
    });
const orgName = (page) => page.locator('[data-testid="org-name"]').first().innerText();
const ownerOrg = () =>
  ilq(
    `select o.name from organizations o join memberships m on m.organization_id = o.id
       join users u on u.id = m.user_id where u.email = '${OWNER}' and m.role <> 'fiduciary' limit 1`,
  );

await step(
  "IL-FIDU-ORG : une fiduciaire reconnectée revient chez son client, sur la même page",
  async () => {
    const name = `Client du client ${stamp}`;
    await ownPage.goto(`${IL}/fr/app/contacts/new`);
    await ownPage.fill("#contact-name", name);
    await ownPage.locator('[data-testid="contact-save"]').click();
    await waitAt(ownPage, `${IL}/fr/app/contacts?saved=1`, "contact du client");
    const id = ilq(`select id from contacts where name = '${name}'`);
    const client = ownerOrg();
    const ctx = await newCtx(browser, "fr-CH", "fidorg");
    const p = await ctx.newPage();
    const email = await signupFromIl(p, "fr", "fidorg");
    const from = events.length;
    const token = fiduciaryInvite(OWNER, email);
    await p.goto(`${IL}/fr/invite?token=${token}`);
    await p.locator('[data-testid="invite-accept"]').click();
    await waitAt(p, `${IL}/fr/app/accounting?welcome=fiduciary`, "acceptation");
    const card = `${IL}/fr/app/contacts/${id}`;
    await p.goto(card);
    expect((await p.inputValue("#contact-name")) === name, "fiche avant l'échéance");
    const expire = (mode) =>
      mode === "cookie disparu"
        ? dropCookies(ctx, (n) => n === "il_session")
        : ilq(
            `delete from sessions where user_id = (select id from users where email = '${email}')`,
          );
    for (const mode of ["cookie disparu", "session effacée"]) {
      await expire(mode);
      await p.reload();
      await waitAt(p, card, `${mode} : retour sur la fiche`);
      const value = await p
        .locator("#contact-name")
        .inputValue({ timeout: 10000 })
        .catch(() => "");
      expect(value === name, `${mode} : ${p.url()} « ${await p.title()} »`);
      expect((await orgName(p)) === client, `${mode} : entreprise ${await orgName(p)}`);
      expect((await ilWho(ctx)) === `${email}|${client}`, `${mode} : session ${await ilWho(ctx)}`);
    }
    // Liste : celle du client, pas la sienne.
    await p.goto(`${IL}/fr/app/contacts`);
    expect((await p.getByText(name).count()) > 0, "liste : pas le contact du client");
    // Envoi après l'échéance : retour sur la même page, chez le client.
    await p.goto(`${IL}/fr/app/contacts/new`);
    await p.fill("#contact-name", `Saisie ${stamp}`);
    await expire("session effacée");
    const back = reopened(p, `${IL}/fr/app/contacts/new`);
    await p.locator('[data-testid="contact-save"]').click();
    await back;
    expect((await orgName(p)) === client, `envoi : entreprise ${await orgName(p)}`);
    // Retirée par le client (comme removeFiduciary) : reconnexion chez elle, plus rien du client.
    ilq(
      `delete from memberships where role = 'fiduciary' and user_id = (select id from users where email = '${email}')`,
    );
    ilq(`delete from sessions where user_id = (select id from users where email = '${email}')`);
    await p.goto(`${IL}/fr/app/contacts`);
    await waitAt(p, `${IL}/fr/app/contacts`, "après le retrait");
    expect((await orgName(p)) === "E2E5 fidorg", `après le retrait : ${await orgName(p)}`);
    expect((await p.getByText(name).count()) === 0, "après le retrait : contact du client visible");
    const last = ilq(
      `select coalesce(last_organization_id::text, '-') from users where email = '${email}'`,
    );
    expect(last === "-", `après le retrait : choix gardé ${last}`);
    neutralSince(from, "fidorg");
    await ctx.close();
  },
);

await step(
  "IL-INVITE-SWITCH : « Changer de compte » ramène sur l'invitation, le bon compte l'accepte",
  async () => {
    const tmp = await newCtx(browser, "fr-CH", "swr");
    const right = await signupFromIl(await tmp.newPage(), "fr", "sw-right");
    await tmp.close();
    const wrong = mail("sw-wrong");
    // A : connectée à InvoiceLead avec un autre compte. B : seulement au Compte Lead.
    for (const mode of ["InvoiceLead", "Compte Lead seul"]) {
      const tag = `sw-${mode === "InvoiceLead" ? "il" : "lead"}`;
      const ctx = await newCtx(browser, "fr-CH", tag);
      const p = await ctx.newPage();
      if (mode === "InvoiceLead") await signupFromIl(p, "fr", "sw-wrong");
      else {
        const r = await ctx.request.post(`${CRM}/api/auth/login`, {
          data: { email: wrong, password: PASS },
          headers: { origin: CRM },
        });
        expect(r.ok(), `${mode} : connexion au Compte Lead ${r.status()}`);
      }
      const from = events.length;
      const token = fiduciaryInvite(OWNER, right);
      const invite = `${IL}/fr/invite?token=${token}`;
      const signIn = p.locator(`a[href*="invite=${token}"]`);
      await p.goto(invite);
      if (mode !== "InvoiceLead") {
        await signIn.click();
        await waitAt(p, invite, `${mode} : connexion sans écran, mauvais compte`);
      }
      await p.locator('[data-testid="invite-accept"]').click();
      await waitAt(p, `${invite}&error=wrongEmail`, `${mode} : mauvaise adresse`);
      await p.getByRole("button", { name: "Changer de compte" }).click();
      await p
        .waitForURL((u) => u.href === invite, { timeout: 25000 })
        .catch(() => {
          throw new Error(`${mode} : après « Changer de compte » ${p.url()}`);
        });
      await signIn.waitFor();
      const left = (await ctx.cookies()).map((c) => c.name);
      expect(
        !left.includes("il_session") && !left.includes("il_after_logout"),
        `${mode} : cookies ${left}`,
      );
      await signIn.click();
      await waitAt(p, `${CRM}/login?next=`, `${mode} : écran du Compte Lead`);
      await passwordLogin(p, right);
      await waitAt(p, invite, `${mode} : retour sur l'invitation`);
      await p.locator('[data-testid="invite-accept"]').click();
      await waitAt(p, `${IL}/fr/app/accounting?welcome=fiduciary`, `${mode} : acceptée`);
      expect(accepted(token) === "t", `${mode} : invitation pas acceptée`);
      neutralSince(from, tag);
      if (mode === "InvoiceLead") {
        // Déconnexion ordinaire : l'accueil ; une seconde visite de l'accueil y reste.
        await ilLogout(p);
        await p.waitForURL((u) => /^\/(de|fr)?$/.test(u.pathname) && u.href.startsWith(IL), {
          timeout: 20000,
        });
        await p.goto(`${IL}/`);
        expect(!/invite/.test(p.url()), `accueil : ${p.url()}`);
      }
      await ctx.close();
    }
  },
);

await step(
  "IL-STRIPE-AFTER-EXPIRY : « Relier Stripe » après l'échéance, retour sur la page Paiements",
  async () => {
    const ctx = await newCtx(browser, "fr-CH", "stripe");
    const p = await ctx.newPage();
    const email = await signupFromIl(p, "fr", "stripe");
    const from = events.length;
    const payments = `${IL}/fr/app/settings/payments`;
    // Session valable : tout droit vers Stripe, comme avant.
    const ok = await ctx.request.get(`${IL}/api/stripe/connect?locale=fr`, { maxRedirects: 0 });
    expect(
      ok.status() === 303 && ok.headers().location.startsWith("https://connect.stripe.com/"),
      `session valable : ${ok.status()} ${ok.headers().location}`,
    );
    await p.goto(payments);
    await p.locator('[data-testid="stripe-connect"]').waitFor();
    ilq(`delete from sessions where user_id = (select id from users where email = '${email}')`);
    const back = reopened(p, payments);
    await p.locator('[data-testid="stripe-connect"]').click();
    await back;
    expect(p.url() === payments, `arrivée ${p.url()}`);
    await p.locator('[data-testid="stripe-connect"]').waitFor();
    neutralSince(from, "stripe");
    await ctx.close();
  },
);

await step(
  "IL-DOWNLOAD-AFTER-EXPIRY : un fichier demandé après une double échéance ramène à son formulaire",
  async () => {
    const ctx = await newCtx(browser, "de-CH", "dl");
    const b = await ctx.newPage();
    const email = await signupFromIl(b, "de", "dl");
    const org = ilq(
      `select m.organization_id from memberships m join users u on u.id = m.user_id where u.email = '${email}' limit 1`,
    );
    ilq(`update organizations set country = 'DE' where id = '${org}'`);
    const year = ilq(
      `with y as (insert into fiscal_years (organization_id, start_date, end_date)
                  values ('${org}', '2026-01-01', '2026-12-31') returning id) select id from y`,
    );
    const from = events.length;
    const reports = `${IL}/de/app/accounting/reports?year=${year}`;
    const datev = `${IL}/de/app/accounting/reports/datev?year=${year}&consultant=1001&client=1`;
    const landed = async (what) => {
      await waitAt(b, reports, what);
      await sleep(800);
      expect(
        b.url() === reports && /· InvoiceLead$/.test(await b.title()),
        `${what} : ${b.url()} « ${await b.title()} »`,
      );
    };
    // Onglet B sur les rapports ; onglet A se déconnecte (InvoiceLead et Compte Lead).
    await b.goto(reports);
    await b.locator('[data-testid="export-datev"]').waitFor();
    const a = await ctx.newPage();
    await a.goto(`${IL}/de/app`);
    await ilLogout(a);
    // Fini quand l'accueil revient (après /oauth/logout du Compte Lead).
    await a.waitForURL((u) => u.href.startsWith(IL) && /^\/(de|fr|en)?$/.test(u.pathname), {
      timeout: 20000,
    });
    await a.close();
    // Onglet B : export DATEV, écran du Compte Lead, connexion : retour sur les rapports.
    await b.bringToFront();
    await b.fill('input[name="consultant"]', "1001");
    await b.fill('input[name="client"]', "1");
    await b.locator('[data-testid="export-datev"]').click();
    await waitAt(b, `${CRM}/login?next=`, "écran Lead-Konto");
    await passwordLogin(b, email);
    await landed("export après la déconnexion");
    // Tous les cookies effacés, adresse du fichier ouverte telle quelle.
    await ctx.clearCookies();
    await b.goto(datev);
    await waitAt(b, `${CRM}/login?next=`, "écran Lead-Konto (2)");
    await passwordLogin(b, email);
    await landed("fichier ouvert sans cookie");
    // Seule la session InvoiceLead échue : retour sans écran, sur les rapports.
    await dropCookies(ctx, (n) => n === "il_session");
    await b.goto(datev);
    await landed("session InvoiceLead seule échue");
    neutralSince(from, "dl");
    // XML TVA et XRechnung : la page de leur lien, jamais le fichier.
    const cold = await browser.newContext();
    const doc = randomUUID();
    for (const [file, form] of [
      ["/fr/app/accounting/vat/xml?period=2026-07-01", "/fr/app/accounting/vat?period=2026-07-01"],
      [`/de/app/invoices/${doc}/xrechnung`, `/de/app/invoices/${doc}`],
      [`/de/app/credit-notes/${doc}/xrechnung`, `/de/app/credit-notes/${doc}`],
    ]) {
      const r = await cold.request.get(`${IL}${file}`, { maxRedirects: 0 });
      const want = `/${file.slice(1, 3)}/login?${new URLSearchParams({ next: form })}`;
      expect(
        r.status() === 307 && r.headers().location.endsWith(want),
        `${file} : ${r.status()} ${r.headers().location}`,
      );
    }
    await cold.close();
    await ctx.close();
  },
);

await step(
  "IL-NEXT-LONG-NO-COOKIE : lien d'import long, connexion finie sans le cookie de la demande",
  async () => {
    const ctx = await newCtx(browser, "fr-CH", "imp2");
    const p = await ctx.newPage();
    const email = await signupFromIl(p, "fr", "imp2");
    const from = events.length;
    const arrived = async (page, link, what) => {
      await page
        .waitForURL(at(`${IL}/fr/app/import/crmlead?d=`), { timeout: 30000 })
        .catch(() => {});
      expect(page.url() === `${IL}${link}`, `${what} : ${page.url().slice(0, 90)}`);
      await page
        .locator('[data-testid="crm-import"]')
        .waitFor({ timeout: 10000 })
        .catch(() => {
          throw new Error(`${what} : formulaire absent`);
        });
    };
    for (const link of importLinks()) {
      // (a) Mot de passe oublié, lien de l'email ouvert dans un autre navigateur.
      await ctx.clearCookies();
      await p.goto(`${IL}${link}`);
      await waitAt(p, `${CRM}/login?next=`, "écran");
      const other = await newCtx(browser, "fr-CH", "imp2");
      const q = await other.newPage();
      await q.goto(resetLink(email, new URL(p.url()).searchParams.get("next")));
      await q.fill("#auth-password", PASS);
      await q.locator("form button").last().click();
      await arrived(q, link, `${link.length} car., autre navigateur`);
      await other.close();
      // (b) Même navigateur, cookie de la demande disparu (écran resté ouvert plus de trois heures).
      await ctx.clearCookies();
      await p.goto(`${IL}${link}`);
      await waitAt(p, `${CRM}/login?next=`, "écran (b)");
      await dropCookies(ctx, (n) => n.startsWith("il_lead_login_"));
      await passwordLogin(p, email);
      await arrived(p, link, `${link.length} car., cookie de la demande disparu`);
    }
    neutralSince(from, "imp2");
    await ctx.close();
  },
);

await step("IL-ASTERISK : une recherche avec « * » survit à la reconnexion", async () => {
  const ctx = await newCtx(browser, "fr-CH", "ast");
  const p = await ctx.newPage();
  const email = await signupFromIl(p, "fr", "ast");
  const from = events.length;
  for (const [page, field] of [
    ["/fr/app/contacts?q=M%C3%BCller*", "Müller*"],
    ["/de/app/contacts?q=%C3%84rzte+%26+Co&archived=1", "Ärzte & Co"],
  ]) {
    await ctx.clearCookies();
    await p.goto(`${IL}${page}`);
    await waitAt(p, `${CRM}/login?next=`, `${page} : écran`);
    await passwordLogin(p, email);
    await p.waitForURL((u) => u.href.startsWith(IL) && !u.pathname.startsWith("/auth"), {
      timeout: 25000,
    });
    await sleep(800);
    expect(p.url() === `${IL}${page}`, `${page} : arrivée ${p.url()}`);
    expect((await p.inputValue("#contacts-q")) === field, `${page} : champ de recherche`);
    // Seule la session InvoiceLead échue : retour sans écran.
    await dropCookies(ctx, (n) => n === "il_session");
    await p.goto(`${IL}${page}`);
    expect(p.url() === `${IL}${page}`, `${page} : retour sans écran ${p.url()}`);
  }
  neutralSince(from, "ast");
  await ctx.close();
});

await step(
  "CRM-TEAM-INVITE-SHARED-BROWSER : collègue invité sur un poste où l'administrateur est connecté",
  async () => {
    const ctx = await newCtx(browser, "fr-CH", "shm");
    const p = await ctx.newPage();
    const manager = await signupFromIl(p, "fr", "shm");
    const account = crmq(`select account_id from users where email = '${manager}'`);
    crmq(
      `insert into lead_subscriptions (account_id, source_app, external_id, app_plan, plan_code, status)
     values ('${account}', 'scanlead', 'e2e5-shm-${stamp}', 'pro_plus', 'pro_plus', 'active') on conflict do nothing`,
    );
    await dropCookies(ctx, (n) => n === "il_session");
    await p.goto(`${IL}/fr/app/settings/team`);
    await waitAt(p, `${IL}/fr/app/settings/team`, "équipe");
    /** Invitation d'un collègue par le formulaire, et le lien de son email (jeton connu). */
    const invite = async (label) => {
      const colleague = mail(label);
      const form = p.locator('[data-testid="member-invite"]');
      await form.locator('input[name="name"]').fill(`Collègue ${label}`);
      await form.locator('input[name="email"]').fill(colleague);
      await form.locator('[data-testid="member-invite-submit"]').click();
      const sent = await waitLog(crmLog, new RegExp(`à ${colleague.replace(/[+.]/g, "\\$&")} — `));
      expect(sent, `invitation de ${label} : pas d'email`);
      const token = `jeton-e2e5-${label}-${stamp}`;
      crmq(
        `update auth_tokens set token_hash = '${sha(token)}' where id = (select id from auth_tokens
         where user_id = (select id from users where email = '${colleague}') and purpose = 'invite'
         order by created_at desc limit 1)`,
      );
      return { colleague, link: `${CRM}/invitation?jeton=${token}&app=invoicelead&lang=fr` };
    };
    const ilSessions = (email) =>
      ilq(
        `select count(*) from sessions s join users u on u.id = s.user_id where u.email = '${email}' and s.expires_at > now()`,
      );
    const managerToken = async (c) =>
      (await c.cookies()).find((k) => k.name === "il_session")?.value ?? "";
    const gone = (token) =>
      ilq(`select count(*) from sessions where id = '${sha(decodeURIComponent(token))}'`) === "0";

    // Deux invitations, faites tant que l'administrateur est encore connecté ici.
    const one = await invite("shm-a");
    const two = await invite("shm-b");
    // (a) Les deux sessions de l'administrateur ouvertes : « Me déconnecter et accepter ».
    const before = await managerToken(ctx);
    const from = events.length;
    await p.goto(one.link);
    await p.getByText(/connecté en tant que/).waitFor();
    await p.getByRole("button", { name: /Me déconnecter et accepter/ }).click();
    await p.waitForSelector("#auth-password");
    await p.fill("#auth-password", PASS);
    await p.locator("form button").last().click();
    await waitAt(p, `${IL}/fr/app`, "(a) arrivée du collègue");
    expect((await ilWho(ctx)).startsWith(`${one.colleague}|`), `(a) session ${await ilWho(ctx)}`);
    expect(
      ilSessions(one.colleague) === "1",
      `(a) sessions du collègue ${ilSessions(one.colleague)}`,
    );
    expect(gone(before), "(a) session de l'administrateur encore valable");
    neutralSince(from, "shm");

    // (b) Compte Lead fermé, session InvoiceLead de l'administrateur restée dans le navigateur.
    const ctx2 = await newCtx(browser, "fr-CH", "shm2");
    const q = await ctx2.newPage();
    await q.goto(`${IL}/auth/lead/start?locale=fr`);
    await waitAt(q, `${CRM}/login?next=`, "(b) écran");
    await passwordLogin(q, manager);
    await waitAt(q, `${IL}/fr/app`, "(b) administrateur connecté");
    await dropCookies(ctx2, (n) => n.startsWith("crmlead_session"));
    const left = await managerToken(ctx2);
    const from2 = events.length;
    await q.goto(two.link);
    await q.waitForSelector("#auth-password");
    await q.fill("#auth-password", PASS);
    await q.locator("form button").last().click();
    await waitAt(q, `${IL}/fr/app`, "(b) arrivée du collègue");
    expect((await ilWho(ctx2)).startsWith(`${two.colleague}|`), `(b) session ${await ilWho(ctx2)}`);
    expect(gone(left), "(b) session de l'administrateur encore valable");
    neutralSince(from2, "shm2");

    // (c) Adresse confirmée (« Continuer vers InvoiceLead ») là où l'administrateur est connecté.
    const ctx3 = await newCtx(browser, "fr-CH", "shm3");
    const r = await ctx3.newPage();
    await r.goto(`${IL}/auth/lead/start?locale=fr`);
    await waitAt(r, `${CRM}/login?next=`, "(c) écran");
    await passwordLogin(r, manager);
    await waitAt(r, `${IL}/fr/app`, "(c) administrateur connecté");
    await dropCookies(ctx3, (n) => n.startsWith("crmlead_session"));
    const tmp = await browser.newContext();
    const person = mail("shm-verif");
    const s = await tmp.request.post(`${CRM}/api/auth/signup`, {
      data: { accountName: "E2E5 vérif", name: "Eve", email: person, password: PASS, locale: "fr" },
      headers: { origin: CRM },
    });
    expect(s.ok(), `(c) inscription ${s.status()}`);
    await tmp.close();
    const vt = randomBytes(32).toString("base64url");
    crmq(`select 1 from auth_token_issue('verify', '${person}', '${sha(vt)}', '1 hour'::interval)`);
    const from3 = events.length;
    await r.goto(`${CRM}/verification?jeton=${vt}&app=invoicelead&lang=fr`);
    await r.getByRole("link", { name: /Continuer vers InvoiceLead/ }).click();
    await r.waitForURL(
      (u) =>
        (u.href.startsWith(IL) && !u.pathname.startsWith("/auth")) ||
        u.href.startsWith(`${CRM}/login`),
      { timeout: 25000 },
    );
    if (r.url().startsWith(`${CRM}/login`)) await passwordLogin(r, person);
    await waitAt(r, `${IL}/fr/app`, "(c) arrivée");
    expect((await ilWho(ctx3)).startsWith(`${person}|`), `(c) session ${await ilWho(ctx3)}`);
    neutralSince(from3, "shm3");
    // Sans `fresh=1` (lien ordinaire), la session ouverte reste reprise sans aller-retour.
    const plain = await ctx3.request.get(`${IL}/auth/lead/start?locale=fr`, { maxRedirects: 0 });
    expect(plain.headers().location === `${IL}/fr/app`, `sans fresh : ${plain.headers().location}`);
    await Promise.all([ctx.close(), ctx2.close(), ctx3.close()]);
  },
);

// ---------- lot 7 (InvoiceLead) : poste partagé, retour rejoué, relance par demande, pages bornées ----------
/** Personne connectée au Compte Lead dans ce navigateur (son email), ou "". */
async function leadWho(ctx) {
  const r = await ctx.request.get(`${CRM}/api/auth/me`);
  return r.ok() ? ((await r.json().catch(() => null))?.user?.email ?? "") : "";
}
/** « personne InvoiceLead / personne Compte Lead » de ce navigateur. */
const ilAndLead = async (ctx) => `${(await ilWho(ctx)).split("|")[0]} / ${await leadWho(ctx)}`;
const ilToken = async (ctx) =>
  (await ctx.cookies()).find((c) => c.name === "il_session")?.value ?? "";
const sessionGone = (token) =>
  ilq(`select count(*) from sessions where id = '${sha(decodeURIComponent(token))}'`) === "0";
const ownOrgOf = (email) =>
  ilq(
    `select o.name from organizations o join memberships m on m.organization_id = o.id
       join users u on u.id = m.user_id where u.email = '${email}' and m.role <> 'fiduciary' limit 1`,
  );
/** Connexion au Compte Lead seul, comme l'écran de connexion de CRMlead le fait (onglet à part). */
const leadLogin = (ctx, email) =>
  ctx.request.post(`${CRM}/api/auth/login`, {
    data: { email, password: PASS },
    headers: { origin: CRM },
  });

await step(
  "IL-RESET-SHARED-DEVICE : poste partagé, la session InvoiceLead suit la personne que le Compte Lead vient d'authentifier",
  async () => {
    const target = `${IL}/de/app/invoices?status=open`;
    const startQ = "locale=de&next=%2Fde%2Fapp%2Finvoices%3Fstatus%3Dopen";
    const tmp = await newCtx(browser, "de-CH", "rsd-a");
    const A = await signupFromIl(await tmp.newPage(), "de", "rsd-a");
    await tmp.close();
    const shared = await newCtx(browser, "de-CH", "rsd");
    const sp = await shared.newPage();
    const B = await signupFromIl(sp, "de", "rsd-b");
    const from = events.length;

    // S1 : A a commencé ailleurs, puis ouvre ici le lien « mot de passe oublié », où B est connectée.
    const away = await newCtx(browser, "de-CH", "rsd-away");
    const { next } = await ilAuthorize(away, startQ);
    await away.close();
    const tokenB = await ilToken(shared);
    expect((await ilAndLead(shared)) === `${B} / ${B}`, `S1 avant : ${await ilAndLead(shared)}`);
    await sp.goto(resetLink(A, next));
    await sp.fill("#auth-password", PASS);
    await sp.locator("form button").last().click();
    await waitAt(sp, target, "S1 arrivée");
    expect(sp.url() === target, `S1 : ${sp.url()}`);
    expect((await ilAndLead(shared)) === `${A} / ${A}`, `S1 : ${await ilAndLead(shared)}`);
    expect(
      (await ilWho(shared)) === `${A}|${ownOrgOf(A)}`,
      `S1 : entreprise ${await ilWho(shared)}`,
    );
    expect(sessionGone(tokenB), "S1 : la session de B vaut encore");

    // S2 : l'écran de connexion de A est resté ouvert plus de trois heures (cookie de la demande
    // échu) ; B se connecte entre-temps à InvoiceLead dans un autre onglet ; puis A se connecte.
    await shared.clearCookies();
    const screen = await shared.newPage();
    await screen.goto(target);
    await waitAt(screen, `${CRM}/login?next=`, "S2 écran de A");
    const authS = new URL(screen.url()).searchParams.get("next") ?? "";
    await dropCookies(shared, (n) => n.startsWith("il_lead_login_"));
    const tabB = await shared.newPage();
    await tabB.goto(`${IL}/auth/lead/start?locale=de`);
    await waitAt(tabB, `${CRM}/login?next=`, "S2 écran de B");
    await passwordLogin(tabB, B);
    await waitAt(tabB, `${IL}/de/app`, "S2 B connectée");
    const tokenB2 = await ilToken(shared);
    // A tape son mot de passe sur son vieil écran : le Compte Lead passe à A et reprend la demande.
    const lg = await leadLogin(shared, A);
    expect(lg.ok(), `S2 connexion de A : ${lg.status()}`);
    await screen.goto(`${CRM}${authS}`);
    await waitAt(screen, target, "S2 arrivée");
    expect(screen.url() === target, `S2 : ${screen.url()}`);
    expect((await ilAndLead(shared)) === `${A} / ${A}`, `S2 : ${await ilAndLead(shared)}`);
    expect(sessionGone(tokenB2), "S2 : la session de B vaut encore");
    await tabB.close();

    // V : A a mené sa demande à bout ici (trace « _ok ») ; B se connecte ensuite au Compte Lead
    // (CRMlead ouvert directement) ; le vieil écran de A reprend la même demande.
    await shared.clearCookies();
    const origin = await shared.newPage();
    const { url: authV } = await ilAuthorize(shared, startQ);
    await origin.goto(authV);
    await passwordLogin(origin, A);
    await waitAt(origin, target, "V : A connectée");
    expect(
      (await shared.cookies()).some((c) => c.name.endsWith("_ok")),
      "V : pas de trace de la demande aboutie",
    );
    const lgB = await leadLogin(shared, B);
    expect(lgB.ok(), `V connexion de B : ${lgB.status()}`);
    const tokenA = await ilToken(shared);
    await origin.goto(authV);
    await waitAt(origin, target, "V : retour de la demande reprise");
    expect(origin.url() === target, `V : ${origin.url()}`);
    expect((await ilAndLead(shared)) === `${B} / ${B}`, `V : ${await ilAndLead(shared)}`);
    expect(sessionGone(tokenA), "V : la session de A vaut encore");
    neutralSince(from, "rsd");
    await shared.close();
  },
);

await step(
  "IL-CALLBACK-REPLAY : retour rejoué après une réponse perdue, relance silencieuse sur la page",
  async () => {
    const ctx = await newCtx(browser, "fr-CH", "rpl");
    const p = await ctx.newPage();
    const email = await signupFromIl(p, "fr", "rpl");
    const target = `${IL}/fr/app/invoices?status=open`;
    /**
     * Retour du Compte Lead (ouvert) dont le serveur a traité la réponse, perdue en route. `keep` : la
     * session InvoiceLead restée dans le navigateur (le serveur l'a remplacée, le navigateur l'ignore).
     */
    const lostReturn = async (query, keep = "") => {
      await dropCookies(ctx, (n) => n === "il_session");
      const { url } = await ilAuthorize(ctx, query);
      if (keep) await ctx.addCookies([{ name: "il_session", value: keep, url: IL }]);
      const answer = await ctx.request.get(url, { maxRedirects: 0 });
      const callback = answer.headers().location ?? "";
      expect(callback.startsWith(`${IL}/auth/lead/callback?code=`), `retour : ${callback}`);
      const cookie = (await ctx.cookies(callback)).map((c) => `${c.name}=${c.value}`).join("; ");
      const lost = await fetch(callback, { headers: { cookie }, redirect: "manual" });
      expect(
        lost.status === 303,
        `premier retour : ${lost.status} ${lost.headers.get("location")}`,
      );
      expect(
        (await ctx.cookies()).some(
          (c) => c.name.startsWith("il_lead_login_") && !c.name.endsWith("_ok"),
        ),
        "le cookie de la demande a disparu",
      );
      return callback;
    };
    for (const withSession of [false, true]) {
      const keep = withSession ? await ilToken(ctx) : "";
      const from = events.length;
      const callback = await lostReturn(
        "locale=fr&next=%2Ffr%2Fapp%2Finvoices%3Fstatus%3Dopen",
        keep,
      );
      const authorizes = [];
      const seen = (r) => {
        if (r.url().startsWith(`${CRM}/oauth/authorize`)) authorizes.push(r.url());
      };
      p.on("request", seen);
      // La personne recharge la page d'erreur du navigateur : le même retour.
      await p.goto(callback);
      await waitAt(p, target, `rechargement${withSession ? " (session restée)" : ""}`);
      p.off("request", seen);
      expect(p.url() === target, `rechargement : ${p.url()}`);
      expect(authorizes.length === 1, `${authorizes.length} passages par le Compte Lead`);
      expect((await ilAndLead(ctx)) === `${email} / ${email}`, `${await ilAndLead(ctx)}`);
      neutralSince(from, "rpl");
    }
    // Une relance déjà faite (state marqué) qui revient rejouée : l'écran d'erreur, sans boucle.
    const again = await lostReturn("locale=fr&next=%2Ffr%2Fapp%2Fquotes&retry=1");
    await p.goto(again);
    await p.waitForURL(at(`${IL}/fr/login?erreur=`), { timeout: 15000 }).catch(() => {});
    expect(
      p.url() === `${IL}/fr/login?erreur=lead&next=%2Ffr%2Fapp%2Fquotes`,
      `relance rejouée : ${p.url()}`,
    );
    await ctx.close();
  },
);

await step(
  "IL-RETRY-PER-REQUEST : deux vieux écrans repris à la fois, chacun arrive sur sa page",
  async () => {
    const ctx = await newCtx(browser, "fr-CH", "r2t");
    const setup = await ctx.newPage();
    await signupFromIl(setup, "fr", "r2t");
    await setup.close();
    const from = events.length;
    /** Deux vieux écrans repris (`keep` : session InvoiceLead restée dans le navigateur). */
    const pair = async (label, delay, keep = "") => {
      await dropCookies(ctx, (n) => n === "il_session");
      const a = await ilAuthorize(ctx, "locale=fr&next=%2Ffr%2Fapp%2Fquotes");
      const b = await ilAuthorize(ctx, "locale=fr&next=%2Ffr%2Fapp%2Finvoices");
      await dropCookies(ctx, (n) => n.startsWith("il_lead_login_"));
      if (keep) await ctx.addCookies([{ name: "il_session", value: keep, url: IL }]);
      const one = await ctx.newPage();
      const two = await ctx.newPage();
      const go = one.goto(a.url).catch(() => {});
      await sleep(delay);
      await two.goto(b.url).catch(() => {});
      await go;
      await waitAt(one, `${IL}/fr/app/quotes`, `${label} : onglet 1`);
      await waitAt(two, `${IL}/fr/app/invoices`, `${label} : onglet 2`);
      expect(!one.url().includes("erreur=") && !two.url().includes("erreur="), label);
      await one.close();
      await two.close();
    };
    // Plusieurs tours d'affilée, sans rien effacer entre eux (l'ancienne marque durait 120 s).
    for (const delay of [0, 20, 40, 60, 100, 300]) await pair(`${delay} ms`, delay);
    // Une relance pendant qu'une session existe, puis une autre sans session, dans les 120 s.
    await pair("avec session", 0, await ilToken(ctx));
    await pair("juste après, sans session", 0);
    neutralSince(from, "r2t");
    await ctx.close();
  },
);

await step(
  "IL-LOGIN-PAGES-BOUNDS : pages longues sans session, seulement les liens d'import, par réseau",
  async () => {
    const SECRET = process.env.IL_SESSION_SECRET ?? "e2e-secret-e2e-secret-e2e-secret-e2e";
    const keyOf = (ip) =>
      createHmac("sha256", Buffer.from(hkdfSync("sha256", SECRET, "", "il-lead-login-client", 32)))
        .update(ip)
        .digest("base64url")
        .slice(0, 22);
    const ipA = `198.51.100.${(stamp % 200) + 20}`;
    const ipB = `203.0.113.${(stamp % 200) + 20}`;
    const rowsOf = (ip) =>
      Number(ilq(`select count(*) from login_pages where client = '${keyOf(ip)}'`));
    const anon = (next, ip) =>
      fetch(`${IL}/auth/lead/start?locale=fr&next=${encodeURIComponent(next)}`, {
        headers: { "x-real-ip": ip },
        redirect: "manual",
      });
    const enc = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
    const forged = (i) =>
      `/fr/app/import/crmlead?d=${enc({
        v: 1,
        kind: "quote",
        lead: { id: `forge-${stamp}-${i}` },
        contact: { name: "Prospect forgé SA" },
        lines: [{ description: "y".repeat(400), quantity: 1, unitPriceCents: 100 }],
      })}`;
    try {
      // Recherche longue, `d` quelconque : rien n'est écrit, la demande part quand même.
      for (const next of [
        `/fr/app/invoices?q=${randomBytes(1600).toString("base64url")}`,
        `/fr/app/import/crmlead?d=${randomBytes(1600).toString("base64url")}`,
      ]) {
        const r = await anon(next, ipA);
        expect(r.status === 303, `départ ${r.status}`);
      }
      expect(rowsOf(ipA) === 0, `pages quelconques gardées : ${rowsOf(ipA)}`);
      // Liens d'import valides depuis un même réseau : vingt au plus dans l'heure.
      for (let i = 0; i < 21; i++) await anon(forged(i), ipA);
      expect(rowsOf(ipA) === 20, `réseau A : ${rowsOf(ipA)} pages`);
      // Un autre réseau n'en souffre pas.
      await anon(forged(100), ipB);
      expect(rowsOf(ipB) === 1, `réseau B : ${rowsOf(ipB)} pages`);
      // Le réseau plafonné : son lien n'a plus de référence, mais le cookie de la demande garde la page.
      const ctx = await newCtx(browser, "fr-CH", "lpb");
      await ctx.setExtraHTTPHeaders({ "x-real-ip": ipA });
      const p = await ctx.newPage();
      await signupFromIl(p, "fr", "lpb");
      await dropCookies(ctx, (n) => n === "il_session");
      const link = forged(200);
      await p.goto(`${IL}${link}`);
      await p.waitForURL(at(`${IL}/fr/app/import/crmlead?d=`), { timeout: 25000 }).catch(() => {});
      expect(p.url() === `${IL}${link}`, `réseau plafonné : ${p.url().slice(0, 90)}`);
      await p.locator('[data-testid="crm-import"]').waitFor({ timeout: 10000 });
      expect(rowsOf(ipA) === 20, `réseau plafonné : ${rowsOf(ipA)} pages`);
      await ctx.close();
    } finally {
      ilq(`delete from login_pages where client in ('${keyOf(ipA)}', '${keyOf(ipB)}')`);
    }
  },
);

// ---------- intégration du lot 7 : chaque correction rejouée sur la pile reconstruite ----------
const LEAD_NAMES = {
  fr: "Compte Lead",
  en: "Lead account",
  de: "Lead-Konto",
  it: "Account Lead",
  es: "Cuenta Lead",
};
/** Un lien d'import de CRMlead ordinaire (un devis), comme le bouton « Créer le devis dans InvoiceLead ». */
function handoffLink(label) {
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const id = randomUUID();
  return `/fr/app/import/crmlead?d=${enc({
    v: 1,
    kind: "quote",
    lead: { id, title: `Devis ${label} ${stamp}` },
    contact: {
      id: `lead:${id}`,
      kind: "company",
      name: `Client ${label} ${stamp} SA`,
      country: "CH",
    },
    lines: [
      { description: "Pose", quantity: 1, unit: "flat", unitPriceCents: 120000, vatCode: "normal" },
    ],
  })}`;
}

await step(
  "CRM-FIRSTBYTE-ACCEPT-LANGUAGE : sans ui_locales ni lang, la langue du navigateur dès le premier octet, sans bascule",
  async () => {
    // La demande qu'InvoiceLead fabrique, privée de sa langue (autre client de la famille, lien fait à la main).
    const tmp = await browser.newContext();
    const { next: asked } = await ilAuthorize(tmp, "locale=de");
    await tmp.close();
    const u = new URL(asked, CRM);
    u.searchParams.delete("ui_locales");
    const bare = u.pathname + u.search;
    expect(asked.includes("ui_locales=de") && !bare.includes("ui_locales"), `demande : ${bare}`);
    const head = (html) => ({
      lang: html.match(/<html lang="([^"]*)"/)?.[1],
      title: html.match(/<title>([^<]*)<\/title>/)?.[1],
      name: html.match(/data-lead-name[^>]*>([^<]*)</)?.[1],
    });
    // Premier octet, lu par le serveur : Accept-Language, sinon le français ; et `Vary`.
    const req = await browser.newContext();
    for (const [accept, l] of [
      ["en-US,en;q=0.9", "en"],
      ["de-CH,de;q=0.9", "de"],
      ["it-CH", "it"],
      ["ja-JP", "fr"],
      ["fr-CH", "fr"],
    ]) {
      for (const path of [
        `/login?next=${encodeURIComponent(bare)}`,
        "/verification?app=invoicelead&jeton=x",
      ]) {
        const r = await req.request.get(`${CRM}${path}`, {
          headers: { "accept-language": accept },
        });
        const h = head(await r.text());
        expect(
          h.lang === l && h.title === LEAD_NAMES[l] && h.name === LEAD_NAMES[l],
          `${accept} ${path.slice(0, 20)} : ${JSON.stringify(h)}`,
        );
        expect(
          /accept-language/i.test(r.headers().vary ?? ""),
          `${accept} : Vary ${r.headers().vary}`,
        );
      }
    }
    // La langue demandée par l'application passe avant celle du navigateur.
    const kept = head(
      await (
        await req.request.get(`${CRM}/login?next=${encodeURIComponent(asked)}`, {
          headers: { "accept-language": "en-US" },
        })
      ).text(),
    );
    expect(
      kept.lang === "de" && kept.title === "Lead-Konto",
      `ui_locales=de : ${JSON.stringify(kept)}`,
    );
    // CRMlead direct : son écran, en français comme avant.
    const directHtml = await (
      await req.request.get(`${CRM}/login`, { headers: { "accept-language": "en-US" } })
    ).text();
    expect(
      /CRMlead/.test(head(directHtml).title ?? "") && !directHtml.includes("data-lead-app"),
      `CRMlead direct : ${JSON.stringify(head(directHtml))}`,
    );
    await req.close();

    // Dans le navigateur : titre, `lang` et nom relevés à chaque changement, du premier octet à l'écran prêt.
    const watch = async (locale, path, chosen) => {
      const ctx = await browser.newContext({ locale });
      const seen = [];
      await ctx.exposeBinding("__fb", (_s, e) => seen.push(e));
      if (chosen) {
        const p0 = await ctx.newPage();
        await p0.goto(`${CRM}/robots.txt`);
        await p0.evaluate((l) => localStorage.setItem("crmlead.lang", l), chosen);
        await p0.close();
      }
      await ctx.addInitScript(() => {
        const snap = (why) => {
          try {
            if (location.port !== "3301" || !document.documentElement) return;
            window.__fb({
              why,
              url: location.pathname,
              title: document.title,
              lang: document.documentElement.lang,
              name: document.querySelector("[data-lead-name]")?.textContent ?? "",
              text: (document.body?.innerText ?? "").replace(/\s+/g, " ").slice(0, 70),
            });
          } catch {}
        };
        snap("init");
        document.addEventListener("DOMContentLoaded", () => snap("dcl"));
        new MutationObserver(() => snap("mut")).observe(document, {
          subtree: true,
          childList: true,
          characterData: true,
          attributes: true,
          attributeFilter: ["lang"],
        });
        // Juste avant chaque image affichée : ce que la personne voit vraiment.
        const frame = () => {
          snap("raf");
          requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
      });
      const p = await ctx.newPage();
      await p.goto(`${CRM}${path}`);
      await p.waitForSelector('[data-testid="suite-brand"]', { timeout: 15000 });
      await sleep(1200);
      await ctx.close();
      return seen.filter((e) => e.title);
    };
    const others = (l) => Object.entries(LEAD_NAMES).filter(([k]) => k !== l);
    for (const [locale, path, l, chosen] of [
      ["en-US", bare, "en"],
      ["de-CH", bare, "de"],
      ["fr-CH", bare, "fr"],
      ["ja-JP", bare, "fr"],
      ["en-US", `/signup?next=${encodeURIComponent(bare)}`, "en"],
      ["en-US", "/verification?app=invoicelead&jeton=x", "en"],
      ["de-CH", "/verification?app=invoicelead&jeton=x", "de"],
      ["en-US", bare, "it", "it"],
      ["de-CH", `/login?next=${encodeURIComponent(asked)}`, "de"],
    ]) {
      const what = `${locale}${chosen ? ` (choix ${chosen})` : ""} ${path.slice(0, 24)}`;
      const all = await watch(locale, path, chosen);
      // Choix au sélecteur : les scripts du premier octet corrigent titre, `lang` et nom pendant l'analyse, avant
      // toute image. L'observateur voit l'état d'avant chaque script (point de microtâches de l'analyseur) : on
      // juge ici sur les images affichées (requestAnimationFrame) et la fin de l'analyse.
      const seen = chosen ? all.filter((e) => e.why === "raf" || e.why === "dcl") : all;
      if (chosen)
        console.log(
          `  ${what} : états avant script, jamais affichés : ${[...new Set(all.filter((e) => e.why === "mut" && (e.title !== LEAD_NAMES[l] || (e.name && e.name !== LEAD_NAMES[l]))).map((e) => `${e.title}|${e.lang}|${e.name}`))].join(" ; ") || "aucun"}`,
        );
      const bad = seen.filter(
        (e) =>
          e.title !== LEAD_NAMES[l] ||
          e.lang !== l ||
          (e.name && e.name !== LEAD_NAMES[l]) ||
          others(l).some(([, n]) => e.text.includes(n)),
      );
      const flips = [...new Set(seen.map((e) => `${e.title}|${e.lang}|${e.name}`))];
      expect(seen.length > 2, `${what} : ${seen.length} relevés`);
      expect(
        !bad.length,
        `${what} : ${bad.length} relevés hors « ${LEAD_NAMES[l]} »/${l} : ${flips.join(" ; ")} | ${bad[0]?.text}`,
      );
      expect(
        seen.some((e) => e.text.includes(LEAD_NAMES[l])),
        `${what} : nom absent de l'écran (${seen.at(-1)?.text})`,
      );
      console.log(`  ${what} : ${seen.length} relevés, toujours ${LEAD_NAMES[l]}/${l}`);
    }
  },
);

await step(
  "CRM-STALE-RELOAD-ONE-DEPARTURE : vieil écran rechargé, Compte Lead ouvert ailleurs : un seul départ, la page demandée",
  async () => {
    const target = `${IL}/fr/app/quotes?status=open`;
    let email = "";
    const rounds = [];
    for (const variant of ["InvoiceLead", "CRMlead direct", "InvoiceLead, demande de 4 h"])
      for (let i = 0; i < 3; i++) rounds.push(variant);
    for (const [n, variant] of rounds.entries()) {
      const ctx = await newCtx(browser, "fr-CH", "stale");
      const from = events.length;
      // 1. Sans session nulle part : l'écran neutre du Compte Lead, laissé ouvert.
      const stale = await ctx.newPage();
      await stale.goto(target);
      await waitAt(stale, `${CRM}/login?next=`, `${variant} : vieil écran`);
      await stale.waitForSelector("#auth-password");
      const old = new URLSearchParams(
        (new URL(stale.url()).searchParams.get("next") ?? "").split("?")[1],
      ).get("state");
      // 2. Ailleurs, dans un autre onglet : le Compte Lead s'ouvre.
      const other = await ctx.newPage();
      if (!email) email = await signupFromIl(other, "fr", "stale");
      else if (variant === "CRMlead direct") {
        await other.goto(`${CRM}/login`);
        await passwordLogin(other, email);
        await other.waitForURL((x) => x.href.startsWith(CRM) && !/\/login/.test(x.pathname), {
          timeout: 20000,
        });
      } else {
        await other.goto(`${IL}/auth/lead/start?locale=fr`);
        await waitAt(other, `${CRM}/login?next=`, `${variant} : écran de l'autre onglet`);
        await passwordLogin(other, email);
        await waitAt(other, `${IL}/fr/app`, `${variant} : autre onglet connecté`);
      }
      await other.close();
      expect(
        stale.url().startsWith(`${CRM}/login?next=`),
        `${variant} : le vieil écran est déjà parti (${stale.url()})`,
      );
      // 3. Plus de trois heures : demande, session InvoiceLead et ancienne marque de relance échues.
      await dropCookies(
        ctx,
        (c) => c === "il_session" || c === "il_login_retry" || c.startsWith("il_lead_login_"),
      );
      if (variant.endsWith("4 h"))
        await stale.evaluate(() => {
          const k = "crmlead.leadid.next";
          const v = JSON.parse(sessionStorage.getItem(k) ?? "null");
          if (v) sessionStorage.setItem(k, JSON.stringify({ ...v, at: Date.now() - 4 * 3600e3 }));
        });
      // 4. L'onglet est rechargé (F5, onglet restauré, économiseur de mémoire).
      const departures = [];
      stale.on("request", (r) => {
        if (r.isNavigationRequest() && r.url().startsWith(`${CRM}/oauth/authorize?`))
          departures.push(new URL(r.url()).searchParams.get("state"));
      });
      await stale.reload();
      await waitAt(stale, target, `${variant} (${n + 1}) : arrivée`);
      await sleep(1500);
      expect(stale.url() === target, `${variant} (${n + 1}) : ${stale.url()}`);
      const again = departures.filter((s) => s === old).length;
      expect(
        again === 1,
        `${variant} (${n + 1}) : ${again} départs avec l'ancienne demande (${departures.length} en tout)`,
      );
      expect(
        (await ilWho(ctx)).startsWith(`${email}|`),
        `${variant} : session ${await ilWho(ctx)}`,
      );
      neutralSince(from, "stale", (e) => /next=|\/oauth\//.test(e.url));
      await ctx.close();
    }
    console.log(`  ${rounds.length} rechargements, un seul départ chacun`);
  },
);

await step(
  "IL-ERROR-SCREEN-LINKS : écran d'erreur, en-tête, pied de page et langue gardent la page ou l'invitation",
  async () => {
    const ctx = await newCtx(browser, "fr-CH", "errl");
    const p = await ctx.newPage();
    const email = await signupFromIl(p, "fr", "errl");
    const from = events.length;
    const page = "/fr/app/quotes?status=draft&q=Dupont";
    const screen = `${IL}/fr/login?erreur=lead&next=${encodeURIComponent(page)}`;
    const hrefs = async () =>
      p.evaluate(() => ({
        header: [...document.querySelectorAll('header a[href^="/auth/lead/start"]')].map((a) =>
          a.getAttribute("href"),
        ),
        footer: [...document.querySelectorAll('footer a[href^="/auth/lead/start"]')].map((a) =>
          a.getAttribute("href"),
        ),
        langs: Object.fromEntries(
          [...document.querySelectorAll("a[hreflang]")].map((a) => [
            a.getAttribute("hreflang"),
            a.getAttribute("href"),
          ]),
        ),
      }));
    // A. Page demandée : chaque lien de l'écran (connexion, inscription, en-tête et pied de page) la garde.
    await dropCookies(ctx, (n) => n === "il_session");
    await p.goto(screen);
    expect(p.url() === screen, `écran d'erreur : ${p.url()}`);
    const h = await hrefs();
    const nextQ = `next=${encodeURIComponent(page)}`;
    expect(
      h.header.length === 2 && h.footer.length === 2,
      `liens : ${h.header.length}+${h.footer.length}`,
    );
    for (const href of [...h.header, ...h.footer])
      expect(href.includes(nextQ), `lien sans la page demandée : ${href}`);
    expect(
      h.langs.de ===
        `/de/login?erreur=lead&next=${encodeURIComponent(page.replace("/fr/", "/de/"))}`,
      `lien DE : ${h.langs.de}`,
    );
    // « Connexion » de l'en-tête puis du pied de page : retour silencieux sur la page demandée.
    for (const where of ["header", "footer"]) {
      await dropCookies(ctx, (n) => n === "il_session");
      await p.goto(screen);
      await p
        .locator(`${where} a[href^="/auth/lead/start"]:not([href*="signup=1"])`)
        .first()
        .click();
      await waitAt(p, `${IL}${page}`, `${where} « Connexion »`);
      expect(p.url() === `${IL}${page}`, `${where} « Connexion » : ${p.url()}`);
    }
    // « Créer un compte » de l'en-tête, Compte Lead déjà ouvert : la page demandée aussi.
    await dropCookies(ctx, (n) => n === "il_session");
    await p.goto(screen);
    await p.locator('header a[href*="signup=1"]').first().click();
    await waitAt(p, `${IL}${page}`, "« Créer un compte »");
    // La langue : l'écran d'erreur en allemand, la même page en allemand, puis son bouton y mène.
    await dropCookies(ctx, (n) => n === "il_session");
    await p.goto(screen);
    await p.locator('a[hreflang="de"]').first().click();
    await p.waitForURL(at(`${IL}/de/login?erreur=lead`), { timeout: 15000 });
    await p.locator('[data-testid="lead-login"]').waitFor({ timeout: 10000 });
    const deHref = await p.locator('[data-testid="lead-login"]').getAttribute("href");
    expect(
      deHref.includes(`next=${encodeURIComponent("/de/app/quotes?status=draft&q=Dupont")}`),
      `bouton DE : ${deHref}`,
    );
    await p.locator('[data-testid="lead-login"]').click();
    await waitAt(p, `${IL}/de/app/quotes?status=draft&q=Dupont`, "DE : page demandée");
    // B. Invitation de fiduciaire : tous les liens ramènent sur elle.
    const token = fiduciaryInvite(OWNER, email);
    const inviteScreen = `${IL}/fr/login?erreur=lead&invite=${token}`;
    await dropCookies(ctx, (n) => n === "il_session");
    await p.goto(inviteScreen);
    const hi = await hrefs();
    for (const href of [...hi.header, ...hi.footer])
      expect(href.includes(`invite=${token}`), `invitation, lien : ${href}`);
    expect(
      hi.langs.de === `/de/login?erreur=lead&invite=${token}`,
      `invitation, DE : ${hi.langs.de}`,
    );
    await p.locator('header a[href^="/auth/lead/start"]:not([href*="signup=1"])').first().click();
    await waitAt(p, `${IL}/fr/invite?token=${token}`, "invitation, en-tête");
    await dropCookies(ctx, (n) => n === "il_session");
    await p.goto(inviteScreen);
    await p.locator('footer a[href*="signup=1"]').first().click();
    await waitAt(
      p,
      `${IL}/fr/invite?token=${token}`,
      "invitation, pied de page « Créer un compte »",
    );
    expect(accepted(token) === "f", "invitation acceptée sans clic");
    // C. Contrôle : les autres pages publiques gardent des liens simples, /de/login sans erreur repart aussitôt.
    for (const path of ["/fr", "/fr/pricing", "/fr/faq"]) {
      await p.goto(`${IL}${path}`);
      const x = await hrefs();
      expect(
        x.header.join(" ") === "/auth/lead/start?locale=fr /auth/lead/start?locale=fr&signup=1",
        `${path} : ${x.header.join(" ")}`,
      );
      expect(
        Object.values(x.langs).every((v) => !v.includes("?")),
        `${path} : langues ${JSON.stringify(x.langs)}`,
      );
    }
    const plain = await fetch(`${IL}/de/login`, { redirect: "manual" });
    expect(
      plain.status >= 300 &&
        plain.status < 400 &&
        (plain.headers.get("location") ?? "").includes("/auth/lead/start?locale=de"),
      `/de/login : ${plain.status} ${plain.headers.get("location")}`,
    );
    neutralSince(from, "errl");
    await ctx.close();
  },
);

await step(
  "IL-FIDU-CRM-IMPORT : lien de son propre CRMlead, fiduciaire passée chez un client : son entreprise, le devis créé",
  async () => {
    const client = ownerOrg();
    const clientId = ilq(
      `select m.organization_id from memberships m join users u on u.id = m.user_id
        where u.email = '${OWNER}' and m.role <> 'fiduciary' limit 1`,
    );
    const ctx = await newCtx(browser, "fr-CH", "fidimp");
    const p = await ctx.newPage();
    const email = await signupFromIl(p, "fr", "fidimp");
    const own = ownOrgOf(email);
    const from = events.length;
    const token = fiduciaryInvite(OWNER, email);
    await p.goto(`${IL}/fr/invite?token=${token}`);
    await p.locator('[data-testid="invite-accept"]').click();
    await waitAt(p, `${IL}/fr/app/accounting?welcome=fiduciary`, "acceptation");
    expect((await orgName(p)) === client, `après l'acceptation : ${await orgName(p)}`);
    const link = handoffLink("fidimp");
    const confirm = p.locator('[data-testid="crm-import-confirm"]');
    /** Session vivante replacée chez le client (comme le sélecteur d'entreprise). */
    const backToClient = async () => {
      ilq(
        `update sessions set organization_id = '${clientId}' where id = '${sha(decodeURIComponent(await ilToken(ctx)))}'`,
      );
      ilq(`update users set last_organization_id = '${clientId}' where email = '${email}'`);
    };
    // A. Session échue, dernière entreprise = le client : le lien s'ouvre dans sa propre entreprise.
    await dropCookies(ctx, (n) => n === "il_session");
    await p.goto(`${IL}${link}`);
    await waitAt(p, `${IL}/fr/app/import/crmlead?d=`, "A : lien d'import");
    expect(p.url() === `${IL}${link}`, `A : ${p.url().slice(0, 90)}`);
    expect((await orgName(p)) === own, `A : entreprise ${await orgName(p)}`);
    expect(await confirm.isEnabled(), "A : bouton « Créer le devis » désactivé");
    await confirm.click();
    await p.waitForURL(/\/fr\/app\/quotes\/[0-9a-f-]{36}\?from=crmlead/, { timeout: 20000 });
    const quote = p.url().split("?")[0];
    const quoteId = quote.split("/").pop();
    const owner = ilq(
      `select o.name from invoices i join organizations o on o.id = i.organization_id where i.id = '${quoteId}'`,
    );
    expect(owner === own, `A : devis créé chez ${owner}`);
    // B. Revenue chez le client, session échue : sa propre pièce (lien de CRMlead) s'ouvre chez elle.
    await backToClient();
    await dropCookies(ctx, (n) => n === "il_session");
    await p.goto(quote);
    await waitAt(p, quote, "B : pièce");
    await p.locator('[data-testid="document-status"]').waitFor({ timeout: 10000 });
    expect((await orgName(p)) === own, `B : entreprise ${await orgName(p)}`);
    // C. Session vivante chez le client : le lien d'import propose de passer chez elle et y revient.
    await backToClient();
    await p.goto(`${IL}${link}`);
    expect((await orgName(p)) === client, `C : entreprise ${await orgName(p)}`);
    expect(!(await confirm.isEnabled()), "C : bouton actif chez le client");
    await p.locator('[data-testid="crm-import-switch"] button', { hasText: own }).click();
    // Même adresse avant et après : on attend que la page soit celle de son entreprise.
    await p
      .locator('[data-testid="crm-import-switch"]')
      .waitFor({ state: "detached", timeout: 15000 });
    await p.locator('[data-testid="crm-import"]').waitFor({ timeout: 10000 });
    expect(p.url() === `${IL}${link}`, `C : ${p.url().slice(0, 90)}`);
    expect((await orgName(p)) === own, `C : entreprise ${await orgName(p)}`);
    expect(await confirm.isEnabled(), "C : bouton désactivé après le passage");
    // D. Session vivante chez le client : sa propre pièce, rien de la pièce avant le passage, puis la pièce.
    await backToClient();
    await p.goto(quote);
    await p.locator('[data-testid="document-elsewhere"]').waitFor({ timeout: 10000 });
    expect(
      (await p.locator('[data-testid="document-status"]').count()) === 0,
      "D : pièce montrée avant le passage",
    );
    await p.locator('[data-testid="document-elsewhere-switch"]').click();
    await p.waitForURL((x) => x.href === quote, { timeout: 15000 }).catch(() => {});
    await p.locator('[data-testid="document-status"]').waitFor({ timeout: 10000 });
    expect((await orgName(p)) === own, `D : entreprise ${await orgName(p)}`);
    // E. Contrôle du lot 6 : une page du client, session échue, rouvre chez le client.
    await backToClient();
    await dropCookies(ctx, (n) => n === "il_session");
    await p.goto(`${IL}/fr/app/contacts`);
    await waitAt(p, `${IL}/fr/app/contacts`, "E : page du client");
    expect((await orgName(p)) === client, `E : entreprise ${await orgName(p)}`);
    neutralSince(from, "fidimp");
    await ctx.close();
  },
);

await step(
  "CRM-FORGOT-THROTTLE : cinq emails de réinitialisation par heure et par adresse, trente par origine",
  async () => {
    const ctx = await newCtx(browser, "fr-CH", "fgt");
    const p = await ctx.newPage();
    const email = await signupFromIl(p, "fr", "fgt");
    // Comme l'écran (appNextForSso) : « + » de la requête envoyé en « %20 ».
    const next = (await ilAuthorize(await browser.newContext(), "locale=fr")).next.replace(
      /\+/g,
      "%20",
    );
    const ipA = `192.0.2.${(stamp % 200) + 20}`;
    const ipB = `198.18.${stamp % 250}.${(stamp % 200) + 21}`;
    const ipC = `198.19.${stamp % 250}.${(stamp % 200) + 22}`;
    const ghost = mail("fgt-inconnu");
    const forgot = (address, ip, withNext = true) =>
      ctx.request.post(`${CRM}/api/auth/forgot`, {
        data: { email: address, ...(withNext ? { next } : {}) },
        headers: { origin: CRM, "x-forwarded-for": ip },
      });
    const mails = (address, subject) =>
      crmLog()
        .split("\n")
        .filter((l) => l.includes(`à ${address} — `) && subject.test(l)).length;
    const live = () =>
      crmq(
        `select count(*) || '|' || coalesce(max(t.created_at)::text, '-') from auth_tokens t join users u on u.id = t.user_id
          where u.email = '${email}' and t.purpose = 'reset' and t.consumed_at is null and t.expires_at > now()`,
      );
    try {
      // Sept demandes pour la même adresse : sept réponses identiques, cinq emails du Compte Lead.
      const before = mails(email, /Réinitialiser/);
      const answers = [];
      let fifth = "";
      for (let i = 0; i < 7; i++) {
        const r = await forgot(email, ipA);
        answers.push(`${r.status()} ${JSON.stringify(await r.json().catch(() => null))}`);
        if (i === 4) {
          await sleep(500);
          fifth = live();
        }
      }
      expect(
        answers.every((a) => a === '200 {"ok":true}'),
        `réponses : ${answers.join(", ")}`,
      );
      await sleep(1500);
      const sent = mails(email, /Réinitialiser/) - before;
      expect(sent === 5, `${sent} emails pour une adresse`);
      expect(
        mails(email, /Réinitialiser le mot de passe de votre Compte Lead/) - before >= 5 &&
          mails(email, /Réinitialiser.*CRMlead/) === 0,
        "emails : pas au nom du Compte Lead",
      );
      // Au-delà du plafond, rien ne remplace le dernier lien : il reste valable.
      expect(live() === fifth && fifth.startsWith("1|"), `dernier lien : ${fifth} puis ${live()}`);
      // Une adresse inconnue : mêmes réponses, aucun email.
      const ghostAnswers = [];
      for (let i = 0; i < 7; i++) {
        const r = await forgot(ghost, ipB);
        ghostAnswers.push(`${r.status()} ${JSON.stringify(await r.json().catch(() => null))}`);
      }
      expect(
        ghostAnswers.every((a) => a === '200 {"ok":true}'),
        `adresse inconnue : ${ghostAnswers.join(", ")}`,
      );
      expect(mails(ghost, /./) === 0, "adresse inconnue : email envoyé");
      // Une même origine, trente adresses : la trente et unième reçoit 429 et Retry-After.
      const codes = [];
      for (let i = 0; i < 31; i++) {
        const r = await forgot(mail(`fgt-o${i}`), ipC, false);
        codes.push(r.status());
        if (i === 30)
          expect(
            r.status() === 429 && Number(r.headers()["retry-after"]) > 0,
            `31e demande : ${r.status()} Retry-After ${r.headers()["retry-after"]}`,
          );
      }
      expect(
        codes.slice(0, 30).every((c) => c === 200),
        `30 premières : ${codes.join(",")}`,
      );
      // L'écran du Compte Lead, depuis cette origine : « Trop de tentatives », dans l'écran neutre.
      const from = events.length;
      await ctx.setExtraHTTPHeaders({ "x-forwarded-for": ipC });
      await ctx.clearCookies();
      await p.goto(`${CRM}/mot-de-passe?next=${encodeURIComponent(next)}`);
      await p.fill("#auth-email", mail("fgt-ecran"));
      await p.locator("form button").last().click();
      await p.getByText(/Trop de tentatives/).waitFor({ timeout: 10000 });
      expect((await p.title()) === "Compte Lead", `écran : ${await p.title()}`);
      neutralSince(from, "fgt");
      await ctx.setExtraHTTPHeaders({});
      // Contrôle : un autre réseau, CRMlead direct (sans demande d'application) : l'email de CRMlead part.
      const direct = mail("fgt-direct");
      const dc = await browser.newContext();
      const s = await dc.request.post(`${CRM}/api/auth/signup`, {
        data: {
          accountName: "E2E5 fgt direct",
          name: "Eve",
          email: direct,
          password: PASS,
          locale: "fr",
        },
        headers: { origin: CRM },
      });
      expect(s.ok(), `inscription directe ${s.status()}`);
      const d = await dc.request.post(`${CRM}/api/auth/forgot`, {
        data: { email: direct },
        headers: { origin: CRM, "x-forwarded-for": ipB },
      });
      expect(d.ok(), `CRMlead direct : ${d.status()}`);
      expect(
        await waitLog(crmLog, new RegExp(`à ${direct.replace(/[+.]/g, "\\$&")} — .*CRMlead`)),
        "CRMlead direct : pas d'email de CRMlead",
      );
      await dc.close();
    } finally {
      crmq(
        `delete from login_attempts where key in ('forgot-origin|${ipA}', 'forgot-origin|${ipB}', 'forgot-origin|${ipC}')
            or key like 'forgot|eve+e2e5-fgt%-${stamp}@example.test'`,
      );
      await ctx.close();
    }
  },
);

await step(
  "CRM-113-LEGACY-COLLEAGUES : collègues d'une organisation née d'InvoiceLead, invités par CRMlead, rendus muets par 113",
  async () => {
    expect(CRM_REPO, "CRM_REPO manquant");
    /** Une organisation : créateur inscrit sur CRMlead (`viaUi` : avec son écran de bienvenue) puis passé par InvoiceLead. */
    const org = async (label, { realLead = false, viaUi = false } = {}) => {
      const ctx = await browser.newContext({ locale: "fr-CH" });
      const creator = mail(`${label}-c`);
      if (viaUi) {
        const w = await ctx.newPage();
        await w.goto(`${CRM}/signup`);
        await w.fill("#auth-account", `E2E5 ${label}`);
        await w.fill("#auth-name", "Eve");
        await w.fill("#auth-email", creator);
        await w.fill("#auth-password", PASS);
        await w.locator("form button").last().click();
        await waitAt(w, `${CRM}/bienvenue`, `${label} : bienvenue de CRMlead`);
        const marked = () =>
          crmq(
            `select count(*) from onboarding_marks o join users u on u.id = o.user_id where u.email = '${creator}'`,
          ) !== "0";
        for (let i = 0; i < 40 && !marked(); i++) await sleep(250);
        expect(marked(), `${label} : bienvenue non relevée`);
        await w.close();
      } else {
        const r = await ctx.request.post(`${CRM}/api/auth/signup`, {
          data: {
            accountName: `E2E5 ${label}`,
            name: "Eve",
            email: creator,
            password: PASS,
            locale: "fr",
          },
          headers: { origin: CRM },
        });
        expect(r.ok(), `${label} : inscription ${r.status()}`);
      }
      if (realLead) {
        const l = await ctx.request.post(`${CRM}/api/leads`, {
          data: { title: "Un vrai lead" },
          headers: { origin: CRM },
        });
        expect(l.ok(), `${label} : lead ${l.status()}`);
      }
      const account = crmq(`select account_id from users where email = '${creator}'`);
      crmq(
        `insert into lead_subscriptions (account_id, source_app, external_id, app_plan, plan_code, status)
         values ('${account}', 'scanlead', 'e2e5-${label}-${stamp}', 'pro_plus', 'pro_plus', 'active') on conflict do nothing`,
      );
      // Réglages → Équipe de CRMlead, comme InvoiceLead le demandait avant ce lot.
      const colleague = mail(`${label}-m`);
      const inv = await ctx.request.post(`${CRM}/api/users`, {
        data: { email: colleague, name: "Collègue" },
        headers: { origin: CRM },
      });
      expect(inv.status() === 201, `${label} : invitation ${inv.status()}`);
      const token = `jeton-${label}-${stamp}`;
      crmq(
        `update auth_tokens set token_hash = '${sha(token)}' where id = (select id from auth_tokens
          where user_id = (select id from users where email = '${colleague}') and purpose = 'invite'
          order by created_at desc limit 1)`,
      );
      const cc = await browser.newContext({ locale: "fr-CH" });
      const acc = await cc.request.post(`${CRM}/api/auth/accept`, {
        data: { token, password: PASS, name: "Collègue" },
        headers: { origin: CRM },
      });
      expect(acc.ok(), `${label} : acceptation ${acc.status()}`);
      // Chacun ouvre ensuite InvoiceLead (le créateur aussitôt après son inscription).
      for (const [c, who] of [
        [ctx, creator],
        [cc, colleague],
      ]) {
        await c.clearCookies();
        const p = await c.newPage();
        await p.goto(`${IL}/auth/lead/start?locale=fr`);
        await waitAt(p, `${CRM}/login?next=`, `${label} : écran`);
        await passwordLogin(p, who);
        await waitAt(p, `${IL}/fr/app`, `${label} : InvoiceLead`);
        await p.close();
      }
      await ctx.close();
      await cc.close();
      return { creator, colleague };
    };
    const prefs = (email) =>
      crmq(
        `select coalesce(p.digest, '-') || '|' || coalesce(p.weekly_report::text, '-') || '|' || coalesce(l.tips::text, '-')
            || '|' || (l.app_quiet_at is not null)::text
         from users u left join notification_prefs p on p.user_id = u.id left join lifecycle_prefs l on l.user_id = u.id
        where u.email = '${email}'`,
      );
    const weeklyDue = (email) =>
      crmq(
        `select (u.is_active and a.paused_at is null and coalesce(p.weekly_report, true))::text
           from users u join accounts a on a.id = u.account_id left join notification_prefs p on p.user_id = u.id
          where u.email = '${email}'`,
      );
    const born = await org("lg113");
    const withLead = await org("lg113-lead", { realLead: true });
    const native = await org("lg113-crm", { viaUi: true });
    expect(weeklyDue(born.colleague) === "true", `avant 113 : ${prefs(born.colleague)}`);
    const replay = () =>
      execFileSync(
        "psql",
        [
          "-U",
          "postgres",
          "-h",
          "localhost",
          "-d",
          "crmlead_e2e",
          "-q",
          "-v",
          "ON_ERROR_STOP=1",
          "-f",
          `${CRM_REPO}/db/113_free_plan_all_apps.sql`,
        ],
        { stdio: ["ignore", "ignore", "ignore"] },
      );
    replay();
    expect(
      /^off\|false\|false\|true$/.test(prefs(born.creator)),
      `créateur : ${prefs(born.creator)}`,
    );
    expect(
      /^off\|false\|false\|true$/.test(prefs(born.colleague)),
      `collègue : ${prefs(born.colleague)}`,
    );
    expect(weeklyDue(born.colleague) === "false", "collègue : rapport du lundi encore dû");
    for (const [what, who] of [
      ["organisation avec un vrai lead, créateur", withLead.creator],
      ["organisation avec un vrai lead, collègue", withLead.colleague],
      ["organisation née sur CRMlead, créateur", native.creator],
      ["organisation née sur CRMlead, collègue", native.colleague],
    ])
      expect(
        (([d, w, , q]) => d !== "off" && w !== "false" && q === "false")(prefs(who).split("|")),
        `${what} : ${prefs(who)}`,
      );
    // Rejouée : rien ne change, et le rapport rallumé par le collègue reste.
    const c = await browser.newContext();
    const lg = await c.request.post(`${CRM}/api/auth/login`, {
      data: { email: born.colleague, password: PASS },
      headers: { origin: CRM },
    });
    expect(lg.ok(), `connexion du collègue : ${lg.status()}`);
    const wr = await c.request.put(`${CRM}/api/notifications/prefs`, {
      data: { weeklyReport: true },
      headers: { origin: CRM },
    });
    expect(wr.ok(), `rapport rallumé : ${wr.status()}`);
    await c.close();
    replay();
    expect(
      prefs(born.colleague).split("|")[1] === "true",
      `113 rejouée : ${prefs(born.colleague)}`,
    );
  },
);

await step(
  "CRM-MEMBERS-PROOF : inviter un collègue exige la preuve de l'administrateur, renvoi compris",
  async () => {
    const ctx = await newCtx(browser, "fr-CH", "prf");
    const p = await ctx.newPage();
    const manager = await signupFromIl(p, "fr", "prf");
    const [org, inviter] = crmq(
      `select account_id || '|' || id from users where email = '${manager}'`,
    ).split("|");
    crmq(
      `insert into lead_subscriptions (account_id, source_app, external_id, app_plan, plan_code, status)
       values ('${org}', 'scanlead', 'e2e5-prf-${stamp}', 'pro_plus', 'pro_plus', 'active') on conflict do nothing`,
    );
    await dropCookies(ctx, (n) => n === "il_session");
    await p.goto(`${IL}/fr/app/settings/team`);
    await waitAt(p, `${IL}/fr/app/settings/team`, "équipe");
    // Depuis InvoiceLead : l'invitation, puis la même adresse encore (renvoi par /members/:id/invite).
    const colleague = mail("prf-coll");
    const sentTo = () =>
      crmLog()
        .split("\n")
        .filter((l) => l.includes(`à ${colleague} — `)).length;
    for (const round of [1, 2]) {
      await p.goto(`${IL}/fr/app/settings/team`);
      const form = p.locator('[data-testid="member-invite"]');
      await form.locator('input[name="name"]').fill("Collègue preuve");
      await form.locator('input[name="email"]').fill(colleague);
      await form.locator('[data-testid="member-invite-submit"]').click();
      for (let i = 0; i < 40 && sentTo() < round; i++) await sleep(250);
      expect(sentTo() === round, `envoi ${round} : ${sentTo()} emails`);
    }
    // L'API : avec le jeton d'identité de l'administrateur, oui ; pour une autre organisation, non.
    const cc = await ctx.request.post(`${CRM}/oauth/token`, {
      form: {
        grant_type: "client_credentials",
        client_id: "invoicelead",
        client_secret: process.env.LEAD_ID_CLIENT_SECRET ?? "lid_test_e2e_secret",
        scope: "members",
      },
    });
    const bearer = `Bearer ${(await cc.json()).access_token}`;
    const proof = await idTokenOf(ctx);
    const invite = (body) =>
      ctx.request.post(`${CRM}/api/lead-id/v1/members/invite`, {
        headers: { authorization: bearer, "x-lead-id-token": proof },
        data: { name: "API", ...body },
      });
    const ok = await invite({ org, inviter, email: mail("prf-api") });
    expect(ok.status() === 201, `avec la preuve : ${ok.status()}`);
    const otherOrg = crmq(`select account_id from users where email = '${OWNER}'`);
    const otherAdmin = crmq(`select id from users where email = '${OWNER}'`);
    for (const [label, body] of [
      ["autre organisation", { org: otherOrg, inviter, email: mail("prf-x1") }],
      ["autre administrateur", { org: otherOrg, inviter: otherAdmin, email: mail("prf-x2") }],
    ]) {
      const r = await invite(body);
      const b = await r.json().catch(() => ({}));
      expect(
        r.status() === 403 && b.error === "inviter_proof",
        `${label} : ${r.status()} ${b.error}`,
      );
    }
    expect(
      crmq(
        `select count(*) from users where email in ('${mail("prf-x1")}', '${mail("prf-x2")}')`,
      ) === "0",
      "invitation hors de son organisation",
    );
    await ctx.close();
  },
);

// ---------- intégration du lot 8 : chaque correction rejouée sur la pile reconstruite ----------
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
/** Code temporel (RFC 6238) d'un secret en base 32, décalé de `offset` périodes de 30 s. */
function totpCode(secret, offset = 0) {
  let bits = "";
  for (const ch of secret.replace(/=+$/, "")) bits += B32.indexOf(ch).toString(2).padStart(5, "0");
  const key = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) key.push(Number.parseInt(bits.slice(i, i + 8), 2));
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000) + offset));
  const h = createHmac("sha1", Buffer.from(key)).update(buf).digest();
  const o = h[h.length - 1] & 15;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1e6).padStart(6, "0");
}
/** Double authentification allumée pour la personne connectée au Compte Lead (`base`) dans `ctx` : son secret. */
async function enable2fa(ctx, base = CRM) {
  const post = (path, data = {}) =>
    ctx.request.post(`${base}${path}`, { data, headers: { origin: base } });
  const secret = (await (await post("/api/auth/totp/begin")).json()).secret;
  const on = await post("/api/auth/totp/confirm", { code: totpCode(secret) });
  expect(on.ok(), `2FA : ${on.status()}`);
  return secret;
}
/** Les adresses où le cadre principal de `page` navigue à partir de maintenant. */
function navLog(page) {
  const seen = [];
  page.on("framenavigated", (f) => {
    if (f === page.mainFrame()) seen.push(f.url());
  });
  return seen;
}
/** Lien « nouveau mot de passe » d'un Compte Lead (`base`), avec la demande de l'application s'il y en a une. */
function resetLinkAt(base, email, next) {
  const token = randomBytes(32).toString("base64url");
  crmq(`select 1 from auth_token_issue('reset', '${email}', '${sha(token)}', '1 hour'::interval)`);
  return `${base}/mot-de-passe?jeton=${token}${next ? `&next=${encodeURIComponent(next)}` : ""}`;
}
/** Même demande d'application (son `state`), quel que soit l'encodage des espaces (« + » ou « %20 »). */
const sameRequest = (a, b) => {
  const st = (n) =>
    n?.startsWith("/oauth/authorize?") ? new URLSearchParams(n.split("?")[1]).get("state") : null;
  return !!st(a) && st(a) === st(b);
};
const quietOf = (email) =>
  crmq(
    `select coalesce(p.digest, 'défaut') || '|' || coalesce(p.weekly_report::text, 'défaut') from users u
       left join notification_prefs p on p.user_id = u.id where u.email = '${email}'`,
  );

await step(
  "CRM-BACK-AFTER-DETOUR : Retour depuis la page demandée rend la page d'avant, après inscription, mot de passe oublié ou « Se connecter »",
  async () => {
    const target = `${IL}/fr/app/invoices?status=open`;
    const ctx = await newCtx(browser, "fr-CH", "back8");
    const from = events.length;
    /** Retour depuis la page demandée : /fr aussitôt, sans repasser par le Compte Lead, la même session. */
    const backToFr = async (p, label) => {
      const token = await ilToken(ctx);
      expect(token, `${label} : pas de session InvoiceLead`);
      const entries = await p.evaluate(() => history.length);
      const navs = navLog(p);
      await p.goBack();
      await sleep(2500);
      const trail = navs.join(" -> ");
      expect(
        p.url() === `${IL}/fr`,
        `${label} : Retour mène à ${p.url()} (navigations : ${trail})`,
      );
      expect(
        !navs.some((u) => u.startsWith(CRM)),
        `${label} : Retour repasse par le Compte Lead (${trail})`,
      );
      expect(
        (await ilToken(ctx)) === token && !sessionGone(token),
        `${label} : session InvoiceLead remplacée (nouvelle connexion silencieuse)`,
      );
      console.log(`  ${label} : historique ${entries} entrées, Retour -> ${p.url()}`);
    };
    // 1. Connexion, « Créer un compte », inscription.
    const p = await ctx.newPage();
    await p.goto(`${IL}/fr`);
    await p.goto(target);
    await waitAt(p, `${CRM}/login?next=`, "inscription : écran du Compte Lead");
    await p.getByRole("link", { name: "Créer un compte" }).click();
    await waitAt(p, `${CRM}/signup?next=`, "inscription : écran d'inscription");
    const who = mail("back8");
    await p.fill("#auth-account", "E2E5 retour");
    await p.fill("#auth-name", "Eve E2E5");
    await p.fill("#auth-email", who);
    await p.fill("#auth-password", PASS);
    await p.locator("form button").last().click();
    await waitAt(p, target, "inscription : arrivée");
    await backToFr(p, "inscription");
    await p.close();
    // 2. Connexion, « Mot de passe oublié ? », « Retour à la connexion », connexion.
    await ctx.clearCookies();
    const p2 = await ctx.newPage();
    await p2.goto(`${IL}/fr`);
    await p2.goto(target);
    await waitAt(p2, `${CRM}/login?next=`, "oubli : écran du Compte Lead");
    await p2.getByRole("link", { name: /Mot de passe oublié/ }).click();
    await waitAt(p2, `${CRM}/mot-de-passe?next=`, "oubli : mot de passe oublié");
    await p2.getByRole("heading", { name: /Mot de passe oublié/ }).waitFor();
    await p2.getByRole("link", { name: /Retour à la connexion/ }).click();
    await waitAt(p2, `${CRM}/login?next=`, "oubli : retour à la connexion");
    await passwordLogin(p2, who);
    await waitAt(p2, target, "oubli : arrivée");
    await backToFr(p2, "oubli");
    await p2.close();
    // 3. « Créer un compte » d'InvoiceLead, puis « Se connecter » sur l'écran d'inscription.
    await ctx.clearCookies();
    const p3 = await ctx.newPage();
    await p3.goto(`${IL}/fr`);
    await p3.goto(
      `${IL}/auth/lead/start?locale=fr&signup=1&next=${encodeURIComponent("/fr/app/invoices?status=open")}`,
    );
    await waitAt(p3, `${CRM}/signup?next=`, "se connecter : écran d'inscription");
    await p3.getByRole("link", { name: "Se connecter" }).click();
    await waitAt(p3, `${CRM}/login?next=`, "se connecter : connexion");
    // L'adresse change avant l'écran (transition du routeur) : l'inscription a aussi ses champs email et mot de passe.
    await p3.getByRole("heading", { name: "Connexion" }).waitFor();
    await passwordLogin(p3, who);
    await waitAt(p3, target, "se connecter : arrivée");
    await backToFr(p3, "se connecter");
    // Témoin : sans détour, comme avant.
    await ctx.clearCookies();
    const p4 = await ctx.newPage();
    await p4.goto(`${IL}/fr`);
    await p4.goto(target);
    await waitAt(p4, `${CRM}/login?next=`, "témoin : écran du Compte Lead");
    await passwordLogin(p4, who);
    await waitAt(p4, target, "témoin : arrivée");
    await backToFr(p4, "témoin");
    neutralSince(from, "back8", (e) => /next=|\/oauth\//.test(e.url));
    await ctx.close();
    // CRMlead ouvert directement : les écrans se poussent comme avant, Retour ramène à la connexion.
    const d = await browser.newContext({ locale: "fr-CH" });
    const dp = await d.newPage();
    await dp.goto(`${CRM}/login`);
    await dp.waitForSelector("#auth-password");
    for (const [link, path] of [
      ["Créer un compte", "/signup"],
      [/Mot de passe oublié/, "/mot-de-passe"],
    ]) {
      await dp.getByRole("link", { name: link }).click();
      await waitAt(dp, `${CRM}${path}`, `direct : ${path}`);
      await dp.goBack();
      await dp.waitForURL((u) => u.pathname === "/login", { timeout: 10000 }).catch(() => {});
      expect(
        new URL(dp.url()).pathname === "/login",
        `direct : Retour depuis ${path} mène à ${dp.url()}`,
      );
      await dp.waitForSelector("#auth-password");
    }
    await d.close();
  },
);

await step(
  "CRM-RESET-2FA : mot de passe oublié avec la 2FA, le code est demandé avant InvoiceLead ; CRMlead direct et sans 2FA inchangés",
  async () => {
    // Compte ouvert depuis InvoiceLead, double authentification allumée.
    const own = await browser.newContext({ locale: "fr-CH" });
    const who = await signupFromIl(await own.newPage(), "fr", "reset2fa");
    const secret = await enable2fa(own);
    await own.close();
    // Quelqu'un qui a la boîte mail, pas l'authentificateur : InvoiceLead, « Mot de passe oublié ? ».
    const ctx = await newCtx(browser, "fr-CH", "reset2fa");
    const from = events.length;
    const p = await ctx.newPage();
    await p.goto(`${IL}/fr/app/invoices`);
    await waitAt(p, `${CRM}/login?next=`, "écran du Compte Lead");
    await p.getByRole("link", { name: /Mot de passe oublié/ }).click();
    await waitAt(p, `${CRM}/mot-de-passe?next=`, "mot de passe oublié");
    // L'adresse change avant l'écran : sans cette attente, l'email partait parfois dans le champ de la connexion.
    await p.getByRole("heading", { name: /Mot de passe oublié/ }).waitFor();
    const next = new URL(p.url()).searchParams.get("next");
    await p.fill("#auth-email", who);
    await p.locator("form button").last().click();
    await p.getByText(/le lien vient de partir/).waitFor({ timeout: 10000 });
    expect(
      await waitLog(
        crmLog,
        new RegExp(
          `à ${who.replace(/[+.]/g, "\\$&")} — Réinitialiser le mot de passe de votre Compte Lead`,
        ),
      ),
      "email de réinitialisation au nom du Compte Lead",
    );
    // Le lien de l'email (même adresse ; le jeton est posé ici), un nouveau mot de passe.
    const answers = [];
    p.on("response", (r) => {
      if (r.url() === `${CRM}/api/auth/reset`) answers.push(r.status());
    });
    await p.goto(resetLink(who, next));
    await p.fill("#auth-password", `${PASS}-n`);
    await p.locator("form button").last().click();
    await p
      .waitForURL((u) => u.href.startsWith(`${CRM}/login?sso=totp`), { timeout: 15000 })
      .catch(() => {
        throw new Error(`après le nouveau mot de passe : ${p.url()}`);
      });
    await p.locator("#auth-code").waitFor({ timeout: 10000 });
    expect(answers.join() === "200", `/reset : ${answers.join()}`);
    expect(
      !(await leadWho(ctx)),
      `session du Compte Lead ouverte sans le code : ${await leadWho(ctx)}`,
    );
    expect(!(await ilToken(ctx)), "session InvoiceLead ouverte sans le code");
    expect(
      sameRequest(new URL(p.url()).searchParams.get("next"), next),
      `demande perdue : ${p.url()}`,
    );
    expect((await p.title()) === "Compte Lead", `écran du code : « ${await p.title()} »`);
    // Le nouveau mot de passe seul ne coupe pas la 2FA.
    const off = await ctx.request.post(`${CRM}/api/auth/totp/disable`, {
      data: { password: `${PASS}-n` },
      headers: { origin: CRM },
    });
    expect(off.status() === 401, `couper la 2FA sans le code : ${off.status()}`);
    await p.fill("#auth-code", totpCode(secret, 1));
    await p.getByRole("button", { name: /Valider/ }).click();
    await waitAt(p, `${IL}/fr/app/invoices`, "après le code");
    expect((await ilWho(ctx)).startsWith(`${who}|`), `InvoiceLead : ${await ilWho(ctx)}`);
    neutralSince(from, "reset2fa", (e) => /next=|\/oauth\//.test(e.url));
    await ctx.close();
    // CRMlead direct : le lien sans application demande aussi le code, puis ouvre CRMlead.
    const dOwn = await browser.newContext({ locale: "fr-CH" });
    const direct = mail("reset2fa-direct");
    const s = await dOwn.request.post(`${CRM}/api/auth/signup`, {
      data: {
        accountName: "E2E5 direct 2FA",
        name: "Eve",
        email: direct,
        password: PASS,
        locale: "fr",
      },
      headers: { origin: CRM },
    });
    expect(s.ok(), `inscription directe : ${s.status()}`);
    const dSecret = await enable2fa(dOwn);
    await dOwn.close();
    const dctx = await browser.newContext({ locale: "fr-CH" });
    const dp = await dctx.newPage();
    await dp.goto(resetLinkAt(CRM, direct));
    await dp.fill("#auth-password", `${PASS}-n`);
    await dp.locator("form button").last().click();
    await dp
      .waitForURL((u) => u.href.startsWith(`${CRM}/login?sso=totp`), { timeout: 15000 })
      .catch(() => {
        throw new Error(`direct, après le nouveau mot de passe : ${dp.url()}`);
      });
    await dp.locator("#auth-code").waitFor({ timeout: 10000 });
    expect(!(await leadWho(dctx)), "direct : session ouverte sans le code");
    expect(/CRMlead/.test(await dp.title()), `direct : écran du code « ${await dp.title()} »`);
    await dp.fill("#auth-code", totpCode(dSecret, 1));
    await dp.getByRole("button", { name: /Valider/ }).click();
    await dp.waitForURL(
      (u) => u.href.startsWith(CRM) && !/^\/(api|login|mot-de-passe)/.test(u.pathname),
      { timeout: 15000 },
    );
    expect((await leadWho(dctx)) === direct, `direct : session ${await leadWho(dctx)}`);
    await dctx.close();
    // Sans 2FA, rien ne change : le lien ouvre la session et ramène tout droit sur la page demandée.
    const pctx = await browser.newContext({ locale: "fr-CH" });
    const pp = await pctx.newPage();
    const plain = await signupFromIl(pp, "fr", "reset-plain");
    await pctx.clearCookies();
    const { next: n2 } = await ilAuthorize(pctx, "locale=fr&next=%2Ffr%2Fapp%2Fquotes");
    await pp.goto(resetLink(plain, n2));
    await pp.fill("#auth-password", `${PASS}-n`);
    await pp.locator("form button").last().click();
    await waitAt(pp, `${IL}/fr/app/quotes`, "sans 2FA : arrivée");
    await pctx.close();
  },
);

await step(
  "IL-CALLBACK-LOGOUT-CSRF : un lien vers le retour posé par un autre site ne déconnecte jamais",
  async () => {
    const ctx = await browser.newContext({ locale: "fr-CH" });
    const p = await ctx.newPage();
    const who = await signupFromIl(p, "fr", "csrf8");
    const token = await ilToken(ctx);
    // L'autre site prend un état scellé par InvoiceLead, sans aucun cookie, et publie le lien du retour.
    const att = await browser.newContext();
    const s = await att.request.get(
      `${IL}/auth/lead/start?locale=fr&fresh=1&retry=1&next=%2Ffr%2Fapp%2Fsettings`,
      { maxRedirects: 0 },
    );
    const state = new URL(s.headers().location ?? "/", IL).searchParams.get("state");
    await att.close();
    expect(state, `état : ${s.status()} ${s.headers().location}`);
    for (const extra of ["", "&code=x"]) {
      const cleared = [];
      const watch = (r) => {
        if (/(^|\n)il_session=;/.test(r.headers()["set-cookie"] ?? "")) cleared.push(r.url());
      };
      p.on("response", watch);
      await p.goto(`${IL}/auth/lead/callback?state=${encodeURIComponent(state)}${extra}`);
      p.off("response", watch);
      const u = new URL(p.url());
      expect(
        u.pathname === "/fr/login" &&
          u.searchParams.get("erreur") === "session" &&
          u.searchParams.get("fresh") === "1" &&
          u.searchParams.get("next") === "/fr/app/settings",
        `lien${extra} : ${p.url()}`,
      );
      expect(!cleared.length, `lien${extra} : il_session effacé (${cleared.join(", ")})`);
      expect(
        (await ilToken(ctx)) === token && !sessionGone(token),
        `lien${extra} : session supprimée`,
      );
      const probe = await ctx.request.get(`${IL}/fr/app`, { maxRedirects: 0 });
      expect(probe.status() === 200, `lien${extra} : /fr/app répond ${probe.status()}`);
      const retry = await p.locator('[data-testid="lead-login"]').getAttribute("href");
      expect(/fresh=1/.test(retry ?? ""), `Réessayer : ${retry}`);
    }
    // « Réessayer » repasse par le Compte Lead (encore ouvert) et ramène la même personne sur la page.
    await p.locator('[data-testid="lead-login"]').click();
    await waitAt(p, `${IL}/fr/app/settings`, "Réessayer");
    expect((await ilWho(ctx)).startsWith(`${who}|`), `après Réessayer : ${await ilWho(ctx)}`);
    await ctx.close();
  },
);

await step(
  "CRM-SIGNUP-UNKNOWN-APP : une application enregistrée hors de la liste (Cashlead) inscrit par mot de passe, sans emails de CRMlead",
  async () => {
    // L'API : une application hors de la liste n'est plus un motif de refus.
    const api = await browser.newContext();
    const raw = mail("cash-api");
    const r = await api.request.post(`${CRM}/api/auth/signup`, {
      data: {
        accountName: "E2E5 cash api",
        name: "Eve",
        email: raw,
        password: PASS,
        locale: "fr",
        app: "cashlead",
      },
      headers: { origin: CRM },
    });
    expect(r.ok(), `app « cashlead » : ${r.status()} ${await r.text()}`);
    await api.close();
    // Un client du Compte Lead enregistré après coup, avec sa propre adresse de retour (un serveur de ce script).
    const app = http.createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end("<!doctype html><title>Cash</title>ok");
    });
    await new Promise((ok) => app.listen(0, "127.0.0.1", ok));
    const cb = `http://127.0.0.1:${app.address().port}/cb`;
    const client = `e2e5-cash-${stamp}`;
    crmq(`select lead_id_client_save('${client}', 'Cash E2E5', null, array['${cb}'], null)`);
    try {
      const ctx = await newCtx(browser, "fr-CH", "cash");
      const from = events.length;
      const p = await ctx.newPage();
      const q = new URLSearchParams({
        response_type: "code",
        client_id: client,
        redirect_uri: cb,
        scope: "openid email profile",
        state: "st-cash",
        code_challenge: createHash("sha256")
          .update(randomBytes(32).toString("base64url"))
          .digest("base64url"),
        code_challenge_method: "S256",
      });
      await p.goto(`${CRM}/oauth/authorize?${q}`);
      await waitAt(p, `${CRM}/login?next=`, "écran du Compte Lead");
      await p.getByRole("link", { name: "Créer un compte" }).click();
      await waitAt(p, `${CRM}/signup?next=`, "inscription");
      const who = mail("cash");
      await p.fill("#auth-account", "E2E5 Cash");
      await p.fill("#auth-name", "Eve E2E5");
      await p.fill("#auth-email", who);
      await p.fill("#auth-password", PASS);
      await p.locator("form button").last().click();
      await waitAt(p, `${cb}?`, "retour vers l'application");
      const back = new URL(p.url());
      expect(
        back.searchParams.get("code") && back.searchParams.get("state") === "st-cash",
        `retour : ${p.url()}`,
      );
      expect(quietOf(who) === "off|false", `réglages de CRMlead : ${quietOf(who)}`);
      await sleep(1000);
      expect(
        !crmLog().includes(`à ${who} — Bienvenue sur CRMlead`),
        "bienvenue de CRMlead envoyée",
      );
      neutralSince(from, "cash", (e) => /next=|\/oauth\//.test(e.url));
      await ctx.close();
    } finally {
      // Le client jetable (ses codes et jetons partent avec lui).
      crmq(`delete from lead_id_clients where client_id = '${client}'`);
      app.close();
    }
  },
);

// ---------- étapes Google (second CRMlead, faux Google) ----------
const gq = (o) => ({ data: o, headers: { origin: CRM_G } });
async function google(page, who, click = true) {
  persona = { sub: `sub-${who}`, email: who, action: "hold" };
  if (click) await page.getByRole("button", { name: /Google/ }).click();
  await waitAt(page, `${GOOGLE}/auth`, "chez Google");
}
if (!CRM_G) console.log("=== étapes Google : sautées (CRM_GOOGLE absent)");
else {
  await step(
    "CRM-SHARED-SSO-COOKIE + CRM-MOBILE-SIGNUP-EMAILS : deux onglets, chacun sa demande",
    async () => {
      const ctx = await newCtx(browser, "fr-CH", "g2");
      const from = events.length;
      const direct = mail("g-direct"),
        app = mail("g-app");
      const tabB = await ctx.newPage();
      await tabB.goto(`${CRM_G}/signup`);
      await tabB.fill("#auth-account", "E2E5 Google direct");
      await google(tabB, direct);
      const tabA = await ctx.newPage();
      const { url } = await ilAuthorize(
        ctx,
        "locale=fr&signup=1&next=%2Ffr%2Fapp%2Finvoices",
        CRM_G,
      );
      await tabA.goto(url);
      await waitAt(tabA, `${CRM_G}/signup?next=`, "A écran d'inscription");
      await tabA.fill("#auth-account", "E2E5 Google app");
      await google(tabA, app);
      await tabA.click("#ok");
      await waitAt(tabA, `${IL}/fr/app/invoices`, "A arrivée");
      await tabB.click("#ok");
      await tabB.waitForURL((u) => u.href.startsWith(CRM_G) && !u.pathname.startsWith("/api/"), {
        timeout: 20000,
      });
      await sleep(2500);
      expect(
        tabB.url().startsWith(CRM_G) && !/oauth|login|signup/.test(tabB.url()),
        `B arrivée : ${tabB.url()}`,
      );
      expect(
        await waitLog(
          gLog,
          new RegExp(`à ${direct.replace(/[+.]/g, "\\$&")} — Bienvenue sur CRMlead`),
        ),
        "B : pas de bienvenue",
      );
      const pb = crmq(
        `select coalesce(p.weekly_report::text, 'défaut') from users u left join notification_prefs p on p.user_id = u.id where u.email = '${direct}'`,
      );
      expect(pb !== "false", `B : rapport du lundi éteint`);
      const pa = crmq(
        `select p.weekly_report from notification_prefs p join users u on u.id = p.user_id where u.email = '${app}'`,
      );
      expect(pa === "f" && !gLog().includes(`à ${app} — Bienvenue`), `A : réglages ${pa}`);
      neutralSince(from, "g2", (e) => /next=|\/oauth\//.test(e.url));
      // App Android / iOS : une inscription native, dans un navigateur qui garde une demande d'InvoiceLead.
      persona = { sub: `sub-${mail("g-native")}`, email: mail("g-native"), action: "auto" };
      await ctx.request.post(
        `${CRM_G}/api/auth/sso/google/start`,
        gq({ mode: "login", locale: "fr", next: (await ilAuthorize(ctx, "locale=fr")).next }),
      );
      const n = await (
        await ctx.request.post(
          `${CRM_G}/api/auth/sso/google/start`,
          gq({ mode: "signup", accountName: "Native", locale: "fr", native: true }),
        )
      ).json();
      const cb = (await ctx.request.get(n.url, { maxRedirects: 0 })).headers().location;
      const ret = (await ctx.request.get(cb, { maxRedirects: 0 })).headers().location;
      expect(ret?.startsWith("io.crmlead.app://sso?code="), `retour natif : ${ret}`);
      expect(
        await waitLog(
          gLog,
          new RegExp(`à ${mail("g-native").replace(/[+.]/g, "\\$&")} — Bienvenue sur CRMlead`),
        ),
        "natif : pas de bienvenue",
      );
      await ctx.close();
    },
  );

  await step(
    "CRM-GOOGLE-LOGIN-CSRF : un retour Google fabriqué ailleurs n'ouvre aucune session",
    async () => {
      const att = await browser.newContext();
      const attacker = mail("g-att");
      const forged = async () => {
        persona = { sub: `sub-${attacker}`, email: attacker, action: "auto" };
        const s = await (
          await att.request.post(
            `${CRM_G}/api/auth/sso/google/start`,
            gq({ mode: "signup", accountName: "Attaquant", locale: "fr" }),
          )
        ).json();
        return (await att.request.get(s.url, { maxRedirects: 0 })).headers().location;
      };
      // J22 : victime sur l'écran Compte Lead ouvert par InvoiceLead.
      const ctx = await newCtx(browser, "fr-CH", "csrf");
      const from = events.length;
      const v = await ctx.newPage();
      const { url } = await ilAuthorize(ctx, "locale=fr&next=%2Ffr%2Fapp%2Finvoices", CRM_G);
      await v.goto(url);
      await waitAt(v, `${CRM_G}/login?next=`, "écran Compte Lead");
      // L'écran affiché, sa demande gardée dans l'onglet (posée au premier rendu, après /api/auth/me) : un
      // retour arrivé avant, à quelques millisecondes du chargement, n'est pas celui d'une personne.
      await v.waitForSelector("#auth-password");
      await v.waitForFunction(() => sessionStorage.getItem("crmlead.leadid.next"));
      await v.goto(await forged());
      // Écran neutre « demande expirée », toujours celui d'InvoiceLead.
      await waitAt(v, `${CRM_G}/login?sso=expired`, "retour fabriqué");
      await v.waitForSelector("#auth-password");
      expect(!/CRMlead/.test(await v.title()), `écran expiré : ${await v.title()}`);
      const me = await (await ctx.request.get(`${CRM_G}/api/auth/me`)).json();
      expect(!me.user, `session ouverte : ${me.user?.email}`);
      expect(
        !(await ctx.cookies()).some((c) => c.name === "il_session"),
        "session InvoiceLead ouverte",
      );
      // Utilisateur direct de CRMlead, connecté par mot de passe.
      const direct = await browser.newContext();
      const victim = mail("g-vict");
      await direct.request.post(
        `${CRM_G}/api/auth/signup`,
        gq({ accountName: "Victime", name: "Eve", email: victim, password: PASS, locale: "fr" }),
      );
      const d = await direct.newPage();
      await d.goto(await forged());
      await waitAt(d, `${CRM_G}/login?sso=expired`, "direct : retour fabriqué");
      const still = await (await direct.request.get(`${CRM_G}/api/auth/me`)).json();
      expect(still.user?.email === victim, `direct : session ${still.user?.email}`);
      expect(
        crmq(`select count(*) from users where email = '${attacker}'`) === "0",
        "compte de l'attaquant créé",
      );
      // Formulaire posté par un autre site.
      for (const headers of [
        { origin: "https://evil.example" },
        { "content-type": "text/plain" },
        { "sec-fetch-site": "cross-site" },
      ]) {
        const r = await direct.request.post(`${CRM_G}/api/auth/login`, {
          data: JSON.stringify({ email: attacker, password: PASS }),
          headers: { "content-type": "application/json", ...headers },
        });
        expect(
          r.status() === 403,
          `connexion d'un autre site ${JSON.stringify(headers)} : ${r.status()}`,
        );
      }
      await Promise.all([att.close(), direct.close()]);
      // Écran « demande expirée » de la victime d'InvoiceLead : neutre dès le premier octet, icône comprise.
      neutralSince(from, "csrf");
      await ctx.close();
    },
  );

  // ---------- retour de Google sans trace dans ce navigateur (CRM-GOOGLE-LOGIN-CSRF, suite) ----------
  /** Compte CRMlead direct, ouvert dans un contexte jetable : le navigateur testé reste déconnecté. */
  async function directAccount(label) {
    const tmp = await browser.newContext();
    const email = mail(label);
    const r = await tmp.request.post(
      `${CRM_G}/api/auth/signup`,
      gq({ accountName: `E2E5 ${label}`, name: "Eve", email, password: PASS, locale: "fr" }),
    );
    await tmp.close();
    expect(r.ok(), `inscription directe ${label} : ${r.status()}`);
    return email;
  }
  /** Adresse de retour obtenue dans un autre navigateur, pour son propre compte Google, jamais suivie. */
  async function forgedReturn(label) {
    const att = await browser.newContext();
    const who = mail(label);
    persona = { sub: `sub-${who}`, email: who, action: "auto" };
    const s = await (
      await att.request.post(
        `${CRM_G}/api/auth/sso/google/start`,
        gq({ mode: "login", locale: "fr" }),
      )
    ).json();
    const back = (await att.request.get(s.url, { maxRedirects: 0 })).headers().location;
    await att.close();
    return back;
  }
  /** Trois départs directs de CRMlead depuis d'autres onglets du même navigateur. */
  async function directDepartures(ctx) {
    for (let i = 0; i < 3; i++)
      await ctx.request.post(
        `${CRM_G}/api/auth/sso/google/start`,
        gq({ mode: "login", locale: "fr" }),
      );
  }
  /** L'écran où le retour finit (plus de `retour=` dans l'adresse), formulaire affiché. */
  async function settled(p, path = "/login") {
    await p.waitForURL(
      (u) => u.href.startsWith(`${CRM_G}${path}`) && !u.searchParams.has("retour"),
      { timeout: 20000 },
    );
    await p.waitForSelector("#auth-password");
    await sleep(800);
  }
  /** Ce que l'onglet montre de lui-même : titre, langue, icônes, manifeste, texte. */
  const tabHead = (p) =>
    p.evaluate(() => ({
      title: document.title,
      lang: document.documentElement.lang,
      links: Array.from(
        document.querySelectorAll(
          'link[rel~="icon"], link[rel="apple-touch-icon"], link[rel="manifest"]',
        ),
      ).map((l) => `${l.rel}=${(l.getAttribute("href") ?? "").slice(0, 24)}`),
      text: document.body.innerText.replace(/\s+/g, " "),
    }));
  // L'icône des quatre carrés, et celle d'écran d'accueil de l'iPhone qui la reprend (sans elle, Safari prenait
  // /apple-touch-icon.png, le « CL » de CRMlead) ; rien d'autre.
  const neutralHead = (h) =>
    !/CRMlead/.test(h.title) &&
    h.links.some((l) => l.startsWith("icon=data:image/svg")) &&
    h.links.every(
      (l) => l.startsWith("icon=data:image/svg") || l === "apple-touch-icon=/lead-touch-icon.png",
    );
  const crmHead = (h) =>
    /CRMlead/.test(h.title) &&
    h.links.some((l) => l.includes("favicon-32")) &&
    h.links.some((l) => l.startsWith("manifest="));
  const session = async (ctx) =>
    (await (await ctx.request.get(`${CRM_G}/api/auth/me`)).json()).user?.email ?? null;

  await step(
    "CRM-GOOGLE-LOGIN-CSRF (allemand) : Lead-Konto après le retour fabriqué, rechargé, puis la page demandée",
    async () => {
      const email = await directAccount("g-vict-de");
      const ctx = await newCtx(browser, "de-CH", "csrf-de");
      const from = events.length;
      const v = await ctx.newPage();
      const { url } = await ilAuthorize(ctx, "locale=de&next=%2Fde%2Fapp%2Finvoices", CRM_G);
      await v.goto(url);
      await waitAt(v, `${CRM_G}/login?next=`, "écran Lead-Konto");
      await v.waitForSelector("#auth-password");
      await v.goto(await forgedReturn("g-att-de"));
      await settled(v);
      let h = await tabHead(v);
      expect(
        /Diese Anmeldeanfrage ist abgelaufen/.test(h.text),
        `message : ${h.text.slice(0, 160)}`,
      );
      for (const when of ["retour", "rechargement"]) {
        if (when === "rechargement") {
          await v.reload();
          await settled(v);
          h = await tabHead(v);
        }
        expect(
          neutralHead(h) && h.title === "Lead-Konto" && h.lang === "de",
          `${when} : ${h.title} ${h.lang} ${h.links}`,
        );
        expect(
          new URL(v.url()).searchParams.get("next")?.startsWith("/oauth/authorize?"),
          `${when} : demande perdue ${v.url()}`,
        );
      }
      expect(!(await session(ctx)), `session ouverte : ${await session(ctx)}`);
      await passwordLogin(v, email);
      await waitAt(v, `${IL}/de/app/invoices`, "arrivée après connexion");
      neutralSince(from, "csrf-de");
      await ctx.close();
    },
  );

  await step(
    "CRM-GOOGLE-LOGIN-CSRF (départ effacé) : retour valide sans son départ, l'écran reste celui d'InvoiceLead",
    async () => {
      // Connexion, reconnexion (`reauth=1`), inscription annulée chez Google.
      for (const kind of ["connexion", "reconnexion", "inscription"]) {
        const tag = `prune-${kind}`;
        const email = await directAccount(tag);
        const ctx = await newCtx(browser, "fr-CH", tag);
        const from = events.length;
        const p = await ctx.newPage();
        if (kind === "reconnexion")
          await ctx.request.post(`${CRM_G}/api/auth/login`, gq({ email, password: PASS }));
        const a = await ilAuthorize(
          ctx,
          `locale=fr${kind === "inscription" ? "&signup=1" : ""}&next=%2Ffr%2Fapp%2Fquotes`,
          CRM_G,
        );
        await p.goto(kind === "reconnexion" ? `${a.url}&prompt=login` : a.url);
        const path = kind === "inscription" ? "/signup" : "/login";
        await waitAt(p, `${CRM_G}${path}?`, "écran Compte Lead");
        if (kind === "inscription") await p.fill("#auth-account", "E2E5 départ effacé");
        await google(p, mail(`${tag}-g`));
        const state = new URL(await p.locator("#ok").getAttribute("href")).searchParams.get(
          "state",
        );
        await directDepartures(ctx);
        const names = (await ctx.cookies()).map((c) => c.name);
        expect(
          !names.some((n) => n.endsWith(`_${state.slice(0, 16)}`)) &&
            !names.includes("crmlead_sso_next"),
          `${kind} : départ gardé ${names}`,
        );
        await p.click(kind === "inscription" ? "#deny" : "#ok");
        await settled(p, path);
        const h = await tabHead(p);
        const q = new URL(p.url()).searchParams;
        expect(neutralHead(h) && h.title === "Compte Lead", `${kind} : ${h.title} ${h.links}`);
        expect(
          q.get("next")?.startsWith("/oauth/authorize?") &&
            (q.get("reauth") === "1") === (kind === "reconnexion"),
          `${kind} : adresse ${p.url()}`,
        );
        const who = await session(ctx);
        expect(who === (kind === "reconnexion" ? email : null), `${kind} : session ${who}`);
        if (kind === "inscription") {
          await p.fill("#auth-account", "E2E5 départ effacé");
          await p.fill("#auth-name", "Eve E2E5");
          await p.fill("#auth-email", mail(`${tag}-new`));
          await p.fill("#auth-password", PASS);
          await p.locator("form button").last().click();
        } else await passwordLogin(p, email);
        await waitAt(p, `${IL}/fr/app/quotes`, `${kind} : arrivée`, 30000);
        neutralSince(from, tag);
        await ctx.close();
      }
    },
  );

  await step(
    "CRM-GOOGLE-LOGIN-CSRF (CRMlead direct) : un retour sans trace montre toujours CRMlead",
    async () => {
      const email = await directAccount("g-direct-lost");
      const ctx = await browser.newContext({ locale: "fr-CH" });
      const p = await ctx.newPage();
      // Déconnecté, onglet neuf : l'adresse fabriquée ailleurs.
      await p.goto(await forgedReturn("g-att-direct"));
      await settled(p);
      let h = await tabHead(p);
      expect(crmHead(h), `adresse fabriquée : ${h.title} ${h.links}`);
      // Son propre départ de CRMlead, effacé par trois autres : toujours CRMlead, sans demande.
      await p.goto(`${CRM_G}/login`);
      await google(p, mail("g-direct-g"));
      await directDepartures(ctx);
      await p.click("#ok");
      await settled(p);
      h = await tabHead(p);
      expect(
        crmHead(h) && !new URL(p.url()).searchParams.has("next"),
        `départ effacé : ${h.title} ${h.links} ${p.url()}`,
      );
      await passwordLogin(p, email);
      await p.waitForURL((u) => u.href.startsWith(CRM_G) && !/\/login/.test(u.pathname), {
        timeout: 20000,
      });
      // Connecté : l'adresse fabriquée ne change rien, CRMlead reste affiché.
      await p.goto(await forgedReturn("g-att-direct2"));
      await sleep(2500);
      expect((await session(ctx)) === email, `connecté : session ${await session(ctx)}`);
      expect(/CRMlead/.test(await p.title()), `connecté : titre ${await p.title()}`);
      await ctx.close();
    },
  );

  await step(
    "CRM-GOOGLE-LOGIN-CSRF (3 h) : retour de Google plus de trois heures après le départ d'InvoiceLead",
    async () => {
      const email = await directAccount("g-3h");
      const ctx = await newCtx(browser, "fr-CH", "g3h");
      const from = events.length;
      const p = await ctx.newPage();
      const { url } = await ilAuthorize(ctx, "locale=fr&next=%2Ffr%2Fapp%2Fexpenses", CRM_G);
      await p.goto(url);
      await waitAt(p, `${CRM_G}/login?next=`, "écran Compte Lead");
      await p.waitForFunction(() => sessionStorage.getItem("crmlead.leadid.next"));
      // Écran ouvert, Google choisi aussitôt, retour trois heures et une minute plus tard.
      await p.evaluate(() => {
        const k = "crmlead.leadid.next";
        const v = JSON.parse(sessionStorage.getItem(k));
        v.at = Date.now() - 3 * 3600_000 - 60_000;
        sessionStorage.setItem(k, JSON.stringify(v));
      });
      await google(p, mail("g-3h-g"));
      const state = new URL(await p.locator("#ok").getAttribute("href")).searchParams.get("state");
      crmq(
        `update sso_states set expires_at = now() - interval '1 minute' where state_hash = '${sha(state)}'`,
      );
      // La dernière demande vit trois heures, le départ (`__Host-` en production) vingt-quatre : tous deux
      // effacés ici (cookies effacés, ou retour au-delà d'un jour), c'est l'onglet qui retrouve la demande.
      await dropCookies(ctx, (n) => /^(__Host-)?crmlead_sso_(depart_|next)/.test(n));
      await p.click("#ok");
      await settled(p);
      const h = await tabHead(p);
      const screen = p.url();
      await passwordLogin(p, email);
      const landed = await p.waitForURL(at(`${IL}/fr/app/expenses`), { timeout: 20000 }).then(
        () => true,
        () => false,
      );
      expect(
        neutralHead(h) && landed,
        `retour tardif : écran « ${h.title} » ${h.links} (${screen}), après connexion ${p.url()}`,
      );
      neutralSince(from, "g3h");
      await ctx.close();
    },
  );

  // Le départ vit vingt-quatre heures, l'état trois : entre les deux, c'est le serveur qui retrouve la demande.
  /** Le départ de ce navigateur pour `state`, et ses heures de vie restantes. */
  async function departure(ctx, state) {
    const c = (await ctx.cookies()).find((k) => k.name.endsWith(`_${state.slice(0, 16)}`));
    return { name: c?.name, hours: c ? (c.expires - Date.now() / 1000) / 3600 : 0 };
  }
  const expireState = (state) =>
    crmq(
      `update sso_states set expires_at = now() - interval '1 minute' where state_hash = '${sha(state)}'`,
    );

  await step(
    "CRM-GOOGLE-LOGIN-CSRF (24 h) : départ d'InvoiceLead gardé, état échu, retour dans un onglet neuf",
    async () => {
      const email = await directAccount("g-24h");
      const ctx = await newCtx(browser, "de-CH", "g24h");
      const from = events.length;
      const p = await ctx.newPage();
      const { url } = await ilAuthorize(ctx, "locale=de&next=%2Fde%2Fapp%2Fexpenses", CRM_G);
      await p.goto(url);
      await waitAt(p, `${CRM_G}/login?next=`, "écran Lead-Konto");
      await p.waitForSelector("#auth-password");
      await google(p, mail("g-24h-g"));
      const back = await p.locator("#ok").getAttribute("href");
      const state = new URL(back).searchParams.get("state");
      const dep = await departure(ctx, state);
      expect(dep.hours > 23 && dep.hours <= 24.1, `départ ${dep.name} : ${dep.hours.toFixed(1)} h`);
      expireState(state);
      // Plus de trois heures : la dernière demande (trois heures) est partie, le départ reste. Onglet neuf, sans
      // rien en sessionStorage : seul le serveur peut retrouver la demande.
      await dropCookies(ctx, (n) => /^(__Host-)?crmlead_sso_next/.test(n));
      await p.close();
      const q = await ctx.newPage();
      const res = await q.goto(back);
      const first = new URL(res.url());
      expect(
        first.pathname === "/login" &&
          first.searchParams.get("sso") === "expired" &&
          first.searchParams.get("next")?.startsWith("/oauth/authorize?") &&
          !first.searchParams.has("retour"),
        `réponse du retour : ${res.url()}`,
      );
      await settled(q);
      const h = await tabHead(q);
      expect(
        neutralHead(h) && h.title === "Lead-Konto" && h.lang === "de",
        `écran : ${h.title} ${h.lang} ${h.links}`,
      );
      expect(
        /Diese Anmeldeanfrage ist abgelaufen/.test(h.text),
        `message : ${h.text.slice(0, 160)}`,
      );
      expect(!(await session(ctx)), `session ouverte : ${await session(ctx)}`);
      await passwordLogin(q, email);
      await waitAt(q, `${IL}/de/app/expenses`, "arrivée après connexion");
      neutralSince(from, "g24h");
      await ctx.close();
    },
  );

  await step(
    "CRM-GOOGLE-LOGIN-CSRF (24 h, CRMlead direct) : un retour tardif d'un départ direct reste CRMlead",
    async () => {
      const email = await directAccount("g-24h-direct");
      const ctx = await browser.newContext({ locale: "fr-CH" });
      const p = await ctx.newPage();
      // Départ direct gardé, état échu : CRMlead, sans demande.
      await p.goto(`${CRM_G}/login`);
      await google(p, mail("g-24h-direct-g"));
      let back = await p.locator("#ok").getAttribute("href");
      let state = new URL(back).searchParams.get("state");
      expireState(state);
      await dropCookies(ctx, (n) => /^(__Host-)?crmlead_sso_next/.test(n));
      const res = await p.goto(back);
      expect(res.url() === `${CRM_G}/login?sso=expired`, `départ gardé : ${res.url()}`);
      await settled(p);
      let h = await tabHead(p);
      expect(
        crmHead(h) && !new URL(p.url()).searchParams.has("next"),
        `départ gardé : ${h.title} ${h.links} ${p.url()}`,
      );
      // Même onglet : un départ d'InvoiceLead abandonné chez Google, puis un départ direct de CRMlead dont le
      // retour arrive sans aucun cookie. La demande garée d'InvoiceLead ne le détourne pas.
      const { url } = await ilAuthorize(ctx, "locale=fr&next=%2Ffr%2Fapp%2Fexpenses", CRM_G);
      await p.goto(url);
      await waitAt(p, `${CRM_G}/login?next=`, "écran Compte Lead");
      await p.waitForSelector("#auth-password");
      await google(p, mail("g-24h-direct-il"));
      await p.goto(`${CRM_G}/login`);
      await google(p, mail("g-24h-direct-g2"));
      back = await p.locator("#ok").getAttribute("href");
      state = new URL(back).searchParams.get("state");
      expireState(state);
      await dropCookies(ctx, (n) => /^(__Host-)?crmlead_sso_(depart_|next)/.test(n));
      await p.click("#ok");
      await settled(p);
      h = await tabHead(p);
      expect(
        crmHead(h) && !new URL(p.url()).searchParams.has("next"),
        `sans cookie : ${h.title} ${h.links} ${p.url()}`,
      );
      await passwordLogin(p, email);
      await p.waitForURL((u) => u.href.startsWith(CRM_G) && !/\/login/.test(u.pathname), {
        timeout: 20000,
      });
      await sleep(1500);
      expect(p.url().startsWith(CRM_G), `arrivée : ${p.url()}`);
      expect((await session(ctx)) === email, `session ${await session(ctx)}`);
      expect(/CRMlead/.test(await p.title()), `arrivée : titre ${await p.title()}`);
      await ctx.close();
    },
  );

  await step(
    "CRM-GOOGLE-SIGNUP-15MIN : inscription Google finie 40 minutes après, erreur de Google",
    async () => {
      const ctx = await newCtx(browser, "fr-CH", "g15");
      const from = events.length;
      const p = await ctx.newPage();
      const { url } = await ilAuthorize(ctx, "locale=fr&signup=1&next=%2Ffr%2Fapp%2Fquotes", CRM_G);
      await p.goto(url);
      await waitAt(p, `${CRM_G}/signup?next=`, "écran d'inscription");
      await p.fill("#auth-account", "E2E5 lent");
      await google(p, mail("g-late"));
      const state = new URL(await p.locator("#ok").getAttribute("href")).searchParams.get("state");
      crmq(
        `update sso_states set expires_at = expires_at - interval '40 minutes' where state_hash = '${sha(state)}'`,
      );
      await p.click("#ok");
      await waitAt(p, `${IL}/fr/app/quotes`, "40 minutes plus tard");
      // Erreur chez Google : retour sur l'inscription, demande gardée, état consommé.
      await dropCookies(ctx, (n) => n === "il_session" || n.startsWith("crmlead_session"));
      const again = await ilAuthorize(ctx, "locale=fr&signup=1&next=%2Ffr%2Fapp%2Fquotes", CRM_G);
      await p.goto(again.url);
      await waitAt(p, `${CRM_G}/signup?next=`, "écran d'inscription (2)");
      await p.fill("#auth-account", "E2E5 erreur");
      // La demande telle que l'écran la porte (et la confie au serveur, `%20` pour `+`).
      const sent = new URL(p.url()).searchParams.get("next").replace(/\+/g, "%20");
      await google(p, mail("g-err"));
      const deny = new URL(await p.locator("#deny").getAttribute("href"));
      deny.searchParams.set("error", "server_error");
      const res = await p.goto(deny.href);
      // L'écran retire ensuite `sso=` de l'adresse : c'est la réponse du serveur qui le dit.
      const want = `${CRM_G}/signup?sso=error&next=${encodeURIComponent(sent)}`;
      expect(res?.url() === want, `erreur de Google : ${res?.url()} (attendu ${want})`);
      await waitAt(p, `${CRM_G}/signup?next=`, "erreur de Google, écran");
      await p.waitForSelector("#auth-account");
      const st = deny.searchParams.get("state");
      expect(
        crmq(`select count(*) from sso_states where state_hash = '${sha(st)}'`) === "0",
        "état non consommé",
      );
      neutralSince(from, "g15");
      await ctx.close();
    },
  );

  // ---------- retour rejoué sans son départ : jamais la demande d'un autre onglet (lot 6) ----------
  await step(
    "CRM-SHARED-NEXT-REPLAY (R10b) : retour Google rejoué d'une connexion directe, toujours CRMlead",
    async () => {
      // Compte lié à Google (inscription par Google, dans un autre navigateur).
      const who = mail("g-r10b");
      const setup = await browser.newContext();
      const sp = await setup.newPage();
      await sp.goto(`${CRM_G}/signup`);
      await sp.fill("#auth-account", "E2E5 R10b");
      await google(sp, who);
      await sp.click("#ok");
      await sp.waitForURL(
        (u) => u.href.startsWith(CRM_G) && !/^\/(signup|login|api)/.test(u.pathname),
        { timeout: 20000 },
      );
      await setup.close();
      // Onglet B, sur CRMlead directement : connexion par Google.
      const ctx = await newCtx(browser, "fr-CH", "r10b");
      const b = await ctx.newPage();
      await b.goto(`${CRM_G}/login`);
      await google(b, who);
      const back = await b.locator("#ok").getAttribute("href");
      await b.click("#ok");
      await b.waitForURL((u) => u.href.startsWith(CRM_G) && !/^\/(login|api)/.test(u.pathname), {
        timeout: 20000,
      });
      expect((await session(ctx)) === who, `B connecté : ${await session(ctx)}`);
      // Un autre onglet part chez Google pour InvoiceLead : c'est la dernière demande du navigateur
      // (telle que l'écran du Compte Lead la confie au serveur, `%20` pour `+`).
      const { next } = await ilAuthorize(ctx, "locale=fr&next=%2Ffr%2Fapp%2Finvoices", CRM_G);
      const s = await ctx.request.post(
        `${CRM_G}/api/auth/sso/google/start`,
        gq({ mode: "login", locale: "fr", next: next.replace(/\+/g, "%20") }),
      );
      expect(s.ok(), `départ de l'autre onglet : ${s.status()}`);
      // B : retour arrière jusqu'au choix du compte chez Google, même compte.
      await b.goto(back);
      await sleep(3000);
      const h = await tabHead(b);
      expect(
        b.url().startsWith(CRM_G) &&
          !/\/oauth\//.test(b.url()) &&
          !new URL(b.url()).searchParams.has("next") &&
          /CRMlead/.test(h.title),
        `B après avoir rechoisi : ${b.url()} « ${h.title} »`,
      );
      expect(
        !(await ctx.cookies()).some((c) => c.name === "il_session"),
        "B : session InvoiceLead ouverte",
      );
      await ctx.close();
    },
  );

  await step(
    "CRM-SHARED-NEXT-REPLAY (R11) : compte Google inconnu, retour arrière, autre compte : toujours CRMlead",
    async () => {
      const known = await directAccount("g-r11");
      const ctx = await newCtx(browser, "fr-CH", "r11");
      const from = events.length;
      const b = await ctx.newPage();
      await b.goto(`${CRM_G}/login`);
      await google(b, mail("g-r11-inconnu"));
      const chooser = b.url();
      // Un onglet d'InvoiceLead part aussi chez Google.
      const a = await ctx.newPage();
      const { url } = await ilAuthorize(ctx, "locale=fr&next=%2Ffr%2Fapp%2Finvoices", CRM_G);
      await a.goto(url);
      await waitAt(a, `${CRM_G}/login?next=`, "A écran Compte Lead");
      await a.waitForSelector("#auth-password");
      await a.waitForFunction(() => sessionStorage.getItem("crmlead.leadid.next"));
      await google(a, mail("g-r11-a"));
      // B revient avec un compte Google inconnu, puis retour arrière chez Google et un autre compte.
      await b.bringToFront();
      await b.click("#ok");
      await settled(b);
      persona = { sub: `sub-${known}`, email: known, action: "hold" };
      await b.goto(chooser);
      await b.click("#ok");
      await settled(b);
      const h = await tabHead(b);
      expect(
        crmHead(h) && !/InvoiceLead/.test(h.text) && !new URL(b.url()).searchParams.has("next"),
        `B après avoir rechoisi : ${b.url()} « ${h.title} » ${h.text.slice(0, 120)}`,
      );
      // A garde sa propre demande jusqu'au bout.
      await a.bringToFront();
      await a.click("#ok");
      await settled(a);
      await passwordLogin(a, known);
      await waitAt(a, `${IL}/fr/app/invoices`, "A : arrivée");
      neutralSince(from, "r11", (e) => /next=|\/oauth\//.test(e.url));
      await ctx.close();
    },
  );

  await step(
    "CRM-SHARED-NEXT-REPLAY (départ effacé) : l'onglet d'InvoiceLead retrouve sa propre demande",
    async () => {
      const email = await directAccount("g-pruned");
      const ctx = await newCtx(browser, "fr-CH", "pruned");
      const from = events.length;
      const t1 = await ctx.newPage();
      const a1 = await ilAuthorize(ctx, "locale=fr&next=%2Ffr%2Fapp%2Fquotes", CRM_G);
      await t1.goto(a1.url);
      await waitAt(t1, `${CRM_G}/login?next=`, "onglet 1 : écran");
      await t1.waitForSelector("#auth-password");
      await t1.waitForFunction(() => sessionStorage.getItem("crmlead.leadid.next"));
      await google(t1, mail("g-pruned-1"));
      const state = new URL(await t1.locator("#ok").getAttribute("href")).searchParams.get("state");
      // Trois départs plus récents : deux directs, puis une autre demande d'InvoiceLead (la dernière).
      for (let i = 0; i < 2; i++)
        await ctx.request.post(
          `${CRM_G}/api/auth/sso/google/start`,
          gq({ mode: "login", locale: "fr" }),
        );
      const a2 = await ilAuthorize(ctx, "locale=fr&next=%2Ffr%2Fapp%2Fexpenses", CRM_G);
      await ctx.request.post(
        `${CRM_G}/api/auth/sso/google/start`,
        gq({ mode: "login", locale: "fr", next: a2.next.replace(/\+/g, "%20") }),
      );
      expect(
        !(await ctx.cookies()).some((c) => c.name.endsWith(`_${state.slice(0, 16)}`)),
        "départ de l'onglet 1 encore là",
      );
      await t1.click("#ok");
      await settled(t1);
      const stateOf = (n) =>
        n ? new URLSearchParams(new URL(n, CRM_G).search).get("state") : null;
      const got = new URL(t1.url()).searchParams.get("next");
      const h = await tabHead(t1);
      expect(
        neutralHead(h) && stateOf(got) === stateOf(a1.next),
        `onglet 1 : « ${h.title} » demande ${got?.slice(0, 90)}`,
      );
      await passwordLogin(t1, email);
      await waitAt(t1, `${IL}/fr/app/quotes`, "onglet 1 : arrivée");
      neutralSince(from, "pruned");
      await ctx.close();
    },
  );

  await step("BOTH-COOKIE-431 (CRMlead) : 50 départs Google, trois cookies au plus", async () => {
    const ctx = await browser.newContext();
    const { next } = await ilAuthorize(ctx, "locale=fr");
    for (let i = 0; i < 50; i++)
      await ctx.request.post(
        `${CRM_G}/api/auth/sso/google/start`,
        gq({ mode: "login", locale: "fr", next }),
      );
    const departs = (await ctx.cookies()).filter((c) => /crmlead_sso_(depart|next)_/.test(c.name));
    const bytes = (await ctx.cookies()).reduce((s, c) => s + c.name.length + c.value.length + 2, 0);
    expect(
      departs.length <= 3 && bytes < 4096,
      `${departs.length} cookies de départ, ${bytes} octets`,
    );
    const r = await ctx.request.get(`${CRM_G}/login`);
    expect(r.status() === 200, `crmlead.io : ${r.status()}`);
    await ctx.close();
  });
  await step(
    "CRM-REAUTH-GOOGLE-2FA (CRMlead direct) : « Me reconnecter avec Google » avec la 2FA mène au code, puis au geste",
    async () => {
      const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
      const totp = (secret, offset = 0) => {
        let bits = "";
        for (const ch of secret.replace(/=+$/, ""))
          bits += B32.indexOf(ch).toString(2).padStart(5, "0");
        const key = [];
        for (let i = 0; i + 8 <= bits.length; i += 8)
          key.push(Number.parseInt(bits.slice(i, i + 8), 2));
        const buf = Buffer.alloc(8);
        buf.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000) + offset));
        const h = createHmac("sha1", Buffer.from(key)).update(buf).digest();
        const o = h[h.length - 1] & 15;
        return String((h.readUInt32BE(o) & 0x7fffffff) % 1e6).padStart(6, "0");
      };
      const who = mail("g-reauth");
      const viaGoogle = async (page) => {
        persona = { sub: `sub-${who}`, email: who, action: "hold" };
        await waitAt(page, `${GOOGLE}/auth`, "chez Google");
        await page.click("#ok");
        await page.waitForURL(/sso=totp/, { timeout: 20000 });
      };
      const typeCode = async (page, code) => {
        await page.locator("#auth-code").waitFor({ timeout: 10000 });
        await page.fill("#auth-code", code);
        await page.getByRole("button", { name: /Valider/ }).click();
      };
      // Compte né par Google (sans mot de passe), CRMlead direct, double authentification active.
      const ctx = await browser.newContext({ locale: "fr-CH" });
      const p = await ctx.newPage();
      await p.goto(`${CRM_G}/signup`);
      await p.fill("#auth-account", "E2E5 reconnexion Google");
      await google(p, who);
      await p.click("#ok");
      await p.waitForURL(
        (u) => u.href.startsWith(CRM_G) && !/^\/(api|signup|login)/.test(u.pathname),
        {
          timeout: 20000,
        },
      );
      const api = (path, data = {}) => ctx.request.post(`${CRM_G}${path}`, gq(data));
      const s1 = (await (await api("/api/auth/totp/begin")).json()).secret;
      const on = await api("/api/auth/totp/confirm", { code: totp(s1) });
      expect(on.ok(), `2FA : ${on.status()}`);
      // Session ouverte depuis plus de dix minutes : couper la 2FA demande de se reconnecter.
      crmq(
        `update sessions set created_at = now() - interval '11 minutes'
          where user_id = (select id from users where email = '${who}') and revoked_at is null`,
      );
      const refused = await api("/api/auth/totp/disable");
      const rb = await refused.json().catch(() => ({}));
      expect(
        refused.status() === 403 && rb.error === "reauth_required",
        `sans preuve : ${refused.status()} ${rb.error}`,
      );
      // Paramètres : « Désactiver », refusé, « Me reconnecter avec Google ».
      await p.goto(`${CRM_G}/settings#me`);
      const box = p.locator("#double-authentification");
      await box.getByRole("button", { name: "Désactiver", exact: true }).click();
      await box.getByRole("button", { name: /Désactiver la double/ }).click();
      await box.getByRole("button", { name: /Me reconnecter avec Google/ }).click();
      await viaGoogle(p);
      const back = new URL(p.url());
      expect(
        back.pathname === "/login" &&
          back.searchParams.get("reauth") === "1" &&
          /^[A-Za-z0-9_-]{16}$/.test(back.searchParams.get("t") ?? ""),
        `retour de Google : ${p.url()}`,
      );
      await typeCode(p, totp(s1, 1));
      await p
        .waitForURL((u) => u.pathname === "/settings" && u.hash === "#me", { timeout: 15000 })
        .catch(() => {});
      expect(new URL(p.url()).pathname === "/settings", `après le code : ${p.url()}`);
      const off = await api("/api/auth/totp/disable");
      expect(off.ok(), `couper la 2FA après le code : ${off.status()}`);
      // Contrôles, 2FA rallumée : un onglet déconnecté (CRMlead direct, puis départ d'InvoiceLead) n'a pas reauth=1.
      const s2 = (await (await api("/api/auth/totp/begin")).json()).secret;
      const on2 = await api("/api/auth/totp/confirm", { code: totp(s2) });
      expect(on2.ok(), `2FA rallumée : ${on2.status()}`);
      await ctx.close();
      const direct = await browser.newContext({ locale: "fr-CH" });
      const d = await direct.newPage();
      await d.goto(`${CRM_G}/login`);
      await d.getByRole("button", { name: /Google/ }).click();
      await viaGoogle(d);
      expect(!d.url().includes("reauth=1") && !d.url().includes("next="), `direct : ${d.url()}`);
      await typeCode(d, totp(s2, 0));
      await d.waitForURL((u) => u.href.startsWith(CRM_G) && !/^\/(api|login)/.test(u.pathname), {
        timeout: 15000,
      });
      await direct.close();
      const il = await newCtx(browser, "fr-CH", "g-reauth-il");
      const from = events.length;
      const r = await il.newPage();
      const { url } = await ilAuthorize(il, "locale=fr&next=%2Ffr%2Fapp%2Finvoices", CRM_G);
      await r.goto(url);
      await waitAt(r, `${CRM_G}/login?next=`, "départ d'InvoiceLead");
      await r.getByRole("button", { name: /Google/ }).click();
      await viaGoogle(r);
      expect(
        !r.url().includes("reauth=1") && r.url().includes("next="),
        `InvoiceLead : ${r.url()}`,
      );
      await typeCode(r, totp(s2, 1));
      await waitAt(r, `${IL}/fr/app/invoices`, "InvoiceLead : page demandée");
      neutralSince(from, "g-reauth-il", (e) => /next=|\/oauth\//.test(e.url));
      await il.close();
    },
  );

  // ---------- intégration du lot 8, étapes Google ----------
  await step(
    "CRM-BACK-AFTER-DETOUR (Google) : Retour depuis la page demandée après « Continuer avec Google » rend la page d'avant",
    async () => {
      const ctx = await newCtx(browser, "fr-CH", "back8g");
      const from = events.length;
      const who = mail("back8-g");
      /** Google (compte déjà choisi : retour aussitôt), arrivée sur `target`, puis Retour : /fr, la même session. */
      const viaGoogle = async (query, path, target, account) => {
        const p = await ctx.newPage();
        await p.goto(`${IL}/fr`);
        const { url } = await ilAuthorize(ctx, query, CRM_G);
        await p.goto(url);
        await waitAt(p, `${CRM_G}${path}?next=`, `${path} : écran du Compte Lead`);
        if (account) await p.fill("#auth-account", account);
        await p.waitForSelector("#auth-password");
        persona = { sub: `sub-${who}`, email: who, action: "auto" };
        await p.getByRole("button", { name: /Google/ }).click();
        await waitAt(p, target, `${path} : arrivée`);
        const token = await ilToken(ctx);
        const navs = navLog(p);
        await p.goBack();
        await sleep(2500);
        const trail = navs.join(" -> ");
        expect(
          p.url() === `${IL}/fr`,
          `${path} : Retour mène à ${p.url()} (navigations : ${trail})`,
        );
        expect(
          !navs.some((u) => u.startsWith(CRM_G) || u.startsWith(GOOGLE)),
          `${path} : Retour repasse par le Compte Lead ou Google (${trail})`,
        );
        expect(
          (await ilToken(ctx)) === token && !sessionGone(token),
          `${path} : session remplacée`,
        );
        await p.close();
        await ctx.clearCookies();
      };
      await viaGoogle(
        "locale=fr&signup=1&next=%2Ffr%2Fapp%2Finvoices",
        "/signup",
        `${IL}/fr/app/invoices`,
        "E2E5 retour Google",
      );
      await viaGoogle("locale=fr&next=%2Ffr%2Fapp%2Fquotes", "/login", `${IL}/fr/app/quotes`);
      neutralSince(from, "back8g", (e) => /next=|\/oauth\//.test(e.url));
      await ctx.close();
      // CRMlead direct : Google reste une entrée poussée, Retour ramène à l'écran de connexion.
      const d = await browser.newContext({ locale: "fr-CH" });
      const dp = await d.newPage();
      await dp.goto(`${CRM_G}/login`);
      await google(dp, mail("back8-gd"));
      await dp.goBack();
      await dp
        .waitForURL((u) => u.href.startsWith(`${CRM_G}/login`), { timeout: 10000 })
        .catch(() => {});
      expect(
        dp.url().startsWith(`${CRM_G}/login`),
        `direct : Retour depuis Google mène à ${dp.url()}`,
      );
      await d.close();
    },
  );

  // Compte ouvert d'avance par un tiers, depuis InvoiceLead, à l'adresse d'une autre personne (jamais confirmée).
  const preh = { victim: mail("g-preh"), pass: `${PASS}-intrus`, intr: null, next: "" };
  await step(
    "CRM-GOOGLE-UNCONFIRMED : Google ne se rattache pas à un compte ouvert d'avance sur une adresse jamais confirmée",
    async () => {
      const { victim } = preh;
      preh.intr = await browser.newContext({ locale: "fr-CH" });
      const ip = await preh.intr.newPage();
      const { url: iu } = await ilAuthorize(preh.intr, "locale=fr&signup=1", CRM_G);
      await ip.goto(iu);
      await waitAt(ip, `${CRM_G}/signup?next=`, "tiers : inscription");
      await ip.fill("#auth-account", "Compte prepare");
      await ip.fill("#auth-name", "Tiers");
      await ip.fill("#auth-email", victim);
      await ip.fill("#auth-password", preh.pass);
      await ip.locator("form button").last().click();
      await waitAt(ip, `${IL}/fr/app`, "tiers : arrivée dans InvoiceLead");
      const before = crmq(
        `select (email_verified_at is null)::text || '|' || coalesce(sso_subject, '') from users where email = '${victim}'`,
      );
      expect(before === "true|", `avant Google : ${before}`);
      // La personne : InvoiceLead, « Créer un compte », « Victime SA », « Continuer avec Google » à son adresse.
      const ctx = await newCtx(browser, "fr-CH", "preh");
      const from = events.length;
      const p = await ctx.newPage();
      const { url, next } = await ilAuthorize(
        ctx,
        "locale=fr&signup=1&next=%2Ffr%2Fapp%2Finvoices",
        CRM_G,
      );
      preh.next = next;
      await p.goto(url);
      await waitAt(p, `${CRM_G}/signup?next=`, "inscription");
      await p.fill("#auth-account", "Victime SA");
      await google(p, victim);
      await p.click("#ok");
      await waitAt(p, `${CRM_G}/login?sso=unconfirmed`, "retour de Google");
      await p.waitForSelector("#auth-password");
      const text = (await p.locator("body").innerText()).replace(/\s+/g, " ");
      expect(/n'a jamais été confirmée/.test(text), `message : ${text.slice(0, 240)}`);
      expect(
        sameRequest(new URL(p.url()).searchParams.get("next"), next),
        `demande perdue : ${p.url()}`,
      );
      expect((await p.title()) === "Compte Lead", `titre : ${await p.title()}`);
      expect(!(await session(ctx)), `session ouverte : ${await session(ctx)}`);
      expect(!(await ilToken(ctx)), "session InvoiceLead ouverte");
      const after = crmq(
        `select (email_verified_at is null)::text || '|' || coalesce(sso_subject, '') from users where email = '${victim}'`,
      );
      expect(after === "true|", `Google rattaché ou adresse confirmée : ${after}`);
      expect(
        await waitLog(
          gLog,
          new RegExp(
            `à ${victim.replace(/[+.]/g, "\\$&")} — Réinitialiser le mot de passe de votre Compte Lead`,
          ),
        ),
        "lien « nouveau mot de passe » au nom du Compte Lead",
      );
      neutralSince(from, "preh", (e) => /next=|\/oauth\//.test(e.url));
      // Le lien reçu : la personne choisit son mot de passe et arrive sur la page demandée.
      await p.goto(resetLinkAt(CRM_G, victim, next));
      await p.fill("#auth-password", `${PASS}-victime`);
      await p.locator("form button").last().click();
      await waitAt(p, `${IL}/fr/app/invoices`, "après le nouveau mot de passe");
      // Le mot de passe du tiers ne vaut plus, ses sessions du Compte Lead sont fermées.
      const lg = await preh.intr.request.post(`${CRM_G}/api/auth/login`, {
        data: { email: victim, password: preh.pass },
        headers: { origin: CRM_G },
      });
      expect(lg.status() === 401, `mot de passe du tiers : ${lg.status()}`);
      expect(!(await session(preh.intr)), "session du tiers au Compte Lead encore ouverte");
      // Google se rattache maintenant (adresse prouvée par le lien) et mène à la page demandée.
      await ctx.clearCookies();
      const g = await ctx.newPage();
      const { url: gu } = await ilAuthorize(ctx, "locale=fr&next=%2Ffr%2Fapp%2Fquotes", CRM_G);
      await g.goto(gu);
      await waitAt(g, `${CRM_G}/login?next=`, "connexion Google");
      await google(g, victim);
      await g.click("#ok");
      await waitAt(g, `${IL}/fr/app/quotes`, "Google après le lien");
      const linked = crmq(
        `select (email_verified_at is not null)::text || '|' || coalesce(sso_subject, '') from users where email = '${victim}'`,
      );
      expect(linked === `true|sub-${victim}`, `Google rattaché : ${linked}`);
      await ctx.close();
      // CRMlead direct : même refus, sur l'écran de CRMlead.
      const direct = await directAccount("g-preh-direct");
      const d = await browser.newContext({ locale: "fr-CH" });
      const dp = await d.newPage();
      await dp.goto(`${CRM_G}/login`);
      await google(dp, direct);
      await dp.click("#ok");
      await waitAt(dp, `${CRM_G}/login?sso=unconfirmed`, "direct : retour de Google");
      await dp.waitForSelector("#auth-password");
      expect(/CRMlead/.test(await dp.title()), `direct : titre ${await dp.title()}`);
      expect(
        /n'a jamais été confirmée/.test(await dp.locator("body").innerText()),
        "direct : message",
      );
      expect(!(await session(d)), "direct : session ouverte");
      await d.close();
    },
  );
  await step(
    "CRM-GOOGLE-UNCONFIRMED (InvoiceLead du tiers) : une fois la personne entrée, l'auteur du compte d'avance ne lit plus rien",
    async () => {
      expect(preh.intr, "étape précédente pas jouée");
      // Ce que la personne saisit dans InvoiceLead, puis ce que la session InvoiceLead du tiers en voit encore.
      const ctx = await browser.newContext({ locale: "fr-CH" });
      const p = await ctx.newPage();
      const { url } = await ilAuthorize(ctx, "locale=fr&next=%2Ffr%2Fapp%2Fcontacts%2Fnew", CRM_G);
      await p.goto(url);
      await waitAt(p, `${CRM_G}/login?next=`, "connexion");
      await passwordLogin(p, preh.victim, `${PASS}-victime`);
      await waitAt(p, `${IL}/fr/app/contacts/new`, "personne : nouveau contact");
      const secret = `Client confidentiel ${stamp}`;
      await p.fill("#contact-name", secret);
      await p.locator('[data-testid="contact-save"]').click();
      await waitAt(p, `${IL}/fr/app/contacts?saved=1`, "personne : contact enregistré");
      await ctx.close();
      const seen = await preh.intr.request.get(`${IL}/fr/app/contacts`, { maxRedirects: 0 });
      const body = seen.status() === 200 ? await seen.text() : "";
      const tok = (await preh.intr.cookies()).find((c) => c.name === "il_session")?.value ?? "";
      const who = tok
        ? ilq(
            `select u.email || '|' || o.name from sessions s join users u on u.id = s.user_id
               join organizations o on o.id = s.organization_id
              where s.id = '${sha(decodeURIComponent(tok))}' and s.expires_at > now()`,
          )
        : "";
      await preh.intr.close();
      expect(
        seen.status() !== 200 && !body.includes(secret),
        `la session InvoiceLead du tiers (${who}) répond ${seen.status()} sur /fr/app/contacts${body.includes(secret) ? ` et montre « ${secret} »` : ""}`,
      );
    },
  );

  await step(
    "CRM-GOOGLE-INVITED : collègue invité depuis InvoiceLead qui passe par Google avant son lien, connexion ou inscription",
    async () => {
      // Administrateur InvoiceLead (Pro+, places) ; invitations par Réglages → Équipe.
      const actx = await browser.newContext({ locale: "fr-CH" });
      const ap = await actx.newPage();
      const manager = await signupFromIl(ap, "fr", "invg-mgr");
      const org = crmq(`select account_id from users where email = '${manager}'`);
      crmq(
        `insert into lead_subscriptions (account_id, source_app, external_id, app_plan, plan_code, status)
         values ('${org}', 'scanlead', 'e2e5-invg-${stamp}', 'pro_plus', 'pro_plus', 'active') on conflict do nothing`,
      );
      await dropCookies(actx, (n) => n === "il_session");
      await ap.goto(`${IL}/fr/app/settings/team`);
      await waitAt(ap, `${IL}/fr/app/settings/team`, "équipe");
      const invite = async (who) => {
        const form = ap.locator('[data-testid="member-invite"]');
        await form.locator('input[name="name"]').fill("Collègue Google");
        await form.locator('input[name="email"]').fill(who);
        await form.locator('[data-testid="member-invite-submit"]').click();
        const line = await waitLog(crmLog, new RegExp(`à ${who.replace(/[+.]/g, "\\$&")} — `));
        expect(line && /InvoiceLead/.test(line), `invitation de ${who} : ${line}`);
        await ap.reload();
      };
      const ilOrg = ownOrgOf(manager);
      const state = (who) =>
        crmq(
          `select u.is_active::text || '|' || (u.sso_subject is not null)::text || '|' || (u.account_id = '${org}')::text
                  || '|' || (select count(*) from auth_tokens t where t.user_id = u.id and t.purpose = 'invite' and t.consumed_at is null)
             from users u where u.email = '${who}'`,
        );
      const ctx = await newCtx(browser, "fr-CH", "invg");
      const from = events.length;
      // Connexion, puis inscription (« Créer un compte », une autre entreprise tapée) : la même invitation acceptée.
      for (const [label, query, path, target] of [
        ["connexion", "locale=fr&next=%2Ffr%2Fapp%2Finvoices", "/login", `${IL}/fr/app/invoices`],
        [
          "inscription",
          "locale=fr&signup=1&next=%2Ffr%2Fapp%2Fquotes",
          "/signup",
          `${IL}/fr/app/quotes`,
        ],
      ]) {
        const who = mail(`invg-${label}`);
        await invite(who);
        expect(
          state(who) === "false|false|true|1",
          `${label} : invitation en attente ${state(who)}`,
        );
        await ctx.clearCookies();
        const p = await ctx.newPage();
        const { url } = await ilAuthorize(ctx, query, CRM_G);
        await p.goto(url);
        await waitAt(p, `${CRM_G}${path}?next=`, `${label} : écran du Compte Lead`);
        if (path === "/signup") await p.fill("#auth-account", "Autre entreprise");
        await google(p, who);
        await p.click("#ok");
        await waitAt(p, target, `${label} : arrivée`);
        expect(state(who) === "true|true|true|0", `${label} : ${state(who)}`);
        expect(quietOf(who) === "off|false", `${label} : réglages de CRMlead ${quietOf(who)}`);
        expect(
          (await ilWho(ctx)) === `${who}|${ilOrg}`,
          `${label} : InvoiceLead ${await ilWho(ctx)}`,
        );
        await p.close();
      }
      // Invitation échue : le message juste, la demande gardée, aucune session.
      const late = mail("invg-late");
      await invite(late);
      crmq(
        `update auth_tokens set expires_at = now() - interval '1 minute'
          where user_id = (select id from users where email = '${late}') and purpose = 'invite'`,
      );
      await ctx.clearCookies();
      const e = await ctx.newPage();
      const { url: eu, next: en } = await ilAuthorize(
        ctx,
        "locale=fr&next=%2Ffr%2Fapp%2Finvoices",
        CRM_G,
      );
      await e.goto(eu);
      await waitAt(e, `${CRM_G}/login?next=`, "échue : écran du Compte Lead");
      await google(e, late);
      await e.click("#ok");
      await waitAt(e, `${CRM_G}/login?sso=invite_expired`, "échue : retour de Google");
      await e.waitForSelector("#auth-password");
      expect(
        /Votre invitation a expiré/.test(await e.locator("body").innerText()),
        "échue : message",
      );
      expect(
        sameRequest(new URL(e.url()).searchParams.get("next"), en),
        `échue : demande perdue ${e.url()}`,
      );
      expect(
        !(await session(ctx)) && state(late).startsWith("false|false"),
        `échue : ${state(late)}`,
      );
      // Invitation annulée (jeton retiré) : l'accès reste refusé.
      const gone = mail("invg-gone");
      await invite(gone);
      crmq(
        `update auth_tokens set consumed_at = now()
          where user_id = (select id from users where email = '${gone}') and purpose = 'invite'`,
      );
      await ctx.clearCookies();
      const c = await ctx.newPage();
      const { url: cu } = await ilAuthorize(ctx, "locale=fr&next=%2Ffr%2Fapp%2Finvoices", CRM_G);
      await c.goto(cu);
      await waitAt(c, `${CRM_G}/login?next=`, "annulée : écran du Compte Lead");
      await google(c, gone);
      await c.click("#ok");
      await waitAt(c, `${CRM_G}/login?sso=inactive`, "annulée : retour de Google");
      expect(
        !(await session(ctx)) && state(gone).startsWith("false|false"),
        `annulée : ${state(gone)}`,
      );
      neutralSince(from, "invg", (ev) => /next=|\/oauth\//.test(ev.url));
      await Promise.all([ctx.close(), actx.close()]);
      // CRMlead direct : collègue invité dans Réglages → Équipe de CRMlead, Google arrive dans CRMlead.
      const dctx = await browser.newContext({ locale: "fr-CH" });
      const admin = mail("invg-crm-adm");
      const sd = await dctx.request.post(
        `${CRM_G}/api/auth/signup`,
        gq({
          accountName: "E2E5 invités CRMlead",
          name: "Eve",
          email: admin,
          password: PASS,
          locale: "fr",
        }),
      );
      expect(sd.ok(), `direct : inscription ${sd.status()}`);
      crmq(
        `insert into lead_subscriptions (account_id, source_app, external_id, app_plan, plan_code, status)
         select account_id, 'scanlead', 'e2e5-invgd-${stamp}', 'pro_plus', 'pro_plus', 'active' from users where email = '${admin}'`,
      );
      const colD = mail("invg-crm");
      const di = await dctx.request.post(`${CRM_G}/api/users`, gq({ email: colD, name: "Direct" }));
      expect(di.status() === 201, `direct : invitation ${di.status()}`);
      await dctx.close();
      const k = await browser.newContext({ locale: "fr-CH" });
      const kp = await k.newPage();
      await kp.goto(`${CRM_G}/login`);
      await google(kp, colD);
      await kp.click("#ok");
      await kp.waitForURL(
        (u) => u.href.startsWith(CRM_G) && !/^\/(api|login|signup)/.test(u.pathname),
        { timeout: 20000 },
      );
      expect((await session(k)) === colD, `direct : session ${await session(k)}`);
      expect(/CRMlead/.test(await kp.title()), `direct : titre ${await kp.title()}`);
      expect(quietOf(colD) !== "off|false", `direct : réglages de CRMlead coupés ${quietOf(colD)}`);
      await k.close();
    },
  );
}

console.log("\nRESULTATS", JSON.stringify(results, null, 1));
await browser.close();
gServer?.close();
