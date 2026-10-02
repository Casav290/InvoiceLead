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
 * Comptes : eve+e2e5-<étape>-<horodatage>@example.test. Le propriétaire (owner), qui invite les fiduciaires,
 * passe en Pro+ dès son inscription : l'accès fiduciaire fait partie de la formule Pro.
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
 *
 * Intégration du lot 8, r8 (compte ouvert d'avance, 113 section 7) : CRM-GOOGLE-UNCONFIRMED vérifie désormais le
 * compte neuf (rien de coché d'office, « je ne l'ai pas ouvert » coché par la personne, autre identifiant, entreprise
 * « Victime SA », compte d'avance désactivé, ses jetons révoqués) et que la session InvoiceLead de l'auteur ne montre
 * rien de ce que la personne saisit ; CRM-RESET-UNCONFIRMED-CHOICE (inscription refusée, puis avec CRM_GOOGLE connexion
 * Google : rien de coché, envoi sans choix refusé), CRM-RESET-UNCONFIRMED-OWN (son propre compte),
 * CRM-RESET-FRESH-DIRECT (CRMlead direct : accueil et bienvenue de CRMlead), CRM-RESET-CONFIRMED (aucun choix, compte
 * neuf refusé, lien inventé) et, avec CRM_GOOGLE, CRM-UNCONFIRMED-VERIFY-LINK (lien « Confirmez votre adresse » du
 * compte d'avance ouvert avant Google).
 *
 * Lot 8, r8 bis (113 section 8, avec CRM_GOOGLE) : CRM-VERIFY-LINK-CHOICE (lien « Confirmez votre adresse » d'un compte
 * ouvert d'avance, ouvert ailleurs : le compte montré, rien de coché, rien de confirmé sans choix ni avec un faux mot de
 * passe, « je ne l'ai pas ouvert » mène dans InvoiceLead dans un compte neuf, l'auteur ne lit rien et perd son mot de
 * passe), CRM-VERIFY-LINK-OWN (la vraie titulaire : confirmée d'un coup dans son navigateur, avec son mot de passe
 * ailleurs, ou un nouveau qui ferme tout ; CRMlead direct : écran de CRMlead, compte neuf vers la bienvenue) et
 * CRM-GOOGLE-UNCONFIRMED-OWN (la vraie titulaire revient s'inscrire par Google : rien de coché, valider sans choisir est
 * refusé, « c'est mon compte » la ramène dans InvoiceLead avec ce qu'elle y avait saisi).
 *
 * Intégration du lot 8, r8 bis (pile reconstruite, avec CRM_GOOGLE) : CRM-UNCONFIRMED-VERIFY-LINK exige désormais le
 * chemin attendu (lien de confirmation ouvert ailleurs : le compte d'avance montré, rien de coché, rien de confirmé ;
 * Google ne s'y rattache pas, lien « nouveau mot de passe » sans rien de coché, compte neuf, jetons du tiers révoqués),
 * CRM-GOOGLE-UNCONFIRMED-OWN (CRMlead direct) (la titulaire d'un compte CRMlead jamais confirmé revient s'inscrire par
 * Google : écran de CRMlead, rien de coché, envoi sans choix refusé, « c'est mon compte » garde son compte et son
 * lead, pas d'accueil d'un compte neuf) et CRM-VERIFY-LINK-OWN (CRMlead direct, même navigateur) (confirmée d'un coup
 * là où elle est connectée). Le frein des inscriptions refusées (`signup|local`, une heure) compte aussi les rejeux
 * précédents : entre deux rejeux rapprochés, `delete from login_attempts where key like 'signup|%'`.
 *
 * Lot 8, r8 ter (CRMlead 113 sections 9 à 11, sessions InvoiceLead revérifiées) : CRM-RESET-PREOPEN-2FA (2FA posée par
 * l'auteur d'un compte ouvert d'avance : retirée quand la personne prouve sa boîte, au lien « nouveau mot de passe » ou
 * « Confirmez votre adresse » ; un compte confirmé garde la sienne), CRM-RESET-UNCONFIRMED-MINE (InvoiceLead du tiers)
 * (« c'est mon compte » ferme aussitôt la session InvoiceLead de l'auteur, `cred_at` ; depuis CRMlead direct, à sa
 * vérification suivante au Compte Lead), IL-FIDU-RECORD (fiche d'un client ouverte depuis une autre entreprise, lien du
 * récapitulatif `?org=`), IL-FIDU-FREE-CLIENT (session chez un client revenu en gratuit : ses propres liens, l'écran
 * « accès suspendu » qui garde la page), CRM-FORGOT-PENDING-INVITE (invitation perdue renvoyée par « Mot de passe
 * oublié »), CRM-APP-LANG-HOLDS (langue demandée par l'application, session ouverte dans une autre) ; CRM-VERIFY-LINK-OWN
 * exige l'arrivée directe dans InvoiceLead (et le code d'abord avec la 2FA), CRM-RESET-UNCONFIRMED-OWN et
 * CRM-RESET-FRESH-DIRECT ne cochent plus rien d'office, CRM-TEAM-INVITE-EMAIL et CRM-LEAD-EMAILS-HTML refusent ou
 * neutralisent un nom sur plusieurs lignes, CRM-GOOGLE-INVITED montre l'écran du choix (rejoindre ou son propre compte).
 *
 * Intégration r8 ter (pile reconstruite) : le lien « nouveau mot de passe » d'une adresse jamais confirmée ne coche plus
 * rien d'office, la titulaire choisit son compte (openOwnReset, dans IL-EXPIRED-REQUEST, IL-SECOND-TAB-10MIN,
 * IL-NEXT-LONG-NO-COOKIE, IL-RESET-SHARED-DEVICE et CRM-RESET-2FA) ; CRM-RESET-2FA part d'adresses confirmées (sinon
 * la 2FA tombe au lien, R8-G2FA) ; le sélecteur de l'écran « accès suspendu » s'ouvre avant le choix ; l'email
 * d'invitation garde son second lien « Ou copiez ce lien » ; le cookie du choix (« __Host-… ») se rejoue par l'en-tête.
 * Les deux défauts du lot 8 propres au Compte Lead sont rejoués dans e2e-login6 (LOGOUT, OPENLINK).
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
/**
 * Lien « Nouveau mot de passe » ouvert par la titulaire. Sur une adresse jamais confirmée (inscription par mot de
 * passe), l'écran demande à qui est le compte, rien de coché d'office (CRMlead c1600ab, R8-SEC-2) : elle choisit le sien.
 */
async function openOwnReset(page, link) {
  const info = page
    .waitForResponse((r) => r.url().endsWith("/api/auth/reset/info"), { timeout: 15000 })
    .catch(() => null);
  await page.goto(link);
  const r = await info;
  const out = r ? await r.json().catch(() => ({})) : {};
  await page.waitForSelector("#auth-password");
  if (out.unconfirmed) {
    const mine = page.locator('[data-testid="reset-whose-mine"]');
    await mine.waitFor();
    expect(!(await mine.isChecked()), "« c'est mon compte » coché d'office");
    await mine.check();
  }
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
// L'accès fiduciaire fait partie de la formule Pro : en formule gratuite (113), l'acceptation d'une
// invitation s'arrête sur « plan » et l'accès d'une fiduciaire est suspendu. Le propriétaire passe en
// Pro+, relue par InvoiceLead à une reconnexion silencieuse.
crmq(
  `insert into lead_subscriptions (account_id, source_app, external_id, app_plan, plan_code, status)
   select account_id, 'scanlead', 'e2e5-owner-${stamp}', 'pro_plus', 'pro_plus', 'active' from users
    where email = '${OWNER}' on conflict do nothing`,
);
await dropCookies(ownCtx, (n) => n === "il_session");
await ownPage.goto(`${IL}/fr/app`);
await waitAt(ownPage, `${IL}/fr/app`, "propriétaire relu en Pro+");
const ownerRank = ilq(
  `select coalesce(o.entitlements #>> '{plan,rank}', case when o.lead_plan = 'free' then '0' else '1' end)
     from organizations o join memberships m on m.organization_id = o.id join users u on u.id = m.user_id
    where u.email = '${OWNER}' and m.role <> 'fiduciary' limit 1`,
);
if (!(Number(ownerRank) >= 1))
  throw new Error(`propriétaire : formule de rang ${ownerRank} dans InvoiceLead, Pro attendu`);

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
    await openOwnReset(q, link);
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
      await openOwnReset(mailTab, resetLink(email, new URL(origin.url()).searchParams.get("next")));
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
    const form = p.locator('[data-testid="member-invite"]');
    // Un nom sur plusieurs lignes (posé dans les données du formulaire à l'envoi, comme un envoi fabriqué : un champ
    // d'une ligne n'en garde aucune) : refusé par InvoiceLead avant le Compte Lead (R8-MAIL-1), le formulaire le dit,
    // personne n'est invité.
    const multi = mail("coll-nl");
    await form
      .locator("form")
      .evaluate((f) =>
        f.addEventListener(
          "formdata",
          (e) => e.formData.set("name", "Max\n\nhttps://x.example/l\n\nR8"),
          { once: true },
        ),
      );
    await form.locator('input[name="name"]').fill("Max");
    await form.locator('input[name="email"]').fill(multi);
    await form.locator('[data-testid="member-invite-submit"]').click();
    await p.getByText("Indiquez un nom et une adresse e-mail valide.").waitFor({ timeout: 10000 });
    expect(
      crmq(`select count(*) from users where email = '${multi}'`) === "0",
      "nom sur plusieurs lignes : invitation envoyée",
    );
    await p.reload();
    // L'inscription au Compte Lead refuse aussi un saut de ligne dans le nom (avec ou sans espaces autour).
    for (const name of ["Eve\n\nhttps://x.example/l", "Eve \n \n https://x.example/l"]) {
      const r = await ctx.request.post(`${CRM}/api/auth/signup`, {
        data: {
          accountName: "E2E5 nom injecté",
          name,
          email: mail("nl-signup"),
          password: PASS,
          locale: "fr",
          app: "invoicelead",
        },
        headers: { origin: CRM, "x-forwarded-for": "198.51.100.77" },
      });
      expect(r.status() === 400, `inscription au nom injecté : ${r.status()}`);
    }
    const colleague = mail("coll");
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
      // Un nom sur plusieurs lignes, une adresse seule sur la sienne et du balisage (R8-MAIL-1) : ramené sur une
      // ligne et échappé ; un seul bouton, le lien d'invitation, aucune adresse étrangère, aucun balisage injecté.
      const inj = mail("cap-inj");
      const ri = await ctx.request.post(`${MAILCAP}/api/lead-id/v1/members/invite`, {
        headers: bearer,
        data: {
          org,
          inviter,
          email: inj,
          name: 'Max\n\nhttps://x.example/l"><b>INJECTE</b><img src=https://x.example/p.png>\n\nR8',
          locale: "fr",
        },
      });
      expect(ri.status() === 201, `invitation au nom injecté : ${ri.status()}`);
      const mi = await mailTo(inj);
      leadMail("invitation au nom injecté", mi, labels.fr);
      const hrefs = [...mi.html.matchAll(/href="([^"]*)"/g)].map((x) => x[1]);
      // Le gabarit met le lien deux fois (le bouton, puis « Ou copiez ce lien ») : un seul bouton, et chaque lien est
      // celui de l'invitation.
      const invites = hrefs.filter((h) => /\/invitation\?jeton=/.test(h));
      expect(
        !hrefs.some((h) => /x\.example/.test(h)) &&
          !/<b>INJECTE|<img[^>]*x\.example/i.test(mi.html) &&
          invites.length > 0 &&
          new Set(invites).size === 1 &&
          mi.html.split(labels.fr).length === 2,
        `invitation au nom injecté : ${hrefs.join(" ")}`,
      );
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
      await openOwnReset(q, resetLink(email, new URL(p.url()).searchParams.get("next")));
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
    await openOwnReset(sp, resetLink(A, next));
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
/** Jetons de rafraîchissement des applications encore valables pour cette personne du Compte Lead (id). */
const liveRefresh = (userId) =>
  crmq(
    `select count(*) from lead_id_refresh where user_id = '${userId}' and revoked_at is null and expires_at > now()`,
  );
/** Sessions du Compte Lead encore ouvertes pour cette personne (id). */
const liveSessions = (userId) =>
  crmq(
    `select count(*) from sessions where user_id = '${userId}' and revoked_at is null and expires_at > now()`,
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
    // Adresse confirmée : sur une adresse jamais prouvée, le lien « nouveau mot de passe » fait tomber la 2FA
    // (CRMlead a7d73ce, R8-G2FA, rejoué par CRM-RESET-PREOPEN-2FA). Ici, la titulaire a confirmé la sienne.
    crmq(`select auth_email_verify((select id from users where email = '${who}'))`);
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
    await openOwnReset(p, resetLink(who, next));
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
    crmq(`select auth_email_verify((select id from users where email = '${direct}'))`);
    const dSecret = await enable2fa(dOwn);
    await dOwn.close();
    const dctx = await browser.newContext({ locale: "fr-CH" });
    const dp = await dctx.newPage();
    await openOwnReset(dp, resetLinkAt(CRM, direct));
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
    await openOwnReset(pp, resetLink(plain, n2));
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

// ---------- intégration du lot 8, r8 : lien « nouveau mot de passe » d'un compte jamais confirmé (113, section 7) ----------
/** Un tiers ouvre depuis InvoiceLead (Compte Lead `base`) un compte à l'adresse `victim`, jamais confirmée. */
async function preCreate(victim, company, base = CRM) {
  const intr = await browser.newContext({ locale: "fr-CH" });
  const ip = await intr.newPage();
  const { url } = await ilAuthorize(intr, "locale=fr&signup=1", base);
  await ip.goto(url);
  await waitAt(ip, `${base}/signup?next=`, "tiers : inscription");
  await ip.fill("#auth-account", company);
  await ip.fill("#auth-name", "Tiers");
  await ip.fill("#auth-email", victim);
  await ip.fill("#auth-password", `${PASS}-intrus`);
  await ip.locator("form button").last().click();
  await waitAt(ip, `${IL}/fr/app`, "tiers : arrivée dans InvoiceLead");
  const oldId = crmq(
    `select id from users where email = '${victim}' and email_verified_at is null`,
  );
  expect(
    oldId && Number(liveRefresh(oldId)) > 0,
    `compte d'avance ${oldId} : ${liveRefresh(oldId)}`,
  );
  return { intr, oldId };
}
/** Le choix coché sur l'écran du lien : "mine", "fresh", ou "" (rien). */
const whoseChecked = async (p) =>
  (await p.isChecked('[data-testid="reset-whose-mine"]'))
    ? "mine"
    : (await p.isChecked('[data-testid="reset-whose-fresh"]'))
      ? "fresh"
      : "";
const tokenOf = (link) => new URL(link).searchParams.get("jeton");
/** Jetons de rafraîchissement émis avant `t0` encore valables (ceux du tiers, pas ceux de la personne). */
const refreshBefore = (userId, t0) =>
  crmq(
    `select count(*) from lead_id_refresh where user_id = '${userId}' and created_at < '${t0}'
        and revoked_at is null and expires_at > now()`,
  );
const leadMe = async (ctx, base = CRM) =>
  (await (await ctx.request.get(`${base}/api/auth/me`)).json().catch(() => ({}))).user?.email ??
  null;
const countLog = (read, line) =>
  read()
    .split("\n")
    .filter((l) => l.includes(line)).length;

await step(
  "CRM-RESET-UNCONFIRMED-CHOICE (inscription refusée) : rien de coché, rien de repris, « c'est mon compte » garde le compte et ferme les accès du tiers",
  async () => {
    const victim = mail("rsc-taken");
    const { intr, oldId } = await preCreate(victim, "Compte avance C");
    const ctx = await newCtx(browser, "fr-CH", "rsc-taken");
    const from = events.length;
    const p = await ctx.newPage();
    const { url, next } = await ilAuthorize(ctx, "locale=fr&signup=1&next=%2Ffr%2Fapp%2Finvoices");
    await p.goto(url);
    await waitAt(p, `${CRM}/signup?next=`, "inscription");
    await p.fill("#auth-account", "Victime C SA");
    await p.fill("#auth-name", "Victime C");
    await p.fill("#auth-email", victim);
    await p.fill("#auth-password", `${PASS}-victime`);
    await p.locator("form button").last().click();
    await p.getByText("Cet e-mail est déjà utilisé.").waitFor({ timeout: 10000 });
    const note = crmq(
      `select coalesce(unconfirmed_claim ->> 'mode', '') || '|' || coalesce(unconfirmed_claim ->> 'account', '')
         from users where id = '${oldId}'`,
    );
    expect(note === "attempt|", `note de l'inscription refusée : ${note}`);
    // « Mot de passe oublié » : le lien de l'email, ouvert dans un autre onglet.
    const q = await ctx.newPage();
    const link = resetLinkAt(CRM, victim, next);
    await q.goto(link);
    await q.waitForSelector('[data-testid="reset-whose"]');
    expect((await whoseChecked(q)) === "", `coché d'office : ${await whoseChecked(q)}`);
    expect((await q.locator("#auth-account").count()) === 0, "champ d'entreprise sans choix");
    expect((await q.title()) === "Compte Lead", `titre : ${await q.title()}`);
    // Envoi sans choix : refusé à l'écran, et par le serveur sans consommer le lien.
    await q.fill("#auth-password", `${PASS}-victime`);
    await q.locator("form button").last().click();
    await q.getByText("Indiquez d'abord si ce compte est le vôtre.").waitFor({ timeout: 5000 });
    const raw = await ctx.request.post(`${CRM}/api/auth/reset`, {
      data: { token: tokenOf(link), password: `${PASS}-victime` },
      headers: { origin: CRM },
    });
    const rawErr = (await raw.json().catch(() => ({}))).error;
    expect(
      raw.status() === 409 && rawErr === "choice_required",
      `envoi sans choix : ${raw.status()} ${rawErr}`,
    );
    // « C'est mon compte » : même compte, adresse confirmée, page demandée ; le tiers perd mot de passe et jetons.
    const t0 = crmq("select now()");
    await q.check('[data-testid="reset-whose-mine"]');
    await q.locator("form button").last().click();
    await waitAt(q, `${IL}/fr/app/invoices`, "après « c'est mon compte »");
    neutralSince(from, "rsc-taken", (e) => /next=|\/oauth\/|jeton=/.test(e.url));
    const same = crmq(
      `select id || '|' || (email_verified_at is not null)::text || '|' || coalesce(unconfirmed_claim::text, '')
         from users where email = '${victim}'`,
    );
    expect(same === `${oldId}|true|`, `compte gardé : ${same}`);
    expect(refreshBefore(oldId, t0) === "0", `jetons du tiers : ${refreshBefore(oldId, t0)}`);
    const lg = await intr.request.post(`${CRM}/api/auth/login`, {
      data: { email: victim, password: `${PASS}-intrus` },
      headers: { origin: CRM },
    });
    expect(lg.status() === 401, `mot de passe du tiers : ${lg.status()}`);
    expect(!(await leadMe(intr)), "session du tiers au Compte Lead encore ouverte");
    // Le compte est confirmé : le lien suivant ne demande plus rien.
    const r = await ctx.newPage();
    await r.goto(resetLinkAt(CRM, victim, next));
    await r.waitForSelector("#auth-password");
    await sleep(1200);
    expect((await r.locator('[data-testid="reset-whose"]').count()) === 0, "choix au lien suivant");
    await Promise.all([ctx.close(), intr.close()]);
  },
);

await step(
  "CRM-RESET-UNCONFIRMED-OWN (mot de passe oublié) : son propre compte jamais confirmé, rien de coché d'office, « c'est mon compte » choisi, même entreprise",
  async () => {
    const ctx = await newCtx(browser, "fr-CH", "rsc-own");
    const from = events.length;
    const p = await ctx.newPage();
    const who = await signupFromIl(p, "fr", "rsc-own");
    const id = crmq(`select id from users where email = '${who}' and email_verified_at is null`);
    expect(id, "compte jamais confirmé");
    const org = await ilWho(ctx);
    await ctx.clearCookies();
    const { url, next } = await ilAuthorize(ctx, "locale=fr&next=%2Ffr%2Fapp%2Fquotes");
    await p.goto(url);
    await waitAt(p, `${CRM}/login?next=`, "connexion");
    const t0 = crmq("select now()");
    await p.goto(resetLinkAt(CRM, who, next));
    await p.waitForSelector('[data-testid="reset-whose"]');
    // Adresse jamais confirmée : la personne lit le compte montré et choisit (R8-SEC-2), rien d'office.
    expect((await whoseChecked(p)) === "", `coché d'office : ${await whoseChecked(p)}`);
    await p.check('[data-testid="reset-whose-mine"]');
    await p.fill("#auth-password", `${PASS}-neuf`);
    await p.locator("form button").last().click();
    await waitAt(p, `${IL}/fr/app/quotes`, "après le nouveau mot de passe");
    neutralSince(from, "rsc-own", (e) => /next=|\/oauth\/|jeton=/.test(e.url));
    expect((await ilWho(ctx)) === org, `InvoiceLead : ${await ilWho(ctx)} (avant ${org})`);
    expect(
      crmq(`select id from users where email = '${who}' and email_verified_at is not null`) === id,
      "même compte, adresse confirmée",
    );
    expect(refreshBefore(id, t0) === "0", `jetons d'avant : ${refreshBefore(id, t0)}`);
    await ctx.close();
  },
);

await step(
  "CRM-RESET-FRESH-DIRECT (CRMlead direct) : « je ne l'ai pas ouvert » sur CRMlead, compte neuf, accueil et bienvenue de CRMlead",
  async () => {
    const victim = mail("rsc-direct");
    const tmp = await browser.newContext();
    const s = await tmp.request.post(`${CRM}/api/auth/signup`, {
      data: {
        accountName: "Compte avance D",
        name: "Tiers",
        email: victim,
        password: `${PASS}-intrus`,
        locale: "fr",
      },
      headers: { origin: CRM },
    });
    await tmp.close();
    expect(s.ok(), `inscription du tiers : ${s.status()}`);
    const oldId = crmq(`select id from users where email = '${victim}'`);
    const welcome = `à ${victim} — Bienvenue sur CRMlead`;
    const before = countLog(crmLog, welcome);
    const ctx = await browser.newContext({ locale: "fr-CH" });
    const p = await ctx.newPage();
    await p.goto(resetLinkAt(CRM, victim));
    await p.waitForSelector('[data-testid="reset-whose"]');
    expect((await whoseChecked(p)) === "", `coché d'office : ${await whoseChecked(p)}`);
    expect(/CRMlead/.test(await p.title()), `titre : ${await p.title()}`);
    await p.check('[data-testid="reset-whose-fresh"]');
    await p.fill("#auth-account", "Victime D SA");
    await p.fill("#auth-name", "Victime D");
    await p.fill("#auth-password", `${PASS}-victime`);
    await p.locator("form button").last().click();
    await waitAt(p, `${CRM}/bienvenue`, "accueil du compte neuf");
    expect(/CRMlead/.test(await p.title()), `accueil : ${await p.title()}`);
    expect((await leadMe(ctx)) === victim, `session : ${await leadMe(ctx)}`);
    const fresh = crmq(
      `select (u.id <> '${oldId}')::text || '|' || a.name from users u join accounts a on a.id = u.account_id
        where u.email = '${victim}'`,
    );
    expect(fresh === "true|Victime D SA", `compte neuf : ${fresh}`);
    expect(
      crmq(
        `select is_active::text || '|' || coalesce(released_email, '') from users where id = '${oldId}'`,
      ) === `false|${victim}`,
      "compte d'avance mis de côté",
    );
    for (let t = 0; t < 40 && countLog(crmLog, welcome) === before; t++) await sleep(250);
    expect(
      countLog(crmLog, welcome) === before + 1,
      `bienvenue de CRMlead : ${countLog(crmLog, welcome) - before}`,
    );
    await ctx.close();
  },
);

await step(
  "CRM-RESET-CONFIRMED (compte confirmé, lien inventé) : aucun choix, pas de compte neuf, le lien reste valable ; lien inventé expiré d'emblée",
  async () => {
    const who = mail("rsc-conf");
    const tmp = await browser.newContext();
    const s = await tmp.request.post(`${CRM}/api/auth/signup`, {
      data: { accountName: "E2E5 confirmé", name: "Eve", email: who, password: PASS, locale: "fr" },
      headers: { origin: CRM },
    });
    await tmp.close();
    expect(s.ok(), `inscription : ${s.status()}`);
    const id = crmq(`select id from users where email = '${who}'`);
    crmq(`select auth_email_verify('${id}')`);
    const ctx = await browser.newContext({ locale: "fr-CH" });
    const p = await ctx.newPage();
    const link = resetLinkAt(CRM, who);
    await p.goto(link);
    await p.waitForSelector("#auth-password");
    await sleep(1200);
    expect((await p.locator('[data-testid="reset-whose"]').count()) === 0, "choix montré");
    const info = await ctx.request.post(`${CRM}/api/auth/reset/info`, {
      data: { token: tokenOf(link) },
      headers: { origin: CRM },
    });
    expect(
      JSON.stringify(await info.json()) === '{"unconfirmed":false}',
      "informations d'un compte confirmé",
    );
    const forced = await ctx.request.post(`${CRM}/api/auth/reset`, {
      data: {
        token: tokenOf(link),
        password: `${PASS}-x`,
        fresh: true,
        accountName: "Prise",
        name: "Prise",
      },
      headers: { origin: CRM },
    });
    const err = (await forced.json().catch(() => ({}))).error;
    expect(
      forced.status() === 409 && err === "not_unconfirmed",
      `compte neuf forcé : ${forced.status()} ${err}`,
    );
    expect(crmq(`select id from users where email = '${who}'`) === id, "compte remplacé");
    await p.fill("#auth-password", `${PASS}-neuf`);
    await p.locator("form button").last().click();
    await p.waitForURL((u) => u.href.startsWith(CRM) && !u.pathname.startsWith("/mot-de-passe"), {
      timeout: 15000,
    });
    expect((await leadMe(ctx)) === who, `lien encore valable : ${await leadMe(ctx)}`);
    const e = await ctx.newPage();
    await e.goto(`${CRM}/mot-de-passe?jeton=${randomBytes(32).toString("base64url")}`);
    await e.getByText("Ce lien a expiré ou a déjà servi").waitFor({ timeout: 8000 });
    await ctx.close();
  },
);

// ---------- lot 8, r8 ter : comptes ouverts d'avance, sessions d'avant un nouveau mot de passe, fiduciaires ----------
/** Lien « Confirmez votre adresse » de `email` sur le Compte Lead `base`, au nom de l'application `app` (jeton reposé). */
const verifyLinkOf = (base, email, app = "invoicelead") => {
  const vt = randomBytes(32).toString("base64url");
  crmq(`select 1 from auth_token_issue('verify', '${email}', '${sha(vt)}', '1 hour'::interval)`);
  return `${base}/verification?jeton=${vt}${app ? `&app=${app}&lang=fr` : ""}`;
};
/** « 2FA allumée|adresse confirmée » d'une personne du Compte Lead (id). */
const totpOf = (id) =>
  crmq(
    `select (totp_enabled_at is not null or totp_secret is not null)::text || '|' || (email_verified_at is not null)::text
       from users where id = '${id}'`,
  );
/** La session InvoiceLead de ce jeton doit revérifier son accès au Compte Lead à sa page suivante (cinq minutes passées). */
const dueForCheck = (token) =>
  ilq(
    `update sessions set last_seen_at = now() - interval '10 minutes' where id = '${sha(decodeURIComponent(token))}'`,
  );
/** Page de l'application lue avec le cookie de `ctx`, sans suivre de redirection : « statut|adresse ». */
const ilProbe = async (ctx, path) => {
  const r = await ctx.request.get(`${IL}${path}`, { maxRedirects: 0 });
  return {
    status: r.status(),
    location: r.headers().location ?? "",
    body: r.ok() ? await r.text() : "",
  };
};

await step(
  "CRM-RESET-PREOPEN-2FA : compte ouvert d'avance avec une 2FA, la personne qui prouve sa boîte entre sans code ; un compte confirmé garde la sienne",
  async () => {
    // (a) « Mot de passe oublié » depuis InvoiceLead : « c'est mon compte », nouveau mot de passe, la page demandée.
    const victim = mail("p2fa-1");
    const { intr, oldId } = await preCreate(victim, "Victime 2FA SA");
    await enable2fa(intr);
    expect(totpOf(oldId) === "true|false", `(a) 2FA du tiers : ${totpOf(oldId)}`);
    const ctx = await newCtx(browser, "fr-CH", "p2fa");
    const from = events.length;
    const p = await ctx.newPage();
    const nav = navLog(p);
    const { next } = await ilAuthorize(ctx, "locale=fr&next=%2Ffr%2Fapp%2Finvoices");
    await p.goto(resetLinkAt(CRM, victim, next));
    await p.waitForSelector('[data-testid="reset-whose"]');
    await p.check('[data-testid="reset-whose-mine"]');
    await p.fill("#auth-password", `${PASS}-victime`);
    await p.locator("form button").last().click();
    await waitAt(p, `${IL}/fr/app/invoices`, "(a) après « c'est mon compte »");
    expect(!nav.some((u) => /sso=totp/.test(u)), `(a) écran du code : ${nav.join(" → ")}`);
    neutralSince(from, "p2fa", (e) => /next=|\/oauth\/|jeton=/.test(e.url));
    expect(totpOf(oldId) === "false|true", `(a) après : ${totpOf(oldId)}`);
    expect(
      crmq(`select count(*) from totp_recovery_codes where user_id = '${oldId}'`) === "0",
      "(a) codes de secours du tiers",
    );
    expect((await ilWho(ctx)).startsWith(`${victim}|`), `(a) InvoiceLead : ${await ilWho(ctx)}`);
    // Le tiers : ni son mot de passe ni son code n'ouvrent plus rien.
    const lg = await intr.request.post(`${CRM}/api/auth/login`, {
      data: { email: victim, password: `${PASS}-intrus` },
      headers: { origin: CRM },
    });
    expect(lg.status() === 401, `(a) mot de passe du tiers : ${lg.status()}`);
    expect(!(await leadMe(intr)), "(a) session du tiers au Compte Lead encore ouverte");
    await Promise.all([ctx.close(), intr.close()]);

    // (b) Lien « Confirmez votre adresse » ouvert ailleurs : « c'est mon compte » avec un nouveau mot de passe.
    const two = mail("p2fa-2");
    const second = await preCreate(two, "Victime 2FA deux SA");
    await enable2fa(second.intr);
    const bctx = await newCtx(browser, "fr-CH", "p2fa-b");
    const fromB = events.length;
    const b = await bctx.newPage();
    const navB = navLog(b);
    await b.goto(verifyLinkOf(CRM, two));
    await b.waitForSelector('[data-testid="verify-whose"]');
    await b.check('[data-testid="verify-whose-mine"]');
    await b.locator('[data-testid="verify-forgot"]').click();
    await b.fill("#auth-password", `${PASS}-victime`);
    await b.locator("form button").last().click();
    await waitAt(b, `${IL}/fr/app`, "(b) arrivée dans InvoiceLead", 30000);
    expect(
      !navB.some((u) => /sso=totp/.test(u)) &&
        (await b.locator('[data-testid="verify-totp"]').count()) === 0,
      `(b) écran du code : ${navB.join(" → ")}`,
    );
    neutralSince(fromB, "p2fa-b");
    expect(totpOf(second.oldId) === "false|true", `(b) après : ${totpOf(second.oldId)}`);
    expect((await ilWho(bctx)).startsWith(`${two}|`), `(b) InvoiceLead : ${await ilWho(bctx)}`);
    await Promise.all([bctx.close(), second.intr.close()]);

    // (c) Contrôle : un compte à l'adresse confirmée garde sa 2FA au lien « nouveau mot de passe ».
    const conf = mail("p2fa-conf");
    const cctx = await browser.newContext({ locale: "fr-CH" });
    const s = await cctx.request.post(`${CRM}/api/auth/signup`, {
      data: {
        accountName: "E2E5 2FA confirmée",
        name: "Eve",
        email: conf,
        password: PASS,
        locale: "fr",
      },
      headers: { origin: CRM },
    });
    expect(s.ok(), `(c) inscription : ${s.status()}`);
    const confId = crmq(`select id from users where email = '${conf}'`);
    crmq(`select auth_email_verify('${confId}')`);
    await enable2fa(cctx);
    const link = resetLinkAt(CRM, conf);
    const r = await cctx.request.post(`${CRM}/api/auth/reset`, {
      data: { token: tokenOf(link), password: `${PASS}-n` },
      headers: { origin: CRM },
    });
    const out = await r.json().catch(() => ({}));
    expect(r.ok() && out.totp === true, `(c) /reset : ${r.status()} ${JSON.stringify(out)}`);
    expect(totpOf(confId) === "true|true", `(c) 2FA gardée : ${totpOf(confId)}`);
    await cctx.close();
  },
);

await step(
  "CRM-RESET-UNCONFIRMED-MINE (InvoiceLead du tiers) : « c'est mon compte » ferme la session InvoiceLead de l'auteur, aussi depuis CRMlead direct",
  async () => {
    // L'auteur ouvre le compte depuis InvoiceLead et y reste connecté.
    const victim = mail("rsc-mine");
    const { intr, oldId } = await preCreate(victim, "Victime SA");
    const authorIl = await ilToken(intr);
    expect(authorIl && !sessionGone(authorIl), "session InvoiceLead de l'auteur");
    // La personne : « Mot de passe oublié » depuis InvoiceLead, rien de coché, « c'est mon compte ».
    const ctx = await newCtx(browser, "fr-CH", "rsc-mine");
    const from = events.length;
    const p = await ctx.newPage();
    const { next } = await ilAuthorize(ctx, "locale=fr&next=%2Ffr%2Fapp%2Fcontacts");
    await p.goto(resetLinkAt(CRM, victim, next));
    await p.waitForSelector('[data-testid="reset-whose"]');
    expect((await whoseChecked(p)) === "", `coché d'office : ${await whoseChecked(p)}`);
    await p.check('[data-testid="reset-whose-mine"]');
    await p.fill("#auth-password", `${PASS}-victime`);
    await p.locator("form button").last().click();
    await waitAt(p, `${IL}/fr/app/contacts`, "après « c'est mon compte »");
    neutralSince(from, "rsc-mine", (e) => /next=|\/oauth\/|jeton=/.test(e.url));
    expect(
      crmq(`select id from users where email = '${victim}' and email_verified_at is not null`) ===
        oldId,
      "même compte, adresse confirmée",
    );
    // Sa session ouverte, celle de l'auteur fermée tout de suite (date du nouveau mot de passe, `cred_at`).
    expect(sessionGone(authorIl), "session InvoiceLead de l'auteur encore là");
    const secret = `Client secret ${stamp}`;
    await p.goto(`${IL}/fr/app/contacts/new`);
    await p.fill("#contact-name", secret);
    await p.locator('[data-testid="contact-save"]').click();
    await waitAt(p, `${IL}/fr/app/contacts?saved=1`, "contact enregistré");
    const seen = await ilProbe(intr, "/fr/app/contacts");
    expect(
      seen.status !== 200 && !seen.body.includes(secret),
      `l'auteur lit encore : ${seen.status} ${seen.location}`,
    );
    // Sa page suivante le renvoie à l'écran du Compte Lead, où il n'a plus de session : le mot de passe.
    const ap = await intr.newPage();
    await ap.goto(`${IL}/fr/app/contacts`);
    await waitAt(ap, `${CRM}/login?next=`, "l'auteur repasse par la connexion");
    await ap.waitForSelector("#auth-password");
    // Contrôle : la session de la personne, revérifiée au Compte Lead après cinq minutes, tient.
    const mine = await ilToken(ctx);
    dueForCheck(mine);
    const kept = await ilProbe(ctx, "/fr/app/contacts");
    expect(
      kept.status === 200 && kept.body.includes(secret) && !sessionGone(mine),
      `session de la personne : ${kept.status} ${kept.location}`,
    );
    await Promise.all([ctx.close(), intr.close()]);

    // Nouveau mot de passe pris sur CRMlead direct (aucun retour par InvoiceLead) : la session de l'auteur tombe à sa
    // vérification suivante au Compte Lead, qui a révoqué ses jetons.
    const two = mail("rsc-mine2");
    const second = await preCreate(two, "Victime deux SA");
    const authorIl2 = await ilToken(second.intr);
    const d = await browser.newContext({ locale: "fr-CH" });
    const dp = await d.newPage();
    await dp.goto(resetLinkAt(CRM, two));
    await dp.waitForSelector('[data-testid="reset-whose"]');
    await dp.check('[data-testid="reset-whose-mine"]');
    await dp.fill("#auth-password", `${PASS}-victime`);
    await dp.locator("form button").last().click();
    await dp.waitForURL((u) => u.href.startsWith(CRM) && !u.pathname.startsWith("/mot-de-passe"), {
      timeout: 15000,
    });
    expect((await leadMe(d)) === two, `CRMlead direct : session ${await leadMe(d)}`);
    expect(
      !sessionGone(authorIl2),
      "CRMlead direct : session de l'auteur fermée sans vérification",
    );
    dueForCheck(authorIl2);
    const after = await ilProbe(second.intr, "/fr/app/contacts");
    expect(
      after.status !== 200 && sessionGone(authorIl2),
      `CRMlead direct : session de l'auteur ${after.status} ${after.location}`,
    );
    await Promise.all([d.close(), second.intr.close()]);
  },
);

await step(
  "IL-FIDU-RECORD : fiche d'un client (contact, facture fournisseur) ouverte depuis une autre entreprise, lien du récapitulatif",
  async () => {
    const client = ownerOrg();
    const clientId = ilq(
      `select m.organization_id from memberships m join users u on u.id = m.user_id
        where u.email = '${OWNER}' and m.role <> 'fiduciary' limit 1`,
    );
    const name = `Fournisseur du client ${stamp}`;
    const contactId = ilq(
      `insert into contacts (organization_id, name, is_supplier) values ('${clientId}', '${name}', true) returning id`,
    ).split("\n")[0];
    const billId = ilq(
      `insert into supplier_bills (organization_id, supplier_name, issue_date, due_date, total_cents)
       values ('${clientId}', '${name}', '2026-09-01', '2026-09-30', 12000) returning id`,
    ).split("\n")[0];
    const ctx = await newCtx(browser, "fr-CH", "fidrec");
    const p = await ctx.newPage();
    const email = await signupFromIl(p, "fr", "fidrec");
    const own = ownOrgOf(email);
    const ownId = ilq(
      `select m.organization_id from memberships m join users u on u.id = m.user_id
        where u.email = '${email}' and m.role <> 'fiduciary' limit 1`,
    );
    const from = events.length;
    const token = fiduciaryInvite(OWNER, email);
    await p.goto(`${IL}/fr/invite?token=${token}`);
    await p.locator('[data-testid="invite-accept"]').click();
    await waitAt(p, `${IL}/fr/app/accounting?welcome=fiduciary`, "acceptation");
    /** Session vivante replacée dans l'entreprise `org` (comme le sélecteur), dernière entreprise comprise. */
    const sessionIn = async (org) => {
      ilq(
        `update sessions set organization_id = '${org}' where id = '${sha(decodeURIComponent(await ilToken(ctx)))}'`,
      );
      ilq(`update users set last_organization_id = '${org}' where email = '${email}'`);
    };
    const elsewhere = p.locator('[data-testid="record-elsewhere"]');
    // Session vivante chez elle : la fiche du client propose d'y passer (rien de la fiche avant), puis la même fiche.
    const card = `${IL}/fr/app/contacts/${contactId}`;
    const bill = `${IL}/fr/app/accounting/bills/${billId}`;
    for (const [label, url, field] of [
      ["contact", card, "#contact-name"],
      ["facture fournisseur", bill, "#bill-supplier"],
    ]) {
      await sessionIn(ownId);
      await p.goto(url);
      await elsewhere.waitFor({ timeout: 10000 });
      expect((await p.locator(field).count()) === 0, `${label} : fiche montrée avant le passage`);
      expect((await elsewhere.innerText()).includes(client), `${label} : entreprise pas nommée`);
      await p.locator('[data-testid="record-elsewhere-switch"]').click();
      await p.locator(field).waitFor({ timeout: 15000 });
      expect(p.url() === url, `${label} : ${p.url()}`);
      expect((await p.inputValue(field)) === name, `${label} : ${await p.inputValue(field)}`);
      expect((await orgName(p)) === client, `${label} : entreprise ${await orgName(p)}`);
    }
    // Session échue, dernière entreprise la sienne : la fiche du client s'ouvre tout de suite chez le client.
    for (const [label, url, field] of [
      ["contact", card, "#contact-name"],
      ["facture fournisseur", bill, "#bill-supplier"],
    ]) {
      await sessionIn(ownId);
      await dropCookies(ctx, (n) => n === "il_session");
      await p.goto(url);
      await waitAt(p, url, `${label}, session échue : retour sur la fiche`);
      expect(
        (await p
          .locator(field)
          .inputValue({ timeout: 10000 })
          .catch(() => "")) === name,
        `${label}, session échue : ${p.url()} « ${await p.title()} »`,
      );
      expect((await orgName(p)) === client, `${label}, session échue : ${await orgName(p)}`);
    }
    // La fiche d'une entreprise où elle n'est rien : introuvable, rien n'en est dit.
    const strangerId = ilq(
      `insert into contacts (organization_id, name, is_supplier)
       select o.id, 'Fiche étrangère ${stamp}', true from organizations o
        where not exists (select 1 from memberships m join users u on u.id = m.user_id
                           where m.organization_id = o.id and u.email = '${email}')
        limit 1 returning id`,
    ).split("\n")[0];
    const stranger = await p.goto(`${IL}/fr/app/contacts/${strangerId}`);
    expect(
      (stranger?.status() === 404 || /introuvable/i.test(await p.title())) &&
        (await elsewhere.count()) === 0,
      `fiche étrangère : ${stranger?.status()} ${await p.title()}`,
    );
    expect(
      !(await p.locator("body").innerText()).includes(`Fiche étrangère ${stamp}`),
      "fiche étrangère : nom montré",
    );
    // Lien du récapitulatif du lundi de son entreprise, dernière entreprise le client : la file de SON entreprise.
    const digest = `${IL}/fr/app/accounting/review?org=${ownId}`;
    await sessionIn(clientId);
    await p.goto(digest);
    await elsewhere.waitFor({ timeout: 10000 });
    expect((await elsewhere.innerText()).includes(own), "récapitulatif : entreprise pas nommée");
    await p.locator('[data-testid="record-elsewhere-switch"]').click();
    await p.waitForURL((u) => u.href === digest, { timeout: 15000 }).catch(() => {});
    await elsewhere.waitFor({ state: "detached", timeout: 15000 });
    expect((await orgName(p)) === own, `récapitulatif : entreprise ${await orgName(p)}`);
    await sessionIn(clientId);
    await dropCookies(ctx, (n) => n === "il_session");
    await p.goto(digest);
    await waitAt(p, digest, "récapitulatif, session échue");
    await p.locator('[data-testid="org-name"]').first().waitFor({ timeout: 10000 });
    expect((await elsewhere.count()) === 0, "récapitulatif, session échue : écran de passage");
    expect((await orgName(p)) === own, `récapitulatif, session échue : ${await orgName(p)}`);
    neutralSince(from, "fidrec");
    await ctx.close();
  },
);

await step(
  "IL-FIDU-FREE-CLIENT : session chez un client revenu en gratuit, ses propres liens mènent chez elle ; l'écran « accès suspendu » garde la page",
  async () => {
    // Un client à part (le propriétaire commun reste en Pro+ pour les autres étapes), en Pro+ puis en gratuit.
    const octx = await browser.newContext({ locale: "fr-CH" });
    const op = await octx.newPage();
    const owner = await signupFromIl(op, "fr", "frc-owner");
    crmq(
      `insert into lead_subscriptions (account_id, source_app, external_id, app_plan, plan_code, status)
       select account_id, 'scanlead', 'e2e5-frc-${stamp}', 'pro_plus', 'pro_plus', 'active' from users
        where email = '${owner}' on conflict do nothing`,
    );
    await dropCookies(octx, (n) => n === "il_session");
    await op.goto(`${IL}/fr/app`);
    await waitAt(op, `${IL}/fr/app`, "client relu en Pro+");
    const clientId = ilq(
      `select m.organization_id from memberships m join users u on u.id = m.user_id
        where u.email = '${owner}' and m.role <> 'fiduciary' limit 1`,
    );
    const client = ownOrgOf(owner);
    const clientCard = ilq(
      `insert into contacts (organization_id, name, is_supplier) values ('${clientId}', 'Fiche du client ${stamp}', true) returning id`,
    ).split("\n")[0];
    // La fiduciaire : son devis tiré de son CRMlead, chez elle, puis l'invitation du client acceptée.
    const ctx = await newCtx(browser, "fr-CH", "frc");
    const p = await ctx.newPage();
    const email = await signupFromIl(p, "fr", "frc-fidu");
    const own = ownOrgOf(email);
    const link = handoffLink("frc");
    await p.goto(`${IL}${link}`);
    await p.locator('[data-testid="crm-import-confirm"]').click();
    await p.waitForURL(/\/fr\/app\/quotes\/[0-9a-f-]{36}\?from=crmlead/, { timeout: 20000 });
    const quote = p.url().split("?")[0];
    const from = events.length;
    const token = fiduciaryInvite(owner, email);
    await p.goto(`${IL}/fr/invite?token=${token}`);
    await p.locator('[data-testid="invite-accept"]').click();
    await waitAt(p, `${IL}/fr/app/accounting?welcome=fiduciary`, "acceptation");
    expect((await orgName(p)) === client, `après l'acceptation : ${await orgName(p)}`);
    // Pendant sa session, le client repasse en formule gratuite (relue au Compte Lead à la page suivante).
    crmq(`delete from lead_subscriptions where external_id = 'e2e5-frc-${stamp}'`);
    ilq(
      `update organizations set entitlements_at = now() - interval '13 hours' where id = '${clientId}'`,
    );
    const ownId = ilq(
      `select m.organization_id from memberships m join users u on u.id = m.user_id
        where u.email = '${email}' and m.role <> 'fiduciary' limit 1`,
    );
    /** Session vivante replacée dans l'entreprise `org` (comme le sélecteur), dernière entreprise comprise. */
    const sessionIn = async (org) => {
      ilq(
        `update sessions set organization_id = '${org}' where id = '${sha(decodeURIComponent(await ilToken(ctx)))}'`,
      );
      ilq(`update users set last_organization_id = '${org}' where email = '${email}'`);
    };
    const backToClient = () => sessionIn(clientId);
    const nav = navLog(p);
    // Son propre devis (« Ouvrir dans InvoiceLead » de son CRMlead) : la pièce, chez elle, sans écran « accès suspendu ».
    await p.goto(quote);
    await p.locator('[data-testid="document-status"]').waitFor({ timeout: 15000 });
    expect(p.url() === quote, `devis : ${p.url()}`);
    expect((await orgName(p)) === own, `devis : entreprise ${await orgName(p)}`);
    expect(
      ilq(
        `select coalesce(o.entitlements #>> '{plan,rank}', '?') from organizations o where o.id = '${clientId}'`,
      ) === "0",
      "client pas relu en gratuit",
    );
    // Un nouveau lien d'import de son CRMlead : l'import, chez elle.
    await backToClient();
    await p.goto(`${IL}${link}`);
    await p.locator('[data-testid="crm-import"]').waitFor({ timeout: 15000 });
    expect(p.url() === `${IL}${link}`, `import : ${p.url().slice(0, 90)}`);
    expect((await orgName(p)) === own, `import : entreprise ${await orgName(p)}`);
    expect(
      await p.locator('[data-testid="crm-import-confirm"]').isEnabled(),
      "import : bouton désactivé",
    );
    expect(!nav.some((u) => /no-access/.test(u)), `écran « accès suspendu » : ${nav.join(" → ")}`);
    // Une page qui ne désigne rien : l'écran « accès suspendu », qui garde la page ; le sélecteur y ramène.
    await backToClient();
    await p.goto(`${IL}/fr/app/contacts?q=x`);
    await waitAt(p, `${IL}/fr/no-access?`, "page du client : accès suspendu");
    const na = new URL(p.url());
    expect(
      na.searchParams.get("reason") === "fiduciary" &&
        na.searchParams.get("next") === "/fr/app/contacts?q=x",
      `accès suspendu : ${p.url()}`,
    );
    // Le sélecteur est un menu déroulant : la personne l'ouvre, puis choisit son entreprise.
    await p.locator('[data-testid="no-access"] [data-testid="org-switcher"] summary').click();
    await p.locator("form button", { hasText: own }).click();
    await waitAt(p, `${IL}/fr/app/contacts?q=x`, "sélecteur : retour sur la page");
    expect((await orgName(p)) === own, `sélecteur : entreprise ${await orgName(p)}`);
    // Une adresse étrangère dans `next` n'est jamais gardée.
    await backToClient();
    await p.goto(
      `${IL}/fr/no-access?reason=fiduciary&next=${encodeURIComponent("https://evil.test/fr/app")}`,
    );
    await p.locator('[data-testid="no-access"]').waitFor({ timeout: 10000 });
    expect(
      (await p.locator("form button", { hasText: own }).count()) === 1 &&
        (await p.locator('input[name="next"]').count()) === 0,
      "accès suspendu : adresse étrangère gardée",
    );
    // Chez elle, la fiche du client suspendu dit pourquoi, sans passage.
    await sessionIn(ownId);
    await p.goto(`${IL}/fr/app/contacts/${clientCard}`);
    await p
      .locator('[data-testid="record-elsewhere"][data-suspended="true"]')
      .waitFor({ timeout: 10000 });
    expect(
      (await p.locator('[data-testid="record-elsewhere-switch"]').count()) === 0,
      "client suspendu : passage proposé",
    );
    // Contrôle : session échue, dernière entreprise le client, même lien d'import : chez elle.
    await backToClient();
    await dropCookies(ctx, (n) => n === "il_session");
    await p.goto(`${IL}${link}`);
    await waitAt(p, `${IL}/fr/app/import/crmlead?d=`, "session échue : import");
    expect((await orgName(p)) === own, `session échue : entreprise ${await orgName(p)}`);
    neutralSince(from, "frc");
    await Promise.all([ctx.close(), octx.close()]);
  },
);

await step(
  "CRM-FORGOT-PENDING-INVITE : collègue invité depuis InvoiceLead sans son email, « Mot de passe oublié » renvoie l'invitation",
  async () => {
    const actx = await browser.newContext({ locale: "fr-CH" });
    const ap = await actx.newPage();
    const manager = await signupFromIl(ap, "fr", "fpi-mgr");
    crmq(
      `insert into lead_subscriptions (account_id, source_app, external_id, app_plan, plan_code, status)
       select account_id, 'scanlead', 'e2e5-fpi-${stamp}', 'pro_plus', 'pro_plus', 'active' from users
        where email = '${manager}' on conflict do nothing`,
    );
    await dropCookies(actx, (n) => n === "il_session");
    await ap.goto(`${IL}/fr/app/settings/team`);
    await waitAt(ap, `${IL}/fr/app/settings/team`, "équipe");
    const colleague = mail("fpi-coll");
    const form = ap.locator('[data-testid="member-invite"]');
    await form.locator('input[name="name"]').fill("Collègue perdue");
    await form.locator('input[name="email"]').fill(colleague);
    await form.locator('[data-testid="member-invite-submit"]').click();
    const to = new RegExp(`à ${colleague.replace(/[+.]/g, "\\$&")} — `);
    expect(await waitLog(crmLog, to), "invitation de départ");
    const sent = () =>
      crmLog()
        .split("\n")
        .filter((l) => to.test(l));
    const firstToken = `jeton-fpi-1-${stamp}`;
    const setLatest = (value) =>
      crmq(
        `update auth_tokens set token_hash = '${sha(value)}' where id = (select id from auth_tokens
          where user_id = (select id from users where email = '${colleague}') and purpose = 'invite'
          order by created_at desc limit 1)`,
      );
    setLatest(firstToken);
    // La collègue a perdu l'email : InvoiceLead, connexion refusée, « Mot de passe oublié ? ».
    const ctx = await newCtx(browser, "fr-CH", "fpi");
    const from = events.length;
    const p = await ctx.newPage();
    await p.goto(`${IL}/fr/app/invoices`);
    await waitAt(p, `${CRM}/login?next=`, "écran du Compte Lead");
    await p.getByRole("link", { name: /Mot de passe oublié/ }).click();
    await waitAt(p, `${CRM}/mot-de-passe?next=`, "mot de passe oublié");
    await p.getByRole("heading", { name: /Mot de passe oublié/ }).waitFor();
    const before = sent().length;
    await p.fill("#auth-email", colleague);
    await p.locator("form button").last().click();
    await p.getByText(/le lien vient de partir/).waitFor({ timeout: 10000 });
    for (let t = 0; t < 40 && sent().length === before; t++) await sleep(250);
    const again = sent().slice(before);
    expect(
      again.length === 1 && /InvoiceLead/.test(again[0]) && !/CRMlead/.test(again[0]),
      `invitation renvoyée : ${again.join(" / ") || "rien"}`,
    );
    // Le nouveau lien la fait entrer dans InvoiceLead ; l'ancien ne vaut plus.
    const fresh = `jeton-fpi-2-${stamp}`;
    setLatest(fresh);
    const old = await ctx.newPage();
    await old.goto(`${CRM}/invitation?jeton=${firstToken}&app=invoicelead&lang=fr`);
    await old.getByText(/Cette invitation a expiré ou a déjà servi/).waitFor({ timeout: 10000 });
    await old.close();
    await p.goto(`${CRM}/invitation?jeton=${fresh}&app=invoicelead&lang=fr`);
    await p.fill("#auth-password", PASS);
    await p.locator("form button").last().click();
    await waitAt(p, `${IL}/fr/app`, "arrivée de la collègue");
    neutralSince(from, "fpi");
    expect((await ilWho(ctx)).startsWith(`${colleague}|`), `InvoiceLead : ${await ilWho(ctx)}`);
    await ctx.close();
    // Contrôle 1 : une invitation faite dans CRMlead est relancée au nom de CRMlead.
    const direct = mail("fpi-crm");
    const di = await actx.request.post(`${CRM}/api/users`, {
      data: { email: direct, name: "Direct" },
      headers: { origin: CRM },
    });
    expect(di.status() === 201, `invitation CRMlead : ${di.status()}`);
    const dTo = new RegExp(`à ${direct.replace(/[+.]/g, "\\$&")} — `);
    expect(await waitLog(crmLog, dTo), "invitation CRMlead de départ");
    const dCount = () =>
      crmLog()
        .split("\n")
        .filter((l) => dTo.test(l));
    const dBefore = dCount().length;
    await actx.request.post(`${CRM}/api/auth/forgot`, {
      data: { email: direct },
      headers: { origin: CRM },
    });
    for (let t = 0; t < 40 && dCount().length === dBefore; t++) await sleep(250);
    const dAgain = dCount().slice(dBefore);
    expect(
      dAgain.length === 1 && /CRMlead/.test(dAgain[0]),
      `relance CRMlead : ${dAgain.join(" / ") || "rien"}`,
    );
    // Contrôle 2 : un membre désactivé (il avait un mot de passe) ne reçoit toujours rien.
    crmq(`update users set is_active = false where email = '${colleague}'`);
    const cBefore = sent().length;
    await actx.request.post(`${CRM}/api/auth/forgot`, {
      data: { email: colleague },
      headers: { origin: CRM },
    });
    await sleep(2500);
    expect(sent().length === cBefore, `membre désactivé : ${sent().slice(cBefore).join(" / ")}`);
    await actx.close();
  },
);

await step(
  "CRM-APP-LANG-HOLDS : session du Compte Lead ouverte en français, l'écran demandé en allemand ou en anglais ne bascule pas",
  async () => {
    const ctx = await newCtx(browser, "fr-CH", "lang");
    const p = await ctx.newPage();
    const who = await signupFromIl(p, "fr", "lang");
    // Vieil écran de connexion rechargé, demande en allemand : « Lead-Konto » jusqu'au départ vers /de/app. La session
    // InvoiceLead retirée, celle du Compte Lead reste ouverte (en français).
    await dropCookies(ctx, (n) => n === "il_session");
    const { next } = await ilAuthorize(ctx, "locale=de&next=%2Fde%2Fapp%2Finvoices");
    const from = events.length;
    await p.goto(`${CRM}/login?next=${encodeURIComponent(next)}`);
    await waitAt(p, `${IL}/de/app/invoices`, "départ vers InvoiceLead en allemand");
    const seen = events.slice(from).filter((e) => e.tag === "lang" && e.title);
    expect(
      seen.length > 0 && seen.every((e) => e.title === "Lead-Konto"),
      `titres : ${[...new Set(seen.map((e) => e.title))].join(", ")}`,
    );
    // Lien « nouveau mot de passe » arrivé en anglais : « Lead account » reste, formulaire compris.
    await dropCookies(ctx, (n) => n === "il_session");
    const { next: en } = await ilAuthorize(ctx, "locale=en&next=%2Fen%2Fapp");
    const from2 = events.length;
    const q = await ctx.newPage();
    await q.goto(resetLinkAt(CRM, who, en));
    await q.waitForSelector("#auth-password");
    await sleep(2000);
    const seen2 = events.slice(from2).filter((e) => e.tag === "lang" && e.title);
    expect(
      (await q.title()) === "Lead account" && seen2.every((e) => e.title === "Lead account"),
      `titres : ${[...new Set(seen2.map((e) => e.title))].join(", ")}`,
    );
    expect(
      (await q.locator("html").getAttribute("lang")) === "en",
      `lang : ${await q.locator("html").getAttribute("lang")}`,
    );
    await ctx.close();
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
  const preh = {
    victim: mail("g-preh"),
    pass: `${PASS}-intrus`,
    intr: null,
    next: "",
    oldId: "",
    intrIl: "",
  };
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
      // Le compte d'avance et les jetons qu'InvoiceLead a reçus pour son auteur (trente jours).
      preh.oldId = crmq(`select id from users where email = '${victim}'`);
      preh.intrIl = await ilToken(preh.intr);
      expect(
        Number(liveRefresh(preh.oldId)) > 0,
        `jetons d'InvoiceLead du tiers : ${liveRefresh(preh.oldId)}`,
      );
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
      // Le lien reçu (lot 8, r8) : l'écran montre le compte d'avance (entreprise, nom de son auteur), rien de coché
      // d'office (le compte neuf ferme l'autre : coché d'office, il fermait le sien à la vraie titulaire qui validait
      // sans lire). La personne coche « je ne l'ai pas ouvert » : l'entreprise tapée et le nom donné par Google sont
      // repris. Elle choisit son mot de passe et arrive sur la page demandée, dans un compte neuf.
      await p.goto(resetLinkAt(CRM_G, victim, next));
      await p.waitForSelector('[data-testid="reset-whose"]');
      const shown = (await p.locator('[data-testid="reset-whose"]').innerText()).replace(
        /\s+/g,
        " ",
      );
      expect(
        /Compte prepare/.test(shown) && /Tiers/.test(shown),
        `compte d'avance montré : ${shown.slice(0, 240)}`,
      );
      expect((await whoseChecked(p)) === "", `coché d'office : ${await whoseChecked(p)}`);
      await p.check('[data-testid="reset-whose-fresh"]');
      const typed = `${await p.inputValue("#auth-account")}|${await p.inputValue("#auth-name")}`;
      expect(typed === "Victime SA|E2E5", `entreprise et nom repris : ${typed}`);
      expect((await p.title()) === "Compte Lead", `titre du lien : ${await p.title()}`);
      await p.fill("#auth-password", `${PASS}-victime`);
      await p.locator("form button").last().click();
      await waitAt(p, `${IL}/fr/app/invoices`, "après le nouveau mot de passe");
      neutralSince(from, "preh", (e) => /next=|\/oauth\//.test(e.url));
      // Compte neuf (autre identifiant, organisation « Victime SA », adresse confirmée), sans emails de CRMlead.
      const fresh = crmq(
        `select (u.id <> '${preh.oldId}')::text || '|' || a.name || '|' || (u.email_verified_at is not null)::text
           from users u join accounts a on a.id = u.account_id where u.email = '${victim}'`,
      );
      expect(fresh === "true|Victime SA|true", `compte neuf : ${fresh}`);
      expect(quietOf(victim) === "off|false", `réglages de CRMlead : ${quietOf(victim)}`);
      expect(
        !gLog().includes(`à ${victim} — Bienvenue sur CRMlead`),
        "bienvenue de CRMlead envoyée",
      );
      expect(
        (await ilWho(ctx)) === `${victim}|Victime SA`,
        `InvoiceLead de la personne : ${await ilWho(ctx)}`,
      );
      // Le compte d'avance : désactivé, adresse libérée (gardée), sessions et jetons d'InvoiceLead révoqués.
      const old = crmq(
        `select is_active::text || '|' || (email like 'released+%@invalid')::text || '|' || coalesce(released_email, '')
                || '|' || (released_to is not null)::text from users where id = '${preh.oldId}'`,
      );
      expect(old === `false|true|${victim}|true`, `compte d'avance : ${old}`);
      expect(
        liveRefresh(preh.oldId) === "0" && liveSessions(preh.oldId) === "0",
        `accès du tiers encore ouverts : jetons ${liveRefresh(preh.oldId)}, sessions ${liveSessions(preh.oldId)}`,
      );
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
      expect(
        (await ilWho(ctx)) === `${victim}|Victime SA`,
        `InvoiceLead après Google : ${await ilWho(ctx)}`,
      );
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
      const mine = await ilWho(ctx);
      await ctx.close();
      // Le contact est dans l'entreprise neuve de la personne, pas dans celle que le tiers a préparée.
      const [cid, corg] = ilq(
        `select c.id || '|' || o.name from contacts c join organizations o on o.id = c.organization_id
          where c.name = '${secret}'`,
      ).split("|");
      expect(
        corg === "Victime SA" && mine === `${preh.victim}|Victime SA`,
        `contact dans ${corg}, personne ${mine}`,
      );
      // La session InvoiceLead que le tiers avait ouverte avant (douze heures) : son entreprise préparée, vide de
      // tout ce que la personne saisit, ni la liste ni la fiche du contact.
      const tok = (await preh.intr.cookies()).find((c) => c.name === "il_session")?.value ?? "";
      expect(tok === preh.intrIl, "session InvoiceLead du tiers changée en route");
      const who = tok
        ? ilq(
            `select u.lead_sub || '|' || o.name from sessions s join users u on u.id = s.user_id
               join organizations o on o.id = s.organization_id
              where s.id = '${sha(decodeURIComponent(tok))}' and s.expires_at > now()`,
          )
        : "";
      const victimSub = crmq(
        `select coalesce(sso_subject, '') || '|' || id from users where email = '${preh.victim}'`,
      );
      const list = await preh.intr.request.get(`${IL}/fr/app/contacts`, { maxRedirects: 0 });
      const card = await preh.intr.request.get(`${IL}/fr/app/contacts/${cid}`, { maxRedirects: 0 });
      const listBody = list.status() === 200 ? await list.text() : "";
      const cardBody = card.status() === 200 ? await card.text() : "";
      await preh.intr.close();
      expect(
        !listBody.includes(secret) && !cardBody.includes(secret),
        `la session InvoiceLead du tiers (${who}) montre « ${secret} » (liste ${list.status()}, fiche ${card.status()})`,
      );
      expect(
        !who.endsWith("|Victime SA") && !who.startsWith(victimSub.split("|")[1]),
        `session InvoiceLead du tiers dans l'entreprise ou au nom de la personne : ${who}`,
      );
    },
  );

  await step(
    "CRM-RESET-UNCONFIRMED-CHOICE (connexion Google) : rien de coché, le serveur exige le choix, « je ne l'ai pas ouvert » mène à la page demandée dans un compte neuf",
    async () => {
      const victim = mail("rsc-glogin");
      const { intr, oldId } = await preCreate(victim, "Compte avance B", CRM_G);
      const intrIl = await ilToken(intr);
      const ctx = await newCtx(browser, "fr-CH", "rsc-glogin");
      const from = events.length;
      const p = await ctx.newPage();
      const { url, next } = await ilAuthorize(ctx, "locale=fr&next=%2Ffr%2Fapp%2Fquotes", CRM_G);
      await p.goto(url);
      await waitAt(p, `${CRM_G}/login?next=`, "connexion");
      await google(p, victim);
      await p.click("#ok");
      await waitAt(p, `${CRM_G}/login?sso=unconfirmed`, "retour de Google");
      const note = crmq(
        `select coalesce(unconfirmed_claim ->> 'mode', '') from users where id = '${oldId}'`,
      );
      expect(note === "login", `note de Google : ${note}`);
      const link = resetLinkAt(CRM_G, victim, next);
      await p.goto(link);
      await p.waitForSelector('[data-testid="reset-whose"]');
      expect((await whoseChecked(p)) === "", `coché d'office : ${await whoseChecked(p)}`);
      await p.fill("#auth-password", `${PASS}-victime`);
      await p.locator("form button").last().click();
      await p.getByText("Indiquez d'abord si ce compte est le vôtre.").waitFor({ timeout: 5000 });
      const raw = await ctx.request.post(
        `${CRM_G}/api/auth/reset`,
        gq({ token: tokenOf(link), password: `${PASS}-victime` }),
      );
      const rawErr = (await raw.json().catch(() => ({}))).error;
      expect(
        raw.status() === 409 && rawErr === "choice_required",
        `envoi sans choix : ${raw.status()} ${rawErr}`,
      );
      await p.check('[data-testid="reset-whose-fresh"]');
      await p.fill("#auth-account", "Victime B SA");
      await p.fill("#auth-name", "Victime B");
      await p.locator("form button").last().click();
      await waitAt(p, `${IL}/fr/app/quotes`, "après « je ne l'ai pas ouvert »");
      neutralSince(from, "rsc-glogin", (e) => /next=|\/oauth\/|jeton=/.test(e.url));
      expect((await ilWho(ctx)) === `${victim}|Victime B SA`, `InvoiceLead : ${await ilWho(ctx)}`);
      expect(quietOf(victim) === "off|false", `réglages de CRMlead : ${quietOf(victim)}`);
      expect(
        crmq(`select is_active::text from users where id = '${oldId}'`) === "false" &&
          liveRefresh(oldId) === "0",
        `compte d'avance : ${crmq(`select is_active::text from users where id = '${oldId}'`)} jetons ${liveRefresh(oldId)}`,
      );
      // Ce que la personne saisit n'apparaît pas dans la session InvoiceLead du tiers.
      const secret = `Client B ${stamp}`;
      const c = await ctx.newPage();
      await c.goto(`${IL}/fr/app/contacts/new`);
      await c.fill("#contact-name", secret);
      await c.locator('[data-testid="contact-save"]').click();
      await waitAt(c, `${IL}/fr/app/contacts?saved=1`, "contact enregistré");
      expect((await ilToken(intr)) === intrIl, "session InvoiceLead du tiers changée");
      const seen = await intr.request.get(`${IL}/fr/app/contacts`, { maxRedirects: 0 });
      const body = seen.status() === 200 ? await seen.text() : "";
      expect(!body.includes(secret), `le tiers voit « ${secret} » (${seen.status()})`);
      await Promise.all([ctx.close(), intr.close()]);
    },
  );

  await step(
    "CRM-UNCONFIRMED-VERIFY-LINK : la personne ouvre d'abord le lien « Confirmez votre adresse » du compte ouvert d'avance, puis Google ; l'auteur ne lit rien de ce qu'elle saisit",
    async () => {
      const victim = mail("g-verif");
      const { intr, oldId } = await preCreate(victim, "Compte avance V", CRM_G);
      const intrIl = await ilToken(intr);
      // Le lien de l'email « Confirmez votre adresse » parti à l'inscription du tiers (jeton reposé ici : l'email
      // simulé n'en garde que l'objet).
      expect(
        await waitLog(
          gLog,
          new RegExp(`à ${victim.replace(/[+.]/g, "\\$&")} — Confirmez votre adresse email`),
        ),
        "email de confirmation à l'adresse de la personne",
      );
      const ctx = await newCtx(browser, "fr-CH", "g-verif");
      const from = events.length;
      const v = await ctx.newPage();
      const vt = randomBytes(32).toString("base64url");
      crmq(
        `select 1 from auth_token_issue('verify', '${victim}', '${sha(vt)}', '1 hour'::interval)`,
      );
      await v.goto(`${CRM_G}/verification?jeton=${vt}&app=invoicelead&lang=fr`);
      // Lot 8, r8 bis (113, section 8) : ouvert hors du navigateur de l'auteur, le lien ne confirme plus rien d'un coup.
      // L'écran montre le compte d'avance (adresse, entreprise, auteur), rien de coché, au nom du Compte Lead.
      await v.waitForSelector('[data-testid="verify-whose"]', { timeout: 10000 });
      const said = (await v.locator("body").innerText()).replace(/\s+/g, " ");
      const shown = (await v.locator('[data-testid="verify-whose"]').innerText()).replace(
        /\s+/g,
        " ",
      );
      expect(
        /Compte avance V/.test(shown) && /Tiers/.test(shown) && shown.includes(victim),
        `compte d'avance montré : ${shown.slice(0, 240)}`,
      );
      const ticked = `${await v.isChecked('[data-testid="verify-whose-mine"]')}|${await v.isChecked('[data-testid="verify-whose-fresh"]')}`;
      expect(ticked === "false|false", `coché d'office : ${ticked}`);
      expect(
        !/Votre adresse est confirmée/.test(said),
        `confirmé d'un coup : ${said.slice(0, 160)}`,
      );
      expect((await v.title()) === "Compte Lead", `titre du lien : ${await v.title()}`);
      const stateOf = () =>
        crmq(
          `select is_active::text || '|' || (email_verified_at is not null)::text || '|' || coalesce(sso_subject, '')
             from users where id = '${oldId}'`,
        );
      expect(stateOf() === "true|false|", `compte d'avance après le lien : ${stateOf()}`);
      // Elle ne choisit rien et part : InvoiceLead, « Créer un compte », « Victime V SA », Google à son adresse.
      await ctx.clearCookies();
      const p = await ctx.newPage();
      const { url, next } = await ilAuthorize(
        ctx,
        "locale=fr&signup=1&next=%2Ffr%2Fapp%2Fcontacts%2Fnew",
        CRM_G,
      );
      await p.goto(url);
      await waitAt(p, `${CRM_G}/signup?next=`, "inscription");
      await p.fill("#auth-account", "Victime V SA");
      await google(p, victim);
      await p.click("#ok");
      // Google ne se rattache pas au compte d'avance (adresse jamais confirmée par qui que ce soit) : pas d'entrée
      // dans l'entreprise de l'auteur, mais le lien « nouveau mot de passe », la demande gardée.
      await waitAt(p, `${CRM_G}/login?sso=unconfirmed`, "retour de Google");
      expect(
        sameRequest(new URL(p.url()).searchParams.get("next"), next),
        `demande perdue : ${p.url()}`,
      );
      expect(!(await ilToken(ctx)), "session InvoiceLead ouverte au retour de Google");
      expect(stateOf() === "true|false|", `Google rattaché ou adresse confirmée : ${stateOf()}`);
      // Le lien reçu : rien de coché d'office (r8) ; elle coche « je ne l'ai pas ouvert », l'entreprise tapée est reprise.
      await p.goto(resetLinkAt(CRM_G, victim, next));
      await p.waitForSelector('[data-testid="reset-whose"]');
      expect((await whoseChecked(p)) === "", `coché d'office : ${await whoseChecked(p)}`);
      await p.check('[data-testid="reset-whose-fresh"]');
      expect(
        (await p.inputValue("#auth-account")) === "Victime V SA",
        `entreprise reprise : ${await p.inputValue("#auth-account")}`,
      );
      await p.fill("#auth-name", "Victime V");
      await p.fill("#auth-password", `${PASS}-victime`);
      await p.locator("form button").last().click();
      await waitAt(p, `${IL}/fr/app/contacts/new`, "après le lien");
      neutralSince(from, "g-verif");
      expect(
        stateOf().startsWith("false|"),
        `compte d'avance encore actif après « je ne l'ai pas ouvert » : ${stateOf()}`,
      );
      const mine = await ilWho(ctx);
      expect(mine === `${victim}|Victime V SA`, `InvoiceLead de la personne : ${mine}`);
      const secret = `Client V ${stamp}`;
      await p.fill("#contact-name", secret);
      await p.locator('[data-testid="contact-save"]').click();
      await waitAt(p, `${IL}/fr/app/contacts?saved=1`, "contact enregistré");
      const tok = await ilToken(intr);
      const seen = await intr.request.get(`${IL}/fr/app/contacts`, { maxRedirects: 0 });
      const body = seen.status() === 200 ? await seen.text() : "";
      const lg = await intr.request.post(
        `${CRM_G}/api/auth/login`,
        gq({ email: victim, password: `${PASS}-intrus` }),
      );
      const state = stateOf();
      const jetons = liveRefresh(oldId);
      await Promise.all([ctx.close(), intr.close()]);
      expect(
        !body.includes(secret) && lg.status() === 401 && jetons === "0",
        `session InvoiceLead du tiers${tok === intrIl ? " d'avant" : ""} : ${seen.status()}` +
          `${body.includes(secret) ? ` et « ${secret} »` : ""} ; son mot de passe : ${lg.status()} ; ses jetons : ` +
          `${jetons} ; personne dans ${mine.split("|")[1]} ; compte d'avance ${state.replace(/\|sub-.*/, "|Google")}`,
      );
    },
  );

  // ---------- lot 8, r8 bis : lien « Confirmez votre adresse » d'un compte jamais confirmé (113, section 8) ----------
  /** Lien « Confirmez votre adresse » de `email` sur le Compte Lead `base` (jeton reposé ici : l'email simulé n'en garde
   *  que l'objet), au nom de l'application `app` comme dans l'email, ou sans (CRMlead direct). */
  const verifyLinkAt = (base, email, app = "invoicelead") => {
    const vt = randomBytes(32).toString("base64url");
    crmq(`select 1 from auth_token_issue('verify', '${email}', '${sha(vt)}', '1 hour'::interval)`);
    return { vt, url: `${base}/verification?jeton=${vt}${app ? `&app=${app}&lang=fr` : ""}` };
  };
  /** « actif|adresse confirmée » d'une personne du Compte Lead (id). */
  const confirmedOf = (id) =>
    crmq(
      `select is_active::text || '|' || (email_verified_at is not null)::text from users where id = '${id}'`,
    );
  /** Inscription par mot de passe depuis InvoiceLead (Compte Lead `base`), dans `ctx` ; rend l'id du Compte Lead. */
  async function ilPasswordSignup(ctx, email, company, name, pass = PASS) {
    const p = await ctx.newPage();
    const { url } = await ilAuthorize(ctx, "locale=fr&signup=1", CRM_G);
    await p.goto(url);
    await waitAt(p, `${CRM_G}/signup?next=`, `${email} : inscription`);
    await p.fill("#auth-account", company);
    await p.fill("#auth-name", name);
    await p.fill("#auth-email", email);
    await p.fill("#auth-password", pass);
    await p.locator("form button").last().click();
    await waitAt(p, `${IL}/fr/app`, `${email} : arrivée dans InvoiceLead`);
    await p.close();
    return crmq(`select id from users where email = '${email}' and is_active`);
  }
  const verifyChecked = async (p) =>
    `${await p.isChecked('[data-testid="verify-whose-mine"]')}|${await p.isChecked('[data-testid="verify-whose-fresh"]')}`;

  await step(
    "CRM-VERIFY-LINK-CHOICE : lien « Confirmez votre adresse » d'un compte ouvert d'avance, ouvert ailleurs : le compte montré, rien de confirmé sans choix, « je ne l'ai pas ouvert » mène dans InvoiceLead, l'auteur ne lit rien",
    async () => {
      const victim = mail("vl-choice");
      const { intr, oldId } = await preCreate(victim, "Compte avance VL", CRM_G);
      const intrIl = await ilToken(intr);
      const ctx = await newCtx(browser, "fr-CH", "vl-choice");
      const from = events.length;
      const p = await ctx.newPage();
      const { vt, url } = verifyLinkAt(CRM_G, victim);
      await p.goto(url);
      await p.waitForSelector('[data-testid="verify-whose"]');
      const shown = (await p.locator('[data-testid="verify-whose"]').innerText()).replace(
        /\s+/g,
        " ",
      );
      expect(
        /Compte avance VL/.test(shown) && /Tiers/.test(shown),
        `compte d'avance montré : ${shown.slice(0, 240)}`,
      );
      expect(
        (await verifyChecked(p)) === "false|false",
        `coché d'office : ${await verifyChecked(p)}`,
      );
      expect(
        (await p.locator('[data-testid="verify-email"]').innerText()) === victim,
        "adresse du lien pas montrée",
      );
      expect((await p.title()) === "Compte Lead", `titre : ${await p.title()}`);
      expect(confirmedOf(oldId) === "true|false", `confirmé à l'ouverture : ${confirmedOf(oldId)}`);
      // Valider sans choisir : refusé ; le serveur refuse aussi de confirmer sans choix.
      await p.locator("form button").last().click();
      await p.getByText("Indiquez d'abord si ce compte est le vôtre.").waitFor({ timeout: 5000 });
      const raw = await ctx.request.post(`${CRM_G}/api/auth/verify`, gq({ token: vt }));
      const rawErr = (await raw.json().catch(() => ({}))).error;
      expect(
        raw.status() === 409 && rawErr === "choice_required",
        `confirmation sans choix : ${raw.status()} ${rawErr}`,
      );
      // « C'est mon compte » sans son mot de passe (celui du tiers) : refusé, rien de confirmé.
      await p.check('[data-testid="verify-whose-mine"]');
      await p.fill("#auth-password", `${PASS}-pas-le-sien`);
      await p.locator("form button").last().click();
      await p.getByText("Mot de passe incorrect.").waitFor({ timeout: 8000 });
      expect(
        confirmedOf(oldId) === "true|false",
        `confirmé sans le mot de passe : ${confirmedOf(oldId)}`,
      );
      // « Je ne l'ai pas ouvert » : compte neuf à son nom, et InvoiceLead tout de suite.
      await p.check('[data-testid="verify-whose-fresh"]');
      await p.fill("#auth-account", "Victime VL SA");
      await p.fill("#auth-name", "Victime VL");
      await p.fill("#auth-password", `${PASS}-victime`);
      await p.locator("form button").last().click();
      await waitAt(p, `${IL}/fr/app`, "après « je ne l'ai pas ouvert »");
      neutralSince(from, "vl-choice");
      expect((await ilWho(ctx)) === `${victim}|Victime VL SA`, `InvoiceLead : ${await ilWho(ctx)}`);
      const fresh = crmq(
        `select (u.id <> '${oldId}')::text || '|' || a.name || '|' || (u.email_verified_at is not null)::text
           from users u join accounts a on a.id = u.account_id where u.email = '${victim}'`,
      );
      expect(fresh === "true|Victime VL SA|true", `compte neuf : ${fresh}`);
      expect(quietOf(victim) === "off|false", `réglages de CRMlead : ${quietOf(victim)}`);
      expect(
        !gLog().includes(`à ${victim} — Bienvenue sur CRMlead`),
        "bienvenue de CRMlead envoyée",
      );
      expect(
        confirmedOf(oldId) === "false|false" &&
          liveRefresh(oldId) === "0" &&
          liveSessions(oldId) === "0",
        `compte d'avance ${confirmedOf(oldId)}, jetons ${liveRefresh(oldId)}, sessions ${liveSessions(oldId)}`,
      );
      // Ce qu'elle saisit n'apparaît pas dans la session InvoiceLead du tiers ; son mot de passe ne vaut plus.
      const secret = `Client VL ${stamp}`;
      const c = await ctx.newPage();
      await c.goto(`${IL}/fr/app/contacts/new`);
      await c.fill("#contact-name", secret);
      await c.locator('[data-testid="contact-save"]').click();
      await waitAt(c, `${IL}/fr/app/contacts?saved=1`, "contact enregistré");
      expect((await ilToken(intr)) === intrIl, "session InvoiceLead du tiers changée");
      const seen = await intr.request.get(`${IL}/fr/app/contacts`, { maxRedirects: 0 });
      const body = seen.status() === 200 ? await seen.text() : "";
      expect(!body.includes(secret), `le tiers voit « ${secret} » (${seen.status()})`);
      const lg = await intr.request.post(
        `${CRM_G}/api/auth/login`,
        gq({ email: victim, password: `${PASS}-intrus` }),
      );
      expect(lg.status() === 401, `mot de passe du tiers : ${lg.status()}`);
      const again = await ctx.request.post(`${CRM_G}/api/auth/verify`, gq({ token: vt }));
      expect(again.status() === 400, `lien rejoué : ${again.status()}`);
      // Google se rattache ensuite au compte de la personne, et mène à la page demandée.
      await ctx.clearCookies();
      const g = await ctx.newPage();
      const { url: gu } = await ilAuthorize(ctx, "locale=fr&next=%2Ffr%2Fapp%2Fquotes", CRM_G);
      await g.goto(gu);
      await waitAt(g, `${CRM_G}/login?next=`, "connexion Google");
      await google(g, victim);
      await g.click("#ok");
      await waitAt(g, `${IL}/fr/app/quotes`, "Google après le compte neuf");
      expect(
        (await ilWho(ctx)) === `${victim}|Victime VL SA`,
        `InvoiceLead après Google : ${await ilWho(ctx)}`,
      );
      await Promise.all([ctx.close(), intr.close()]);
    },
  );

  await step(
    "CRM-VERIFY-LINK-OWN : la vraie titulaire confirme son adresse (même navigateur d'un coup, ailleurs avec son mot de passe, ou un nouveau, puis InvoiceLead sans second écran ; avec la 2FA, le code d'abord), CRMlead direct",
    async () => {
      // (a) Inscrite depuis InvoiceLead, le lien ouvert dans le même navigateur : confirmée d'un coup, comme avant.
      const ctx = await newCtx(browser, "fr-CH", "vl-own");
      const from = events.length;
      const own = mail("vl-own");
      const ownId = await ilPasswordSignup(ctx, own, "Ma Societe VL", "Jean Legit");
      const p = await ctx.newPage();
      await p.goto(verifyLinkAt(CRM_G, own).url);
      await p.getByText("Votre adresse est confirmée").waitFor({ timeout: 8000 });
      expect(
        (await p.locator('[data-testid="verify-whose"]').count()) === 0,
        "(a) choix montré à la titulaire",
      );
      expect(confirmedOf(ownId) === "true|true", `(a) ${confirmedOf(ownId)}`);
      neutralSince(from, "vl-own");
      await ctx.close();

      // (b) Ouvert sur un autre appareil : son compte montré, son mot de passe confirme et la fait entrer dans
      // InvoiceLead sans le redemander ; sa session d'origine reste.
      const home = await browser.newContext({ locale: "fr-CH" });
      const two = mail("vl-own2");
      const twoId = await ilPasswordSignup(home, two, "Ma Societe VL deux", "Jeanne Legit");
      const homeIl = await ilToken(home);
      const phone = await newCtx(browser, "fr-CH", "vl-own2");
      const from2 = events.length;
      const q = await phone.newPage();
      await q.goto(verifyLinkAt(CRM_G, two).url);
      await q.waitForSelector('[data-testid="verify-whose"]');
      expect(
        /Ma Societe VL deux/.test(await q.locator('[data-testid="verify-whose"]').innerText()),
        "(b) compte montré",
      );
      await q.check('[data-testid="verify-whose-mine"]');
      await q.fill("#auth-password", PASS);
      const navQ = navLog(q);
      await q.locator("form button").last().click();
      // Droit dans InvoiceLead : ni second écran de mot de passe, ni écran de CRMlead.
      await waitAt(q, `${IL}/fr/app`, "(b) arrivée", 30000);
      expect(
        !navQ.some((u) => u.startsWith(`${CRM_G}/login`)),
        `(b) écran de connexion : ${navQ.join(" → ")}`,
      );
      expect(confirmedOf(twoId) === "true|true", `(b) ${confirmedOf(twoId)}`);
      expect(
        (await ilToken(home)) === homeIl && !sessionGone(homeIl),
        "(b) session InvoiceLead d'origine fermée",
      );
      expect(
        (await ilWho(phone)) === `${two}|Ma Societe VL deux`,
        `(b) InvoiceLead ${await ilWho(phone)}`,
      );
      neutralSince(from2, "vl-own2");
      await Promise.all([home.close(), phone.close()]);

      // (b2) Même chose avec la double authentification : le code, sous le nom d'InvoiceLead, avant d'y entrer ;
      // aucune session avant le code.
      const home2 = await browser.newContext({ locale: "fr-CH" });
      const tfa = mail("vl-own2fa");
      const tfaId = await ilPasswordSignup(home2, tfa, "Ma Societe VL 2FA", "Jil Legit");
      const tfaSecret = await enable2fa(home2, CRM_G);
      await home2.close();
      const phone2 = await newCtx(browser, "fr-CH", "vl-own2fa");
      const from2b = events.length;
      const q2 = await phone2.newPage();
      const navQ2 = navLog(q2);
      await q2.goto(verifyLinkAt(CRM_G, tfa).url);
      await q2.waitForSelector('[data-testid="verify-whose"]');
      await q2.check('[data-testid="verify-whose-mine"]');
      await q2.fill("#auth-password", PASS);
      await q2.locator("form button").last().click();
      await q2.locator('[data-testid="verify-totp"]').waitFor({ timeout: 10000 });
      expect((await q2.title()) === "Compte Lead", `(b2) écran du code : « ${await q2.title()} »`);
      expect(!(await session(phone2)), `(b2) session sans le code : ${await session(phone2)}`);
      expect(!(await ilToken(phone2)), "(b2) session InvoiceLead sans le code");
      await q2.fill("#auth-code", totpCode(tfaSecret, 1));
      await q2.locator('[data-testid="verify-totp"] button').click();
      await waitAt(q2, `${IL}/fr/app`, "(b2) arrivée après le code", 30000);
      expect(
        !navQ2.some((u) => u.startsWith(`${CRM_G}/login`)),
        `(b2) écran de connexion : ${navQ2.join(" → ")}`,
      );
      expect(confirmedOf(tfaId) === "true|true", `(b2) ${confirmedOf(tfaId)}`);
      expect(
        (await ilWho(phone2)) === `${tfa}|Ma Societe VL 2FA`,
        `(b2) InvoiceLead ${await ilWho(phone2)}`,
      );
      neutralSince(from2b, "vl-own2fa");
      await phone2.close();

      // (c) Mot de passe oublié : un nouveau, qui confirme et ferme tout ce qui était ouvert.
      const third = await browser.newContext({ locale: "fr-CH" });
      const three = mail("vl-own3");
      const threeId = await ilPasswordSignup(third, three, "Ma Societe VL trois", "Jo Legit");
      const other = await newCtx(browser, "fr-CH", "vl-own3");
      const from3 = events.length;
      const r = await other.newPage();
      await r.goto(verifyLinkAt(CRM_G, three).url);
      await r.waitForSelector('[data-testid="verify-whose"]');
      await r.check('[data-testid="verify-whose-mine"]');
      await r.locator('[data-testid="verify-forgot"]').click();
      await r.fill("#auth-password", `${PASS}-nouveau`);
      const thirdIl = await ilToken(third);
      const t3 = crmq("select now()");
      await r.locator("form button").last().click();
      // Le nouveau mot de passe ouvre la session : InvoiceLead tout de suite, sans le retaper.
      await waitAt(r, `${IL}/fr/app`, "(c) arrivée", 30000);
      expect(
        (await ilWho(other)) === `${three}|Ma Societe VL trois`,
        `(c) InvoiceLead ${await ilWho(other)}`,
      );
      expect(confirmedOf(threeId) === "true|true", `(c) ${confirmedOf(threeId)}`);
      const old = await other.request.post(
        `${CRM_G}/api/auth/login`,
        gq({ email: three, password: PASS }),
      );
      expect(old.status() === 401, `(c) ancien mot de passe : ${old.status()}`);
      const sessionsBefore = crmq(
        `select count(*) from sessions where user_id = '${threeId}' and revoked_at is null
            and expires_at > now() and created_at < '${t3}'`,
      );
      expect(
        refreshBefore(threeId, t3) === "0" && sessionsBefore === "0",
        `(c) jetons d'avant ${refreshBefore(threeId, t3)}, sessions d'avant ${sessionsBefore}`,
      );
      // Tout ce qui était ouvert avant est fermé, la session InvoiceLead du premier appareil comprise.
      expect(sessionGone(thirdIl), "(c) session InvoiceLead d'avant le nouveau mot de passe");
      neutralSince(from3, "vl-own3");
      await Promise.all([third.close(), other.close()]);

      // (d) CRMlead direct, sur un autre appareil : l'écran de CRMlead ; « je ne l'ai pas ouvert » mène à la bienvenue.
      const direct = await directAccount("vl-direct");
      const directId = crmq(`select id from users where email = '${direct}' and is_active`);
      const d = await browser.newContext({ locale: "fr-CH" });
      const dp = await d.newPage();
      await dp.goto(verifyLinkAt(CRM_G, direct, "").url);
      await dp.waitForSelector('[data-testid="verify-whose"]');
      expect(/CRMlead/.test(await dp.title()), `(d) titre ${await dp.title()}`);
      await dp.check('[data-testid="verify-whose-fresh"]');
      await dp.fill("#auth-account", "Direct VL SA");
      await dp.fill("#auth-name", "Direct VL");
      await dp.fill("#auth-password", `${PASS}-direct`);
      await dp.locator("form button").last().click();
      await waitAt(dp, `${CRM_G}/bienvenue`, "(d) bienvenue de CRMlead");
      expect((await session(d)) === direct, `(d) session ${await session(d)}`);
      expect(
        confirmedOf(directId) === "false|false",
        `(d) compte d'avance ${confirmedOf(directId)}`,
      );
      expect(
        await waitLog(gLog, new RegExp(`à ${direct.replace(/[+.]/g, "\\$&")} — Bienvenue`)),
        "(d) bienvenue de CRMlead absente",
      );
      await d.close();
    },
  );

  await step(
    "CRM-GOOGLE-UNCONFIRMED-OWN : la vraie titulaire d'un compte jamais confirmé revient s'inscrire par Google : rien de coché, « c'est mon compte » garde ce qu'elle a saisi",
    async () => {
      const own = mail("g-own");
      const ctx = await newCtx(browser, "fr-CH", "g-own");
      const oldId = await ilPasswordSignup(ctx, own, "Ma Societe GO", "Jean Legit");
      const mine = `Mon client ${stamp}`;
      const c = await ctx.newPage();
      await c.goto(`${IL}/fr/app/contacts/new`);
      await c.fill("#contact-name", mine);
      await c.locator('[data-testid="contact-save"]').click();
      await waitAt(c, `${IL}/fr/app/contacts?saved=1`, "contact enregistré");
      await c.close();
      // Plus tard : « Créer un compte », la même entreprise, puis Google à la même adresse.
      await ctx.clearCookies();
      const from = events.length;
      const p = await ctx.newPage();
      const { url, next } = await ilAuthorize(
        ctx,
        "locale=fr&signup=1&next=%2Ffr%2Fapp%2Fcontacts",
        CRM_G,
      );
      await p.goto(url);
      await waitAt(p, `${CRM_G}/signup?next=`, "inscription");
      await p.fill("#auth-account", "Ma Societe GO");
      await google(p, own);
      await p.click("#ok");
      await waitAt(p, `${CRM_G}/login?sso=unconfirmed`, "retour de Google");
      const note = crmq(
        `select coalesce(unconfirmed_claim ->> 'mode', '') from users where id = '${oldId}'`,
      );
      expect(note === "signup", `note de Google : ${note}`);
      await p.goto(resetLinkAt(CRM_G, own, next));
      await p.waitForSelector('[data-testid="reset-whose"]');
      expect(
        /Ma Societe GO/.test(await p.locator('[data-testid="reset-whose"]').innerText()),
        "compte montré",
      );
      expect((await whoseChecked(p)) === "", `coché d'office : ${await whoseChecked(p)}`);
      // Valider sans rien changer : refusé, le compte reste le sien.
      await p.fill("#auth-password", `${PASS}-neuf`);
      await p.locator("form button").last().click();
      await p.getByText("Indiquez d'abord si ce compte est le vôtre.").waitFor({ timeout: 5000 });
      expect(
        confirmedOf(oldId) === "true|false",
        `après un envoi sans choix : ${confirmedOf(oldId)}`,
      );
      // « C'est mon compte » : la page demandée, dans son entreprise, avec son contact.
      await p.check('[data-testid="reset-whose-mine"]');
      await p.locator("form button").last().click();
      await waitAt(p, `${IL}/fr/app/contacts`, "après « c'est mon compte »");
      neutralSince(from, "g-own", (e) => /next=|\/oauth\/|jeton=/.test(e.url));
      expect((await ilWho(ctx)) === `${own}|Ma Societe GO`, `InvoiceLead : ${await ilWho(ctx)}`);
      await p.getByText(mine).first().waitFor({ timeout: 8000 });
      expect(confirmedOf(oldId) === "true|true", `son compte : ${confirmedOf(oldId)}`);
      await ctx.close();
    },
  );

  // Intégration r8-a2 : le même défaut sur CRMlead direct (Password.tsx cochait « je ne l'ai pas ouvert » pour toute
  // inscription par Google, quelle que soit l'origine), et le lien de confirmation ouvert dans le même navigateur.
  await step(
    "CRM-GOOGLE-UNCONFIRMED-OWN (CRMlead direct) : la titulaire d'un compte CRMlead jamais confirmé revient s'inscrire par Google : écran de CRMlead, rien de coché, « c'est mon compte » garde son lead",
    async () => {
      const own = mail("g-own-direct");
      const ctx = await browser.newContext({ locale: "fr-CH" });
      const s = await ctx.request.post(
        `${CRM_G}/api/auth/signup`,
        gq({
          accountName: "Ma Societe GD",
          name: "Jean Legit",
          email: own,
          password: PASS,
          locale: "fr",
        }),
      );
      expect(s.ok(), `inscription directe : ${s.status()}`);
      const oldId = crmq(
        `select id from users where email = '${own}' and is_active and email_verified_at is null`,
      );
      expect(oldId, "compte direct jamais confirmé");
      const accountOf = () =>
        crmq(`select account_id from users where email = '${own}' and is_active`);
      const account = accountOf();
      const title = `Mon lead ${stamp}`;
      const l = await ctx.request.post(`${CRM_G}/api/leads`, gq({ title }));
      expect(l.status() === 201, `lead : ${l.status()}`);
      // Plus tard, déconnectée : « Créer un compte » de CRMlead, la même entreprise, Google à la même adresse.
      await ctx.clearCookies();
      const p = await ctx.newPage();
      await p.goto(`${CRM_G}/signup`);
      await p.fill("#auth-account", "Ma Societe GD");
      await google(p, own);
      await p.click("#ok");
      await waitAt(p, `${CRM_G}/login?sso=unconfirmed`, "retour de Google");
      await p.waitForSelector("#auth-password");
      expect(/CRMlead/.test(await p.title()), `titre au retour : ${await p.title()}`);
      const note = crmq(
        `select coalesce(unconfirmed_claim ->> 'mode', '') from users where id = '${oldId}'`,
      );
      expect(note === "signup", `note de Google : ${note}`);
      expect(!(await session(ctx)), `session ouverte : ${await session(ctx)}`);
      // Le lien reçu : son compte montré, rien de coché ; valider sans choisir est refusé, à l'écran et au serveur.
      const link = resetLinkAt(CRM_G, own);
      await p.goto(link);
      await p.waitForSelector('[data-testid="reset-whose"]');
      expect(/CRMlead/.test(await p.title()), `titre du lien : ${await p.title()}`);
      const shown = (await p.locator('[data-testid="reset-whose"]').innerText()).replace(
        /\s+/g,
        " ",
      );
      expect(
        /Ma Societe GD/.test(shown) && /Jean Legit/.test(shown),
        `compte montré : ${shown.slice(0, 240)}`,
      );
      expect((await whoseChecked(p)) === "", `coché d'office : ${await whoseChecked(p)}`);
      await p.fill("#auth-password", `${PASS}-neuf`);
      await p.locator("form button").last().click();
      await p.getByText("Indiquez d'abord si ce compte est le vôtre.").waitFor({ timeout: 5000 });
      const raw = await ctx.request.post(
        `${CRM_G}/api/auth/reset`,
        gq({ token: tokenOf(link), password: `${PASS}-neuf` }),
      );
      const rawErr = (await raw.json().catch(() => ({}))).error;
      expect(
        raw.status() === 409 && rawErr === "choice_required",
        `envoi sans choix : ${raw.status()} ${rawErr}`,
      );
      expect(
        confirmedOf(oldId) === "true|false" && accountOf() === account,
        `après un envoi sans choix : ${confirmedOf(oldId)}, compte ${accountOf()}`,
      );
      // « C'est mon compte » : CRMlead, pas l'accueil d'un compte neuf ; même compte, son lead, adresse confirmée.
      await p.check('[data-testid="reset-whose-mine"]');
      await p.locator("form button").last().click();
      await p.waitForURL(
        (u) => u.href.startsWith(CRM_G) && !/^\/(mot-de-passe|login|signup|api)/.test(u.pathname),
        { timeout: 20000 },
      );
      await sleep(800);
      expect(new URL(p.url()).pathname !== "/bienvenue", `arrivée : ${p.url()}`);
      expect((await session(ctx)) === own, `session : ${await session(ctx)}`);
      expect(
        accountOf() === account && confirmedOf(oldId) === "true|true",
        `son compte : ${confirmedOf(oldId)}, compte ${accountOf()} (avant ${account})`,
      );
      const leads = await ctx.request.get(`${CRM_G}/api/leads?view=list`);
      expect(
        leads.ok() && (await leads.text()).includes(title),
        `son lead absent (${leads.status()})`,
      );
      await ctx.close();
    },
  );

  await step(
    "CRM-VERIFY-LINK-OWN (CRMlead direct, même navigateur) : inscrite sur CRMlead, le lien de confirmation ouvert là où elle est connectée confirme d'un coup, écran de CRMlead",
    async () => {
      const own = mail("vl-direct-same");
      const ctx = await browser.newContext({ locale: "fr-CH" });
      const p = await ctx.newPage();
      await p.goto(`${CRM_G}/signup`);
      await p.fill("#auth-account", "Direct meme navigateur");
      await p.fill("#auth-name", "Jean Direct");
      await p.fill("#auth-email", own);
      await p.fill("#auth-password", PASS);
      await p.locator("form button").last().click();
      await p.waitForURL(
        (u) => u.href.startsWith(CRM_G) && !/^\/(signup|login|api)/.test(u.pathname),
        { timeout: 20000 },
      );
      const id = crmq(
        `select id from users where email = '${own}' and is_active and email_verified_at is null`,
      );
      expect(id, "compte direct jamais confirmé");
      expect(
        await waitLog(
          gLog,
          new RegExp(`à ${own.replace(/[+.]/g, "\\$&")} — Confirmez votre adresse`),
        ),
        "email de confirmation absent",
      );
      const v = await ctx.newPage();
      await v.goto(verifyLinkAt(CRM_G, own, "").url);
      await v.getByText("Votre adresse est confirmée").waitFor({ timeout: 8000 });
      expect(
        (await v.locator('[data-testid="verify-whose"]').count()) === 0,
        "choix montré dans son navigateur",
      );
      expect(/CRMlead/.test(await v.title()), `titre : ${await v.title()}`);
      expect(confirmedOf(id) === "true|true", `confirmée : ${confirmedOf(id)}`);
      expect((await session(ctx)) === own, `session : ${await session(ctx)}`);
      await ctx.close();
    },
  );

  await step(
    "CRM-GOOGLE-INVITED : collègue invité qui passe par Google avant son lien : rien d'accepté sans son choix, rejoindre ou son propre compte, connexion ou inscription, CRMlead direct",
    async () => {
      // Administrateur InvoiceLead (Pro+, places) ; invitations par Réglages → Équipe.
      const actx = await browser.newContext({ locale: "fr-CH" });
      const ap = await actx.newPage();
      const manager = await signupFromIl(ap, "fr", "invg-mgr");
      const org = crmq(`select account_id from users where email = '${manager}'`);
      const teamName = crmq(`select name from accounts where id = '${org}'`);
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
      /** « actif|Google rattaché|dans l'équipe qui invite|invitations ouvertes » de cette adresse au Compte Lead. */
      const state = (who) =>
        crmq(
          `select u.is_active::text || '|' || (u.sso_subject is not null)::text || '|' || (u.account_id = '${org}')::text
                  || '|' || (select count(*) from auth_tokens t where t.user_id = u.id and t.purpose = 'invite' and t.consumed_at is null)
             from users u where u.email = '${who}'`,
        );
      const choiceCookie = async (ctx) =>
        (await ctx.cookies()).find((k) => /crmlead_sso_invite$/.test(k.name));
      const ctx = await newCtx(browser, "fr-CH", "invg");
      const from = events.length;
      /** Départ d'InvoiceLead, Google, puis l'écran du choix : rien d'accepté, aucune session, la marque neutre. */
      const toChoice = async (label, who, query, path, company) => {
        await ctx.clearCookies();
        const p = await ctx.newPage();
        const { url } = await ilAuthorize(ctx, query, CRM_G);
        await p.goto(url);
        await waitAt(p, `${CRM_G}${path}?next=`, `${label} : écran du Compte Lead`);
        if (company) await p.fill("#auth-account", company);
        await google(p, who);
        await p.click("#ok");
        await waitAt(p, `${CRM_G}/login?sso=invite_choice`, `${label} : écran du choix`);
        const box = p.locator('[data-testid="invite-choice"]');
        await box.waitFor({ timeout: 10000 });
        const text = (await box.innerText()).replace(/\s+/g, " ");
        expect(
          text.includes(teamName) && /Eve E2E5/.test(text),
          `${label} : invitation montrée « ${text} »`,
        );
        expect((await p.title()) === "Compte Lead", `${label} : titre ${await p.title()}`);
        expect(state(who) === "false|false|true|1", `${label} : avant le choix ${state(who)}`);
        expect(!(await session(ctx)) && !(await ilToken(ctx)), `${label} : session avant le choix`);
        return p;
      };
      // Connexion : « Rejoindre » ; un choix rejoué ou fabriqué ensuite ne fait rien.
      const joiner = mail("invg-connexion");
      await invite(joiner);
      const jp = await toChoice(
        "connexion",
        joiner,
        "locale=fr&next=%2Ffr%2Fapp%2Finvoices",
        "/login",
      );
      const kept = await choiceCookie(ctx);
      expect(kept, "connexion : cookie du choix absent");
      await jp.locator('[data-testid="invite-choice-join"]').click();
      await waitAt(jp, `${IL}/fr/app/invoices`, "connexion : arrivée après « Rejoindre »");
      expect(state(joiner) === "true|true|true|0", `connexion : ${state(joiner)}`);
      expect(quietOf(joiner) === "off|false", `connexion : réglages de CRMlead ${quietOf(joiner)}`);
      expect(
        (await ilWho(ctx)) === `${joiner}|${ilOrg}`,
        `connexion : InvoiceLead ${await ilWho(ctx)}`,
      );
      await jp.close();
      const other = await browser.newContext();
      const forged = await other.request.post(
        `${CRM_G}/api/auth/sso/invite-choice`,
        gq({ choice: "join" }),
      );
      expect(forged.status() === 401, `choix sans cookie : ${forged.status()}`);
      // Le cookie du choix rejoué tel quel (en production, « __Host-… » : Secure, refusé par addCookies sur http).
      const replay = await other.request.post(`${CRM_G}/api/auth/sso/invite-choice`, {
        data: { choice: "own", accountName: "Rejeu SA" },
        headers: { origin: CRM_G, cookie: `${kept.name}=${kept.value}` },
      });
      expect(replay.status() === 401, `choix rejoué : ${replay.status()}`);
      await other.close();
      // Inscription, « Victime SA » tapée : « Créer mon propre compte » reprend l'entreprise, l'invitation est déclinée.
      const owner = mail("invg-inscription");
      await invite(owner);
      const op = await toChoice(
        "inscription",
        owner,
        "locale=fr&signup=1&next=%2Ffr%2Fapp%2Fquotes",
        "/signup",
        "Victime SA",
      );
      await op.locator('[data-testid="invite-choice-own"]').click();
      expect(
        (await op.inputValue("#auth-account")) === "Victime SA",
        `inscription : entreprise ${await op.inputValue("#auth-account")}`,
      );
      await op.locator('[data-testid="invite-choice-own-submit"]').click();
      await waitAt(op, `${IL}/fr/app/quotes`, "inscription : arrivée dans son compte");
      expect(state(owner) === "true|true|false|0", `inscription : ${state(owner)}`);
      expect(
        crmq(
          `select a.name from users u join accounts a on a.id = u.account_id where u.email = '${owner}'`,
        ) === "Victime SA",
        "inscription : compte neuf à son entreprise",
      );
      expect(
        crmq(
          `select count(*) from users where account_id = '${org}' and lower(email) = lower('${owner}')`,
        ) === "0",
        "inscription : encore dans l'équipe qui invite",
      );
      expect(
        (await ilWho(ctx)) === `${owner}|Victime SA`,
        `inscription : InvoiceLead ${await ilWho(ctx)}`,
      );
      expect(
        ilq(
          `select count(*) from memberships m join users u on u.id = m.user_id join organizations o on o.id = m.organization_id
            where u.email = '${owner}' and o.name = '${ilOrg}'`,
        ) === "0",
        "inscription : membre de l'entreprise qui invite dans InvoiceLead",
      );
      expect(quietOf(owner) === "off|false", `inscription : réglages de CRMlead ${quietOf(owner)}`);
      await op.close();
      // Google la ramène ensuite dans SON compte, sans écran.
      await ctx.clearCookies();
      const back = await ctx.newPage();
      const { url: bu } = await ilAuthorize(ctx, "locale=fr&next=%2Ffr%2Fapp%2Finvoices", CRM_G);
      await back.goto(bu);
      await waitAt(back, `${CRM_G}/login?next=`, "retour par Google : écran");
      await google(back, owner);
      await back.click("#ok");
      await waitAt(back, `${IL}/fr/app/invoices`, "retour par Google : arrivée");
      expect(
        (await ilWho(ctx)) === `${owner}|Victime SA`,
        `retour par Google : ${await ilWho(ctx)}`,
      );
      await back.close();
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
      neutralSince(from, "invg", (ev) => /next=|\/oauth\/|sso=/.test(ev.url));
      await Promise.all([ctx.close(), actx.close()]);
      // CRMlead direct : collègues invités dans Réglages → Équipe de CRMlead ; le même choix, à la marque de CRMlead.
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
      const dOrg = crmq(`select account_id from users where email = '${admin}'`);
      crmq(
        `insert into lead_subscriptions (account_id, source_app, external_id, app_plan, plan_code, status)
         values ('${dOrg}', 'scanlead', 'e2e5-invgd-${stamp}', 'pro_plus', 'pro_plus', 'active')`,
      );
      for (const [label, path, choice] of [
        ["rejoindre", "/login", "join"],
        ["son compte", "/signup", "own"],
      ]) {
        const col = mail(`invg-crm-${choice}`);
        const di = await dctx.request.post(
          `${CRM_G}/api/users`,
          gq({ email: col, name: "Direct" }),
        );
        expect(di.status() === 201, `direct ${label} : invitation ${di.status()}`);
        const k = await browser.newContext({ locale: "fr-CH" });
        const kp = await k.newPage();
        await kp.goto(`${CRM_G}${path}`);
        if (choice === "own") await kp.fill("#auth-account", "Autre direct SA");
        await google(kp, col);
        await kp.click("#ok");
        await waitAt(kp, `${CRM_G}/login?sso=invite_choice`, `direct ${label} : écran du choix`);
        await kp.locator('[data-testid="invite-choice"]').waitFor({ timeout: 10000 });
        expect(/CRMlead/.test(await kp.title()), `direct ${label} : titre ${await kp.title()}`);
        expect(!(await session(k)), `direct ${label} : session avant le choix`);
        if (choice === "join") await kp.locator('[data-testid="invite-choice-join"]').click();
        else {
          await kp.locator('[data-testid="invite-choice-own"]').click();
          await kp.locator('[data-testid="invite-choice-own-submit"]').click();
        }
        await kp.waitForURL(
          (u) => u.href.startsWith(CRM_G) && !/^\/(api|login|signup)/.test(u.pathname),
          { timeout: 20000 },
        );
        expect((await session(k)) === col, `direct ${label} : session ${await session(k)}`);
        expect(/CRMlead/.test(await kp.title()), `direct ${label} : titre ${await kp.title()}`);
        const where = crmq(
          `select (u.account_id = '${dOrg}')::text || '|' || a.name from users u join accounts a on a.id = u.account_id
            where u.email = '${col}'`,
        );
        expect(
          choice === "join"
            ? where === "true|E2E5 invités CRMlead"
            : where === "false|Autre direct SA",
          `direct ${label} : ${where}`,
        );
        await k.close();
      }
      await dctx.close();
    },
  );
}

console.log("\nRESULTATS", JSON.stringify(results, null, 1));
await browser.close();
gServer?.close();
