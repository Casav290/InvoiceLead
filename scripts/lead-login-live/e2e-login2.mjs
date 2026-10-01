import { readFileSync } from "node:fs";
import { chromium } from "playwright";

const SP = process.argv[2] ?? "/tmp";
const IL = "http://localhost:3300",
  CRM = "http://localhost:3301";
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "fr-CH" });
const events = [];
await ctx.exposeBinding("__report", (_s, s) => {
  events.push(s);
});
await ctx.addInitScript(() => {
  const snap = (why) => {
    try {
      if (!location.href.startsWith("http://localhost:3301")) return;
      const leaves = Array.from(document.querySelectorAll("body *")).filter(
        (e) => e.children.length === 0,
      );
      const crmBrand = leaves.some(
        (e) => e.textContent?.trim() === "CRMlead" && e.getBoundingClientRect().height > 0,
      );
      const tagline = (document.body?.innerText ?? "").includes("ne laisse aucun lead sans suite");
      const icon = document.querySelector('link[rel="icon"]')?.getAttribute("href") ?? "";
      window.__report({
        why,
        url: location.pathname + location.search.slice(0, 40),
        title: document.title,
        crmBrand,
        tagline,
        ssr: !!document.getElementById("ssr"),
        crmIcon: icon.includes("favicon"),
        dashboard: /Mes actions|My actions|Pipeline/.test(document.body?.innerText ?? ""),
        text: (document.body?.innerText ?? "").replace(/\s+/g, " ").slice(0, 60),
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
const results = {};
const isBad = (e) =>
  e.crmBrand || e.tagline || e.ssr || /CRMlead/.test(e.title) || e.crmIcon || e.dashboard;
async function step(name, fn) {
  const from = events.length;
  let ok = "ok";
  try {
    await fn();
  } catch (e) {
    ok = "ERREUR " + String(e).split("\n")[0].slice(0, 200);
    await page.screenshot({ path: `${SP}/e2e2-${name}.png` });
  }
  const evs = events.slice(from);
  const bad = evs.filter(isBad);
  results[name] = `${ok} | ${evs.length} relevés CRMlead, ${bad.length} avec CRMlead visible`;
  console.log(`\n=== ${name}: ${results[name]}`);
  const uniq = [
    ...new Map(
      evs.map((e) => [`${e.url}|${e.title}|${e.text.slice(0, 30)}|${isBad(e)}`, e]),
    ).values(),
  ];
  for (const e of uniq.slice(0, 12))
    console.log(`  ${isBad(e) ? "!!" : "  "} ${e.url} | ${e.title} | ${e.text}`);
}
const crmLog = () => readFileSync(process.env.CRM_LOG ?? `${SP}/crm.log`, "utf8");
const logStart = crmLog().length;

await step("inscription", async () => {
  await page.goto(`${IL}/fr`);
  await page.locator('header a[href*="signup=1"]').first().click();
  await page.waitForURL(`${CRM}/signup**`);
  await page.fill("#auth-account", "Atelier Test");
  await page.fill("#auth-name", "Eve Test");
  await page.fill("#auth-email", email);
  await page.fill("#auth-password", pass);
  await page.locator("form button").last().click();
  await page.waitForURL(`${IL}/fr/app**`, { timeout: 20000 });
});
await step("emails-inscription", async () => {
  const log = crmLog().slice(logStart);
  const lines = log.split("\n").filter((l) => l.includes("[email simulé]"));
  console.log(lines.join("\n"));
  if (lines.some((l) => /CRMlead|Bienvenue|Welcome/i.test(l)))
    throw new Error("email CRMlead envoyé");
});
await step("bouton-retour", async () => {
  await page.goBack();
  await page.waitForTimeout(2500);
  console.log("  URL après Retour:", page.url());
  if (page.url().startsWith(CRM) && !/oauth/.test(page.url())) {
    await page.waitForTimeout(2500);
    console.log("  URL 2.5 s plus tard:", page.url());
    if (page.url().startsWith(CRM)) throw new Error("resté sur crmlead: " + page.url());
  }
});
await step("mot-de-passe-oublie", async () => {
  await ctx.clearCookies();
  await page.goto(`${IL}/fr`);
  await page.locator('header a[href="/auth/lead/start?locale=fr"]').click();
  await page.waitForURL(`${CRM}/login**`);
  await page.getByRole("link", { name: /Mot de passe oublié/ }).click();
  await page.waitForURL(`${CRM}/mot-de-passe?next=**`);
  await page.fill("#auth-email", email);
  await page.locator("form button").last().click();
  await page
    .getByText(/envoyé|lien/i)
    .first()
    .waitFor({ timeout: 10000 })
    .catch(() => {});
  await page.waitForTimeout(1500);
  console.log(
    "  écran:",
    (await page.locator("form, main, body").first().innerText()).replace(/\s+/g, " ").slice(0, 160),
  );
  const lines = crmLog()
    .split("\n")
    .filter((l) => l.includes("[email simulé]"))
    .slice(-1);
  console.log("  " + lines.join("\n"));
  if (!/Compte Lead/.test(lines[0] ?? ""))
    throw new Error("email de réinitialisation pas au nom du Compte Lead");
  await page.getByRole("link", { name: /Retour à la connexion/ }).click();
  await page.waitForURL(`${CRM}/login?next=**`);
  await page.fill("#auth-email", email);
  await page.fill("#auth-password", pass);
  await page.locator("form button").last().click();
  await page.waitForURL(`${IL}/fr/app**`, { timeout: 20000 });
});
await step("retour-google-annule", async () => {
  await ctx.clearCookies();
  await page.goto(`${IL}/auth/lead/start?locale=fr`);
  await page.waitForURL(`${CRM}/login**`);
  const next = new URL(page.url()).searchParams.get("next");
  await page.goto(`${CRM}/login?sso=canceled&next=${encodeURIComponent(next)}`);
  await page.waitForSelector('[data-testid="suite-brand"]');
  await page.fill("#auth-email", email);
  await page.fill("#auth-password", pass);
  await page.locator("form button").last().click();
  await page.waitForURL(`${IL}/fr/app**`, { timeout: 20000 });
});
await step("confirmation-adresse", async () => {
  await page.goto(`${CRM}/verification?jeton=faux&app=invoicelead`);
  await page.getByRole("link", { name: "Continuer vers InvoiceLead" }).waitFor();
});
await step("langue-allemande", async () => {
  await ctx.clearCookies();
  await page.goto(`${IL}/auth/lead/start?locale=de`);
  await page.waitForURL(`${CRM}/login**`);
  await page.waitForSelector('[data-testid="suite-brand"]');
  const t = await page.locator("h1").first().innerText();
  console.log("  titre:", t, "| onglet:", await page.title());
  if (!/Anmeld/.test(t)) throw new Error("pas en allemand: " + t);
});
console.log("\nRESULTATS", JSON.stringify(results, null, 1));
await browser.close();
