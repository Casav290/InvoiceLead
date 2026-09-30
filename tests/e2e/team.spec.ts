import { expect, test } from "@playwright/test";
import { LEAD, login } from "./helpers";

test("équipe : rôle d'un utilisateur, invitation et accès d'une fiduciaire", async ({
  browser,
  page,
}) => {
  const run = Date.now();
  const org = `org-team-${run}`;
  await login(page, "fr", {
    sub: `sub-team-${run}`,
    email: `team-${run}@atelier.test`,
    org,
    org_name: "Équipe Sàrl",
    plan: "pro",
  });

  // Un utilisateur de l'entreprise, limité aux factures.
  const bobContext = await browser.newContext();
  const bob = await bobContext.newPage();
  await login(bob, "fr", {
    sub: `sub-bob-${run}`,
    email: `bob-${run}@atelier.test`,
    name: "Bob Muster",
    org,
    org_name: "Équipe Sàrl",
    org_role: "user",
    plan: "pro",
  });

  await page.goto("/fr/app/settings/team");
  await expect(page.getByTestId("seats")).toHaveText("2 sur 2 places utilisées");
  const bobRow = page.getByTestId("team-member").filter({ hasText: "Bob Muster" });
  await bobRow.getByLabel("Dans InvoiceLead").selectOption({ label: "Factures seulement" });
  await bobRow.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByText("Rôle enregistré.")).toBeVisible();

  // Bob ne peut plus rien comptabiliser : l'import bancaire le renvoie à l'accueil.
  await bob.goto("/fr/app/accounting/bank");
  await bob.getByLabel("Relevé bancaire (camt.053)").setInputFiles({
    name: "releve.xml",
    mimeType: "application/xml",
    buffer: Buffer.from("<Document/>"),
  });
  await bob.getByTestId("bank-import").click();
  await expect(bob.getByTestId("forbidden")).toBeVisible();
  await bobContext.close();

  // Invitation de la fiduciaire.
  const fiduEmail = `fidu-${run}@fidu.test`;
  await page.getByLabel("Adresse e-mail de la fiduciaire").fill(fiduEmail);
  await page.getByTestId("fiduciary-invite").click();
  await expect(page.getByText(`Invitation envoyée à ${fiduEmail}.`)).toBeVisible();
  const link = await page.getByTestId("invite-link").inputValue();
  expect(link).toContain("/fr/invite?token=");

  // La fiduciaire se connecte avec son propre Compte Lead et accepte.
  const fiduContext = await browser.newContext();
  const fidu = await fiduContext.newPage();
  const res = await fidu.request.post(`${LEAD}/test/next-user`, {
    data: {
      sub: `sub-fidu-${run}`,
      email: fiduEmail,
      org: `org-fidu-${run}`,
      org_name: "Fidu Conseil SA",
    },
  });
  expect(res.ok()).toBeTruthy();
  await fidu.goto(new URL(link).pathname + new URL(link).search);
  await fidu.getByRole("link", { name: "Se connecter avec mon Compte Lead" }).click();
  await fidu.waitForURL(/\/fr\/invite\?token=/);
  await fidu.getByTestId("invite-accept").click();
  await fidu.waitForURL(/\/fr\/app\/accounting\?welcome=fiduciary/);
  await expect(fidu.getByTestId("org-name")).toHaveText("Équipe Sàrl");

  // Retour à sa propre entreprise par le sélecteur.
  await fidu.getByTestId("org-switcher").locator("summary").click();
  await fidu.getByRole("button", { name: "Fidu Conseil SA" }).click();
  await expect(fidu.getByTestId("org-name")).toHaveText("Fidu Conseil SA");

  // L'entreprise voit sa fiduciaire et peut lui retirer l'accès.
  await page.reload();
  await expect(page.getByTestId("fiduciary")).toContainText(fiduEmail);
  await page.getByTestId("fiduciary-remove").click();
  await expect(page.getByText("Accès retiré.")).toBeVisible();
  await expect(page.getByTestId("fiduciary")).toHaveCount(0);
  await fiduContext.close();
});
