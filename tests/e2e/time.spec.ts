import { expect, test } from "@playwright/test";
import { login, setupBilling, traitNetIssues } from "./helpers";

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

test("temps : bloc ProjectLead, puis clé de liaison créée en formule gratuite, limitée à ProjectLead", async ({
  page,
}) => {
  const run = Date.now();
  await login(page, "fr", {
    sub: `sub-pl-${run}`,
    email: `pl-${run}@atelier.test`,
    org: `org-pl-${run}`,
    org_name: "Projets Sàrl",
  });
  await page.goto("/fr/app/time");
  const block = page.getByTestId("projectlead-block");
  await expect(block).toContainText("Projets d'équipe avec ProjectLead");
  await expect(block).toContainText("ProjectLead gère les projets, le planning et le temps");
  await expect(block).toContainText("brouillons de factures");
  await expect(block.getByTestId("projectlead-open")).toHaveText("Ouvrir ProjectLead");
  await expect(block.getByTestId("projectlead-open")).toHaveAttribute(
    "href",
    "https://projectlead.io",
  );
  // Le suivi du temps d'InvoiceLead reste là, sous le bloc.
  await expect(page.getByText("Créez d'abord un projet pour un client.")).toBeVisible();

  await block.getByTestId("projectlead-connect").click();
  await expect(page).toHaveURL(/\/fr\/app\/settings\/projectlead$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Relier ProjectLead");
  // Onglet ouvert à toutes les formules : pas de marque ; l'API complète reste Pro+.
  await expect(page.getByTestId("settings-tab-projectlead").getByTestId("pro-badge")).toHaveCount(
    0,
  );
  await expect(page.getByTestId("settings-tab-api").getByTestId("pro-badge")).toHaveText("Pro+");
  await expect(page.getByTestId("projectlead-drafts")).toContainText(
    "une facture compte dans vos 10 factures du mois seulement quand vous l'émettez",
  );
  await page.getByTestId("projectlead-key-create").click();
  const key = (await page.getByTestId("projectlead-key-secret").textContent())?.trim() ?? "";
  expect(key).toMatch(/^il_live_/);
  await expect(page.getByTestId("projectlead-key-row")).toContainText("ProjectLead");

  // Ce que ProjectLead appelle passe ; le reste de l'API est refusé à cette clé.
  const headers = { Authorization: `Bearer ${key}` };
  expect((await page.request.get("/api/v1/contacts?q=", { headers })).status()).toBe(200);
  expect((await page.request.get("/api/v1/invoices", { headers })).status()).toBe(403);
  expect(
    (await page.request.post("/api/mcp", { headers, data: { jsonrpc: "2.0", id: 1 } })).status(),
  ).toBe(403);

  // Révoquée : ProjectLead ne passe plus.
  await page.getByTestId("projectlead-key-row").getByRole("button", { name: "Révoquer" }).click();
  await expect(page.getByText("Clé révoquée.")).toBeVisible();
  expect((await page.request.get("/api/v1/contacts?q=", { headers })).status()).toBe(401);

  // Téléphone : le bloc de la page Temps tient sans débordement, au visuel Trait net.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/fr/app/time");
  await expect(page.getByTestId("projectlead-block")).toBeVisible();
  expect(await traitNetIssues(page)).toEqual([]);
});
