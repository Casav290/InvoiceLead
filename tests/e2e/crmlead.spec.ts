import { expect, test } from "@playwright/test";
import { login } from "./helpers";

test("lead gagné dans CRMlead : relecture, puis devis en brouillon créé une seule fois", async ({
  page,
}) => {
  const run = Date.now();
  await login(page, "fr", {
    sub: `sub-crm-${run}`,
    email: `crm-${run}@atelier.test`,
    org: `org-crm-${run}`,
    org_name: "Passage Sàrl",
  });
  const d = Buffer.from(
    JSON.stringify({
      v: 1,
      kind: "quote",
      lead: { id: `lead-${run}`, title: "Refonte du site" },
      contact: { id: `co-${run}`, name: "Boulangerie Rochat SA", email: "lea@rochat.test" },
      lines: [
        { description: "Atelier de cadrage", quantity: 2, unit: "day", unitPriceCents: 120000 },
      ],
    }),
  ).toString("base64url");

  await page.goto(`/fr/app/import/crmlead?d=${d}`);
  await expect(page.getByTestId("crm-import")).toContainText("Boulangerie Rochat SA");
  await expect(page.getByTestId("crm-total")).toHaveText("2'400.00");
  await page.getByTestId("crm-import-confirm").click();
  await expect(page.getByText("Brouillon créé depuis CRMlead.", { exact: false })).toBeVisible();
  const url = page.url();
  expect(url).toMatch(/\/fr\/app\/quotes\/[0-9a-f-]+\?from=crmlead/);

  // Rouvrir le lien ramène au même devis.
  await page.goto(`/fr/app/import/crmlead?d=${d}`);
  await page.getByTestId("crm-import-confirm").click();
  await page.waitForURL(/from=crmlead/);
  expect(page.url()).toBe(url);

  await page.goto("/fr/app/import/crmlead?d=abc");
  await expect(page.getByText(/incomplet ou illisible/)).toBeVisible();
});
