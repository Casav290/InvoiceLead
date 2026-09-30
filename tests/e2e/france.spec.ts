import { expect, test } from "@playwright/test";
import { login } from "./helpers";

test("entreprise française : facture en euros à 20 %, SIRET, Factur-X, PCG et CA3", async ({
  page,
}) => {
  const run = Date.now();
  await login(page, "fr", {
    sub: `sub-fr-${run}`,
    email: `fr-${run}@durand.test`,
    org: `org-fr-${run}`,
    org_name: "Atelier Durand SAS",
  });

  await page.goto("/fr/app/settings/company");
  const company = page.getByTestId("company-form");
  await company.getByTestId("company-country").selectOption("FR");
  await company.getByLabel("Raison sociale").fill("Atelier Durand SAS");
  await company.getByLabel("Forme juridique").selectOption("sas");
  await company.getByLabel("Numéro de TVA intracommunautaire").fill("FR40303265045");
  await company.getByLabel("SIRET").fill("303 265 045 00003");
  await company.getByLabel("Rue").fill("Rue de Rivoli");
  await company.getByLabel("Numéro", { exact: true }).fill("10");
  await company.getByLabel("NPA").fill("75001");
  await company.getByLabel("Localité").fill("Paris");
  await company.getByLabel("E-mail").fill("factures@durand.test");
  await company.getByLabel("IBAN", { exact: true }).fill("FR76 3000 6000 0112 3456 7890 189");
  await company.getByLabel("Entreprise inscrite au registre TVA").check();
  await company.getByLabel("Décompte selon").selectOption("agreed");
  await page.getByTestId("company-save").click();
  await expect(page.getByText("Réglages enregistrés.")).toBeVisible();

  await page.goto("/fr/app/contacts/new");
  const contact = page.getByTestId("contact-form");
  await contact.getByLabel("Nom ou raison sociale").fill("Client SARL");
  await contact.getByLabel("Pays").selectOption("FR");
  await contact.getByLabel("Rue").fill("Rue de la République");
  await contact.getByLabel("NPA").fill("69001");
  await contact.getByLabel("Localité").fill("Lyon");
  await page.getByTestId("contact-save").click();

  await page.goto("/fr/app/invoices/new");
  const form = page.getByTestId("invoice-form");
  await form.getByLabel("Client", { exact: true }).selectOption({ label: "Client SARL" });
  const line = page.getByTestId("invoice-line-0");
  await line.getByLabel("Désignation").fill("Conseil");
  await line.getByLabel("Prix unitaire").fill("1000");
  await expect(form).toContainText("EUR 1 200,00");
  await page.getByTestId("invoice-save").click();
  await page.getByTestId("document-issue").click();
  await expect(page.getByText(/Facture émise/)).toBeVisible();
  await expect(page.locator("body")).toContainText("SIRET 30326504500003");
  await expect(page.locator("body")).toContainText("N° TVA FR40303265045");

  const href = await page.getByTestId("document-pdf").getAttribute("href");
  const pdf = await page.request.get(href ?? "");
  expect(pdf.headers()["content-type"]).toBe("application/pdf");
  expect((await pdf.body()).toString("latin1")).toContain("factur-x.xml");

  // Comptabilité PCG : plan, exercice, écritures automatiques, puis CA3 du trimestre.
  await page.goto("/fr/app/settings/accounts");
  await page.getByTestId("chart-install").click();
  await expect(page.locator("body")).toContainText("Plan comptable général");
  await expect(page.locator("body")).toContainText("Prestations de services");
  await page.goto("/fr/app/settings/fiscal-years");
  await page.getByTestId("fiscal-year-first").click();
  await page.goto("/fr/app/accounting");
  await page.getByTestId("post-pending").click();
  const journal = page.getByTestId("journal");
  await expect(journal).toContainText("411000");
  await expect(journal).toContainText("706000");
  await expect(journal).toContainText("445710");
  await expect(journal).toContainText("1\u00a0200,00");

  const today = new Date().toISOString().slice(0, 10);
  const month = Number(today.slice(5, 7));
  const quarterStart = `${today.slice(0, 4)}-${String(month - ((month - 1) % 3)).padStart(2, "0")}-01`;
  await page.goto(`/fr/app/accounting/vat?period=${quarterStart}`);
  await expect(page.getByTestId("figure-A1")).toContainText("1\u00a0000,00");
  await expect(page.getByTestId("figure-08")).toContainText("200,00");
  await expect(page.getByTestId("figure-28")).toContainText("200,00");
});
