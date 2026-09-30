import { expect, type Page, test } from "@playwright/test";
import { scorReference } from "../../src/countries/ch/qr-reference";
import { camt053 } from "../support/camt";
import { samplePdf } from "../support/pdf";
import { login, setupBilling } from "./helpers";

test("comptabilité : pièce en attente, puis journal en partie double après mise en place", async ({
  page,
}) => {
  const run = Date.now();
  const today = new Date().toISOString().slice(0, 10);
  await login(page, "fr", {
    sub: `sub-led-${run}`,
    email: `led-${run}@atelier.test`,
    org: `org-led-${run}`,
    org_name: "Journal Sàrl",
  });
  await setupBilling(page);

  // Une facture émise avant la mise en place de la comptabilité attend.
  await page.goto("/fr/app/invoices/new");
  await page
    .getByTestId("invoice-form")
    .getByLabel("Client", { exact: true })
    .selectOption({ label: "Client SA" });
  await page.getByTestId("invoice-line-0").getByLabel("Article").selectOption({ label: "Conseil" });
  await page.getByTestId("invoice-save").click();
  await page.getByTestId("document-issue").click();
  await expect(page.getByText(/Facture émise/)).toBeVisible();

  await page.getByRole("link", { name: "Comptabilité" }).click();
  await expect(page.getByTestId("accounting-setup")).toBeVisible();
  await expect(page.getByTestId("unposted")).toContainText("1 pièce attend");

  await page.goto("/fr/app/settings/accounts");
  await page.getByTestId("chart-install").click();
  await page.goto("/fr/app/settings/fiscal-years");
  await page.getByTestId("fiscal-year-first").click();
  await expect(page.getByText("Exercice ouvert.")).toBeVisible();

  await page.goto("/fr/app/accounting");
  await page.getByTestId("post-pending").click();
  await expect(page.getByText("1 écriture ajoutée au journal.")).toBeVisible();
  const journal = page.getByTestId("journal");
  await expect(journal).toContainText("1100");
  await expect(journal).toContainText("162.15");
  await expect(journal).toContainText("3400");
  await expect(journal).toContainText("2200");
  await expect(journal).toContainText("12.15");
  await expect(page.getByTestId("chain-status")).toHaveText(
    "Chaîne d'empreintes vérifiée sur 1 écriture.",
  );
  await expect(page.getByTestId("unposted")).toHaveCount(0);

  // Justificatif des frais, déposé avant le relevé : lu tout de suite, rattaché à l'import.
  await page.goto("/fr/app/accounting/receipts");
  await page.getByLabel("Factures ou tickets").setInputFiles({
    name: "frais.pdf",
    mimeType: "application/pdf",
    buffer: await samplePdf(["Banque Cantonale", `Date ${today}`, "Total CHF 5.00"]),
  });
  await page.getByTestId("receipts-upload").click();
  await expect(page.getByText("1 justificatif ajouté.")).toBeVisible();
  await expect(page.getByTestId("receipt-status")).toHaveText("Lu, paiement pas encore trouvé");

  // Relevé bancaire : le paiement est rapproché par sa référence, les frais par leur justificatif.
  const reference = await invoiceReference(page);
  await page.goto("/fr/app/accounting/bank");
  await page.getByLabel("Relevé bancaire (camt.053)").setInputFiles({
    name: "releve.xml",
    mimeType: "application/xml",
    buffer: Buffer.from(
      camt053("CH9300762011623852957", [
        {
          id: `P${run}`,
          date: today,
          amount: "162.15",
          credit: true,
          party: "Client SA",
          reference,
        },
        {
          id: `F${run}`,
          date: today,
          amount: "5.00",
          credit: false,
          party: "Banque",
          text: "Frais de tenue de compte",
        },
      ]),
    ),
  });
  await page.getByTestId("bank-import").click();
  await expect(page.getByText("2 mouvements importés.")).toBeVisible();
  const proposals = page.getByTestId("bank-proposal");
  await expect(proposals).toHaveCount(2);
  await expect(page.getByTestId("bank-review")).toContainText("Paiement de la facture");
  await expect(page.getByTestId("bank-review")).toContainText("6940");
  await expect(page.getByTestId("bank-review")).toContainText("Justificatif de Banque Cantonale");
  await page.getByTestId("bank-validate-confident").click();
  await expect(page.getByText("2 écritures validées.")).toBeVisible();
  await expect(page.getByText("Tous les mouvements sont traités.")).toBeVisible();

  await page.getByRole("link", { name: "Journal" }).click();
  await expect(page.getByTestId("journal")).toContainText("6940");
  await expect(page.getByTestId("chain-status")).toHaveText(
    "Chaîne d'empreintes vérifiée sur 3 écritures.",
  );
  await page.goto("/fr/app/invoices");
  await expect(page.getByRole("row", { name: /Client SA/ })).toContainText("Payée");
  await page.goto("/fr/app/accounting/receipts");
  await expect(page.getByTestId("receipt-status")).toHaveText("Comptabilisé");

  // Rapports : 150.00 de prestations moins 5.00 de frais bancaires.
  await page.getByRole("link", { name: "Rapports" }).click();
  await expect(page.getByTestId("result")).toHaveText("145.00");
  await expect(page.getByTestId("balance-check")).toHaveText("Le bilan est équilibré.");
  await page.getByTestId("trial-balance").getByRole("link", { name: /6940/ }).click();
  await expect(page.getByTestId("ledger")).toContainText("5.00");
});

/** Référence SCOR de la facture émise, recalculée depuis son numéro (IBAN ordinaire, pas de QR-IBAN). */
async function invoiceReference(page: Page): Promise<string> {
  await page.goto("/fr/app/invoices");
  const number = await page
    .getByRole("row", { name: /Client SA/ })
    .getByRole("link")
    .textContent();
  return scorReference((number ?? "").trim());
}
