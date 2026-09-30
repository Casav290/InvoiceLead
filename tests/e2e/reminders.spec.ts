import { expect, test } from "@playwright/test";
import { login, setupBilling } from "./helpers";

test("relances : facture échue proposée, relance notée, historique sur la facture", async ({
  page,
}) => {
  const run = Date.now();
  await login(page, "fr", {
    sub: `sub-rem-${run}`,
    email: `rem-${run}@atelier.test`,
    org: `org-rem-${run}`,
    org_name: "Relances Sàrl",
  });
  await setupBilling(page);

  // 45 jours après la facture : 15 jours de retard, seule la première relance est due.
  const issued = new Date(Date.now() - 45 * 86_400_000).toISOString().slice(0, 10);
  await page.goto("/fr/app/invoices/new");
  const form = page.getByTestId("invoice-form");
  await form.getByLabel("Client", { exact: true }).selectOption({ label: "Client SA" });
  await form.getByLabel("Date de facture").fill(issued);
  await form.getByLabel("Date de la prestation").fill(issued);
  await page.getByTestId("invoice-line-0").getByLabel("Article").selectOption({ label: "Conseil" });
  await page.getByTestId("invoice-save").click();
  await page.getByTestId("document-issue").click();
  await expect(page.getByText(/Facture émise/)).toBeVisible();

  await page.goto("/fr/app/invoices");
  await expect(page.getByRole("row", { name: /Client SA/ })).toContainText("En retard");
  await page.getByTestId("reminders-link").click();
  const row = page.getByTestId("reminder-row");
  await expect(row).toContainText("1re relance");
  await expect(row).toContainText("pas d'e-mail");
  await row.getByRole("button", { name: "Noter comme envoyée (courrier)" }).click();
  await expect(page.getByText("Relance notée comme envoyée.")).toBeVisible();
  await expect(page.getByText("Aucune relance à faire aujourd'hui.")).toBeVisible();

  await page.goto("/fr/app/invoices");
  await page
    .getByRole("row", { name: /Client SA/ })
    .getByRole("link")
    .click();
  await expect(page.getByTestId("reminder-history")).toContainText("1re relance");
  await expect(page.getByTestId("reminder-history")).toContainText("courrier");
});
