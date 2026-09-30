import { expect, test } from "@playwright/test";
import { login } from "./helpers";

test("formule gratuite : fonctions Pro signalées, liens vers la mise à niveau", async ({
  page,
}) => {
  const run = Date.now();
  await login(page, "fr", {
    sub: `sub-free-${run}`,
    email: `free-${run}@atelier.test`,
    org: `org-free-${run}`,
    org_name: "Gratuit Sàrl",
  });
  await expect(page.getByTestId("plan-usage")).toContainText("Formule Gratuit");
  await expect(page.getByTestId("plan-usage")).toContainText("0 factures sur 10");
  for (const path of [
    "/fr/app/accounting/bank",
    "/fr/app/accounting/receipts",
    "/fr/app/accounting/vat",
  ]) {
    await page.goto(path);
    await expect(page.getByTestId("plan-notice")).toBeVisible();
    await expect(
      page.getByTestId("plan-notice").getByRole("link", { name: "Passer à Pro" }),
    ).toHaveAttribute("href", /^https:\/\//);
  }
});
