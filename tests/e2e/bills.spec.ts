import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { camt053 } from "../support/camt";
import { samplePdf } from "../support/pdf";
import { login, setupBilling, traitNetIssues } from "./helpers";

const UBL = `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:ID>R-2026-117</cbc:ID>
  <cbc:IssueDate>DATE</cbc:IssueDate>
  <cbc:DocumentCurrencyCode>CHF</cbc:DocumentCurrencyCode>
  <cac:AccountingSupplierParty><cac:Party>
    <cac:PostalAddress><cbc:StreetName>Hardturmstrasse 3</cbc:StreetName><cbc:CityName>Zürich</cbc:CityName><cbc:PostalZone>8005</cbc:PostalZone><cac:Country><cbc:IdentificationCode>CH</cbc:IdentificationCode></cac:Country></cac:PostalAddress>
    <cac:PartyLegalEntity><cbc:RegistrationName>Druckerei Muster AG</cbc:RegistrationName></cac:PartyLegalEntity>
  </cac:Party></cac:AccountingSupplierParty>
  <cac:PaymentMeans><cbc:PaymentMeansCode>58</cbc:PaymentMeansCode><cbc:PaymentID>RF18539007547034</cbc:PaymentID><cac:PayeeFinancialAccount><cbc:ID>CH56 0483 5012 3456 7800 9</cbc:ID></cac:PayeeFinancialAccount></cac:PaymentMeans>
  <cac:TaxTotal><cbc:TaxAmount currencyID="CHF">32.40</cbc:TaxAmount><cac:TaxSubtotal><cbc:TaxableAmount currencyID="CHF">400.00</cbc:TaxableAmount><cbc:TaxAmount currencyID="CHF">32.40</cbc:TaxAmount><cac:TaxCategory><cbc:ID>S</cbc:ID><cbc:Percent>8.1</cbc:Percent></cac:TaxCategory></cac:TaxSubtotal></cac:TaxTotal>
  <cac:LegalMonetaryTotal><cbc:PayableAmount currencyID="CHF">432.40</cbc:PayableAmount></cac:LegalMonetaryTotal>
  <cac:InvoiceLine><cbc:ID>1</cbc:ID><cac:Item><cbc:Name>Flyer A5</cbc:Name></cac:Item></cac:InvoiceLine>
</Invoice>`;

test("factures fournisseurs : e-facture importée, approuvée, payée par pain.001, soldée par le relevé", async ({
  page,
}) => {
  const run = Date.now();
  const today = new Date().toISOString().slice(0, 10);
  await login(page, "fr", {
    sub: `sub-bill-${run}`,
    email: `bill-${run}@atelier.test`,
    org: `org-bill-${run}`,
    org_name: "Achats Sàrl",
    plan: "pro",
  });
  await setupBilling(page);
  await page.goto("/fr/app/settings/accounts");
  await page.getByTestId("chart-install").click();
  await page.goto("/fr/app/settings/fiscal-years");
  await page.getByTestId("fiscal-year-first").click();
  await expect(page.getByText("Exercice ouvert.")).toBeVisible();

  await page.goto("/fr/app/accounting/bills");
  await page.getByLabel(/E-factures reçues/).setInputFiles({
    name: "rechnung.xml",
    mimeType: "application/xml",
    buffer: Buffer.from(UBL.replace("DATE", today)),
  });
  await page.getByTestId("einvoice-import").click();
  await expect(page.getByText("1 facture importée.")).toBeVisible();
  await page
    .getByTestId("bills-draft")
    .getByRole("link", { name: /Druckerei Muster AG/ })
    .click();

  const form = page.getByTestId("bill-form");
  await expect(form.getByLabel("IBAN du fournisseur")).toHaveValue("CH5604835012345678009");
  await expect(form.getByLabel("Montant à payer, TVA comprise")).toHaveValue("432.40");
  await form
    .getByLabel("Compte de charge")
    .selectOption({ label: "6500 Charges d'administration" });
  await page.getByTestId("bill-save").click();
  await expect(page.getByText("Facture enregistrée.")).toBeVisible();
  await page.getByTestId("bill-approve").click();
  await expect(page.getByText("Facture approuvée et comptabilisée.")).toBeVisible();

  await page.goto("/fr/app/accounting/bills");
  const download = page.waitForEvent("download");
  await page.getByTestId("bills-export").click();
  const file = await download;
  const xml = await readFile((await file.path()) ?? "", "utf8");
  expect(xml).toContain("urn:iso:std:iso:20022:tech:xsd:pain.001.001.09");
  expect(xml).toContain("<IBAN>CH5604835012345678009</IBAN>");
  expect(xml).toContain("<Cd>SCOR</Cd>");
  await page.goto("/fr/app/accounting/bills");
  await expect(page.getByTestId("bills-scheduled")).toContainText("Druckerei Muster AG");

  await page.goto("/fr/app/accounting/bank");
  await page.getByLabel("Relevé bancaire (camt.053)").setInputFiles({
    name: "releve.xml",
    mimeType: "application/xml",
    buffer: Buffer.from(
      camt053("CH9300762011623852957", [
        {
          id: `S${run}`,
          date: today,
          amount: "432.40",
          credit: false,
          party: "Druckerei Muster AG",
          reference: "RF18539007547034",
        },
      ]),
    ),
  });
  await page.getByTestId("bank-import").click();
  await expect(page.getByTestId("bank-review")).toContainText("Paiement d’une facture fournisseur");
  await page.getByTestId("bank-validate-confident").click();
  await expect(page.getByText("1 écriture validée.")).toBeVisible();
  await page.goto("/fr/app/accounting/bills");
  await expect(page.getByTestId("bills-paid")).toContainText("Druckerei Muster AG");
});

test("factures fournisseurs : « Prendre en photo », l'IA remplit le brouillon à approuver, même en formule gratuite", async ({
  page,
}) => {
  const run = Date.now();
  const today = new Date().toISOString().slice(0, 10);
  await login(page, "fr", {
    sub: `sub-bill-photo-${run}`,
    email: `bill-photo-${run}@atelier.test`,
    org: `org-bill-photo-${run}`,
    org_name: "Photo Sàrl",
  });
  await setupBilling(page);
  await page.goto("/fr/app/settings/accounts");
  await page.getByTestId("chart-install").click();
  await page.goto("/fr/app/settings/fiscal-years");
  await page.getByTestId("fiscal-year-first").click();
  await expect(page.getByText("Exercice ouvert.")).toBeVisible();

  await page.goto("/fr/app/accounting/bills");
  const block = page.getByTestId("bill-photo");
  await expect(block.getByRole("heading", { name: "Prendre en photo" })).toBeVisible();
  await expect(page.getByTestId("bill-photo-quota")).toContainText("0 sur 20");
  // Téléphone : l'appareil photo s'ouvre ; ordinateur : le choix d'une photo ou d'un PDF.
  const input = page.getByTestId("bill-photo-input");
  await expect(input).toHaveAttribute("capture", "environment");
  await expect(input).toHaveAttribute("accept", /image\/jpeg.*application\/pdf/);
  await input.setInputFiles({
    name: "facture.pdf",
    mimeType: "application/pdf",
    buffer: await samplePdf(["Imprimerie Muster SA", `Date ${today}`, "Total CHF 432.40"]),
  });

  // Le brouillon s'ouvre, rempli par l'IA : la personne vérifie, corrige au besoin, approuve.
  await expect(page).toHaveURL(/\/fr\/app\/accounting\/bills\/[0-9a-f-]{36}\?photo=1$/);
  await expect(
    page.getByText("Facture lue par l'IA. Vérifiez les champs, puis approuvez."),
  ).toBeVisible();
  await expect(page.getByTestId("bill-status")).toContainText("Brouillon");
  const form = page.getByTestId("bill-form");
  await expect(form.getByLabel("Fournisseur", { exact: true })).toHaveValue("Imprimerie Muster SA");
  await expect(form.getByLabel("Montant à payer, TVA comprise")).toHaveValue("432.40");
  await expect(form.getByLabel("Date de facture")).toHaveValue(today);
  await expect(page.getByRole("link", { name: "Voir le justificatif" })).toBeVisible();
  await form
    .getByLabel("Compte de charge")
    .selectOption({ label: "6500 Charges d'administration" });
  await page.getByTestId("bill-save").click();
  await expect(page.getByText("Facture enregistrée.")).toBeVisible();
  await page.getByTestId("bill-approve").click();
  await expect(page.getByText("Facture approuvée et comptabilisée.")).toBeVisible();

  // Une lecture du mois de comptée ; la facture attend son paiement.
  await page.goto("/fr/app/accounting/bills");
  await expect(page.getByTestId("bill-photo-quota")).toContainText("1 sur 20");
  await expect(page.getByTestId("bills-approved")).toContainText("Imprimerie Muster SA");

  // Téléphone (390 px) : le bouton tient dans la largeur, sans débordement.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/fr/app/accounting/bills");
  await expect(page.getByTestId("bill-photo")).toBeVisible();
  expect(await traitNetIssues(page)).toEqual([]);
});
