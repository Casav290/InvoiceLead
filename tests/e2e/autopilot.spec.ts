import { expect, test } from "@playwright/test";
import { scorReference } from "../../src/countries/ch/qr-reference";
import { camt053 } from "../support/camt";
import { login, setupBilling } from "./helpers";

test("pilote automatique : le paiement reconnu passe seul, la personne approuve ou annule", async ({
  page,
}) => {
  const run = Date.now();
  const today = new Date().toISOString().slice(0, 10);
  await login(page, "fr", {
    sub: `sub-auto-${run}`,
    email: `auto-${run}@atelier.test`,
    org: `org-auto-${run}`,
    org_name: "Pilote Sàrl",
    plan: "pro",
  });
  await setupBilling(page);
  await page.goto("/fr/app/settings/accounts");
  await page.getByTestId("chart-install").click();
  await page.goto("/fr/app/settings/fiscal-years");
  await page.getByTestId("fiscal-year-first").click();
  await expect(page.getByText("Exercice ouvert.")).toBeVisible();

  await page.goto("/fr/app/invoices/new");
  await page
    .getByTestId("invoice-form")
    .getByLabel("Client", { exact: true })
    .selectOption({ label: "Client SA" });
  await page.getByTestId("invoice-line-0").getByLabel("Article").selectOption({ label: "Conseil" });
  await page.getByTestId("invoice-save").click();
  await page.getByTestId("document-issue").click();
  await expect(page.getByText(/Facture émise/)).toBeVisible();
  await page.goto("/fr/app/invoices");
  const number = await page
    .getByRole("row", { name: /Client SA/ })
    .getByRole("link")
    .textContent();

  await page.goto("/fr/app/accounting/review");
  await page.getByTestId("autopilot-form").getByLabel("Pilote automatique").check();
  await page.getByTestId("autopilot-save").click();
  await expect(page.getByText(/Pilote automatique activé/)).toBeVisible();

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
          reference: scorReference((number ?? "").trim()),
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
  await expect(page.getByTestId("autopilot-notice")).toContainText(
    "1 mouvement comptabilisé par le pilote automatique.",
  );
  // Les frais bancaires, proposés par l'IA à moins de 97 %, attendent une personne.
  await expect(page.getByTestId("bank-proposal")).toHaveCount(1);

  await page.getByTestId("autopilot-notice").getByRole("link").click();
  await expect(page.getByTestId("review-row")).toHaveCount(1);
  await expect(page.getByTestId("review-row")).toContainText("Paiement de facture");
  await page.getByTestId("review-undo").click();
  await expect(page.getByText(/Écriture annulée par extourne/)).toBeVisible();
  await expect(page.getByTestId("review-row")).toHaveCount(0);

  // Le paiement est de nouveau proposé ; validé par une personne, il ne repasse pas par la revue.
  await page.goto("/fr/app/accounting/bank");
  await expect(page.getByTestId("bank-proposal")).toHaveCount(2);
  await page.getByTestId("bank-validate-confident").click();
  await page.goto("/fr/app/accounting/review");
  await expect(page.getByText("Rien à approuver.")).toBeVisible();
  await expect(page.getByTestId("anomalies")).toBeVisible();
});
