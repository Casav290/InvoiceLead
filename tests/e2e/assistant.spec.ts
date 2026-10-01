import { expect, test } from "@playwright/test";
import { login, setupBilling } from "./helpers";

test("assistant : une question sur les livres, réponse tirée des chiffres", async ({ page }) => {
  const run = Date.now();
  await login(page, "fr", {
    sub: `sub-ask-${run}`,
    email: `ask-${run}@atelier.test`,
    org: `org-ask-${run}`,
    org_name: "Question Sàrl",
    plan: "pro",
  });
  await setupBilling(page);
  await page.goto("/fr/app/invoices/new");
  await page
    .getByTestId("invoice-form")
    .getByLabel("Client", { exact: true })
    .selectOption({ label: "Client SA" });
  await page.getByTestId("invoice-line-0").getByLabel("Article").selectOption({ label: "Conseil" });
  await page.getByTestId("invoice-save").click();
  await page.getByTestId("document-issue").click();
  await expect(page.getByText(/Facture émise/)).toBeVisible();

  await page.goto("/fr/app");
  await page.getByTestId("dashboard-assistant").click();
  await page.getByRole("button", { name: "Qui me doit le plus ?" }).click();
  await page.getByTestId("assistant-ask").click();
  const answer = page.getByTestId("assistant-answer");
  await expect(answer).toContainText("Vos clients vous doivent CHF 162.15");
  await expect(answer.getByRole("link", { name: "Factures" })).toBeVisible();
  await expect(answer.getByRole("link")).toHaveCount(1);
});
