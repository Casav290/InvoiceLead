import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type Browser, expect, type Page, test } from "@playwright/test";
import { APP, LEAD } from "./helpers";

/**
 * « Continuer avec Google » dans l'app Android / iOS (lib/lead-app-auth.ts ; contrat d'ERPlead
 * docs/GOOGLE-APP.md, imité par le faux Compte Lead) : la vue web de l'app est un navigateur à l'agent
 * de l'app (InvoiceLeadApp LeadAppAuth/1) avec un faux pont Capacitor (tests/support/fake-capacitor.js).
 * Google n'est jamais appelé : son retour est imité par le faux Compte Lead (code de transfert).
 */

const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148";
const NEW_APP = `${IPHONE} InvoiceLeadApp LeadAppAuth/1`;
const OLD_APP = `${IPHONE} InvoiceLeadApp`;
const BRIDGE = readFileSync(join(process.cwd(), "tests/support/fake-capacitor.js"), "utf8");

type Call = { name: string; arg: unknown; url: string };

/** Une vue web de l'app : agent, faux pont, appels au pont relevés. */
async function webview(browser: Browser, ua = NEW_APP, launchUrl?: string) {
  const context = await browser.newContext({
    userAgent: ua,
    viewport: { width: 390, height: 844 },
    locale: "it-CH",
  });
  const calls: Call[] = [];
  await context.exposeBinding("__bridgeCall", ({ page }, name: string, arg: unknown) => {
    calls.push({ name, arg, url: page.url() });
  });
  if (launchUrl)
    await context.addInitScript((url) => {
      (window as unknown as { __FAKE_CAPACITOR: unknown }).__FAKE_CAPACITOR = { launchUrl: url };
    }, launchUrl);
  await context.addInitScript({ content: BRIDGE });
  return { context, page: await context.newPage(), calls };
}

const named = (calls: Call[], name: string) => calls.filter((c) => c.name === name);

async function appGoogle(page: Page, on: boolean) {
  expect((await page.request.post(`${LEAD}/test/app-google`, { data: { on } })).ok()).toBeTruthy();
}

/** Écran de connexion de l'app → Compte Lead → « Continuer avec Google » → page relais. */
async function toRelay(page: Page, calls: Call[]) {
  await page.goto(`${APP}/it/login`);
  await page.waitForURL(`${LEAD}/oauth/authorize?**`);
  await page.locator("#google").click();
  await page.waitForURL(`${APP}/it/lead-auth/google?**`);
  await expect(page.getByRole("heading", { name: "Accesso con Google…" })).toBeVisible();
  await expect.poll(() => named(calls, "Browser.open").length).toBe(1);
  const start = String(named(calls, "Browser.open")[0]?.arg);
  expect(start.startsWith(`${LEAD}/auth/google/app/start?d=invoicelead.`)).toBe(true);
  return new URL(start).searchParams.get("d") ?? "";
}

/** Retour de Google imité : le code de transfert du départ `d`, et le lien de retour de l'app. */
async function googleReturn(page: Page, d: string): Promise<{ code: string; link: string }> {
  const r = await page.request.post(`${LEAD}/test/app-google/code`, { data: { d } });
  expect(r.ok()).toBeTruthy();
  return r.json();
}

const emit = (page: Page, url: string) =>
  page.evaluate(
    (u) =>
      (window as unknown as { __fakeEmit: (k: string, p: unknown) => number }).__fakeEmit(
        "App.appUrlOpen",
        { url: u },
      ),
    url,
  );

const redeems = async (page: Page) =>
  (await (await page.request.get(`${LEAD}/test/app-google`)).json()).redeems as { ok: boolean }[];

test.afterEach(async ({ page }) => {
  await appGoogle(page, false);
});

test("app (LeadAppAuth/1) : « Continuer avec Google » → page relais → navigateur du téléphone → lien de retour → connectée dans InvoiceLead, une seule fois", async ({
  browser,
  page: plain,
}) => {
  await appGoogle(plain, true);
  await plain.request.post(`${LEAD}/test/next-user`, {
    data: {
      sub: "sub-google-app",
      email: "gina@google-app.test",
      name: "Gina Google",
      org: "org-google-app",
      org_name: "Google App Sàrl",
      locale: "it",
    },
  });
  const { context, page, calls } = await webview(browser);
  try {
    const before = (await redeems(page)).length;
    const d = await toRelay(page, calls);
    // L'écoute du lien de retour est posée (page relais), le navigateur du téléphone est ouvert.
    expect(named(calls, "App.addListener").map((c) => c.arg)).toContain("appUrlOpen");
    expect(named(calls, "Browser.addListener").map((c) => c.arg)).toContain("browserFinished");
    const { link } = await googleReturn(page, d);
    expect(link).toMatch(/^io\.invoicelead\.app:\/\/lead-auth\?code=[A-Za-z0-9_-]{43}$/);
    await emit(page, link);
    await page.waitForURL(`${APP}/it/app`);
    expect(named(calls, "Browser.close")).toHaveLength(1);
    const after = await redeems(page);
    expect(after.slice(before)).toEqual([{ ok: true, cookie: true }]);
    await expect(page.locator("body")).toContainText("Google App Sàrl");
    // Le même lien une seconde fois (appUrlOpen répété) : rien ne se passe.
    await page.waitForFunction(() =>
      (window as unknown as { __fakeListeners: (k: string) => number }).__fakeListeners(
        "App.appUrlOpen",
      ),
    );
    await emit(page, link);
    await page.waitForTimeout(500);
    expect(page.url()).toBe(`${APP}/it/app`);
    expect((await redeems(page)).length).toBe(after.length);
    expect(named(calls, "Browser.close")).toHaveLength(1);
  } finally {
    await context.close();
  }
});

test("navigateur du téléphone refermé sans retour : l'écran de connexion du Compte Lead revient", async ({
  browser,
  page: plain,
}) => {
  await appGoogle(plain, true);
  const { context, page, calls } = await webview(browser);
  try {
    await toRelay(page, calls);
    await page.evaluate(() =>
      (window as unknown as { __fakeEmit: (k: string) => number }).__fakeEmit(
        "Browser.browserFinished",
      ),
    );
    await page.waitForURL(`${LEAD}/login?**`);
    const back = new URL(page.url());
    expect(back.searchParams.get("locale")).toBe("it");
    expect(back.searchParams.get("next")).toContain("client_id=invoicelead");
    expect(named(calls, "Browser.close")).toHaveLength(0);
  } finally {
    await context.close();
  }
});

test("app relancée par le lien de retour (lien de lancement) : connectée depuis l'écran de connexion de l'app, le lien n'est suivi qu'une fois", async ({
  browser,
  page: plain,
}) => {
  await appGoogle(plain, true);
  const first = await webview(browser);
  const d = await toRelay(first.page, first.calls);
  // L'app est « tuée » pendant la connexion Google ; les cookies de la vue web restent (stockage).
  const { cookies } = await first.context.storageState();
  await first.context.close();
  const { link } = await googleReturn(plain, d);
  const relaunched = await webview(browser, NEW_APP, link);
  try {
    await relaunched.context.addCookies(cookies);
    const before = (await redeems(plain)).length;
    await relaunched.page.goto(`${APP}/it/app`);
    await relaunched.page.waitForURL(`${APP}/it/app`);
    // Lu sur l'écran de connexion de l'app (rachat), puis de nouveau par la page d'arrivée.
    await expect
      .poll(() => named(relaunched.calls, "App.getLaunchUrl").length)
      .toBeGreaterThanOrEqual(2);
    expect(named(relaunched.calls, "Browser.close")).toHaveLength(1);
    expect((await redeems(plain)).slice(before)).toEqual([{ ok: true, cookie: true }]);
    // L'espace s'ouvre et reste ouvert : le même lien de lancement, relu par la page, est ignoré.
    await relaunched.page.waitForTimeout(800);
    expect(relaunched.page.url()).toBe(`${APP}/it/app`);
    expect((await redeems(plain)).length).toBe(before + 1);
  } finally {
    await relaunched.context.close();
  }
});

test("liens étrangers ignorés dans l'app ; hors de l'app, la page relais ne fait que revenir à l'écran de connexion", async ({
  browser,
  page: plain,
}) => {
  await appGoogle(plain, true);
  const { context, page, calls } = await webview(browser);
  try {
    await toRelay(page, calls);
    const relay = page.url();
    for (const url of [
      `io.crmlead.app://sso?code=${"A".repeat(43)}`,
      `io.projectlead.app://lead-auth?code=${"A".repeat(43)}`,
      `io.invoicelead.app://autre?code=${"A".repeat(43)}`,
      "https://invoicelead.io/it/app",
    ])
      await emit(page, url);
    await page.waitForTimeout(500);
    expect(page.url()).toBe(relay);
    expect(named(calls, "Browser.close")).toHaveLength(0);
    // Départ étranger dans l'adresse de la page relais : rien n'est ouvert, connexion ordinaire.
    const opened = named(calls, "Browser.open").length;
    const forged = new URL(relay);
    forged.searchParams.set("start", "https://evil.example/auth/google/app/start?d=x");
    await page.goto(forged.toString());
    await page.waitForURL(`${LEAD}/oauth/authorize?**`);
    expect(named(calls, "Browser.open")).toHaveLength(opened);
  } finally {
    await context.close();
  }
  // Navigateur ordinaire (aucun pont) : retour à l'écran de connexion du Compte Lead, sans rien ouvrir.
  const start = `${LEAD}/auth/google/app/start?d=invoicelead.x`;
  const back = `${LEAD}/login?${new URLSearchParams({ next: "/oauth/authorize?client_id=invoicelead", locale: "fr" })}`;
  await plain.goto(`${APP}/lead-auth/google?${new URLSearchParams({ start, back })}`);
  await plain.waitForURL(`${LEAD}/login?**`);
  expect(new URL(plain.url()).searchParams.get("locale")).toBe("fr");
});

test("ancienne version de l'app (sans LeadAppAuth/1) et navigateur : l'écran de connexion part tout droit, comme avant", async ({
  browser,
  page: plain,
}) => {
  for (const ua of [OLD_APP, undefined]) {
    const context = await browser.newContext(ua ? { userAgent: ua } : {});
    try {
      const r = await context.request.get(`${APP}/it/login`, { maxRedirects: 0 });
      expect([303, 307]).toContain(r.status());
      expect(r.headers().location).toContain("/auth/lead/start?locale=it");
    } finally {
      await context.close();
    }
  }
  // Nouvelle version : un écran vide lit d'abord le lien de lancement, puis part au Compte Lead.
  const fresh = await browser.newContext({ userAgent: NEW_APP });
  try {
    const r = await fresh.request.get(`${APP}/it/login`, { maxRedirects: 0 });
    expect(r.status()).toBe(200);
    expect(await r.text()).toContain("data-lead-auth-boot");
  } finally {
    await fresh.close();
  }
  expect(plain).toBeTruthy();
});
