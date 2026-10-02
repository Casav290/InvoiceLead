/**
 * Parcours du lot 6 (01.10.2026), côté Compte Lead : chaque défaut corrigé dans CRMlead, rejoué contre un CRMlead
 * lancé avec un faux Google (celui de ce script).
 *
 *   CRM_GOOGLE=http://localhost:<port> node scripts/lead-login-live/e2e-login6.mjs
 *
 * Le CRMlead à tester : `NODE_ENV=production SERVE_DIST=1 PUBLIC_URL=$CRM_GOOGLE` (dist construit depuis le dépôt),
 * base crmlead_e2e, et GOOGLE_CLIENT_ID=x GOOGLE_CLIENT_SECRET=y GOOGLE_AUTH_URL=http://127.0.0.1:<GOOGLE_PORT>/auth
 * GOOGLE_TOKEN_URL=http://127.0.0.1:<GOOGLE_PORT>/token GOOGLE_USERINFO_URL=http://127.0.0.1:<GOOGLE_PORT>/userinfo
 * (GOOGLE_PORT : 8942 par défaut). L'application InvoiceLead n'est pas appelée : ses adresses sont interceptées.
 * ONLY=<motif> : seulement les étapes dont le nom correspond (REPLAY, TOTP, THEME, SWOFF, HOST, QUIET, LOGOUT,
 * OPENLINK).
 *
 * - REPLAY : un retour de Google sans son départ ne prend jamais la demande d'InvoiceLead d'un autre onglet ;
 * - TOTP : deux onglets revenus de Google avec la double authentification gardent chacun défi et destination ;
 * - THEME : couleur d'action, icône d'écran d'accueil (iPhone) et adresses fabriquées (`app=constructor`) ;
 * - SWOFF : hors connexion au second saut d'un retour sans trace, la page neutre, puis la demande retrouvée ;
 * - HOST : une connexion Google commencée sur un autre nom du serveur aboutit ;
 * - QUIET : une inscription depuis InvoiceLead porte le repère du rattrapage de 113.
 * - LOGOUT (lot 8, R8-SEC-3) : un lien vers /oauth/logout posé sur un autre site ne ferme la session qu'avec le jeton
 *   d'identité de la personne (comme InvoiceLead), jamais sans, avec celui d'un autre ou un faux ; une adresse tapée,
 *   oui ;
 * - OPENLINK (lot 8, PD-R8-3) : le lien « Ouvrir dans InvoiceLead » d'une pièce suit la langue de l'écran CRMlead.
 *
 * Comptes : eve+e2e6-<étape>-<horodatage>@example.test. Un compte ouvert par mot de passe confirme son adresse (son
 * lien de confirmation) avant de passer par Google : depuis le lot 8, Google ne se rattache plus à une adresse jamais
 * confirmée (statut unconfirmed de 113).
 */
// Le travailleur de service de CRMlead passe par le réseau du contexte : couper CRMlead le coupe aussi.
process.env.PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS = "1";

import { execFileSync } from "node:child_process";
import { createHash, createHmac, randomBytes } from "node:crypto";
import http from "node:http";

const { chromium } = await import("playwright");

const CRM = (process.env.CRM_GOOGLE ?? "").replace(/\/$/, "");
if (!CRM) {
  console.error("CRM_GOOGLE manquant (voir l'en-tête)");
  process.exit(2);
}
const CRM_HOST = new URL(CRM);
const GPORT = Number(process.env.GOOGLE_PORT ?? 8942);
const GOOGLE = `http://127.0.0.1:${GPORT}`;
const stamp = Date.now();
const mail = (l) => `eve+e2e6-${l}-${stamp}@example.test`;
const PASS = `Tr3s-l0ng-e2e6-${stamp}`;
let fails = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "  ok  " : "  NON "} ${name}${ok ? "" : " " + detail}`);
  if (!ok) fails++;
};
const ONLY = process.env.ONLY ?? "";
const step = (n) => !ONLY || n.includes(ONLY);

// ---------- faux Google ----------
let persona = { sub: "g-0", email: mail("g0") };
const codes = new Map();
const g = http
  .createServer(async (req, res) => {
    const u = new URL(req.url, GOOGLE);
    const json = (s, b) => {
      res.writeHead(s, { "Content-Type": "application/json" });
      res.end(JSON.stringify(b));
    };
    if (u.pathname === "/auth") {
      const back = u.searchParams.get("redirect_uri");
      const state = encodeURIComponent(u.searchParams.get("state") ?? "");
      const code = randomBytes(12).toString("hex");
      codes.set(code, { ...persona });
      res.writeHead(200, { "Content-Type": "text/html" });
      return res.end(
        `<!doctype html><title>Google</title><a id="ok" href="${back}?code=${code}&state=${state}">Continuer</a> <a id="deny" href="${back}?error=access_denied&state=${state}">Annuler</a>`,
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
      return json(200, { sub: who.sub, email: who.email, email_verified: true, name: "R6A0" });
    }
    json(404, {});
  })
  .listen(GPORT, "127.0.0.1");

// ---------- HTTP avec pot de cookies ----------
function jar() {
  const c = new Map();
  const f = async (path, opts = {}) => {
    const res = await fetch(path.startsWith("http") ? path : CRM + path, {
      redirect: "manual",
      ...opts,
      headers: { ...(opts.headers ?? {}), Cookie: [...c].map(([k, v]) => `${k}=${v}`).join("; ") },
    });
    for (const sc of res.headers.getSetCookie()) {
      const [kv, ...attrs] = sc.split(";");
      const i = kv.indexOf("=");
      const k = kv.slice(0, i).trim();
      const v = kv.slice(i + 1).trim();
      if (
        !v ||
        attrs.some((a) => /max-age=0\b/i.test(a.trim()) || /expires=Thu, 01 Jan 1970/i.test(a))
      )
        c.delete(k);
      else c.set(k, v);
    }
    return res;
  };
  f.cookies = c;
  return f;
}
const post = (f, path, body) =>
  f(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
const stateOf = (url) => new URL(url).searchParams.get("state");
const loc = (res) => res.headers.get("location") ?? "";
const authorize = (locale = "fr") => {
  const q = new URLSearchParams({
    response_type: "code",
    client_id: "invoicelead",
    redirect_uri: "http://localhost:3300/auth/lead/callback",
    scope: "openid email profile lead offline_access",
    state: randomBytes(8).toString("hex"),
    nonce: randomBytes(8).toString("hex"),
    code_challenge: createHash("sha256")
      .update("v" + stamp)
      .digest("base64url"),
    code_challenge_method: "S256",
    ui_locales: locale,
  });
  return `/oauth/authorize?${q.toString().replace(/\+/g, "%20")}`;
};

// ---------- TOTP ----------
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const b32 = (s) => {
  let bits = "";
  for (const ch of s.replace(/=+$/, "")) bits += B32.indexOf(ch).toString(2).padStart(5, "0");
  const out = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(out);
};
const totp = (secret, offset = 0) => {
  const counter = Math.floor(Date.now() / 30000) + offset;
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const h = createHmac("sha1", b32(secret)).update(buf).digest();
  const o = h[h.length - 1] & 15;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1e6).padStart(6, "0");
};

// =============================================================== 1. retours rejoués et départ effacé (HTTP)
if (step("REPLAY")) {
  console.log("REPLAY : un retour sans son départ ne prend jamais la demande d'un autre onglet");
  persona = { sub: `g-e2e6-r10-${stamp}`, email: mail("r10") };
  // R10b/R11 : départ direct, retour (annulé), puis départ d'InvoiceLead dans un autre onglet, puis retour rejoué du direct.
  let f = jar();
  const direct = stateOf(
    (await (await post(f, "/api/auth/sso/google/start", { mode: "login" })).json()).url,
  );
  const back1 = loc(await f(`/api/auth/sso/google/callback?error=access_denied&state=${direct}`));
  check("retour annulé d'un départ direct : CRMlead", /\/login\?sso=canceled$/.test(back1), back1);
  await post(f, "/api/auth/sso/google/start", { mode: "login", next: authorize() });
  check(
    "aucune demande commune au navigateur n'est posée",
    !f.cookies.has("crmlead_sso_next"),
    [...f.cookies.keys()].join(","),
  );
  const replay = loc(await f(`/api/auth/sso/google/callback?code=x&state=${direct}`));
  check(
    "R10b/R11 : le retour rejoué du départ direct ne prend pas la demande d'InvoiceLead",
    !/next=/.test(replay) && /retour=inconnu/.test(replay),
    replay,
  );
  // Ancien cookie commun resté d'une version précédente : ignoré.
  f = jar();
  f.cookies.set("crmlead_sso_next", encodeURIComponent(authorize()));
  const d2 = stateOf(
    (await (await post(f, "/api/auth/sso/google/start", { mode: "login" })).json()).url,
  );
  await f(`/api/auth/sso/google/callback?error=access_denied&state=${d2}`);
  const r2 = loc(await f(`/api/auth/sso/google/callback?code=x&state=${d2}`));
  check(
    "ancien cookie commun : ignoré, effacé au départ",
    !/next=/.test(r2) && !f.cookies.has("crmlead_sso_next"),
    r2,
  );
  // Départ d'InvoiceLead effacé par trois départs plus récents : l'onglet tranche (retour=orphelin), pas la demande d'un autre.
  f = jar();
  const mine = authorize("de");
  const sA = stateOf(
    (await (await post(f, "/api/auth/sso/google/start", { mode: "login", next: mine })).json()).url,
  );
  const other = authorize("fr");
  for (let i = 0; i < 3; i++)
    await post(f, "/api/auth/sso/google/start", {
      mode: "login",
      next: i === 1 ? other : undefined,
    });
  const rA = loc(await f(`/api/auth/sso/google/callback?code=x&state=${sA}`));
  check(
    "départ d'InvoiceLead effacé : l'onglet tranche (orphelin), jamais la page d'un autre",
    /retour=orphelin/.test(rA) && !/next=/.test(rA),
    rA,
  );
  // Le retour rejoué d'une application garde la sienne.
  f = jar();
  const sB = stateOf(
    (await (await post(f, "/api/auth/sso/google/start", { mode: "login", next: mine })).json()).url,
  );
  await f(`/api/auth/sso/google/callback?error=access_denied&state=${sB}`);
  const rB = loc(await f(`/api/auth/sso/google/callback?code=x&state=${sB}`));
  check(
    "retour rejoué d'InvoiceLead : sa propre demande",
    rB.includes(`next=${encodeURIComponent(mine)}`),
    rB,
  );
}

// =============================================================== 2. second facteur dans deux onglets (navigateur)
const browser = await chromium.launch();
/** L'adresse confirmée par son lien (jeton posé ici, route de l'écran /verification), comme depuis l'email. */
async function confirmEmail(f, email) {
  const token = randomBytes(32).toString("base64url");
  execFileSync("psql", [
    "-U",
    "postgres",
    "-h",
    "localhost",
    "-d",
    "crmlead_e2e",
    "-tA",
    "-c",
    `select 1 from auth_token_issue('verify', '${email}', '${createHash("sha256").update(token).digest("hex")}', '1 hour'::interval)`,
  ]);
  const r = await post(f, "/api/auth/verify", { token });
  if (r.status !== 200) throw new Error(`confirmation de ${email} : ${r.status}`);
}
async function userWith2fa(label) {
  const f = jar();
  const email = mail(label);
  const s = await post(f, "/api/auth/signup", {
    accountName: `R6A0 ${label}`,
    name: "R6 A0",
    email,
    password: PASS,
    locale: "fr",
  });
  if (s.status !== 200) throw new Error(`signup ${s.status}`);
  await confirmEmail(f, email);
  const { secret } = await (await post(f, "/api/auth/totp/begin", {})).json();
  const conf = await post(f, "/api/auth/totp/confirm", { code: totp(secret) });
  if (conf.status !== 200) throw new Error(`totp confirm ${conf.status} ${await conf.text()}`);
  await post(f, "/api/auth/logout", {});
  return { email, secret };
}
async function googleIn(page, url) {
  await page.goto(CRM + url);
  await page.getByRole("button", { name: /Google/ }).click();
  await page.waitForURL((u) => u.href.startsWith(`${GOOGLE}/auth`));
  await page.click("#ok");
  await page.waitForURL(/sso=totp/);
}
async function typeCode(page, code) {
  await page.fill("#auth-code", code);
  await page.getByRole("button", { name: /Valider|Bestätigen|Confirm/ }).click();
}
if (step("TOTP")) {
  for (const order of ["B puis A", "A puis B"]) {
    console.log(`TOTP (${order}) : chaque onglet garde son défi et sa destination`);
    const { email, secret } = await userWith2fa(`totp-${order[0]}`);
    persona = { sub: `g-e2e6-totp-${order[0]}-${stamp}`, email };
    const ctx = await browser.newContext({ locale: "fr-CH" });
    const toIl = [];
    await ctx.route("http://localhost:3300/**", (r) => {
      toIl.push(r.request().url());
      return r.abort();
    });
    const B = await ctx.newPage(),
      A = await ctx.newPage();
    await googleIn(B, "/login");
    const want = authorize();
    await googleIn(A, `/login?next=${encodeURIComponent(want)}`);
    check(
      "B : écran du code avec son onglet (t=)",
      /[?&]t=[A-Za-z0-9_-]{16}/.test(B.url()) && !/next=/.test(B.url()),
      B.url(),
    );
    check(
      "A : écran du code avec sa demande et son onglet",
      /next=/.test(A.url()) && /[?&]t=/.test(A.url()),
      A.url(),
    );
    check(
      "A : écran neutre (titre Compte Lead)",
      (await A.title()) === "Compte Lead",
      await A.title(),
    );
    const nav = [];
    A.on("framenavigated", (fr) => {
      if (fr === A.mainFrame()) nav.push(fr.url());
    });
    const first = order === "B puis A" ? B : A,
      second = order === "B puis A" ? A : B;
    await typeCode(first, totp(secret, 0));
    await first.waitForTimeout(2500);
    await typeCode(second, totp(secret, 1));
    await second.waitForTimeout(2500);
    const bUrl = B.url();
    const bMe = await B.evaluate(() => fetch("/api/auth/me").then((r) => r.json()));
    const bCode = await B.locator("#auth-code").count();
    const bText = (await B.evaluate(() => document.body.innerText))
      .replace(/\s+/g, " ")
      .slice(0, 120);
    check(
      "B (CRMlead direct) reste dans CRMlead, connecté, écran de CRMlead",
      bUrl.startsWith(CRM) &&
        !/oauth|3300/.test(bUrl) &&
        bMe?.user?.email === email &&
        bCode === 0 &&
        !/Compte Lead/.test(bText),
      `${bUrl} | ${bCode} | ${bText}`,
    );
    check(
      "B : titre CRMlead, pas Compte Lead",
      !/Compte Lead/.test(await B.title()),
      await B.title(),
    );
    const aWent = [...nav, ...toIl].some(
      (u) =>
        (u.includes("/oauth/authorize?") && u.includes("client_id=invoicelead")) ||
        u.startsWith("http://localhost:3300/auth/lead/callback"),
    );
    check(
      "A (InvoiceLead) part vers sa demande",
      aWent,
      JSON.stringify([...nav, ...toIl]).slice(0, 300),
    );
    check(
      "A : n'est pas resté sur l'écran du code",
      !/sso=totp/.test(A.url()) || toIl.length > 0,
      A.url(),
    );
    await ctx.close();
  }
}

// =============================================================== 3. couleur, icône d'écran d'accueil, adresses fabriquées
if (step("THEME")) {
  console.log(
    "THEME : la couleur d'action et les icônes de l'application, jamais celles de CRMlead",
  );
  const ctx = await browser.newContext({ locale: "fr-CH" });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const rgb = (sel, prop) =>
    page
      .locator(sel)
      .first()
      .evaluate((el, p) => getComputedStyle(el)[p], prop);
  await page.goto(`${CRM}/login?next=${encodeURIComponent(authorize())}`);
  await page.getByRole("button", { name: "Se connecter" }).waitFor();
  check(
    "bouton « Se connecter » prune",
    (await rgb('button:has-text("Se connecter")', "backgroundColor")) === "rgb(122, 46, 103)",
    await rgb('button:has-text("Se connecter")', "backgroundColor"),
  );
  check(
    "lien « Créer un compte » prune",
    (await rgb('a:has-text("Créer un compte")', "color")) === "rgb(122, 46, 103)",
    await rgb('a:has-text("Créer un compte")', "color"),
  );
  const banner = page.locator("text=Connectez-vous pour continuer vers InvoiceLead").locator("..");
  const bb = await banner.evaluate(
    (el) => getComputedStyle(el).borderTopColor + " | " + getComputedStyle(el).backgroundColor,
  );
  check("bandeau sans vert CRMlead", !/15, 111, 112|238, 246, 246/.test(bb), bb);
  const touch = () =>
    page.evaluate(() =>
      Array.from(document.querySelectorAll('link[rel="apple-touch-icon"]')).map((l) =>
        l.getAttribute("href"),
      ),
    );
  check(
    "après l'hydratation : seule l'icône d'écran d'accueil neutre",
    JSON.stringify(await touch()) === '["/lead-touch-icon.png"]',
    JSON.stringify(await touch()),
  );
  check(
    "attribut data-lead-app=invoicelead",
    (await page.evaluate(() => document.documentElement.dataset.leadApp)) === "invoicelead",
  );
  // Page arrivée avec la tête de CRMlead, puis écran d'une application, puis retour à CRMlead dans le même onglet.
  await page.goto(`${CRM}/login`);
  await page.getByRole("button", { name: "Se connecter" }).waitFor();
  await page.evaluate((n) => {
    history.pushState({}, "", "/signup?next=" + encodeURIComponent(n));
    dispatchEvent(new PopStateEvent("popstate"));
  }, authorize());
  await page.waitForTimeout(600);
  check(
    "écran d'une application ouvert dans l'onglet : prune et icône neutre",
    (await page.evaluate(() => document.documentElement.dataset.leadApp)) === "invoicelead" &&
      JSON.stringify(await touch()) === '["/lead-touch-icon.png"]',
    JSON.stringify(await touch()),
  );
  await page.evaluate(() => {
    history.pushState({}, "", "/conditions");
    dispatchEvent(new PopStateEvent("popstate"));
  });
  await page.waitForTimeout(500);
  check(
    "écran de CRMlead ensuite : data-lead-app retiré",
    (await page.evaluate(() => document.documentElement.dataset.leadApp)) === undefined,
  );
  check(
    "écran de CRMlead ensuite : son icône d'écran d'accueil revient",
    JSON.stringify(await touch()) === '["/apple-touch-icon.png"]',
    JSON.stringify(await touch()),
  );
  // Direct : le vert de CRMlead.
  await page.goto(`${CRM}/login`);
  await page.getByRole("button", { name: "Se connecter" }).waitFor();
  check(
    "CRMlead direct : bouton vert",
    (await rgb('button:has-text("Se connecter")', "backgroundColor")) === "rgb(15, 111, 112)",
  );
  check(
    "CRMlead direct : pas de data-lead-app",
    (await page.evaluate(() => document.documentElement.dataset.leadApp)) === undefined,
  );
  check(
    "CRMlead direct : icône CL",
    JSON.stringify(await touch()) === '["/apple-touch-icon.png"]',
    JSON.stringify(await touch()),
  );
  // Liens d'email : vérification et invitation au nom d'InvoiceLead.
  for (const u of [
    "/verification?jeton=abc&app=invoicelead&lang=fr",
    "/invitation?jeton=abc&app=invoicelead&lang=fr",
  ]) {
    await page.goto(CRM + u);
    await page.waitForTimeout(1200);
    check(
      `${u.split("?")[0]} : icône neutre et prune`,
      JSON.stringify(await touch()) === '["/lead-touch-icon.png"]' &&
        (await page.evaluate(() => document.documentElement.dataset.leadApp)) === "invoicelead",
      JSON.stringify(await touch()),
    );
  }
  // Lien « Continuer vers InvoiceLead » de la confirmation d'adresse : revérifie la session (fresh=1).
  await page.goto(`${CRM}/verification?jeton=abc&app=invoicelead&lang=fr`);
  await page.waitForTimeout(1500);
  const href = await page
    .locator('a:has-text("Continuer vers InvoiceLead")')
    .getAttribute("href")
    .catch(() => "");
  check(
    "Continuer vers InvoiceLead : fresh=1",
    /\/auth\/lead\/start\?locale=fr&fresh=1$/.test(href ?? ""),
    href,
  );
  // Adresses fabriquées.
  for (const u of [
    `/login?next=${encodeURIComponent("/oauth/authorize?client_id=constructor")}`,
    "/login?next=/oauth/authorize?client_id=constructor",
    "/verification?jeton=abc&app=constructor",
    "/invitation?jeton=abc&app=toString",
    "/invitation?jeton=abc&app=hasOwnProperty",
    "/verification?jeton=abc&app=__proto__",
  ]) {
    errors.length = 0;
    await page.goto(CRM + u);
    await page.waitForTimeout(1200);
    const text = (await page.evaluate(() => document.body.innerText)).trim();
    check(
      `${u} : pas de page blanche`,
      errors.length === 0 && text.length > 20,
      `${errors.join(" | ")} [${text.slice(0, 40)}]`,
    );
  }
  await ctx.close();
}

// =============================================================== 4. hors connexion au second saut d'un retour sans trace
if (step("SWOFF")) {
  for (const withApp of [true, false]) {
    console.log(
      `SWOFF (${withApp ? "onglet d'InvoiceLead" : "onglet direct de CRMlead"}) : retour de Google sans trace, réseau coupé`,
    );
    const ctx = await browser.newContext({ locale: "de-CH", serviceWorkers: "allow" });
    const page = await ctx.newPage();
    const want = authorize("de");
    await page.goto(withApp ? `${CRM}/login?next=${encodeURIComponent(want)}` : `${CRM}/login`);
    await page
      .waitForFunction(() => navigator.serviceWorker?.controller !== null, null, { timeout: 15000 })
      .catch(() => {});
    await page.reload();
    await page.waitForTimeout(500);
    const sw = await page.evaluate(() => !!navigator.serviceWorker?.controller);
    check("travailleur de service actif", sw);
    // Départ vers Google tel que parkForSso + markSsoStart le font.
    await page.evaluate((app) => {
      const k = "crmlead.leadid.next";
      if (app) {
        const raw = sessionStorage.getItem(k);
        if (raw) {
          sessionStorage.setItem(k + ".sso-parked", raw);
          sessionStorage.removeItem(k);
        }
      } else sessionStorage.removeItem(k + ".sso-parked");
      sessionStorage.setItem(k + ".sso", String(Date.now() + 5));
    }, withApp);
    await ctx.clearCookies();
    const off = (r) => r.abort("internetdisconnected");
    await ctx.route(/\/(login|signup)\?.*retour=/, off);
    const res = await page
      .goto(`${CRM}/api/auth/sso/google/callback?error=access_denied`)
      .catch((e) => e);
    await page.waitForTimeout(800);
    const title = await page.title();
    const body = await page.evaluate(() => document.body.innerText);
    const heads = await page.evaluate(() =>
      Array.from(document.querySelectorAll("link")).map(
        (l) => l.rel + ":" + l.getAttribute("href"),
      ),
    );
    check(
      "hors connexion : page neutre (Lead-Konto)",
      title === "Lead-Konto" && body.includes("Keine Internetverbindung"),
      `${title} | ${body.slice(0, 80)}`,
    );
    check(
      "hors connexion : rien de CRMlead",
      !/CRMlead/.test(body + title) &&
        !heads.some((h) => /favicon|apple-touch-icon\.png|manifest/.test(h)),
      JSON.stringify(heads),
    );
    if (withApp) {
      const parked = await page.evaluate(() =>
        sessionStorage.getItem("crmlead.leadid.next.sso-parked"),
      );
      check("hors connexion : la demande garée survit", !!parked);
      const color = await page.locator("#r").evaluate((el) => getComputedStyle(el).color);
      check(
        "hors connexion : lien « Erneut versuchen » prune",
        color === "rgb(122, 46, 103)",
        color,
      );
    }
    await ctx.unroute(/\/(login|signup)\?.*retour=/, off);
    await page.locator("#r").click();
    await page.waitForTimeout(2500);
    const after = page.url();
    if (withApp) {
      check(
        "réseau revenu : écran du Compte Lead avec sa demande",
        after.includes(`next=${encodeURIComponent(want)}`) && (await page.title()) === "Lead-Konto",
        `${after} | ${await page.title()}`,
      );
    } else {
      check(
        "réseau revenu : CRMlead pour un onglet direct",
        /\/login\?sso=canceled$|\/login$/.test(after) && /CRMlead/.test(await page.title()),
        `${after} | ${await page.title()}`,
      );
    }
    await ctx.close();
  }
}

// =============================================================== 5. adresse non canonique : la page repart sur la bonne
if (step("HOST")) {
  console.log("HOST : connexion Google commencée sur un autre nom du serveur");
  persona = { sub: `g-e2e6-host-${stamp}`, email: mail("host") };
  const f = jar();
  await post(f, "/api/auth/signup", {
    accountName: "R6A0 host",
    name: "R6",
    email: persona.email,
    password: PASS,
    locale: "fr",
  });
  await confirmEmail(f, persona.email);
  const ctx = await browser.newContext({ locale: "fr-CH" });
  const page = await ctx.newPage();
  await page.goto(`${CRM_HOST.protocol}//127.0.0.1:${CRM_HOST.port}/login`);
  check("la page repart sur l'adresse publique", page.url().startsWith(`${CRM}/login`), page.url());
  await page.getByRole("button", { name: /Google/ }).click();
  await page.waitForURL((u) => u.href.startsWith(`${GOOGLE}/auth`));
  await page.click("#ok");
  await page.waitForTimeout(2500);
  const me = await page.evaluate(() =>
    fetch("/api/auth/me")
      .then((r) => r.json())
      .catch(() => null),
  );
  check(
    "la connexion aboutit (session ouverte)",
    me?.user?.email === persona.email,
    `${page.url()} ${JSON.stringify(me)?.slice(0, 80)}`,
  );
  await ctx.close();
}

// =============================================================== 6. inscription depuis une application : repère de 113
if (step("QUIET")) {
  const f = jar();
  const email = mail("quiet");
  await post(f, "/api/auth/signup", {
    accountName: "R6A0 quiet",
    name: "R6",
    email,
    password: PASS,
    locale: "fr",
    app: "invoicelead",
  });
  const row = execFileSync("psql", [
    "-U",
    "postgres",
    "-h",
    "localhost",
    "-d",
    "crmlead_e2e",
    "-tA",
    "-c",
    `select lp.tips, lp.app_quiet_at is not null, np.digest, np.weekly_report from users u join lifecycle_prefs lp on lp.user_id = u.id join notification_prefs np on np.user_id = u.id where u.email = '${email}'`,
  ])
    .toString()
    .trim();
  check("inscription depuis InvoiceLead : silence et repère de 113", row === "f|t|off|f", row);
}

// =============================================================== 7 et 8 : lot 8 r8 (déconnexion, lien d'une pièce)
const crmSql = (q) =>
  execFileSync("psql", ["-U", "postgres", "-h", "localhost", "-d", "crmlead_e2e", "-tA", "-c", q])
    .toString()
    .trim();
/** Ouvre un compte CRMlead direct dans ce contexte (cookie de session posé), rend son adresse. */
async function signupIn(request, label, locale = "fr") {
  const email = mail(label);
  const s = await request.post(`${CRM}/api/auth/signup`, {
    data: { accountName: `R8 ${label}`, name: "R8", email, password: PASS, locale },
  });
  if (s.status() !== 200) throw new Error(`signup ${label} : ${s.status()} ${await s.text()}`);
  return email;
}
/** Les jetons qu'InvoiceLead reçoit pour la session de ce contexte (code + PKCE, avec offline_access). */
async function ilTokens(request) {
  const verifier = randomBytes(32).toString("base64url");
  const redirect = "http://localhost:3300/auth/lead/callback";
  const q = new URLSearchParams({
    response_type: "code",
    client_id: "invoicelead",
    redirect_uri: redirect,
    scope: "openid email profile lead offline_access",
    state: randomBytes(12).toString("base64url"),
    nonce: randomBytes(12).toString("base64url"),
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
  });
  const a = await request.get(`${CRM}/oauth/authorize?${q}`, { maxRedirects: 0 });
  const code = new URL(a.headers().location ?? "/", CRM).searchParams.get("code");
  if (!code) throw new Error(`autorisation : ${a.status()} ${a.headers().location}`);
  const t = await request.post(`${CRM}/oauth/token`, {
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
  if (!out.id_token || !out.refresh_token) throw new Error(`jetons : ${t.status()}`);
  return out;
}

if (step("LOGOUT")) {
  console.log(
    "LOGOUT (R8-SEC-3) : un autre site ne ferme la session du Compte Lead qu'avec le jeton de la personne",
  );
  const ctx = await browser.newContext({ locale: "fr-CH" });
  // InvoiceLead n'est pas appelé (retour de la déconnexion servi ici) ; evil.test est la page d'un autre site.
  await ctx.route("http://localhost:3300/**", (r) =>
    r.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<!doctype html><title>IL</title>InvoiceLead",
    }),
  );
  await ctx.route(/^https:\/\/invoicelead\.io\//, (r) => r.abort());
  let evil = "";
  await ctx.route("http://evil.test/**", (r) =>
    r.fulfill({ status: 200, contentType: "text/html", body: evil }),
  );
  const a = await signupIn(ctx.request, "logout-a");
  const tokA = await ilTokens(ctx.request);
  const other = await browser.newContext();
  await signupIn(other.request, "logout-b");
  const tokB = await ilTokens(other.request);
  await other.close();
  const me = async () =>
    (await (await ctx.request.get(`${CRM}/api/auth/me`)).json()).user?.email ?? null;
  const page = await ctx.newPage();
  /** Lien de déconnexion suivi depuis l'autre site ; rend la page d'où part la navigation (Referer). */
  const fromEvil = async (hint) => {
    const q = new URLSearchParams({
      client_id: "invoicelead",
      post_logout_redirect_uri: "http://localhost:3300/",
    });
    if (hint) q.set("id_token_hint", hint);
    evil = `<!doctype html><title>Autre site</title><a id="go" href="${CRM}/oauth/logout?${q}">Voir</a>`;
    await page.goto("http://evil.test/");
    const req = page.waitForRequest((r) => r.url().includes("/oauth/logout"));
    await page.click("#go");
    const from = (await (await req).allHeaders()).referer ?? "";
    await page.waitForURL(
      (u) => !u.href.includes("/oauth/logout") && !u.href.startsWith("http://evil.test"),
    );
    return from;
  };
  const s1 = await fromEvil(null);
  check("le lien part bien d'un autre site (evil.test)", s1.startsWith("http://evil.test/"), s1);
  check(
    "autre site, sans jeton : la session reste ouverte",
    (await me()) === a,
    String(await me()),
  );
  await fromEvil(tokB.id_token);
  check(
    "autre site, jeton d'une autre personne : la session reste",
    (await me()) === a,
    String(await me()),
  );
  await fromEvil(`${tokA.id_token.slice(0, -4)}AAAA`);
  check("autre site, jeton falsifié : la session reste", (await me()) === a, String(await me()));
  const stillRefresh = await ctx.request.post(`${CRM}/oauth/token`, {
    form: {
      grant_type: "refresh_token",
      refresh_token: tokA.refresh_token,
      client_id: "invoicelead",
      client_secret: process.env.LEAD_ID_CLIENT_SECRET ?? "lid_test_e2e_secret",
    },
  });
  const rotated = (await stillRefresh.json().catch(() => ({}))).refresh_token;
  check(
    "les jetons de rafraîchissement d'InvoiceLead restent valables",
    !!rotated,
    String(stillRefresh.status()),
  );
  // InvoiceLead (crmlead.io et invoicelead.io sont deux sites) : son propre jeton, même vieux, ferme tout.
  await fromEvil(tokA.id_token);
  check(
    "jeton de la personne (comme InvoiceLead) : la session est fermée",
    (await me()) === null,
    String(await me()),
  );
  const dead = await ctx.request.post(`${CRM}/oauth/token`, {
    form: {
      grant_type: "refresh_token",
      refresh_token: rotated ?? tokA.refresh_token,
      client_id: "invoicelead",
      client_secret: process.env.LEAD_ID_CLIENT_SECRET ?? "lid_test_e2e_secret",
    },
  });
  check(
    "et ses jetons de rafraîchissement sont révoqués",
    dead.status() >= 400,
    String(dead.status()),
  );
  check(
    "l'onglet revient sur InvoiceLead, jamais l'écran de CRMlead",
    page.url().startsWith("http://localhost:3300/"),
    page.url(),
  );
  // CRMlead direct : une adresse tapée (aucun autre site) déconnecte toujours, sans jeton.
  const back = await ctx.request.post(`${CRM}/api/auth/login`, {
    data: { email: a, password: PASS },
  });
  check(
    "reconnexion par mot de passe",
    back.status() === 200 && (await me()) === a,
    String(back.status()),
  );
  await page.goto(`${CRM}/oauth/logout?client_id=invoicelead`);
  check(
    "adresse tapée, sans jeton : la session est fermée",
    (await me()) === null,
    String(await me()),
  );
  await ctx.close();
}

if (step("OPENLINK")) {
  console.log(
    "OPENLINK (PD-R8-3) : « Ouvrir dans InvoiceLead » dans la langue de la personne, pas celle du client",
  );
  const ctx = await browser.newContext({ locale: "de-CH" });
  await ctx.route(/^https:\/\/(invoicelead\.io|example\.test)\//, (r) => r.abort());
  const email = await signupIn(ctx.request, "openlink", "de");
  const lead = crmSql(
    `insert into leads (account_id, pipeline_id, step_id, title, next_action_at)
     select u.account_id, p.id, st.id, 'Devis pour un client romand', now() + interval '1 day'
       from users u join pipelines p on p.account_id = u.account_id join pipeline_steps st on st.pipeline_id = p.id
      where u.email = '${email}' order by st.position limit 1 returning id`,
  ).split("\n")[0];
  const ext = randomBytes(8).toString("hex");
  // L'adresse qu'InvoiceLead envoie : dans la langue du document (celle du client, ici le français).
  crmSql(
    `insert into lead_documents (account_id, lead_id, app, external_id, kind, number, status, total_cents, currency, issue_date, url)
     select account_id, id, 'invoicelead', '${ext}', 'quote', 'D-R8-1', 'sent', 120000, 'CHF', current_date,
            'https://invoicelead.io/fr/app/quotes/${ext}?from=crm#lignes'
       from leads where id = '${lead}';
     insert into lead_documents (account_id, lead_id, app, external_id, kind, number, status, total_cents, currency, issue_date, url)
     select account_id, id, 'other', '${ext}-x', 'invoice', 'F-R8-2', 'sent', 5000, 'CHF', current_date,
            'https://example.test/fr/app/invoices/${ext}'
       from leads where id = '${lead}'`,
  );
  const page = await ctx.newPage();
  await page.goto(`${CRM}/leads/${lead}`);
  await page.waitForSelector('[data-testid="lead-invoices"] li a');
  const hrefs = await page.$$eval('[data-testid="lead-invoices"] li a', (as) =>
    as.map((x) => x.getAttribute("href")),
  );
  const lang = await page.evaluate(() => document.documentElement.lang);
  check("écran CRMlead en allemand", /^de/.test(lang), lang);
  check(
    "pièce d'InvoiceLead en français : le lien s'ouvre en allemand, recherche et ancre gardées",
    hrefs.includes(`https://invoicelead.io/de/app/quotes/${ext}?from=crm#lignes`),
    hrefs.join(" "),
  );
  check(
    "une autre adresse passe telle quelle",
    hrefs.includes(`https://example.test/fr/app/invoices/${ext}`),
    hrefs.join(" "),
  );
  await ctx.close();
}

await browser.close();
g.close();
console.log(fails ? `\n${fails} échec(s)` : "\ntout est vert");
process.exit(fails ? 1 : 0);
