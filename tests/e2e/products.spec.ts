import { expect, test } from "@playwright/test";
import { login } from "./helpers";

test("articles : création avec prix suisse, erreur de montant, modification, archivage", async ({
  page,
}) => {
  await login(page, "de", {
    sub: "sub-pr",
    email: "pr@atelier.test",
    org: "org-pr",
    org_name: "Produkte GmbH",
  });
  await page.getByRole("link", { name: "Artikel" }).click();
  await page.getByTestId("product-new").click();
  const form = page.getByTestId("product-form");
  await form.getByLabel("Bezeichnung").fill("Beratung");
  await form.getByLabel("Artikelnummer").fill("BER-H");
  await form.getByLabel("Einzelpreis exkl. MWST (CHF)").fill("150.555");
  await page.getByTestId("product-save").click();
  await expect(page.getByText("Ungültiger Betrag (höchstens zwei Dezimalstellen).")).toBeVisible();

  await page
    .getByTestId("product-form")
    .getByLabel("Einzelpreis exkl. MWST (CHF)")
    .fill("1'250.50");
  await page.getByTestId("product-save").click();
  await expect(page).toHaveURL(/\/de\/app\/products\?saved=1$/);
  const row = page.getByRole("row", { name: /Beratung/ });
  await expect(row).toContainText("1'250.50");
  await expect(row).toContainText("8.1");

  await page.getByRole("link", { name: "Beratung" }).click();
  await expect(
    page.getByTestId("product-form").getByLabel("Einzelpreis exkl. MWST (CHF)"),
  ).toHaveValue("1'250.50");
  await page.getByTestId("product-archive").click();
  await expect(page.getByText("Artikel archiviert.")).toBeVisible();
});
