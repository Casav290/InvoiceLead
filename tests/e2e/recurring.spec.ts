import { expect, test } from "@playwright/test";
import { login, setupBilling } from "./helpers";

test("facture récurrente : créée depuis une facture, générée et envoyée par la tâche quotidienne", async ({
  page,
}) => {
  const run = Date.now();
  await login(page, "fr", {
    sub: `sub-rec-${run}`,
    email: `rec-${run}@atelier.test`,
    org: `org-rec-${run}`,
    org_name: "Abonnements Sàrl",
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

  const today = new Date().toISOString().slice(0, 10);
  const panel = page.getByTestId("recurring-panel");
  await panel.locator("summary").click();
  await panel.getByLabel("Prochaine facture le").fill(today);
  await panel.getByLabel(/Émettre et envoyer automatiquement/).check();
  await page.getByTestId("recurring-create").click();
  await expect(page.getByText("Récurrence enregistrée.")).toBeVisible();
  await expect(page.getByTestId("recurring-row")).toContainText("Tous les mois");

  expect((await page.request.get("/api/cron/daily")).status()).toBe(401);
  const cron = await page.request.get("/api/cron/daily", {
    headers: { Authorization: "Bearer cron-secret-for-tests-only" },
  });
  const body = await cron.json();
  expect(body.recurring.created).toBeGreaterThanOrEqual(1);

  await page.goto("/fr/app/invoices");
  const year = new Date().getFullYear();
  await expect(page.getByRole("row", { name: new RegExp(`${year}-0002`) })).toContainText(
    "Client SA",
  );
});
