import { expect, test } from "@playwright/test";
import { LEAD, login } from "./helpers";

test("sans session, la page demandée passe par le Compte Lead puis se rouvre", async ({ page }) => {
  const res = await page.request.get("/fr/app/invoices?kind=quote", { maxRedirects: 0 });
  expect([303, 307, 308]).toContain(res.status());
  const location = res.headers().location ?? "";
  expect(location).toContain("/fr/login?next=");
  expect(decodeURIComponent(location)).toContain("next=/fr/app/invoices?kind=quote");
  await page.goto("/fr/app/invoices");
  await expect(page).toHaveURL(/\/fr\/app\/invoices$/);
});

test("une adresse de retour étrangère est ignorée", async ({ page }) => {
  await page.goto("/auth/lead/start?locale=de&next=https%3A%2F%2Fevil.example%2F");
  await expect(page).toHaveURL(/\/de\/app$/);
});

test("l'écran de connexion ne reste que pour dire une erreur", async ({ page }) => {
  await page.goto("/de/login?erreur=session");
  await expect(page.getByTestId("lead-login")).toBeVisible();
});

test("« Créer un compte » ouvre directement l'inscription du Compte Lead", async ({ page }) => {
  const first = await page.request.get("/fr/signup", { maxRedirects: 0 });
  expect([303, 307, 308]).toContain(first.status());
  const start = first.headers().location ?? "";
  expect(start).toContain("/auth/lead/start?locale=fr&signup=1");
  const second = await page.request.get(start, { maxRedirects: 0 });
  expect(second.status()).toBe(303);
  const authorize = new URL(second.headers().location ?? "");
  expect(authorize.pathname).toBe("/oauth/authorize");
  expect(authorize.searchParams.get("prompt")).toBe("create");
});

test("« Connexion » et « Créer un compte » mènent tout droit au Compte Lead", async ({ page }) => {
  await page.goto("/fr");
  const header = page.locator("header");
  await expect(header.getByRole("link", { name: "Connexion" })).toHaveAttribute(
    "href",
    "/auth/lead/start?locale=fr",
  );
  await expect(header.locator('a[href="/auth/lead/start?locale=fr&signup=1"]')).toHaveCount(1);
  await header.getByRole("link", { name: "Connexion" }).click();
  await page.waitForURL("**/fr/app");
});

test("session expirée : la page demandée se rouvre après la reconnexion", async ({
  page,
  context,
}) => {
  await context.addCookies([
    { name: "il_session", value: "expiree", url: "http://localhost:3100/" },
  ]);
  await page.goto("/fr/app/invoices?kind=quote");
  await expect(page).toHaveURL(/\/fr\/app\/invoices\?kind=quote$/);
});

test("l'écran d'erreur garde la page demandée pour « Réessayer »", async ({ page }) => {
  await page.goto("/fr/login?erreur=lead&next=%2Ffr%2Fapp%2Finvoices");
  await expect(page.getByTestId("lead-login")).toHaveAttribute(
    "href",
    "/auth/lead/start?locale=fr&next=%2Ffr%2Fapp%2Finvoices",
  );
});

test("deux onglets qui se connectent en même temps arrivent chacun sur leur page", async ({
  browser,
}) => {
  const context = await browser.newContext();
  const one = await context.newPage();
  const two = await context.newPage();
  // Les deux demandes partent avant que l'une revienne : chacune garde la sienne.
  const a = await one.request.get("/auth/lead/start?locale=fr&next=%2Ffr%2Fapp%2Finvoices", {
    maxRedirects: 0,
  });
  const b = await two.request.get("/auth/lead/start?locale=fr&next=%2Ffr%2Fapp%2Fquotes", {
    maxRedirects: 0,
  });
  await one.goto(a.headers().location ?? "");
  await expect(one).toHaveURL(/\/fr\/app\/invoices$/);
  await two.goto(b.headers().location ?? "");
  await expect(two).toHaveURL(/\/fr\/app\/quotes$/);
  await context.close();
});

test("la racine choisit une langue", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/(de|fr)$/);
});

test("connexion par le Compte Lead, puis retour direct dans l'application", async ({ page }) => {
  await login(page, "fr");
  await expect(page.getByTestId("dashboard-title")).toHaveText("Bonjour Ada");
  await expect(page.getByTestId("org-name")).toHaveText("Atelier Muster GmbH");
  // Le tableau de bord donne des chiffres (les montants exacts sont vérifiés dans invoices.spec).
  await expect(page.getByTestId("figure-revenue-month")).toHaveText(/^[A-Z]{3} [\d'.,]+$/);
  await expect(page.getByTestId("figure-open")).toHaveText(/^[A-Z]{3} [\d'.,]+$/);
  await expect(page.getByTestId("dashboard-chart")).toBeVisible();

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
  // Plus de session : l'application renvoie vers le Compte Lead.
  const again = await page.request.get("/de/app", { maxRedirects: 0 });
  expect(again.headers().location ?? "").toContain("/de/login?next=");
});

test("un compte Lead sans InvoiceLead dans sa formule entre en version gratuite", async ({
  page,
}) => {
  await login(page, "fr", {
    sub: "sub-noa",
    email: "noa@libre.test",
    name: "Noa",
    org: "org-libre",
    org_name: "Libre Sàrl",
    access: false,
  });
  await expect(page.getByTestId("dashboard-title")).toBeVisible();
});

test("une application retirée montre l'écran sans accès", async ({ page }) => {
  await login(
    page,
    "fr",
    {
      sub: "sub-ret",
      email: "ret@libre.test",
      name: "Ret",
      org: "org-retired",
      org_name: "Retraite Sàrl",
      status: "retired",
    },
    "**/fr/no-access",
  );
  await expect(page.getByTestId("no-access")).toBeVisible();

  // La page de l'application n'est ni exécutée ni envoyée à une organisation sans accès.
  const direct = await page.request.get("/fr/app", { maxRedirects: 0 });
  expect([303, 307, 308]).toContain(direct.status());
  expect(direct.headers().location).toContain("/fr/no-access");
  expect(await direct.text()).not.toContain("dashboard-title");
});

test("un retour sans demande en cours relance la connexion une fois, sans écran", async ({
  page,
}) => {
  // Demande expirée (plus de 30 minutes, autre onglet) : relancée, la personne arrive dans l'application.
  await page.goto("/auth/lead/callback?code=x&state=y");
  await expect(page).toHaveURL(/\/de\/app$/);
});

test("un retour sans demande, juste après une relance, montre l'écran d'erreur", async ({
  page,
  context,
}) => {
  await context.addCookies([
    { name: "il_login_retry", value: "1", url: "http://localhost:3100/auth/lead/callback" },
  ]);
  await page.goto("/auth/lead/callback?code=x&state=y");
  await expect(page).toHaveURL(/\/de\/login\?erreur=session$/);
  await expect(page.getByText("Die Anmeldeanfrage ist abgelaufen")).toBeVisible();
});

test("un état falsifié au retour est refusé", async ({ page, context }) => {
  await context.addCookies([
    { name: "il_login_retry", value: "1", url: "http://localhost:3100/auth/lead/callback" },
  ]);
  await page.goto("/de/login?erreur=session");
  // Départ réel (cookie posé), mais retour avec un autre `state`.
  const start = await page.request.get("/auth/lead/start?locale=de", { maxRedirects: 0 });
  expect(start.status()).toBe(303);
  await page.goto("/auth/lead/callback?code=abc&state=faux");
  // Aucune demande ne porte ce `state` : refusé, sans session ouverte.
  await expect(page).toHaveURL(/\/de\/login\?erreur=(lead|session)$/);
});

test("un chemin encodé ne contourne pas le filtre du proxy", async ({ page }) => {
  const res = await page.request.get("/de/%61pp", { maxRedirects: 0 });
  expect([303, 307, 308]).toContain(res.status());
  expect(await res.text()).not.toContain("dashboard-title");
  expect(res.headers().location ?? "").toContain("/de/login");
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

  test("un retour expiré relance la connexion en français", async ({ page }) => {
    await page.goto("/auth/lead/callback?code=x&state=y");
    await expect(page).toHaveURL(/\/fr\/app$/);
  });
});

test("pages publiques : tarifs, FAQ et textes légaux dans les deux langues", async ({ page }) => {
  for (const [path, heading] of [
    ["/fr/pricing", "Des tarifs simples, pour toute la famille Lead"],
    ["/de/faq", "Häufige Fragen"],
    ["/fr/legal/privacy", "Politique de confidentialité InvoiceLead"],
    ["/de/legal/dpa", "Auftragsbearbeitungsvertrag (AVV) InvoiceLead"],
    ["/de/legal/imprint", "Impressum"],
    ["/fr/legal/terms", "Conditions générales InvoiceLead"],
  ] as const) {
    const res = await page.goto(path);
    expect(res?.status(), path).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(heading);
  }
  const missing = await page.goto("/fr/legal/inconnu");
  expect(missing?.status()).toBe(404);
});
