import { expect, test } from "@playwright/test";
import { login } from "./helpers";

test("facture : brouillon avec article et ligne libre, émission avec numéro, facture figée", async ({
  page,
}) => {
  const run = Date.now();
  await login(page, "fr", {
    sub: `sub-inv-${run}`,
    email: `inv-${run}@atelier.test`,
    org: `org-inv-${run}`,
    org_name: "Factures Sàrl",
  });

  // Données de l'entreprise, assujettie à la TVA.
  await page.goto("/fr/app/settings/company");
  const company = page.getByTestId("company-form");
  await company.getByLabel("Raison sociale").fill("Factures Sàrl");
  await company.getByLabel("Forme juridique").selectOption("gmbh");
  await company.getByLabel("Numéro IDE").fill("CHE-116.281.710");
  await company.getByLabel("Rue").fill("Rue du Marché");
  await company.getByLabel("Numéro", { exact: true }).fill("4");
  await company.getByLabel("NPA").fill("1204");
  await company.getByLabel("Localité").fill("Genève");
  await company.getByLabel("IBAN", { exact: true }).fill("CH93 0076 2011 6238 5295 7");
  await company.getByLabel("Entreprise inscrite au registre TVA").check();
  await company.getByLabel("Méthode de décompte").selectOption("effective");
  await company.getByLabel("Décompte selon").selectOption("agreed");
  await page.getByTestId("company-save").click();
  await expect(page.getByText("Réglages enregistrés.")).toBeVisible();

  // Un client et un article.
  await page.goto("/fr/app/contacts/new");
  await page.getByTestId("contact-form").getByLabel("Nom ou raison sociale").fill("Client SA");
  await page.getByTestId("contact-save").click();
  await page.goto("/fr/app/products/new");
  const product = page.getByTestId("product-form");
  await product.getByLabel("Désignation").fill("Conseil");
  await product.getByLabel("Prix unitaire hors TVA (CHF)").fill("150");
  await page.getByTestId("product-save").click();

  await page.getByRole("link", { name: "Factures" }).click();
  await page.getByTestId("invoice-new").click();
  const form = page.getByTestId("invoice-form");
  await form.getByLabel("Client", { exact: true }).selectOption({ label: "Client SA" });
  const line0 = page.getByTestId("invoice-line-0");
  await line0.getByLabel("Article").selectOption({ label: "Conseil" });
  await line0.getByLabel("Quantité").fill("2.5");
  await page.getByTestId("invoice-line-add").click();
  const line1 = page.getByTestId("invoice-line-1");
  await line1.getByLabel("Désignation").fill("Frais de déplacement");
  await line1.getByLabel("Prix unitaire HT").fill("40,5");
  await line1.getByLabel("TVA").selectOption("exempt");
  const totals = page.getByTestId("invoice-totals");
  await expect(totals).toContainText("415.50");
  await expect(totals).toContainText("30.38");
  await expect(totals).toContainText("CHF 445.88");

  await page.getByTestId("invoice-save").click();
  await expect(page.getByText("Brouillon enregistré.")).toBeVisible();
  await expect(page.getByTestId("invoice-status")).toHaveText("Brouillon");

  await page.getByTestId("invoice-issue").click();
  await expect(page.getByText(/Facture émise/)).toBeVisible();
  const year = new Date().getFullYear();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(`Facture ${year}-0001`);
  const doc = page.getByTestId("invoice-document");
  await expect(doc).toContainText("CHE-116.281.710 TVA");
  await expect(doc).toContainText("Client SA");
  await expect(page.getByTestId("invoice-total")).toHaveText("CHF 445.88");
  await expect(page.getByTestId("invoice-form")).toHaveCount(0);

  await page.getByRole("link", { name: "Toutes les factures" }).click();
  await expect(page.getByRole("row", { name: new RegExp(`${year}-0001`) })).toContainText("445.88");
});
