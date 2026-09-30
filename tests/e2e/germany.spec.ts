import { expect, test } from "@playwright/test";
import { login } from "./helpers";

test("entreprise allemande : facture en euros à 19 %, GiroCode, SKR04 et UStVA", async ({
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

  // Comptabilité SKR04 : plan, exercice, écritures automatiques, puis UStVA du trimestre.
  await page.goto("/fr/app/settings/accounts");
  await page.getByTestId("chart-install").click();
  await expect(page.locator("body")).toContainText("Plan comptable SKR04");
  await expect(page.locator("body")).toContainText("Produits soumis à 19");
  await page.goto("/fr/app/settings/fiscal-years");
  await page.getByTestId("fiscal-year-first").click();
  await page.goto("/fr/app/accounting");
  await page.getByTestId("post-pending").click();
  const journal = page.getByTestId("journal");
  await expect(journal).toContainText("1200");
  await expect(journal).toContainText("4400");
  await expect(journal).toContainText("3800");
  await expect(journal).toContainText("1.190,00");

  const today = new Date().toISOString().slice(0, 10);
  const month = Number(today.slice(5, 7));
  const quarterStart = `${today.slice(0, 4)}-${String(month - ((month - 1) % 3)).padStart(2, "0")}-01`;
  await page.goto(`/fr/app/accounting/vat?period=${quarterStart}`);
  await expect(page.getByTestId("figure-81")).toContainText("1.000,00");
  await expect(page.getByTestId("figure-81")).toContainText("190,00");
  await expect(page.getByTestId("figure-83")).toContainText("190,00");
});
