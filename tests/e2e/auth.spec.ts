import { expect, test } from "@playwright/test";
import { LEAD, login } from "./helpers";

test("l'application sans session renvoie vers la connexion", async ({ page }) => {
  await page.goto("/de/app");
  await expect(page).toHaveURL(/\/de\/login$/);
  await expect(page.getByTestId("lead-login")).toBeVisible();
});

test("la racine choisit une langue", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/(de|fr)$/);
});

test("connexion par le Compte Lead, puis retour direct dans l'application", async ({ page }) => {
  await login(page, "fr");
  await expect(page.getByTestId("dashboard-title")).toHaveText("Bonjour Ada");
  await expect(page.getByTestId("org-name")).toHaveText("Atelier Muster GmbH");

  // Déjà connecté : /login et /signup mènent directement à l'application.
  await page.goto("/fr/login");
  await expect(page).toHaveURL(/\/fr\/app$/);
  await page.goto("/fr/signup");
  await expect(page).toHaveURL(/\/fr\/app$/);
});

test("le sélecteur d'applications ouvre <app>/login", async ({ page }) => {
  await login(page, "de");
  await page.getByTestId("application-switcher").click();
  await expect(page.getByTestId("application-switcher-crmlead")).toHaveAttribute(
    "href",
    "https://crmlead.io/login",
  );
  await expect(page.getByTestId("application-switcher-scanlead")).toHaveAttribute(
    "href",
    "https://scanlead.io/login",
  );
  await expect(page.getByRole("menuitem", { name: /ProjectLead/ })).toContainText("Demnächst");
  await expect(page.getByRole("menuitem", { name: /InvoiceLead/ })).toContainText("Hier");
});

test("déconnexion : session locale et Compte Lead fermés", async ({ page }) => {
  await login(page, "de");
  await page.getByTestId("user-menu").click();
  await page.getByTestId("logout").click();
  await expect(page).toHaveURL(/\/de$/);
  const logouts = (await (await page.request.get(`${LEAD}/test/logouts`)).json()) as {
    client_id: string;
    id_token_hint: string | null;
  }[];
  expect(logouts.at(-1)?.client_id).toBe("invoicelead");
  expect(logouts.at(-1)?.id_token_hint).toBeTruthy();
  await page.goto("/de/app");
  await expect(page).toHaveURL(/\/de\/login$/);
});

test("une formule sans InvoiceLead montre l'écran de mise à niveau", async ({ page }) => {
  await login(
    page,
    "fr",
    {
      sub: "sub-noa",
      email: "noa@libre.test",
      name: "Noa",
      org: "org-libre",
      org_name: "Libre Sàrl",
      access: false,
    },
    "**/fr/no-access",
  );
  await expect(page.getByTestId("no-access")).toBeVisible();

  // La page de l'application n'est ni exécutée ni envoyée à une organisation sans accès.
  const direct = await page.request.get("/fr/app", { maxRedirects: 0 });
  expect([303, 307, 308]).toContain(direct.status());
  expect(direct.headers().location).toContain("/fr/no-access");
  expect(await direct.text()).not.toContain("dashboard-title");
  await expect(page.getByRole("link", { name: "Mettre à niveau" })).toHaveAttribute(
    "href",
    "https://scanlead.io/billing",
  );
});

test("un retour sans demande en cours est refusé proprement", async ({ page }) => {
  await page.goto("/auth/lead/callback?code=x&state=y");
  await expect(page).toHaveURL(/\/de\/login\?erreur=session$/);
  await expect(page.getByText("Die Anmeldeanfrage ist abgelaufen")).toBeVisible();
});

test("un état falsifié au retour est refusé", async ({ page }) => {
  await page.goto("/de/login");
  // Départ réel (cookie posé), mais retour avec un autre `state`.
  const start = await page.request.get("/auth/lead/start?locale=de", { maxRedirects: 0 });
  expect(start.status()).toBe(303);
  await page.goto("/auth/lead/callback?code=abc&state=faux");
  await expect(page).toHaveURL(/\/de\/login\?erreur=lead$/);
});

test("un chemin encodé ne contourne pas le filtre du proxy", async ({ page }) => {
  const res = await page.request.get("/de/%61pp", { maxRedirects: 0 });
  expect([303, 307, 308]).toContain(res.status());
  expect(await res.text()).not.toContain("dashboard-title");
  await page.goto("/de/%61pp");
  await expect(page).toHaveURL(/\/de\/login$/);
});

test("déconnexion au clavier depuis le menu", async ({ page }) => {
  await login(page, "de");
  await page.getByTestId("user-menu").focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("logout")).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByTestId("logout")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/de$/);
});

test("une adresse inconnue donne une page 404 traduite", async ({ page }) => {
  const res = await page.goto("/fr/nexiste-pas");
  expect(res?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "Page introuvable" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "fr-CH");
});

test.describe("navigateur en français", () => {
  test.use({ locale: "fr-CH" });

  test("un retour expiré ramène à la connexion en français", async ({ page }) => {
    await page.goto("/auth/lead/callback?code=x&state=y");
    await expect(page).toHaveURL(/\/fr\/login\?erreur=session$/);
  });
});
