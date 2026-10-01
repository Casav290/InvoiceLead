import { chromium } from "playwright";

const SP = process.argv[2] ?? "/tmp";
const IL = "http://localhost:3300",
  CRM = "http://localhost:3301";
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "fr-CH" });
const events = [];
await ctx.exposeBinding("__report", (_src, s) => {
  events.push({ t: Date.now(), ...s });
});
await ctx.addInitScript(() => {
  const snap = (why) => {
    try {
      const leaves = Array.from(document.querySelectorAll("body *")).filter(
        (e) => e.children.length === 0,
      );
      const crmBrand = leaves.some(
        (e) => e.textContent?.trim() === "CRMlead" && e.getBoundingClientRect().height > 0,
      );
      const tagline = (document.body?.innerText ?? "").includes("ne laisse aucun lead sans suite");
      const ssr = !!document.getElementById("ssr");
      const suite = !!document.querySelector('[data-testid="suite-brand"]');
      window.__report({
        why,
        url: location.href.slice(0, 90),
        title: document.title,
        crmBrand,
        tagline,
        ssr,
        suite,
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
  });
});
const page = await ctx.newPage();
const stamp = Date.now();
const email = `eve+${stamp}@example.test`;
const pass = "Tr3s-l0ng-mot-de-passe-unique-" + stamp;
const out = {};
async function step(name, fn) {
  const from = events.length;
  try {
    await fn();
    out[name] = "ok";
  } catch (e) {
    out[name] = "ERREUR " + String(e).slice(0, 300);
    await page.screenshot({ path: `${SP}/e2e-${name}-fail.png` });
  }
  const evs = events.slice(from);
  const bad = evs.filter((e) => e.crmBrand || e.tagline || e.ssr || /^CRMlead/.test(e.title));
  const uniq = [
    ...new Map(
      evs.map((e) => [`${e.url}|${e.title}|${e.suite}|${e.crmBrand}|${e.text.slice(0, 40)}`, e]),
    ).values(),
  ];
  console.log(
    `\n=== ${name}: ${out[name]} — ${evs.length} relevés, ${bad.length} avec CRMlead visible`,
  );
  for (const e of uniq)
    console.log(
      `  ${e.crmBrand || e.tagline || e.ssr || /^CRMlead/.test(e.title) ? "!!" : "  "} ${e.url} | title=${e.title} | suite=${e.suite} | ${e.text}`,
    );
}
// 1. Inscription depuis « Créer un compte » sur invoicelead.io
await step("inscription", async () => {
  await page.goto(`${IL}/fr`);
  await page.locator('header a[href*="signup=1"]').first().click();
  await page.waitForURL(`${CRM}/signup**`);
  await page.screenshot({ path: `${SP}/e2e-signup-screen.png` });
  await page.fill("#auth-account", "Atelier Test");
  await page.fill("#auth-name", "Eve Test");
  await page.fill("#auth-email", email);
  await page.fill("#auth-password", pass);
  await page.locator("form button[type=submit], form button:not([type])").last().click();
  await page.waitForURL(`${IL}/fr/app**`, { timeout: 20000 });
  await page.screenshot({ path: `${SP}/e2e-after-signup.png` });
});
// 2. Déconnexion d'InvoiceLead puis Connexion (Compte Lead peut-être encore ouvert)
await step("reconnexion", async () => {
  await ctx.clearCookies({ domain: "localhost" }).catch(() => {});
  await ctx.clearCookies();
  await page.goto(`${IL}/fr`);
  await page.locator('header a[href="/auth/lead/start?locale=fr"]').first().click();
  await page.waitForURL(`${CRM}/login**`);
  await page.waitForSelector('[data-testid="suite-brand"]');
  await page.screenshot({ path: `${SP}/e2e-login-screen.png` });
  await page.fill("#auth-email", email);
  await page.fill("#auth-password", pass);
  await page.locator("form button").last().click();
  await page.waitForURL(`${IL}/fr/app**`, { timeout: 20000 });
});
// 3. Lien profond : déconnecté d'InvoiceLead, encore connecté au Compte Lead
await step("lien-profond-deja-connecte", async () => {
  // Session InvoiceLead fermée, Compte Lead toujours ouvert : retour silencieux sur la page demandée.
  const keep = (await ctx.cookies()).filter((c) => c.name !== "il_session");
  await ctx.clearCookies();
  await ctx.addCookies(keep);
  console.log("cookies gardés:", keep.map((c) => c.name).join(","));
  await page.goto(`${IL}/fr/app/invoices`);
  await page.waitForURL(`${IL}/fr/app/invoices**`, { timeout: 20000 });
});
console.log("\nRESULTATS", JSON.stringify(out));
await browser.close();
