import { expect, test } from "@playwright/test";
import { login } from "./helpers";

test("plan comptable : installation du modèle, compte ajouté, compte système protégé", async ({
  page,
}) => {
  await login(page, "fr", {
    sub: `sub-acc-${Date.now()}`,
    email: `acc-${Date.now()}@atelier.test`,
    org: `org-acc-${Date.now()}`,
    org_name: "Comptes SA",
  });
  await page.getByRole("link", { name: "Réglages" }).click();
  await page.getByRole("link", { name: "Plan comptable" }).click();
  await expect(page).toHaveURL(/\/fr\/app\/settings\/accounts$/);
  await page.getByLabel("Modèle").selectOption("corporation");
  await page.getByTestId("chart-install").click();
  await expect(page.getByText("Plan comptable installé.")).toBeVisible();
  await expect(page.getByRole("row", { name: /2979/ })).toContainText("Bénéfice ou perte");

  await page.getByTestId("account-new").click();
  const form = page.getByTestId("account-form");
  await form.getByLabel("Numéro").fill("1020");
  await form.getByLabel("Type").selectOption("asset");
  await form.getByLabel("Nom en français").fill("Banque Raiffeisen");
  await page.getByTestId("account-save").click();
  await expect(page.getByText("Ce numéro est déjà utilisé.")).toBeVisible();
  await page.getByTestId("account-form").getByLabel("Numéro").fill("1021");
  await page.getByTestId("account-save").click();
  await expect(page).toHaveURL(/\/fr\/app\/settings\/accounts\?saved=1$/);
  await expect(page.getByRole("row", { name: /1021/ })).toContainText("Banque Raiffeisen");

  await page.getByRole("link", { name: "Débiteurs", exact: false }).first().click();
  await expect(page.getByTestId("account-form").getByLabel("Compte actif")).toBeDisabled();
});

test("exercices : premier exercice prolongé puis exercice suivant", async ({ page }) => {
  await login(page, "de", {
    sub: `sub-fy-${Date.now()}`,
    email: `fy-${Date.now()}@atelier.test`,
    org: `org-fy-${Date.now()}`,
    org_name: "Jahre GmbH",
  });
  await page.goto("/de/app/settings/fiscal-years");
  await page.getByLabel("Startdatum").fill("2026-04-15");
  await page.getByLabel(/verlängern/).check();
  await page.getByTestId("fiscal-year-first").click();
  await expect(page.getByText("Geschäftsjahr eröffnet.")).toBeVisible();
  await expect(page.getByRole("row", { name: /15\.04\.2026 bis 31\.12\.2027/ })).toBeVisible();
  await expect(page.getByText("Nächstes Geschäftsjahr: 01.01.2028 bis 31.12.2028")).toBeVisible();
  await page.getByTestId("fiscal-year-next").click();
  await expect(page.getByRole("row", { name: /01\.01\.2028 bis 31\.12\.2028/ })).toBeVisible();
});
