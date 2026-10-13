import { type BrowserContext, expect, type Page, test } from "@playwright/test";
import { APP, LEAD, login } from "./helpers";

/**
 * Passer d'une application Lead à l'autre (règle commune de la famille, demande d'Ève du 13.10.2026) :
 * connectée au Compte Lead, la personne qui tape invoicelead.io, suit un lanceur ou /login arrive
 * tout droit dans l'espace de son entreprise ; déconnectée, elle voit la page publique après un seul
 * essai silencieux, jamais un écran d'erreur ni une boucle. Le faux Compte Lead garde sa session dans
 * le navigateur (cookie « fake_lead_sid ») et répond login_required à prompt=none sans elle, comme
 * ERPlead.
 */

const FAMILY = [
  ["erplead", "EL", "rgb(67, 56, 202)", "https://erplead.io/account"],
  ["scanlead", "SL", "rgb(37, 99, 235)", "https://scanlead.io/login"],
  ["crmlead", "CL", "rgb(15, 110, 112)", "https://crmlead.io/login"],
  ["projectlead", "PL", "rgb(154, 106, 0)", "https://projectlead.io/login"],
  ["invoicelead", "IL", "rgb(122, 46, 103)", null],
  ["greetlead", "GL", "rgb(194, 24, 91)", "https://greetlead.io/login"],
] as const;

/** Demandes reçues par le faux Compte Lead (prompt, langue). */
async function authorizes(page: Page): Promise<{ prompt: string | null }[]> {
  return (await page.request.get(`${LEAD}/test/authorizes`)).json();
}
const silentCount = async (page: Page) =>
  (await authorizes(page)).filter((a) => a.prompt === "none").length;

/** Une entreprise propre au test, pour lire data-lead-org sans mélange. */
function person(tag: string, extra: Record<string, string> = {}) {
  const run = `${tag}-${Date.now()}`;
  return {
    sub: `sub-${run}`,
    email: `${run}@passage.test`,
    name: "Paula Passage",
    org: `org-${run}`,
    org_name: `Passage ${tag} Sàrl`,
    ...extra,
  };
}

/** Ne garde que la session du Compte Lead : comme une personne qui arrive d'une autre application. */
async function leadSessionOnly(context: BrowserContext) {
  await context.clearCookies({ name: "il_session" });
  await context.clearCookies({ name: "lead_probe" });
}

test("racine connectée : tout droit dans l'espace, langue de l'adresse ou du Compte Lead", async ({
  page,
}) => {
  const who = person("racine");
  await login(page, "de", who, "**/de/app");
  await page.goto("/");
  await page.waitForURL(`${APP}/fr/app`);
  await expect(page.locator("[data-lead-org]")).toHaveAttribute("data-lead-org", who.org);
  await page.goto("/de");
  await page.waitForURL(`${APP}/de/app`);
  await page.goto("/?lang=en");
  await page.waitForURL(`${APP}/en/app`);
  await expect(page.locator("html")).toHaveAttribute("lang", "en-GB");
});

test("racine déconnectée : la page de vente, après un seul essai silencieux", async ({
  page,
  context,
}) => {
  const before = await silentCount(page);
  await page.goto("/");
  await page.waitForURL(`${APP}/de`);
  await expect(page.locator("header").getByRole("link", { name: "Anmelden" })).toBeVisible();
  expect(page.url()).not.toContain("erreur");
  expect(await silentCount(page)).toBe(before + 1);
  const probe = (await context.cookies()).find((c) => c.name === "lead_probe");
  expect(probe).toMatchObject({ value: "1", path: "/", httpOnly: false, sameSite: "Lax" });
  // Deuxième chargement, autre langue : aucun nouvel essai.
  await page.reload();
  await page.goto("/fr");
  await expect(page).toHaveURL(`${APP}/fr`);
  expect(await silentCount(page)).toBe(before + 1);
});

test("Compte Lead ouvert, InvoiceLead pas encore : la racine et le lien profond entrent sans écran", async ({
  page,
  context,
}) => {
  const who = person("arrivee", { locale: "fr-CH" });
  await login(page, "de", who, "**/de/app");
  await leadSessionOnly(context);
  const before = await silentCount(page);
  await page.goto("/");
  await page.waitForURL(`${APP}/fr/app`);
  await expect(page.getByTestId("dashboard-title")).toHaveText("Bonjour Paula");
  await expect(page.locator("[data-lead-org]")).toHaveAttribute("data-lead-org", who.org);
  expect(await silentCount(page)).toBe(before + 1);
  // Connectée : lead_probe effacé, la racine mène de nouveau dans l'espace.
  expect((await context.cookies()).map((c) => c.name)).not.toContain("lead_probe");

  // Lien profond : le Compte Lead, toujours ouvert, rend la même personne (le faux Compte Lead
  // reconnecte la personne choisie, comme son écran de connexion).
  await leadSessionOnly(context);
  await page.request.post(`${LEAD}/test/next-user`, { data: who });
  await page.goto("/fr/app/invoices");
  await page.waitForURL(`${APP}/fr/app/invoices`);
  await expect(page.locator("[data-lead-org]")).toHaveAttribute("data-lead-org", who.org);
});

test("/login sans langue : l'espace dans la langue du Compte Lead, pas celle du navigateur", async ({
  page,
}) => {
  const who = person("login", { locale: "fr" });
  await page.request.post(`${LEAD}/test/next-user`, { data: who });
  // Navigateur en allemand (de-CH), Compte Lead en français.
  await page.goto("/login");
  await page.waitForURL(`${APP}/fr/app`);
  await expect(page.locator("[data-lead-org]")).toHaveAttribute("data-lead-org", who.org);
});

test("déconnexion : la racine reste publique, sans nouvel essai", async ({ page }) => {
  await login(page, "fr", person("sortie"));
  await page.getByTestId("user-menu").click();
  await page.getByTestId("logout").click();
  await page.waitForURL(/\/(de|fr)$/);
  const before = await silentCount(page);
  await page.goto("/");
  await expect(page).toHaveURL(/\/(de|fr)$/);
  expect(await silentCount(page)).toBe(before);
});

test("robots : la page publique, sans redirection", async ({ page }) => {
  const bot = {
    "user-agent": "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
    "sec-fetch-mode": "navigate",
    "sec-fetch-dest": "document",
  };
  const fr = await page.request.get("/fr", { headers: bot, maxRedirects: 0 });
  expect(fr.status()).toBe(200);
  const root = await page.request.get("/", { headers: bot, maxRedirects: 0 });
  expect(root.headers().location ?? "").not.toContain("/auth/lead/start");
});

for (const size of [
  { width: 1280, height: 800 },
  { width: 390, height: 844 },
]) {
  test(`lanceur à ${size.width} px : six applications, même ordre, adresse d'entrée`, async ({
    page,
  }) => {
    await page.setViewportSize(size);
    await login(page, "fr");
    const launcher = page.locator("[data-lead-launcher]");
    await expect(launcher).toHaveAttribute("aria-label", "Applications Lead");
    await expect(launcher).toHaveAttribute("title", "Applications Lead");
    const box = await launcher.boundingBox();
    expect([box?.width, box?.height]).toEqual([36, 36]);
    await launcher.click();
    const entries = page.locator("[data-lead-app]");
    await expect(entries).toHaveCount(6);
    const seen = await entries.evaluateAll((els) =>
      els.map((el) => ({
        code: el.getAttribute("data-lead-app"),
        mark: el.querySelector("span[aria-hidden]")?.textContent ?? "",
        color: getComputedStyle(el.querySelector("span[aria-hidden]") as Element).backgroundColor,
        href: el.getAttribute("href"),
        current: el.getAttribute("aria-current"),
        height: el.getBoundingClientRect().height,
        text: el.textContent ?? "",
      })),
    );
    expect(seen.map((s) => [s.code, s.mark, s.color, s.href])).toEqual(FAMILY.map((f) => [...f]));
    expect(seen.filter((s) => s.current).map((s) => [s.code, s.current])).toEqual([
      ["invoicelead", "page"],
    ]);
    expect(seen.every((s) => s.height >= 48)).toBe(true);
    expect(seen.find((s) => s.code === "invoicelead")?.text).toContain("Vous êtes ici");
    expect(seen.find((s) => s.code === "crmlead")?.text).toContain("Ouvrir");
    expect(seen.map((s) => s.text).join(" ")).not.toMatch(/Bientôt|formule|Mettre à niveau/i);

    const panel = page.locator("[data-lead-launcher-panel]");
    const frame = await panel.boundingBox();
    expect(frame).not.toBeNull();
    if (frame) {
      expect(frame.x).toBeGreaterThanOrEqual(0);
      expect(frame.x + frame.width).toBeLessThanOrEqual(size.width);
      if (size.width < 480) {
        // Téléphone : fixe, à 16 px des bords, sous l'en-tête.
        expect(Math.round(frame.x)).toBe(16);
        expect(Math.round(size.width - frame.x - frame.width)).toBe(16);
        const header = await page.locator("header").first().boundingBox();
        expect(frame.y).toBeGreaterThanOrEqual((header?.y ?? 0) + (header?.height ?? 0));
        expect(frame.y + frame.height).toBeLessThanOrEqual(size.height);
      } else {
        expect(Math.round(frame.width)).toBe(320);
      }
    }
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);

    // Échap ferme, un clic en dehors aussi.
    await page.keyboard.press("Escape");
    await expect(panel).toBeHidden();
    await expect(launcher).toBeFocused();
    await launcher.click();
    await expect(panel).toBeVisible();
    await page.locator("main").click({ position: { x: 5, y: 5 } });
    await expect(panel).toBeHidden();
  });
}
