import { expect, test } from "@playwright/test";
import { login } from "./helpers";

test("entreprise allemande : facture en euros à 19 %, GiroCode, comptabilité annoncée", async ({
  page,
}) => {
  const run = Date.now();
  await login(page, "fr", {
    sub: `sub-de-${run}`,
    email: `de-${run}@werkstatt.test`,
    org: `org-de-${run}`,
    org_name: "Werkstatt Müller GmbH",
  });

  await page.goto("/fr/app/settings/company");
  const company = page.getByTestId("company-form");
  await company.getByTestId("company-country").selectOption("DE");
  await expect(company.getByLabel("QR-IBAN")).toHaveCount(0);
  await company.getByLabel("Raison sociale").fill("Werkstatt Müller GmbH");
  await company.getByLabel("Forme juridique").selectOption("gmbh");
  await company.getByLabel("USt-IdNr.").fill("DE136695976");
  await company.getByLabel("Rue").fill("Friedrichstrasse");
  await company.getByLabel("Numéro", { exact: true }).fill("10");
  await company.getByLabel("NPA").fill("10117");
  await company.getByLabel("Localité").fill("Berlin");
  await company.getByLabel("IBAN", { exact: true }).fill("DE89 3704 0044 0532 0130 00");
  await company.getByLabel("Entreprise inscrite au registre TVA").check();
  await company.getByLabel("Décompte selon").selectOption("agreed");
  await page.getByTestId("company-save").click();
  await expect(page.getByText("Réglages enregistrés.")).toBeVisible();

  await page.goto("/fr/app/contacts/new");
  await page.getByTestId("contact-form").getByLabel("Nom ou raison sociale").fill("Kunde GmbH");
  await page.getByTestId("contact-save").click();
  await page.goto("/fr/app/products/new");
  const product = page.getByTestId("product-form");
  await product.getByLabel("Désignation").fill("Beratung");
  await product.getByLabel("Prix unitaire hors TVA (EUR)").fill("1000");
  await page.getByTestId("product-save").click();

  await page.goto("/fr/app/invoices/new");
  await page
    .getByTestId("invoice-form")
    .getByLabel("Client", { exact: true })
    .selectOption({ label: "Kunde GmbH" });
  await page
    .getByTestId("invoice-line-0")
    .getByLabel("Article")
    .selectOption({ label: "Beratung" });
  await expect(page.getByTestId("invoice-form")).toContainText("EUR 1.190,00");
  await page.getByTestId("invoice-save").click();
  await page.getByTestId("document-issue").click();
  await expect(page.getByText(/Facture émise/)).toBeVisible();
  await expect(page.locator("body")).toContainText("1.190,00");
  await expect(page.locator("body")).toContainText("USt-IdNr. DE136695976");

  const pdfLink = page.getByRole("link", { name: /PDF/ }).first();
  const response = await page.request.get((await pdfLink.getAttribute("href")) ?? "");
  expect(response.headers()["content-type"]).toBe("application/pdf");

  await page.goto("/fr/app/accounting");
  await expect(page.getByTestId("accounting-unavailable")).toContainText("Allemagne");
  await page.goto("/fr/app/settings/company");
  await page.getByTestId("company-country").selectOption("CH");
  await page.getByTestId("company-save").click();
  // Les champs allemands ne passent pas les contrôles suisses : rien n'est enregistré.
  await expect(page.getByText("Numéro IDE invalide", { exact: false })).toBeVisible();
  await page.goto("/fr/app/accounting");
  await expect(page.getByTestId("accounting-unavailable")).toBeVisible();
});
