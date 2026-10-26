import { expect, test } from "@playwright/test";
import { closeDb, markAppUsed } from "./db";
import { login, setupBilling, traitNetIssues } from "./helpers";

test.afterAll(() => closeDb());

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

test("temps : bloc ProjectLead sans clé ; Réglages, Applications Lead : état de chaque app", async ({
  page,
}) => {
  const run = Date.now();
  const org = `org-pl-${run}`;
  const email = `pl-${run}@atelier.test`;
  await login(page, "fr", { sub: `sub-pl-${run}`, email, org, org_name: "Projets Sàrl" });
  await page.goto("/fr/app/time");
  const block = page.getByTestId("projectlead-block");
  await expect(block).toContainText("Projets d'équipe avec ProjectLead");
  await expect(block).toContainText("ProjectLead gère les projets, le planning et le temps");
  await expect(block.getByTestId("projectlead-open")).toHaveText("Ouvrir ProjectLead");
  await expect(block.getByTestId("projectlead-open")).toHaveAttribute(
    "href",
    "https://projectlead.io",
  );
  // Plus de bouton de clé : une ligne d'état.
  await expect(block.getByTestId("projectlead-state")).toHaveText(
    "Le temps saisi dans ProjectLead arrive ici en brouillons de factures.",
  );
  await expect(block.getByTestId("projectlead-connect")).toHaveCount(0);
  await expect(page.getByText("Créez d'abord un projet pour un client.")).toBeVisible();

  // Réglages, Applications Lead : ouvert à toutes les formules, rien à coller.
  await page.goto("/fr/app/settings/lead-apps");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Applications Lead");
  await expect(page.getByTestId("settings-tab-leadApps")).toHaveText("Applications Lead");
  await expect(page.getByTestId("settings-tab-leadApps").getByTestId("pro-badge")).toHaveCount(0);
  await expect(page.getByTestId("settings-tab-projectlead")).toHaveCount(0);
  await expect(page.getByTestId("lead-apps-intro")).toHaveText(
    `Entreprise du Compte Lead : Projets Sàrl (${email}). Les applications ouvertes avec cette entreprise se relient toutes seules : rien à copier ni à coller.`,
  );
  await expect(page.getByTestId("lead-app-projectlead-state")).toHaveText("Pas encore utilisée");
  await expect(page.getByTestId("lead-app-crmlead-state")).toHaveText("Pas encore utilisée");
  await expect(page.getByTestId("lead-app-crmlead")).toContainText(
    "CRMlead : pas encore utilisée par votre entreprise. Ouvrez-la avec votre Compte Lead (gratuit pour commencer) : le lien se fait tout seul.",
  );
  await expect(page.getByTestId("lead-app-crmlead-open")).toHaveText("Ouvrir CRMlead");
  await expect(page.getByTestId("lead-apps-api")).toContainText(
    "Pas besoin de clé pour relier les applications Lead.",
  );
  await expect(page.getByTestId("lead-apps").locator("input, textarea")).toHaveCount(0);

  await markAppUsed(org, "projectlead");
  await page.reload();
  await expect(page.getByTestId("lead-app-projectlead-state")).toHaveText("Reliée");
  await expect(page.getByTestId("lead-app-projectlead")).toContainText(
    "ProjectLead crée ici les brouillons de factures du temps passé.",
  );
  await expect(page.getByTestId("lead-app-projectlead-last")).toHaveText(
    "Aucun brouillon reçu pour l’instant.",
  );

  // Réglages, API : outils extérieurs seulement.
  await page.goto("/fr/app/settings/api");
  await expect(page.getByTestId("api-lead-apps")).toHaveText(
    "Pas besoin de clé pour relier ProjectLead ou CRMlead.",
  );
  await expect(page.getByTestId("api-projectlead-link")).toHaveCount(0);

  // Téléphone : le bloc et l'écran tiennent sans débordement, au visuel Trait net.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/fr/app/time");
  await expect(page.getByTestId("projectlead-block")).toBeVisible();
  expect(await traitNetIssues(page)).toEqual([]);
  await page.goto("/fr/app/settings/lead-apps");
  expect(await traitNetIssues(page)).toEqual([]);
});
