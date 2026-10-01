/**
 * Parcours du lot 5 (01.10.2026) : chaque défaut corrigé, rejoué de bout en bout sur la pile locale
 * (InvoiceLead 3300, CRMlead 3301). Une étape par défaut, nommée d'après lui.
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
 * - ONLY=<motif> : seulement les étapes dont le nom correspond ; DEBUG_NAV=1 : navigations de l'étape
 *   « envoi après expiration ».
 *
 * Comptes : eve+e2e5-<étape>-<horodatage>@example.test.
 */
import { execFileSync } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFileSync, unlinkSync, writeFileSync } from "node:fs";
import http from "node:http";

// Le travailleur de service de CRMlead passe par le réseau du contexte : couper CRMlead le coupe aussi.
process.env.PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS = "1";
const { chromium } = await import("playwright");

const SP = process.argv[2] ?? "/tmp";
const IL = "http://localhost:3300",
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
  expect((await p.locator('link[rel~="icon"]').count()) === 0, "icône de CRMlead");
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

await step("IL-NEXT-500 : un lien d'import long survit à la reconnexion", async () => {
  const ctx = await newCtx(browser, "fr-CH", "imp");
  const p = await ctx.newPage();
  await signupFromIl(p, "fr", "imp");
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
    // S2 : retour du Compte Lead en erreur pendant la connexion d'une invitation.
    const t2 = fiduciaryInvite(OWNER, email);
    await dropCookies(ctx, (n) => n === "il_session");
    const { url } = await ilAuthorize(ctx, `locale=fr&invite=${t2}`);
    const back = await ctx.request.get(url, { maxRedirects: 0 });
    const cb = new URL(back.headers().location);
    expect(cb.href.startsWith(`${IL}/auth/lead/callback?`), `S2 retour : ${cb.href}`);
    cb.searchParams.set("code", "falsifie");
    await p.goto(cb.href);
    await waitAt(p, `${IL}/fr/login?erreur=lead&invite=${t2}`, "S2 écran d'erreur");
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
    const quiet = await make("legacy", false);
    const kept = await make("legacy-lead", true);
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
    const prefs = (email) =>
      crmq(
        `select coalesce(p.digest, '-') || '|' || coalesce(p.weekly_report::text, '-') || '|' || coalesce(l.tips::text, '-')
         from users u left join notification_prefs p on p.user_id = u.id left join lifecycle_prefs l on l.user_id = u.id
        where u.email = '${email}'`,
      );
    expect(prefs(quiet) === "off|false|false", `compte InvoiceLead : ${prefs(quiet)}`);
    expect(!/false/.test(prefs(kept)), `compte CRMlead avec un vrai lead : ${prefs(kept)}`);
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
  const neutralHead = (h) =>
    !/CRMlead/.test(h.title) &&
    h.links.length > 0 &&
    h.links.every((l) => l.startsWith("icon=data:image/svg"));
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
}

console.log("\nRESULTATS", JSON.stringify(results, null, 1));
await browser.close();
gServer?.close();
