import { expect, test } from "@playwright/test";
import { login, setupBilling } from "./helpers";

test("notes de frais : kilomètres et dépense, visibles par la comptabilité", async ({ page }) => {
  const run = Date.now();
  await login(page, "fr", {
    sub: `sub-exp-${run}`,
    email: `exp-${run}@atelier.test`,
    org: `org-exp-${run}`,
    org_name: "Frais Sàrl",
  });
  await setupBilling(page);
  await page.getByRole("link", { name: "Frais" }).first().click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Notes de frais");
  await expect(page.getByText("Aucune note de frais pour l'instant.")).toBeVisible();

  const trip = page.getByTestId("claim-mileage");
  await trip.getByLabel("Trajet (de, à, motif)").fill("Lausanne – Genève, client");
  await trip.getByLabel("Kilomètres").fill("120");
  await expect(trip.getByLabel("Taux par km (CHF)")).toHaveValue("0.70");
  await trip.getByLabel("À rembourser à").fill("Eva Muster");
  await trip.getByLabel("IBAN pour le remboursement").fill("CH56 0483 5012 3456 7800 9");
  await page.getByTestId("claim-mileage-save").click();
  await expect(page.getByText("Note de frais envoyée à la comptabilité.")).toBeVisible();
  await expect(page.getByTestId("claim-row")).toContainText("84.00");

  const expense = page.getByTestId("claim-expense");
  await expense.getByLabel("Objet").fill("Billet de train");
  await expense.getByLabel("Montant payé (CHF)").fill("abc");
  await expense.getByLabel("À rembourser à").fill("Eva Muster");
  await page.getByTestId("claim-expense-save").click();
  await expect(page.getByText("Montant invalide.")).toBeVisible();
  // L'IBAN de la note précédente est repris.
  await expect(expense.getByLabel("IBAN pour le remboursement")).toHaveValue(
    "CH5604835012345678009",
  );

  await page.goto("/fr/app/accounting/bills");
  await expect(page.getByTestId("bill-row")).toContainText("Note de frais");
  await expect(page.getByTestId("bill-row")).toContainText("Eva Muster");
});
