import { expect, test } from "@playwright/test";
import { login, setupBilling } from "./helpers";

test("devis : émission, acceptation puis transformation en facture", async ({ page }) => {
  const run = Date.now();
  await login(page, "de", {
    sub: `sub-quo-${run}`,
    email: `quo-${run}@atelier.test`,
    org: `org-quo-${run}`,
    org_name: "Offerten GmbH",
  });
  await setupBilling(page);

  await page.goto("/de/app");
  await page.getByRole("link", { name: "Offerten" }).click();
  await page.getByTestId("quote-new").click();
  const form = page.getByTestId("invoice-form");
  await expect(form.getByLabel("Gültig bis")).toBeVisible();
  await form.getByLabel("Kunde", { exact: true }).selectOption({ label: "Client SA" });
  await page.getByTestId("invoice-line-0").getByLabel("Artikel").selectOption({ label: "Conseil" });
  await page.getByTestId("invoice-save").click();
  await expect(page.getByTestId("document-status")).toHaveText("Entwurf");

  await page.getByTestId("document-issue").click();
  const year = new Date().getFullYear();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(`Offerte O-${year}-0001`);
  await expect(page.getByTestId("invoice-document")).not.toContainText("Zahlbar auf das Konto");
  const pdf = await page.request.get(
    (await page.getByTestId("document-pdf").getAttribute("href")) ?? "",
  );
  expect(pdf.headers()["content-type"]).toBe("application/pdf");

  await page.getByTestId("quote-accept").click();
  await expect(page.getByTestId("document-status")).toHaveText("Angenommen");
  await page.getByTestId("quote-convert").click();
  await expect(page).toHaveURL(/\/de\/app\/invoices\/[0-9a-f-]+\?converted=1$/);
  await expect(page.getByText("Rechnungsentwurf aus der Offerte erstellt.")).toBeVisible();
  await expect(page.getByTestId("invoice-totals")).toContainText("162.15");

  await page.getByRole("link", { name: "Offerten" }).click();
  await expect(page.getByRole("row", { name: new RegExp(`O-${year}-0001`) })).toContainText(
    "Verrechnet",
  );
});
