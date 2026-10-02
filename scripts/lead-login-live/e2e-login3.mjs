import { execSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { chromium } from "playwright";

const IL = "http://localhost:3300",
  CRM = "http://localhost:3301";
const psql = (q) =>
  execSync(`psql -U postgres -h localhost -d crmlead_e2e -tA -c "${q.replace(/"/g, '\\"')}"`)
    .toString()
    .trim();
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
const email = `onglets+${stamp}@example.test`;
const pass = "Tr3s-l0ng-mot-de-passe-unique-" + stamp;
const ctx = await browser.newContext({ locale: "fr-CH" });
const p1 = await ctx.newPage();

await step("inscription + réglages CRMlead coupés", async () => {
  await p1.goto(`${IL}/auth/lead/start?locale=fr&signup=1`);
  await p1.waitForURL(`${CRM}/signup**`);
  await p1.fill("#auth-account", "Onglets Sàrl");
  await p1.fill("#auth-name", "Eve");
  await p1.fill("#auth-email", email);
  await p1.fill("#auth-password", pass);
  await p1.locator("form button").last().click();
  await p1.waitForURL(`${IL}/fr/app**`, { timeout: 20000 });
  const prefs = psql(
    `select p.digest, p.weekly_report, coalesce(l.tips, true) from users u join notification_prefs p on p.user_id = u.id left join lifecycle_prefs l on l.user_id = u.id where u.email = '${email}'`,
  );
  const welcome = psql(
    `select count(*) from lifecycle_emails e join users u on u.id = e.user_id where u.email = '${email}' and e.kind = 'welcome' and e.sent_at is not null`,
  );
  console.log("  prefs (digest|weekly|tips):", prefs, "| bienvenue CRMlead neutralisée:", welcome);
  if (prefs !== "off|f|f" || welcome !== "1") throw new Error("emails CRMlead pas coupés");
});

await step("deuxième onglet", async () => {
  await ctx.clearCookies();
  const a = await ctx.newPage();
  const b = await ctx.newPage();
  await a.goto(`${IL}/auth/lead/start?locale=fr&next=%2Ffr%2Fapp%2Finvoices`);
  await a.waitForURL(`${CRM}/login**`);
  await b.goto(`${IL}/auth/lead/start?locale=fr&next=%2Ffr%2Fapp%2Fquotes`);
  await b.waitForURL(`${CRM}/login**`);
  await a.bringToFront();
  await a.fill("#auth-email", email);
  await a.fill("#auth-password", pass);
  await a.locator("form button").last().click();
  await a.waitForURL(`${IL}/fr/app/invoices`, { timeout: 20000 });
  await b.bringToFront();
  await b.evaluate(() => window.dispatchEvent(new Event("focus")));
  await b.waitForURL(`${IL}/fr/app/quotes`, { timeout: 20000 });
  await a.close();
  await b.close();
});

await step("lien de réinitialisation ouvert déjà connecté", async () => {
  // Connecté au Compte Lead (étape précédente). Un jeton de réinitialisation, comme dans l'email.
  const token = randomBytes(32).toString("base64url");
  const hash = createHash("sha256").update(token).digest("hex");
  psql(`select * from auth_token_issue('reset', '${email}', '${hash}', '1 hour'::interval)`);
  const pg = await ctx.newPage();
  await pg.goto(`${IL}/auth/lead/start?locale=fr`); // session IL déjà ouverte : direct dans l'app
  const next =
    "/oauth/authorize?client_id=invoicelead&response_type=code&redirect_uri=http%3A%2F%2Flocalhost%3A3300%2Fauth%2Flead%2Fcallback&state=" +
    "s".repeat(32) +
    "&code_challenge=" +
    "c".repeat(43) +
    "&code_challenge_method=S256&scope=openid%20email";
  await pg.goto(`${CRM}/mot-de-passe?jeton=${token}&next=${encodeURIComponent(next)}`);
  await pg.waitForSelector("#auth-password", { timeout: 10000 });
  if (!pg.url().startsWith(`${CRM}/mot-de-passe`))
    throw new Error("formulaire non montré: " + pg.url());
  console.log("  formulaire affiché, onglet:", await pg.title());
  await pg.close();
});

await step("inscription Google annulée", async () => {
  await ctx.clearCookies();
  const pg = await ctx.newPage();
  await pg.goto(`${IL}/auth/lead/start?locale=fr&signup=1`);
  await pg.waitForURL(`${CRM}/signup**`);
  await pg.fill("#auth-account", "Atelier Gardé");
  const next = new URL(pg.url()).searchParams.get("next");
  await pg.goto(`${CRM}/signup?sso=canceled&next=${encodeURIComponent(next)}`);
  await pg.waitForSelector('[data-testid="suite-brand"]');
  const v = await pg.inputValue("#auth-account");
  const err = await pg
    .locator("form")
    .first()
    .innerText()
    .catch(() => "");
  console.log("  nom gardé:", v, "| onglet:", await pg.title());
  if (v !== "Atelier Gardé") throw new Error("nom du compte perdu");
  await pg.close();
});
console.log("\nRESULTATS", JSON.stringify(results));
await browser.close();
