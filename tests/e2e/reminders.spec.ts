import { expect, test } from "@playwright/test";
import { login, setupBilling } from "./helpers";

test("relances : facture échue proposée, relance notée, historique sur la facture", async ({
  page,
}) => {
  const run = Date.now();
  await login(page, "fr", {
    sub: `sub-rem-${run}`,
    email: `rem-${run}@atelier.test`,
    org: `org-rem-${run}`,
    org_name: "Relances Sàrl",
  });
  await setupBilling(page);

  // 45 jours après la facture : 15 jours de retard, seule la première relance est due.
  const issued = new Date(Date.now() - 45 * 86_400_000).toISOString().slice(0, 10);
  await page.goto("/fr/app/invoices/new");
  const form = page.getByTestId("invoice-form");
  await form.getByLabel("Client", { exact: true }).selectOption({ label: "Client SA" });
  await form.getByLabel("Date de facture").fill(issued);
  await form.getByLabel("Date de la prestation").fill(issued);
  await page.getByTestId("invoice-line-0").getByLabel("Article").selectOption({ label: "Conseil" });
  await page.getByTestId("invoice-save").click();
  await page.getByTestId("document-issue").click();
  await expect(page.getByText(/Facture émise/)).toBeVisible();

  await page.goto("/fr/app/invoices");
  await expect(page.getByRole("row", { name: /Client SA/ })).toContainText("En retard");
  await page.getByTestId("reminders-link").click();
  const row = page.getByTestId("reminder-row");
  await expect(row).toContainText("1re relance");
  await expect(row).toContainText("pas d'e-mail");
  await row.getByRole("button", { name: "Noter comme envoyée (courrier)" }).click();
  await expect(page.getByText("Relance notée comme envoyée.")).toBeVisible();
  await expect(page.getByText("Aucune relance à faire aujourd'hui.")).toBeVisible();
  // La facture en retard est attendue cette semaine dans la prévision.
  await expect(page.getByTestId("forecast-week").first()).toContainText("Semaine du");
  await expect(page.getByTestId("reminder-settings")).toContainText(
    "font partie de la formule Pro",
  );

  await page.goto("/fr/app/invoices");
  await page
    .getByRole("row", { name: /Client SA/ })
    .getByRole("link")
    .click();
  await expect(page.getByTestId("reminder-history")).toContainText("1re relance");
  await expect(page.getByTestId("reminder-history")).toContainText("courrier");
});

test("relances Pro : frais et intérêts moratoires réclamés, puis abandonnés", async ({ page }) => {
  const run = Date.now();
  await login(page, "fr", {
    sub: `sub-remp-${run}`,
    email: `remp-${run}@atelier.test`,
    org: `org-remp-${run}`,
    org_name: "Relances Pro Sàrl",
    plan: "pro",
  });
  await setupBilling(page);
  await page.goto("/fr/app/settings/accounts");
  await page.getByTestId("chart-install").click();
  await page.goto("/fr/app/settings/fiscal-years");
  await page.getByTestId("fiscal-year-first").click();
  await expect(page.getByText("Exercice ouvert.")).toBeVisible();

  // Échue depuis 15 jours : première relance, intérêt de 5 % sur 162.15 (0.33).
  const issued = new Date(Date.now() - 45 * 86_400_000).toISOString().slice(0, 10);
  await page.goto("/fr/app/invoices/new");
  const form = page.getByTestId("invoice-form");
  await form.getByLabel("Client", { exact: true }).selectOption({ label: "Client SA" });
  await form.getByLabel("Date de facture").fill(issued);
  await form.getByLabel("Date de la prestation").fill(issued);
  await page.getByTestId("invoice-line-0").getByLabel("Article").selectOption({ label: "Conseil" });
  await page.getByTestId("invoice-save").click();
  await page.getByTestId("document-issue").click();
  await expect(page.getByText(/Facture émise/)).toBeVisible();

  await page.goto("/fr/app/invoices/reminders");
  const settings = page.getByTestId("reminder-settings");
  await settings.getByLabel("Frais de rappel dès la 2e relance (CHF)").fill("20");
  await settings.getByLabel("Intérêt moratoire annuel (%)").fill("5");
  await settings.getByLabel("Envoyer les relances automatiquement").check();
  await page.getByTestId("reminder-settings-save").click();
  await expect(page.getByText("Réglages des relances enregistrés.")).toBeVisible();
  await expect(settings.getByLabel("Intérêt moratoire annuel (%)")).toHaveValue("5");

  const row = page.getByTestId("reminder-row");
  await expect(row.getByTestId("reminder-total")).toHaveText("CHF 162.48");
  await expect(row.getByTestId("reminder-charges")).toContainText("intérêts 0.33");
  await row.getByRole("button", { name: "Noter comme envoyée (courrier)" }).click();
  await expect(page.getByText("Relance notée comme envoyée.")).toBeVisible();

  await page.goto("/fr/app/invoices");
  await page
    .getByRole("row", { name: /Client SA/ })
    .getByRole("link")
    .click();
  const balance = page.getByTestId("invoice-balance");
  await expect(balance.getByTestId("balance-chargesCents")).toHaveText("0.33");
  await expect(balance.getByTestId("balance-openCents")).toHaveText("162.48");
  await page.getByTestId("charges-waive").click();
  await expect(page.getByText("Frais et intérêts abandonnés.")).toBeVisible();
  await expect(balance.getByTestId("balance-openCents")).toHaveText("162.15");
  await expect(balance.getByTestId("balance-chargesCents")).toHaveCount(0);
});
