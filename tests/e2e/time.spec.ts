import { expect, test } from "@playwright/test";
import { login, setupBilling } from "./helpers";

test("temps : projet, saisie, chrono, puis facture des heures", async ({ page }) => {
  const run = Date.now();
  await login(page, "fr", {
    sub: `sub-time-${run}`,
    email: `time-${run}@atelier.test`,
    org: `org-time-${run}`,
    org_name: "Heures Sàrl",
  });
  await setupBilling(page);
  await page.getByRole("link", { name: "Temps" }).first().click();
  await expect(page.getByText("Créez d'abord un projet pour un client.")).toBeVisible();

  await page.goto("/fr/app/time/projects");
  const form = page.getByTestId("project-form");
  await form.getByLabel("Nom du projet").fill("Site web");
  await form.getByLabel("Client").selectOption({ label: "Client SA" });
  await form.getByLabel("Tarif horaire hors TVA (CHF)").fill("150");
  await form.getByLabel("Budget en heures (facultatif)").fill("10");
  await page.getByTestId("project-save").click();
  await expect(page.getByText("Projet enregistré.")).toBeVisible();

  await page.goto("/fr/app/time");
  const entry = page.getByTestId("time-entry-form");
  await entry.getByLabel("Durée").fill("1:30");
  await entry.getByLabel("Description").fill("Maquette");
  await page.getByTestId("time-entry-save").click();
  await expect(page.getByText("Temps ajouté.")).toBeVisible();
  await expect(page.getByTestId("time-entry")).toContainText("Maquette");

  await page.getByTestId("timer").getByLabel("Description").fill("Intégration");
  await page.getByTestId("timer-start").click();
  await expect(page.getByTestId("timer-elapsed")).toBeVisible();
  await page.getByTestId("timer-stop").click();
  await expect(page.getByText("Chrono arrêté, temps enregistré.")).toBeVisible();
  await expect(page.getByTestId("time-entry")).toHaveCount(2);

  await page.goto("/fr/app/time/projects");
  await page.getByTestId("project-row").getByRole("link", { name: "Site web" }).click();
  await expect(page.getByTestId("project-unbilled")).toHaveText("227.50");
  await page.getByTestId("project-invoice").click();
  await expect(page).toHaveURL(/\/fr\/app\/invoices\/[0-9a-f-]+\?saved=1$/);
  await expect(page.getByTestId("invoice-form")).toBeVisible();
  await expect(page.getByTestId("invoice-line-0").getByLabel("Désignation")).toHaveValue(
    /Maquette/,
  );

  await page.goto("/fr/app/time/projects");
  await page.getByTestId("project-row").getByRole("link", { name: "Site web" }).click();
  await expect(page.getByTestId("project-unbilled")).toHaveText("0.00");
});
