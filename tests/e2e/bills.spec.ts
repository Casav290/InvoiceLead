import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { camt053 } from "../support/camt";
import { login, setupBilling } from "./helpers";

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
