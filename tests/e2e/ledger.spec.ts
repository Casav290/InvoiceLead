import { expect, test } from "@playwright/test";
import { login, setupBilling } from "./helpers";

test("comptabilité : pièce en attente, puis journal en partie double après mise en place", async ({
  page,
}) => {
  const run = Date.now();
  await login(page, "fr", {
    sub: `sub-led-${run}`,
    email: `led-${run}@atelier.test`,
    org: `org-led-${run}`,
    org_name: "Journal Sàrl",
  });
  await setupBilling(page);

  // Une facture émise avant la mise en place de la comptabilité attend.
  await page.goto("/fr/app/invoices/new");
  await page
    .getByTestId("invoice-form")
    .getByLabel("Client", { exact: true })
    .selectOption({ label: "Client SA" });
  await page.getByTestId("invoice-line-0").getByLabel("Article").selectOption({ label: "Conseil" });
  await page.getByTestId("invoice-save").click();
  await page.getByTestId("document-issue").click();
  await expect(page.getByText(/Facture émise/)).toBeVisible();

  await page.getByRole("link", { name: "Comptabilité" }).click();
  await expect(page.getByTestId("accounting-setup")).toBeVisible();
  await expect(page.getByTestId("unposted")).toContainText("1 pièce attend");

  await page.goto("/fr/app/settings/accounts");
  await page.getByTestId("chart-install").click();
  await page.goto("/fr/app/settings/fiscal-years");
  await page.getByTestId("fiscal-year-first").click();
  await expect(page.getByText("Exercice ouvert.")).toBeVisible();

  await page.goto("/fr/app/accounting");
  await page.getByTestId("post-pending").click();
  await expect(page.getByText("1 écriture ajoutée au journal.")).toBeVisible();
  const journal = page.getByTestId("journal");
  await expect(journal).toContainText("1100");
  await expect(journal).toContainText("162.15");
  await expect(journal).toContainText("3400");
  await expect(journal).toContainText("2200");
  await expect(journal).toContainText("12.15");
  await expect(page.getByTestId("chain-status")).toHaveText(
    "Chaîne d'empreintes vérifiée sur 1 écriture.",
  );
  await expect(page.getByTestId("unposted")).toHaveCount(0);
});
