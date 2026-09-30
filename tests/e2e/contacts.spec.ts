import { expect, test } from "@playwright/test";
import { login } from "./helpers";

test("contacts : création, erreur d'adresse, modification, recherche, archivage", async ({
  page,
}) => {
  await login(page, "fr", {
    sub: "sub-ct",
    email: "ct@atelier.test",
    org: "org-ct",
    org_name: "Contacts Sàrl",
  });
  await page.getByRole("link", { name: "Contacts" }).click();
  await expect(page.getByText("Aucun contact pour l'instant.")).toBeVisible();

  await page.getByTestId("contact-new").click();
  const form = page.getByTestId("contact-form");
  await form.getByLabel("Nom ou raison sociale").fill("Boulangerie du Lac SA");
  await form.getByLabel("Rue").fill("Quai du Mont-Blanc");
  await page.getByTestId("contact-save").click();
  await expect(page.getByText("Certains champs sont à corriger.")).toBeVisible();
  await expect(page.getByTestId("contact-form").getByLabel("Rue")).toHaveValue(
    "Quai du Mont-Blanc",
  );

  await page.getByTestId("contact-form").getByLabel("NPA").fill("1201");
  await page.getByTestId("contact-form").getByLabel("Localité").fill("Genève");
  await page.getByTestId("contact-save").click();
  await expect(page).toHaveURL(/\/fr\/app\/contacts\?saved=1$/);
  await expect(page.getByRole("link", { name: "Boulangerie du Lac SA" })).toBeVisible();

  await page.getByRole("link", { name: "Boulangerie du Lac SA" }).click();
  await page.getByTestId("contact-form").getByLabel("Délai de paiement (jours)").fill("10");
  await page.getByTestId("contact-save").click();
  await expect(page.getByText("Contact enregistré.")).toBeVisible();

  await page.getByPlaceholder("Rechercher un nom, un e-mail, une localité").fill("zurich");
  await page.getByRole("button", { name: "Rechercher" }).click();
  await expect(page.getByText("Aucun contact ne correspond à cette recherche.")).toBeVisible();

  await page.goto("/fr/app/contacts");
  await page.getByRole("link", { name: "Boulangerie du Lac SA" }).click();
  await page.getByTestId("contact-archive").click();
  await expect(page.getByText("Contact archivé.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Boulangerie du Lac SA" })).toHaveCount(0);
});

test("contacts : une fiche inconnue donne un 404", async ({ page }) => {
  await login(page, "de");
  const res = await page.goto("/de/app/contacts/00000000-0000-0000-0000-000000000000");
  expect(res?.status()).toBe(404);
});
