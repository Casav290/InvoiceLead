import { createHmac } from "node:crypto";
import { expect, test } from "@playwright/test";
import { LEAD, login, traitNetIssues } from "./helpers";

/**
 * Abonnement InvoiceLead payé dans InvoiceLead (décision d'Ève du 13.10.2026) : « Passer à Pro »
 * mène à la page Formule, puis à Stripe Checkout (faux Stripe du faux Compte Lead), et la formule
 * vaut ici dès le retour ; elle se déclare au Compte Lead. Un événement d'une autre application
 * Lead ne change rien.
 */

type Billing = {
  customers: { id: string; idempotency?: string; form: Record<string, string> }[];
  checkouts: {
    id: string;
    customer: string;
    metadata: Record<string, string>;
    subscription_metadata: Record<string, string>;
    price: string;
    subscription: string | null;
    form: Record<string, string>;
  }[];
  portals: Record<string, string>[];
  subscriptions: { id: string; status: string; metadata: Record<string, string> }[];
};

function sign(payload: string, secret = "whsec_billing_e2e") {
  const at = Math.floor(Date.now() / 1000);
  return `t=${at},v1=${createHmac("sha256", secret).update(`${at}.${payload}`).digest("hex")}`;
}

test("formule : Passer à Pro+ (annuel), paiement, Pro+ ici, portail, autres applications sans effet", async ({
  page,
}) => {
  const run = Date.now();
  const org = `org-abo-${run}`;
  await login(page, "fr", {
    sub: `sub-abo-${run}`,
    email: `abo-${run}@atelier.test`,
    org,
    org_name: "Abonnement Sàrl",
  });
  const billing = async () =>
    (await (await page.request.get(`${LEAD}/test/billing`)).json()) as Billing;

  // « Passer à Pro » du menu de la personne : la page Formule d'InvoiceLead, Pro présélectionné.
  await page.getByTestId("user-menu").click();
  const upgrade = page.getByTestId("menu-upgrade");
  await expect(upgrade).toHaveText("Passer à Pro");
  await expect(upgrade).toHaveAttribute("href", "/fr/app/settings/plan?plan=pro");
  await upgrade.click();
  await page.waitForURL("**/fr/app/settings/plan?plan=pro");
  await expect(page.getByRole("heading", { name: "Formule InvoiceLead" })).toBeVisible();
  await expect(page.getByTestId("plan-current")).toHaveAttribute("data-tier", "free");
  await expect(page.getByTestId("plan-current")).toContainText("Votre formule : Gratuit");
  await expect(page.getByTestId("plan-card-free")).toHaveAttribute("data-current", "true");
  await expect(page.getByTestId("plan-card-pro")).toContainText("19 €");
  await expect(page.getByText("ne vaut que pour InvoiceLead").first()).toBeVisible();
  expect(await traitNetIssues(page)).toEqual([]);

  // Annuel, puis Pro+ : départ vers Stripe Checkout.
  await page.getByTestId("plan-interval-year").check();
  await expect(page.getByTestId("plan-card-proPlus")).toContainText("390 €");
  await page.getByTestId("plan-checkout-pro_plus").click();
  await page.getByRole("link", { name: "Payer" }).click();
  // Le faux Stripe « paie » et revient : la formule est relue chez Stripe, sans attendre le webhook.
  await page.waitForURL("**/fr/app/settings/plan?checkout=done");
  await expect(page.getByTestId("plan-notice-status")).toHaveText(
    "Merci ! Votre formule InvoiceLead Pro+ est active.",
  );
  await expect(page.getByTestId("plan-current")).toHaveAttribute("data-tier", "proplus");
  await expect(page.getByTestId("plan-current")).toHaveAttribute("data-source", "own");
  await expect(page.getByTestId("plan-current")).toContainText("Abonnement annuel, renouvelé le");
  // Plus de bouton d'achat : on change de formule dans le portail.
  await expect(page.getByTestId("plan-checkout-pro")).toHaveCount(0);

  // Session Checkout : client propre à InvoiceLead, marques de l'application, rien de Scanlead ni
  // de Stripe Connect.
  const after = await billing();
  const session = after.checkouts.at(-1);
  expect(session?.price).toBe("price_e2e_proplus_yearly");
  expect(session?.metadata).toMatchObject({
    app: "invoicelead",
    plan: "pro_plus",
    interval: "year",
  });
  expect(session?.subscription_metadata).toEqual(session?.metadata);
  expect(Object.keys(session?.form ?? {}).join(" ")).not.toMatch(
    /client_reference_id|workspace_id|invoice_id|organization_id/,
  );
  const customer = after.customers.find((c) => c.id === session?.customer);
  expect(customer?.form["metadata[app]"]).toBe("invoicelead");
  expect(customer?.idempotency).toMatch(/^invoicelead-customer-/);
  // Déclaré au Compte Lead.
  const reports = (await (await page.request.get(`${LEAD}/test/billing-reports`)).json()) as {
    org: string;
    plan: string;
    status: string;
    external_id: string;
  }[];
  expect(reports.filter((r) => r.org === org).at(-1)).toMatchObject({
    plan: "pro_plus",
    status: "active",
    external_id: session?.subscription,
  });

  // Les places suivent : Pro+ en compte cinq.
  await page.goto("/fr/app/settings/team");
  await expect(page.getByTestId("seats")).toHaveText("1 sur 5 places utilisées");

  // Un abonnement CRMlead (même client, même compte) reçu par le webhook d'InvoiceLead : 200, rien.
  const crm = {
    id: `evt_crm_${run}`,
    type: "customer.subscription.deleted",
    data: {
      object: {
        id: session?.subscription,
        customer: session?.customer,
        status: "canceled",
        metadata: { app: "crmlead", account_id: session?.metadata.account_id },
        items: { data: [{ price: { id: "price_crm", lookup_key: "crmlead_pro_monthly" } }] },
      },
    },
  };
  const payload = JSON.stringify(crm);
  const hook = await page.request.post("/api/billing/webhook", {
    headers: { "stripe-signature": sign(payload), "content-type": "application/json" },
    data: payload,
  });
  expect(hook.status()).toBe(200);
  expect(await hook.json()).toEqual({ received: true, result: "other_app" });
  // Mal signé (secret de Stripe Connect) : refusé.
  const forged = await page.request.post("/api/billing/webhook", {
    headers: { "stripe-signature": sign(payload, "whsec_e2e"), "content-type": "application/json" },
    data: payload,
  });
  expect(forged.status()).toBe(400);
  await page.goto("/fr/app/settings/plan");
  await expect(page.getByTestId("plan-current")).toHaveAttribute("data-tier", "proplus");

  // Portail Stripe : la configuration propre à InvoiceLead, retour sur la page Formule.
  await page.getByTestId("plan-portal").click();
  await expect(
    page.getByRole("heading", { name: "Portail client InvoiceLead (test)" }),
  ).toBeVisible();
  const portal = (await billing()).portals.at(-1);
  expect(portal).toMatchObject({
    customer: session?.customer,
    configuration: "bpc_e2e_invoicelead",
    return_url: "http://localhost:3100/fr/app/settings/plan",
    locale: "fr",
  });

  // Résiliation chez Stripe, apprise par le webhook (événement signé, état relu chez Stripe).
  await page.request.post(`${LEAD}/test/billing/subscriptions/${session?.subscription}`, {
    data: { status: "canceled" },
  });
  const deleted = JSON.stringify({
    id: `evt_del_${run}`,
    type: "customer.subscription.deleted",
    data: {
      object: {
        id: session?.subscription,
        customer: session?.customer,
        status: "canceled",
        metadata: session?.subscription_metadata,
        items: { data: [{ price: { id: "price_e2e_proplus_yearly" } }] },
      },
    },
  });
  const res = await page.request.post("/api/billing/webhook", {
    headers: { "stripe-signature": sign(deleted), "content-type": "application/json" },
    data: deleted,
  });
  expect(await res.json()).toEqual({ received: true, result: "applied" });
  await page.goto("/fr/app/settings/plan");
  await expect(page.getByTestId("plan-current")).toHaveAttribute("data-tier", "free");
  await expect(page.getByTestId("plan-checkout-pro")).toBeVisible();
});

test("formule : paiement annulé, puis un utilisateur sans droit et sans place", async ({
  page,
  browser,
}) => {
  const run = Date.now();
  const org = `org-abo2-${run}`;
  await login(page, "de", {
    sub: `sub-abo2-${run}`,
    email: `abo2-${run}@atelier.test`,
    org,
    org_name: "Abo GmbH",
  });
  await page.goto("/de/app/settings/plan?plan=pro_plus");
  await expect(page.getByTestId("plan-card-proPlus")).toHaveClass(/border-2/);
  // Abgebrochen : rien ne change.
  await page.getByTestId("plan-checkout-pro").click();
  await page.getByRole("link", { name: "Annuler" }).click();
  await page.waitForURL("**/de/app/settings/plan?checkout=cancel");
  await expect(page.getByTestId("plan-notice-status")).toHaveText(
    "Zahlung abgebrochen: Es wurde nichts belastet.",
  );
  await expect(page.getByTestId("plan-current")).toHaveAttribute("data-tier", "free");

  // Une personne de la même entreprise, sans être administratrice : Gratuit = une place, prise.
  const other = await browser.newContext();
  const bob = await other.newPage();
  await login(
    bob,
    "de",
    {
      sub: `sub-abo2-bob-${run}`,
      email: `bob-${run}@atelier.test`,
      org,
      org_name: "Abo GmbH",
      org_role: "user",
    },
    "**/de/no-access?**",
  );
  const screen = bob.getByTestId("no-access");
  await expect(screen).toHaveAttribute("data-reason", "seat");
  await expect(screen).toContainText("Alle InvoiceLead-Plätze sind belegt");
  await expect(screen).toContainText("Bitten Sie den Administrator von Abo GmbH");
  // Pas de paiement pour elle ; et pas de lien vers une autre application.
  await expect(bob.getByTestId("no-access-checkout-month")).toHaveCount(0);
  await expect(bob.locator('a[href*="scanlead.io"]')).toHaveCount(0);
  // Le départ vers Stripe lui est refusé aussi côté serveur.
  const direct = await bob.request.post("/api/billing/checkout", {
    form: { locale: "de", plan: "pro", interval: "month" },
    maxRedirects: 0,
  });
  expect(direct.status()).toBe(303);
  expect(direct.headers().location).toContain("/de/app/settings/plan?error=admin");
  await other.close();
});

test("tarifs : « Choisir Pro » mène à l'inscription puis à la page Formule", async ({ page }) => {
  await page.goto("/fr/pricing");
  await expect(
    page.getByText("Un abonnement InvoiceLead ne vaut que pour InvoiceLead."),
  ).toBeVisible();
  const pro = page.getByTestId("plan-pro").getByRole("link");
  const href = new URL(String(await pro.getAttribute("href")), "http://localhost:3100");
  expect(href.pathname).toBe("/auth/lead/start");
  expect(href.searchParams.get("signup")).toBe("1");
  expect(href.searchParams.get("next")).toBe("/fr/app/settings/plan?plan=pro");
});
