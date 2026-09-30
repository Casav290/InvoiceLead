import { expect, test } from "@playwright/test";
import { login } from "./helpers";

test("réglages entreprise : erreurs signalées, saisie gardée, puis enregistrement", async ({
  page,
}) => {
  await login(page, "fr", {
    sub: `sub-set-${Date.now()}`,
    email: `set-${Date.now()}@atelier.test`,
    org: `org-set-${Date.now()}`,
    org_name: "Set Sàrl",
  });
  await page.getByRole("link", { name: "Compléter" }).click();
  await expect(page).toHaveURL(/\/fr\/app\/settings\/company$/);

  const form = page.getByTestId("company-form");
  await form.getByLabel("Forme juridique").selectOption("gmbh");
  await form.getByLabel("Rue").fill("Rue du Lac");
  await form.getByLabel("Numéro", { exact: true }).fill("4");
  await form.getByLabel("NPA").fill("120");
  await form.getByLabel("Localité").fill("Genève");
  await form.getByLabel("Numéro IDE").fill("CHE-116.281.711");
  await form.getByLabel("IBAN", { exact: true }).fill("CH93 0076 2011 6238 5295 7");
  await page.getByTestId("company-save").click();

  await expect(page.getByText("Certains champs sont à corriger.")).toBeVisible();
  await expect(
    page.getByText(
      "Code postal invalide (4 chiffres en Suisse, 5 en Allemagne et en France, format britannique au Royaume-Uni).",
    ),
  ).toBeVisible();
  await expect(page.getByText("Numéro IDE invalide (format ou clé de contrôle).")).toBeVisible();
  await expect(page.getByTestId("company-form").getByLabel("Rue")).toHaveValue("Rue du Lac");

  await page.getByTestId("company-form").getByLabel("NPA").fill("1201");
  await page.getByTestId("company-form").getByLabel("Numéro IDE").fill("CHE-116.281.710");
  await page.getByTestId("company-save").click();
  await expect(page.getByText("Réglages enregistrés.")).toBeVisible();
  await expect(page.getByTestId("company-form").getByLabel("Numéro IDE")).toHaveValue(
    "CHE-116.281.710",
  );

  await page.getByRole("link", { name: "Tableau de bord" }).click();
  await expect(page.getByText("Fait", { exact: true })).toBeVisible();
});

test("réglages entreprise : un simple utilisateur ne peut que lire", async ({ page }) => {
  await login(page, "de", {
    sub: "sub-reader",
    email: "reader@atelier.test",
    org: "org-reader",
    org_name: "Reader AG",
    org_role: "user",
  });
  await page.goto("/de/app/settings/company");
  await expect(page.getByText("Nur Administratoren und Verantwortliche")).toBeVisible();
  await expect(page.getByTestId("company-save")).toHaveCount(0);
  await expect(page.getByTestId("company-form").getByLabel("Strasse")).toBeDisabled();
});
