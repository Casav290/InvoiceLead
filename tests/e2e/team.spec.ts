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

test("équipe : l'administrateur invite une personne depuis InvoiceLead", async ({ page }) => {
  const run = Date.now();
  const org = `org-add-${run}`;
  await login(page, "fr", {
    sub: `sub-add-${run}`,
    email: `add-${run}@atelier.test`,
    org,
    org_name: "Ajout Sàrl",
    plan: "proplus",
  });
  await page.goto("/fr/app/settings/team");
  const form = page.getByTestId("member-invite");
  await expect(form).toContainText("Ajouter une personne");
  const colleague = `coll-${run}@atelier.test`;
  await form.getByLabel("Nom").fill("Léa Collègue");
  await form.getByLabel("Adresse e-mail").fill(colleague);
  await page.getByTestId("member-invite-submit").click();
  await expect(form.getByRole("status")).toHaveText(`Invitation envoyée à ${colleague}.`);
  type Sent = { invites: Record<string, string>[]; resends: Record<string, string>[] };
  const sent = async () =>
    (await (await page.request.get(`${LEAD}/test/member-invites`)).json()) as Sent;
  expect((await sent()).invites.at(-1)).toEqual({
    org,
    inviter: `sub-add-${run}`,
    email: colleague,
    name: "Léa Collègue",
    locale: "fr",
  });

  // Déjà invitée, pas encore arrivée : l'invitation est renvoyée.
  await form.getByLabel("Nom").fill("Léa Collègue");
  await form.getByLabel("Adresse e-mail").fill(colleague);
  await page.getByTestId("member-invite-submit").click();
  await expect(form.getByRole("status")).toHaveText(`Invitation renvoyée à ${colleague}.`);
  expect((await sent()).resends.at(-1)).toMatchObject({
    org,
    inviter: `sub-add-${run}`,
    locale: "fr",
  });

  // Adresse qui a déjà un accès Lead : l'écran le dit et garde la saisie.
  await form.getByLabel("Nom").fill("Actif");
  await form.getByLabel("Adresse e-mail").fill(`actif-${run}@atelier.test`);
  await page.getByTestId("member-invite-submit").click();
  await expect(form.getByRole("alert")).toContainText("a déjà un accès Lead");
  await expect(form.getByLabel("Adresse e-mail")).toHaveValue(`actif-${run}@atelier.test`);

  // Plus de place dans la formule : lien vers une formule plus grande.
  await form.getByLabel("Nom").fill("Plein");
  await form.getByLabel("Adresse e-mail").fill(`plein-${run}@atelier.test`);
  await page.getByTestId("member-invite-submit").click();
  await expect(form.getByRole("alert")).toContainText("Toutes les places de votre formule");
  await expect(form.getByRole("link", { name: /plus de places/ })).toHaveAttribute(
    "href",
    "https://scanlead.io/billing",
  );
});

test("équipe : un responsable qui n'est pas administrateur ne voit pas l'invitation", async ({
  page,
}) => {
  const run = Date.now();
  await login(page, "fr", {
    sub: `sub-mgr-${run}`,
    email: `mgr-${run}@atelier.test`,
    org: `org-mgr-${run}`,
    org_role: "manager",
    plan: "proplus",
  });
  await page.goto("/fr/app/settings/team");
  await expect(page.getByTestId("member-invite")).toHaveCount(0);
  await expect(page.getByTestId("team-members")).toContainText(
    "Seul l'administrateur de l'organisation ajoute de nouvelles personnes.",
  );
});

test("avis de bêta envoyé depuis le menu", async ({ page }) => {
  const run = Date.now();
  await login(page, "fr", {
    sub: `sub-fb-${run}`,
    email: `fb-${run}@atelier.test`,
    org: `org-fb-${run}`,
  });
  await page.goto("/fr/app/invoices");
  await page.getByTestId("user-menu").click();
  await page.getByTestId("feedback-link").click();
  await page.waitForURL(/\/fr\/app\/feedback\?from=/);
  await page.getByLabel("Problème").check();
  await page.getByLabel("Votre message").fill("Le bouton est difficile à trouver.");
  await page.getByTestId("feedback-send").click();
  await expect(page.getByText("Merci, votre avis est bien arrivé.")).toBeVisible();
});
