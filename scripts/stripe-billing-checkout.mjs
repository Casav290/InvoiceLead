#!/usr/bin/env node
/**
 * Parcours de paiement RÉEL en MODE TEST Stripe, navigateur sans tête : InvoiceLead local (port 3100)
 * relié au faux Compte Lead (port 4010) et à Stripe en mode test (STRIPE_BILLING_* de test).
 *
 *   Réglages → Formule → « Passer à Pro » → Stripe Checkout (carte 4242 4242 4242 4242) → retour :
 *   formule Pro ici → « Gérer l'abonnement » → portail Stripe d'InvoiceLead (ses seuls abonnements)
 *   → résiliation en fin de période → retour.
 *
 *   node scripts/stripe-billing-checkout.mjs [--app http://localhost:3100] [--lead http://localhost:4010]
 *     [--shots <dossier>] [--cancel]
 *
 * Imprime CHECKOUT_OK et un résumé JSON (identifiants Stripe de test, jamais un secret). Les
 * événements se rejouent ensuite vers le webhook local avec scripts/stripe-billing-replay.mjs.
 * Playwright : celui installé sur le serveur (/usr/lib/node_modules), sinon celui du dépôt.
 */
import { createRequire } from "node:module";

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};
const APP = opt("--app", "http://localhost:3100");
const LEAD = opt("--lead", "http://localhost:4010");
const SHOTS = opt("--shots", null);
const CANCEL = args.includes("--cancel");

let playwright;
try {
  playwright = createRequire("/usr/lib/node_modules/")("playwright");
} catch {
  playwright = await import("@playwright/test");
}
const { chromium } = playwright;

const run = Date.now().toString(36);
const user = {
  sub: `sub-stripe-${run}`,
  email: `stripe-test-${run}@example.com`,
  name: "Test Stripe",
  org: `org-stripe-${run}`,
  org_name: `Test Stripe ${run}`,
};
const summary = { run, org: user.org, t0: Math.floor(Date.now() / 1000) - 5 };

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  locale: "fr-CH",
  viewport: { width: 1280, height: 900 },
});
const page = await context.newPage();
const shot = async (name) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
};

try {
  // Connexion par le faux Compte Lead (organisation neuve, formule gratuite).
  const res = await page.request.post(`${LEAD}/test/next-user`, { data: user });
  if (!res.ok()) throw new Error("faux Compte Lead injoignable");
  await page.goto(`${APP}/fr/login`);
  await page.waitForURL(`${APP}/fr/app`);

  await page.goto(`${APP}/fr/app/settings/plan`);
  const current = page.getByTestId("plan-current");
  if ((await current.getAttribute("data-tier")) !== "free")
    throw new Error("pas en Gratuit au départ");
  await shot("1-formule-gratuit");
  await page.getByTestId("plan-checkout-pro").click();

  // Stripe Checkout (mode test).
  await page.waitForURL(/checkout\.stripe\.com/, { timeout: 30_000 });
  await page.locator("#cardNumber").waitFor({ timeout: 30_000 });
  await shot("2-checkout");
  summary.checkoutTitle = await page.title();
  await page.locator("#cardNumber").fill("4242 4242 4242 4242");
  await page.locator("#cardExpiry").fill("12 / 34");
  await page.locator("#cardCvc").fill("123");
  const fillIf = async (selector, value) => {
    const el = page.locator(selector);
    if ((await el.count()) && (await el.isVisible()) && (await el.isEditable()))
      await el.fill(value);
  };
  await fillIf("#billingName", "Test Stripe");
  const country = page.locator("#billingCountry");
  if (await country.count()) await country.selectOption("CH");
  await fillIf("#billingAddressLine1", "Bahnhofstrasse 1");
  await fillIf("#billingPostalCode", "8001");
  await fillIf("#billingLocality", "Zürich");
  await shot("3-checkout-rempli");
  await page.locator('button[type="submit"]').first().click();

  // Retour dans InvoiceLead : la formule est relue chez Stripe aussitôt.
  await page.waitForURL(`${APP}/fr/app/settings/plan?checkout=*`, { timeout: 60_000 });
  summary.returnedTo = new URL(page.url()).search;
  summary.tierAfterPayment = await current.getAttribute("data-tier");
  summary.sourceAfterPayment = await current.getAttribute("data-source");
  summary.statusText = (await current.innerText()).replace(/\s+/g, " ").trim();
  await shot("4-formule-pro");
  if (summary.tierAfterPayment !== "pro")
    throw new Error(`formule après paiement : ${summary.tierAfterPayment}`);

  // Portail Stripe d'InvoiceLead : ses seuls abonnements.
  await page.getByTestId("plan-portal").click();
  await page.waitForURL(/billing\.stripe\.com/, { timeout: 30_000 });
  await page
    .getByText(/InvoiceLead Pro/)
    .first()
    .waitFor({ timeout: 30_000 });
  await shot("5-portail");
  // Le nom du compte Stripe partagé (« scanlead.io », en test « Scanlead Login Sandbox ») s'affiche
  // en en-tête du portail : seul le reste de la page compte.
  const portalText = (await page.locator("body").innerText()).replace(
    /Scanlead Login Sandbox|scanlead\.io/g,
    "",
  );
  summary.portal = {
    showsInvoiceLeadPro: /InvoiceLead Pro/.test(portalText),
    showsOtherApps: /CRMlead|Scanlead|ProjectLead|Greetlead|\bSolo\b|\bEquipe\b/i.test(portalText),
  };
  if (summary.portal.showsOtherApps || !summary.portal.showsInvoiceLeadPro)
    throw new Error("le portail ne montre pas seulement l'abonnement InvoiceLead");
  if (CANCEL) {
    // Résiliation en fin de période (configuration du portail d'InvoiceLead).
    await page
      .getByText(/Annuler l.abonnement/)
      .first()
      .click();
    // Une raison est proposée (facultative) dans une fenêtre, puis la confirmation.
    const proceed = page.getByRole("button", { name: /Continuer vers l.annulation|Continue/ });
    const confirm = page.getByTestId("confirm");
    const done = page.getByText(/Annulation le|sera annulé|prendra fin|Renouveler l.abonnement/i);
    const first = async (...locators) =>
      Promise.any(
        locators.map((l, i) =>
          l
            .first()
            .waitFor({ timeout: 30_000 })
            .then(() => i),
        ),
      ).catch(() => -1);
    // La confirmation ne se clique qu'une fois : ensuite elle se désactive le temps de l'envoi.
    for (let step = 0; step < 6; step++) {
      const seen = await first(done, proceed, confirm);
      if (seen === 0 || seen === -1) break;
      await (seen === 1 ? proceed : confirm).first().click();
      if (seen === 2) break;
      await page.waitForTimeout(1000);
    }
    summary.portal.cancelled = await done
      .first()
      .waitFor({ timeout: 30_000 })
      .then(() => true)
      .catch(() => false);
    await shot("6-portail-resilie");
    if (!summary.portal.cancelled) throw new Error("résiliation non confirmée par le portail");
  }
  console.log("CHECKOUT_OK");
} catch (e) {
  await shot("erreur").catch(() => {});
  summary.error = String(e?.message ?? e);
  console.log("CHECKOUT_FAILED");
  process.exitCode = 1;
} finally {
  console.log(JSON.stringify(summary, null, 1));
  await browser.close();
}
