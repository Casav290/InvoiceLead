// Contrôle sans tête du passage entre applications sur une prévisualisation Vercel d'InvoiceLead.
//
//   node scripts/preview-passage-check.mjs https://<prévisualisation>.vercel.app
//
// La prévisualisation n'a pas de base : on vérifie le proxy sur Vercel (racine, en-têtes, robots,
// /login), l'essai silencieux auprès du vrai Compte Lead (erplead.io, prompt=none) et le retour sur la
// page publique, sans écran d'erreur ni boucle. Le retour du Compte Lead vise l'adresse enregistrée
// (invoicelead.io) : il est rejoué sur la prévisualisation quand la personne n'est pas connectée ;
// connectée (personne TEST du banc ~/projets/lead-e2e), on constate seulement que le Compte Lead rend
// un code sans écran, jamais échangé. Protection Vercel : jeton de contournement dans
// ~/.invoicelead-vercel-bypass (ou INVOICELEAD_BYPASS_FILE). Aucun mot de passe affiché.
// Sortie : PREVIEW_PASSAGE_OK.
import { readFileSync } from "node:fs";
import { chromium } from "@playwright/test";

const PREVIEW = (process.argv[2] ?? "").replace(/\/+$/, "");
if (!PREVIEW.startsWith("https://")) throw new Error("adresse de la prévisualisation attendue");
const BYPASS = readFileSync(
  process.env.INVOICELEAD_BYPASS_FILE ?? `${process.env.HOME}/.invoicelead-vercel-bypass`,
  "utf8",
).trim();
const state = JSON.parse(
  readFileSync(
    process.env.LEAD_E2E_STATE ?? `${process.env.HOME}/projets/lead-e2e/state.json`,
    "utf8",
  ),
);
const who = state.orgs[0].people[0];
const results = [];
const check = (name, ok, detail = "") => {
  results.push(ok);
  console.log(`${ok ? "ok " : "NON"} ${name}${detail ? ` : ${detail}` : ""}`);
};
const clean = (u) =>
  u.replace(/([?&](code|state|nonce|code_challenge|id_token_hint)=)[^&]+/g, "$1…");

const NAV = {
  "accept-language": "fr-CH,fr;q=0.9",
  "sec-fetch-mode": "navigate",
  "sec-fetch-dest": "document",
  "user-agent":
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/141.0 Safari/537.36",
};
/**
 * Suit les redirections comme une navigation (cookies du contexte). Le retour du Compte Lead vise
 * l'adresse enregistrée (invoicelead.io) : rejoué sur la prévisualisation, ou arrêt (stopAtCallback).
 */
async function walk(ctx, url, { stopAtCallback = false } = {}) {
  const hops = [];
  for (let i = 0; i < 15; i++) {
    hops.push(url);
    if (url.startsWith("https://invoicelead.io/auth/lead/callback")) {
      if (stopAtCallback) return { hops, final: url };
      url = PREVIEW + url.slice("https://invoicelead.io".length);
      hops.push(url);
    }
    const r = await ctx.request.get(url, { maxRedirects: 0, headers: NAV });
    const loc = r.headers().location;
    if (r.status() >= 300 && r.status() < 400 && loc) {
      url = new URL(loc, url).href;
      continue;
    }
    return { hops, final: url, status: r.status() };
  }
  return { hops, final: url, status: 0 };
}

const browser = await chromium.launch();
async function context() {
  const ctx = await browser.newContext({ locale: "fr-CH" });
  // Cookie de contournement de la protection Vercel, sur la prévisualisation seulement.
  const r = await ctx.request.get(`${PREVIEW}/robots.txt`, {
    headers: { "x-vercel-protection-bypass": BYPASS, "x-vercel-set-bypass-cookie": "samesitenone" },
  });
  if (!r.ok()) throw new Error(`contournement refusé : ${r.status()}`);
  return ctx;
}
function chain(page) {
  const seen = [];
  page.on("request", (req) => {
    if (req.isNavigationRequest() && req.frame() === page.mainFrame()) seen.push(req.url());
  });
  return seen;
}

// A. Personne déconnectée : un seul essai silencieux, puis la page publique.
{
  const ctx = await context();
  const head = await ctx.request.get(`${PREVIEW}/`, { maxRedirects: 0, headers: NAV });
  check(
    "A0 racine : 303 vers le départ silencieux, no-store et Vary: Cookie",
    head.status() === 303 &&
      (head.headers().location ?? "").includes("/auth/lead/start?prompt=none&from=%2F") &&
      head.headers()["cache-control"] === "no-store" &&
      /cookie/i.test(head.headers().vary ?? ""),
    `${head.status()} ${head.headers()["cache-control"]} vary=${head.headers().vary}`,
  );
  const { hops, final, status } = await walk(ctx, `${PREVIEW}/`);
  console.log("   chemin :", hops.map(clean).join("\n            "));
  const authorize = hops.find((u) => u.startsWith("https://erplead.io/oauth/authorize"));
  check(
    "A1 racine sans session : départ silencieux",
    hops.some((u) => u.startsWith(`${PREVIEW}/auth/lead/start?prompt=none&from=%2F`)),
  );
  check(
    "A2 le Compte Lead est appelé avec prompt=none, sans langue imposée",
    !!authorize &&
      new URL(authorize).searchParams.get("prompt") === "none" &&
      !new URL(authorize).searchParams.get("ui_locales"),
  );
  const back = hops.filter((u) => u.startsWith("https://invoicelead.io/auth/lead/callback"));
  check(
    "A3 erplead.io répond login_required, sans écran",
    back.length === 1 &&
      new URL(back[0]).searchParams.get("error") === "login_required" &&
      !hops.some((u) => /erplead\.io\/login/.test(u)),
  );
  check(
    "A4 arrivée sur la page publique (une seule fois par le Compte Lead)",
    status === 200 &&
      new URL(final).host === new URL(PREVIEW).host &&
      new URL(final).pathname === "/fr" &&
      hops.filter((u) => new URL(u).host === "erplead.io").length === 1,
    clean(final),
  );
  const page = await ctx.newPage();
  const seen = chain(page);
  await page.goto(final);
  await page.waitForLoadState("networkidle");
  check(
    "A5 page de vente, aucun écran d'erreur",
    /Du devis à l.encaissement/.test(await page.content()) &&
      !(await page.content()).includes("Connexion impossible") &&
      !page.url().includes("erreur"),
  );
  const probe = (await ctx.cookies(PREVIEW)).find((c) => c.name === "lead_probe");
  check(
    "A6 lead_probe posé (lisible, Lax)",
    probe?.value === "1" && probe.httpOnly === false && probe.sameSite === "Lax",
  );
  const before = seen.length;
  await page.goto(`${PREVIEW}/`);
  await page.waitForLoadState("networkidle");
  check(
    "A7 deuxième chargement au navigateur : pas de nouveau passage par erplead.io",
    !seen.slice(before).some((u) => new URL(u).host === "erplead.io") &&
      new URL(page.url()).pathname === "/fr",
    seen.slice(before).map(clean).join(" → "),
  );
  const bot = await ctx.request.get(`${PREVIEW}/fr`, {
    headers: {
      "user-agent": "Mozilla/5.0 (compatible; Googlebot/2.1)",
      "sec-fetch-mode": "navigate",
      "sec-fetch-dest": "document",
    },
    maxRedirects: 0,
  });
  check("A8 Googlebot : 200 sans redirection", bot.status() === 200);
  // /login : l'écran de connexion d'ERPlead aux couleurs d'InvoiceLead.
  const login = await ctx.newPage();
  const loginSeen = chain(login);
  await login.goto(`${PREVIEW}/login`);
  await login.waitForLoadState("networkidle");
  const at = new URL(login.url());
  check(
    "A10 /login sans session : écran de connexion d'ERPlead, départ sans langue",
    at.host === "erplead.io" &&
      at.pathname === "/login" &&
      loginSeen.some((u) => u === `${PREVIEW}/auth/lead/start`),
    clean(login.url()),
  );
  check("A11 écran aux couleurs d'InvoiceLead", /InvoiceLead/.test(await login.content()));
  await ctx.close();
}

// B. Personne TEST connectée au Compte Lead : le Compte Lead rend un code sans écran.
{
  const ctx = await context();
  const r = await ctx.request.post("https://erplead.io/login", {
    form: { email: who.email, password: who.password, next: "/account" },
    headers: { origin: "https://erplead.io" },
    maxRedirects: 0,
  });
  check("B0 personne TEST connectée sur erplead.io", r.status() === 303);
  // Arrêt au retour vers invoicelead.io : pas d'échange (la prévisualisation n'a pas de base), le code
  // n'est jamais utilisé.
  const { hops, final } = await walk(ctx, `${PREVIEW}/`, { stopAtCallback: true });
  console.log("   chemin :", hops.map(clean).join("\n            "));
  check(
    "B1 racine : départ silencieux puis erplead.io sans écran",
    hops.some((u) => u.startsWith(`${PREVIEW}/auth/lead/start?prompt=none`)) &&
      hops.some((u) => u.startsWith("https://erplead.io/oauth/authorize")) &&
      !hops.some((u) => /erplead\.io\/(login|signup)/.test(u)),
  );
  const cb = new URL(final);
  check(
    "B2 erplead.io rend un code (session ouverte), pas d'erreur",
    cb.pathname === "/auth/lead/callback" &&
      !!cb.searchParams.get("code") &&
      !cb.searchParams.get("error"),
  );
  // Se déconnecter d'ERPlead (session TEST seulement).
  await ctx.request
    .post("https://erplead.io/logout", {
      headers: { origin: "https://erplead.io" },
      maxRedirects: 0,
    })
    .catch(() => null);
  await ctx.close();
}

await browser.close();
const ok = results.every(Boolean);
console.log(ok ? "PREVIEW_PASSAGE_OK" : "PREVIEW_PASSAGE_KO");
process.exit(ok ? 0 : 1);
