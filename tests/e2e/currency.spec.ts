import { expect, test } from "@playwright/test";
import { login, setupBilling } from "./helpers";

test("devise : réservée à Pro, cours BCE figé à l'émission, différence de change au paiement", async ({
  page,
}) => {
  const run = Date.now();
  const today = new Date().toISOString().slice(0, 10);
  const day = Number(today.slice(8, 10));
  // Cours du faux service BCE : 0.94 CHF pour 1 EUR, plus un millième par jour du mois.
  const rate = (0.94 + (day - 1) / 1000).toFixed(4);

  await login(page, "fr", {
    sub: `sub-fx-free-${run}`,
    email: `fx-free-${run}@atelier.test`,
    org: `org-fx-free-${run}`,
    org_name: "Gratuit Sàrl",
  });
  await setupBilling(page);
  await page.goto("/fr/app/invoices/new");
  const free = page.getByTestId("invoice-form");
  await free.getByLabel("Client", { exact: true }).selectOption({ label: "Client SA" });
  await free.getByLabel("Devise").selectOption("EUR");
  await page.getByTestId("invoice-line-0").getByLabel("Article").selectOption({ label: "Conseil" });
  await page.getByTestId("invoice-save").click();
  await expect(
    page.getByText("Facturer en devise étrangère fait partie de la formule Pro."),
  ).toBeVisible();

  await page.context().clearCookies();
  await login(page, "fr", {
    sub: `sub-fx-${run}`,
    email: `fx-${run}@atelier.test`,
    org: `org-fx-${run}`,
    org_name: "Devises Sàrl",
    plan: "pro",
  });
  await setupBilling(page);
  await page.goto("/fr/app/settings/accounts");
  await page.getByTestId("chart-install").click();
  await page.goto("/fr/app/settings/fiscal-years");
  await page.getByTestId("fiscal-year-first").click();
  await expect(page.getByText("Exercice ouvert.")).toBeVisible();

  await page.goto("/fr/app/invoices/new");
  const form = page.getByTestId("invoice-form");
  await form.getByLabel("Client", { exact: true }).selectOption({ label: "Client SA" });
  await form.getByLabel("Devise").selectOption("EUR");
  await expect(form.getByLabel("Cours (1 EUR en CHF)")).toBeVisible();
  await page.getByTestId("invoice-line-0").getByLabel("Article").selectOption({ label: "Conseil" });
  await expect(form).toContainText("EUR 162.15");
  await page.getByTestId("invoice-save").click();
  await expect(page).toHaveURL(/\/fr\/app\/invoices\/[0-9a-f-]+\?saved=1$/);
  await page.getByTestId("document-issue").click();
  await expect(page.getByText(/Facture émise/)).toBeVisible();

  const document = page.getByTestId("invoice-document");
  await expect(document.getByTestId("invoice-total")).toHaveText("EUR 162.15");
  await expect(document.getByTestId("invoice-fx")).toContainText(`1 EUR = ${rate} CHF`);
  const pdf = await page.request.get(`${page.url().split("?")[0]}/pdf`);
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()["content-type"]).toBe("application/pdf");

  // Le client paie au cours de 1 : la différence de change va sur 6960.
  const payment = page.getByTestId("payment-form");
  await expect(payment.getByLabel("Cours du jour (1 EUR en CHF)")).toBeVisible();
  await payment.getByLabel("Cours du jour (1 EUR en CHF)").fill("1");
  await page.getByTestId("payment-save").click();
  await expect(page).toHaveURL(/\?paid=1$/);

  await page.goto("/fr/app/invoices");
  await expect(page.getByRole("row").filter({ hasText: "Client SA" }).first()).toContainText(
    "EUR 162.15",
  );

  await page.goto("/fr/app/accounting");
  const journal = page.getByTestId("journal");
  await expect(journal).toContainText("6960");
  await expect(journal).toContainText("162.15");
  await expect(page.getByTestId("unposted")).toHaveCount(0);
});
