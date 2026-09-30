import { expect, test } from "@playwright/test";
import { login, setupBilling } from "./helpers";

test("facture : brouillon avec article et ligne libre, émission avec numéro, facture figée", async ({
  page,
}) => {
  const run = Date.now();
  await login(page, "fr", {
    sub: `sub-inv-${run}`,
    email: `inv-${run}@atelier.test`,
    org: `org-inv-${run}`,
    org_name: "Factures Sàrl",
  });

  await setupBilling(page);

  await page.getByRole("link", { name: "Factures" }).click();
  await page.getByTestId("invoice-new").click();
  const form = page.getByTestId("invoice-form");
  await form.getByLabel("Client", { exact: true }).selectOption({ label: "Client SA" });
  const line0 = page.getByTestId("invoice-line-0");
  await line0.getByLabel("Article").selectOption({ label: "Conseil" });
  await line0.getByLabel("Quantité").fill("2.5");
  await page.getByTestId("invoice-line-add").click();
  const line1 = page.getByTestId("invoice-line-1");
  await line1.getByLabel("Désignation").fill("Frais de déplacement");
  await line1.getByLabel("Prix unitaire HT").fill("40,5");
  await line1.getByLabel("TVA").selectOption("exempt");
  const totals = page.getByTestId("invoice-totals");
  await expect(totals).toContainText("415.50");
  await expect(totals).toContainText("30.38");
  await expect(totals).toContainText("CHF 445.88");

  await page.getByTestId("invoice-save").click();
  await expect(page.getByText("Brouillon enregistré.")).toBeVisible();
  await expect(page.getByTestId("document-status")).toHaveText("Brouillon");

  await page.getByTestId("document-issue").click();
  await expect(page.getByText(/Facture émise/)).toBeVisible();
  const year = new Date().getFullYear();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(`Facture ${year}-0001`);
  const doc = page.getByTestId("invoice-document");
  await expect(doc).toContainText("CHE-116.281.710 TVA");
  await expect(doc).toContainText("Client SA");
  await expect(page.getByTestId("invoice-total")).toHaveText("CHF 445.88");
  await expect(page.getByTestId("invoice-form")).toHaveCount(0);

  const href = await page.getByTestId("document-pdf").getAttribute("href");
  const pdf = await page.request.get(href ?? "");
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()["content-type"]).toBe("application/pdf");
  expect((await pdf.body()).subarray(0, 5).toString()).toBe("%PDF-");

  await page.getByRole("link", { name: "Toutes les factures" }).click();
  await expect(page.getByRole("row", { name: new RegExp(`${year}-0001`) })).toContainText("445.88");
});
