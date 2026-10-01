import { execSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { chromium } from "playwright";

const IL = "http://localhost:3300",
  CRM = "http://localhost:3301";
const psql = (q) =>
  execSync(`psql -U postgres -h localhost -d crmlead_e2e -tA -c "${q}"`).toString().trim();
const browser = await chromium.launch();
const results = {};
async function step(name, fn) {
  try {
    await fn();
    results[name] = "ok";
  } catch (e) {
    results[name] = "ERREUR " + String(e).split("\n")[0].slice(0, 250);
  }
  console.log(`=== ${name}: ${results[name]}`);
}
const stamp = Date.now();
const email = `reset+${stamp}@example.test`;
const pass = "Tr3s-l0ng-mot-de-passe-unique-" + stamp;
const ctx = await browser.newContext({ locale: "fr-CH" });
const p = await ctx.newPage();
await p.goto(`${IL}/auth/lead/start?locale=fr&signup=1`);
await p.waitForURL(`${CRM}/signup**`);
await p.fill("#auth-account", "Reset Sàrl");
await p.fill("#auth-name", "Eve");
await p.fill("#auth-email", email);
await p.fill("#auth-password", pass);
await p.locator("form button").last().click();
await p.waitForURL(`${IL}/fr/app**`, { timeout: 20000 });
const realNext = async () => {
  const r = await ctx.request
    .get(`${CRM}/oauth/authorize?x=1`, { maxRedirects: 0 })
    .catch(() => null);
  return null;
};

await step("retour à la connexion depuis le lien, déjà connecté", async () => {
  // Une vraie demande d'InvoiceLead (state valable), comme celle que porte le lien de l'email.
  const keep = (await ctx.cookies()).filter((c) => c.name !== "il_session");
  await ctx.clearCookies();
  await ctx.addCookies(keep);
  const s = await ctx.request.get(`${IL}/auth/lead/start?locale=fr&next=%2Ffr%2Fapp%2Finvoices`, {
    maxRedirects: 0,
  });
  const authorize = new URL(s.headers().location);
  const next = authorize.pathname + authorize.search;
  const token = randomBytes(32).toString("base64url");
  psql(
    `select * from auth_token_issue('reset', '${email}', '${createHash("sha256").update(token).digest("hex")}', '1 hour'::interval)`,
  );
  const pg = await ctx.newPage();
  await pg.goto(`${CRM}/mot-de-passe?jeton=${token}&next=${encodeURIComponent(next)}`);
  await pg.waitForSelector("#auth-password");
  await pg.getByRole("link", { name: /Retour à la connexion/ }).click();
  await pg.waitForURL(`${IL}/fr/app/invoices`, { timeout: 20000 }).catch(async (e) => {
    console.log("  fin:", pg.url());
    throw e;
  });
  await pg.close();
});

await step("nouveau mot de passe dans un autre onglet, l'onglet d'origine repart", async () => {
  await ctx.clearCookies();
  const origin = await ctx.newPage();
  await origin.goto(`${IL}/auth/lead/start?locale=fr&next=%2Ffr%2Fapp%2Fquotes`);
  await origin.waitForURL(`${CRM}/login**`);
  await origin.getByRole("link", { name: /Mot de passe oublié/ }).click();
  await origin.waitForURL(`${CRM}/mot-de-passe**`);
  await origin.fill("#auth-email", email);
  await origin.locator("form button").last().click();
  await origin.waitForTimeout(1500);
  // L'email : son lien, ouvert dans un autre onglet (le jeton est posé ici, l'adresse du lien est la même).
  const next = new URL(origin.url()).searchParams.get("next");
  const token = randomBytes(32).toString("base64url");
  psql(
    `select * from auth_token_issue('reset', '${email}', '${createHash("sha256").update(token).digest("hex")}', '1 hour'::interval)`,
  );
  const mail = await ctx.newPage();
  await mail.goto(`${CRM}/mot-de-passe?jeton=${token}&next=${encodeURIComponent(next)}`);
  await mail.fill("#auth-password", pass + "x");
  await mail.locator("form button").last().click();
  await mail.waitForURL(`${IL}/fr/app/quotes`, { timeout: 20000 }).catch(async (e) => {
    console.log("  mail fin:", mail.url(), (await mail.locator("body").innerText()).slice(0, 200));
    throw e;
  });
  await origin.bringToFront();
  await origin.evaluate(() => window.dispatchEvent(new Event("focus")));
  await origin.waitForURL(`${IL}/fr/app/quotes`, { timeout: 20000 }).catch(async (e) => {
    console.log("  origine fin:", origin.url());
    throw e;
  });
});
console.log("\nRESULTATS", JSON.stringify(results));
await browser.close();
