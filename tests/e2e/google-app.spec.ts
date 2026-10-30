import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type Browser, type BrowserContext, expect, type Page, test } from "@playwright/test";
import { APP, LEAD } from "./helpers";

/**
 * « Continuer avec Google » dans l'app Android / iOS (lib/lead-app-auth.ts ; contrat d'ERPlead
 * docs/GOOGLE-APP.md révisé le 30.10.2026 : liens VÉRIFIÉS, imité par le faux Compte Lead) : la vue web
 * de l'app est un navigateur à l'agent de l'app (InvoiceLeadApp LeadAppAuth/2) avec un faux pont
 * Capacitor (tests/support/fake-capacitor.js : Android, ou iOS avec le module LeadAuthSession). Google
 * n'est jamais appelé : son retour est imité par le faux Compte Lead (code de transfert et lien vérifié
 * https://invoicelead.io/lead-auth/return?code=…).
 */

const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148";
const NEW_APP = `${IPHONE} InvoiceLeadApp LeadAppAuth/2`;
const FIRST_APP = `${IPHONE} InvoiceLeadApp LeadAppAuth/1`;
const OLD_APP = `${IPHONE} InvoiceLeadApp`;
const RETOUR = "https://invoicelead.io/lead-auth/return";
const BRIDGE = readFileSync(join(process.cwd(), "tests/support/fake-capacitor.js"), "utf8");

type Call = { name: string; arg: unknown; url: string };
type Stored = Awaited<ReturnType<BrowserContext["storageState"]>>;
type Platform = { platform?: "ios" | "android"; session?: "https" | "old" | "none" };

/**
 * Une vue web de l'app : agent, faux pont (plateforme, module iOS), appels au pont relevés. `stored` :
 * cookies et localStorage d'une vue web précédente (app fermée puis relancée : le téléphone les garde).
 */
async function webview(
  browser: Browser,
  opts: { ua?: string; launchUrl?: string; retained?: string; stored?: Stored } & Platform = {},
) {
  const context = await browser.newContext({
    userAgent: opts.ua ?? NEW_APP,
    viewport: { width: 390, height: 844 },
    locale: "it-CH",
    ...(opts.stored ? { storageState: opts.stored } : {}),
  });
  const calls: Call[] = [];
  await context.exposeBinding("__bridgeCall", ({ page }, name: string, arg: unknown) => {
    calls.push({ name, arg, url: page.url() });
  });
  await context.addInitScript(
    (c) => {
      (window as unknown as { __FAKE_CAPACITOR: unknown }).__FAKE_CAPACITOR = c;
    },
    {
      launchUrl: opts.launchUrl,
      retained: opts.retained,
      platform: opts.platform ?? "android",
      session: opts.session,
    },
  );
  await context.addInitScript({ content: BRIDGE });
  return { context, page: await context.newPage(), calls };
}

const named = (calls: Call[], name: string) => calls.filter((c) => c.name === name);
/** Ce que la page relais a ouvert : Custom Tab (Android), session ou Safari (iOS). */
const OPENERS = ["Browser.open", "LeadAuthSession.start", "LeadAuthSession.openExternal"];
const openings = (calls: Call[]) => calls.filter((c) => OPENERS.includes(c.name));

async function appGoogle(page: Page, on: boolean) {
  expect((await page.request.post(`${LEAD}/test/app-google`, { data: { on } })).ok()).toBeTruthy();
}

/** Écran de connexion de l'app → Compte Lead → « Continuer avec Google » → page relais → ouverture. */
async function toRelay(page: Page, calls: Call[], opener = "Browser.open", mode = "auto") {
  await page.goto(`${APP}/it/login`);
  await page.waitForURL(`${LEAD}/oauth/authorize?**`);
  await page.locator("#google").click();
  await page.waitForURL(`${APP}/it/lead-auth/google?**`);
  await expect(page.getByRole("heading", { name: "Accesso con Google…" })).toBeVisible();
  await expect.poll(() => openings(calls).length).toBe(1);
  const opened = openings(calls)[0];
  expect(opened?.name).toBe(opener);
  const start = new URL(String(opened?.arg));
  expect(`${start.origin}${start.pathname}`).toBe(`${LEAD}/auth/google/app/start`);
  expect(start.searchParams.get("d")?.startsWith("invoicelead.")).toBe(true);
  expect(start.searchParams.getAll("m")).toEqual([mode]);
  return start.searchParams.get("d") ?? "";
}

/** Retour de Google imité : le code de transfert du départ `d`, et le lien vérifié de l'app. */
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
const endSession = (page: Page, result: { url: string } | { error: string }) =>
  page.evaluate(
    (r) => (window as unknown as { __fakeSession: (x: unknown) => boolean }).__fakeSession(r),
    result,
  );
const listening = (page: Page) =>
  page.waitForFunction(() =>
    (window as unknown as { __fakeListeners: (k: string) => number }).__fakeListeners(
      "App.appUrlOpen",
    ),
  );

const fake = async (page: Page) =>
  (await (await page.request.get(`${LEAD}/test/app-google`)).json()) as {
    redeems: { ok: boolean }[];
    modes: (string | null)[];
  };
const redeems = async (page: Page) => (await fake(page)).redeems;

async function nextUser(page: Page, sub: string, orgName: string) {
  await page.request.post(`${LEAD}/test/next-user`, {
    data: {
      sub,
      email: `${sub}@google-app.test`,
      name: "Gina Google",
      org: `org-${sub}`,
      org_name: orgName,
      locale: "it",
    },
  });
}

test.afterEach(async ({ page }) => {
  await appGoogle(page, false);
});

test("app Android (LeadAppAuth/2) : « Continuer avec Google » → page relais → Custom Tab (start&m=auto) → lien vérifié https://invoicelead.io/lead-auth/return → connectée dans InvoiceLead, une seule fois", async ({
  browser,
  page: plain,
}) => {
  await appGoogle(plain, true);
  await nextUser(plain, "sub-google-app", "Google App Sàrl");
  const { context, page, calls } = await webview(browser);
  try {
    const before = (await redeems(page)).length;
    const d = await toRelay(page, calls);
    // L'écoute du lien de retour est posée (page relais), le Custom Tab est ouvert.
    expect(named(calls, "App.addListener").map((c) => c.arg)).toContain("appUrlOpen");
    expect(named(calls, "Browser.addListener").map((c) => c.arg)).toContain("browserFinished");
    const { link } = await googleReturn(page, d);
    expect(link).toMatch(
      /^https:\/\/invoicelead\.io\/lead-auth\/return\?code=[\w-]{43}&locale=it$/,
    );
    await emit(page, link);
    await page.waitForURL(`${APP}/it/app`);
    expect(named(calls, "Browser.close")).toHaveLength(1);
    const after = await redeems(page);
    expect(after.slice(before)).toEqual([{ ok: true, cookie: true }]);
    await expect(page.locator("body")).toContainText("Google App Sàrl");
    // Le même lien une seconde fois (appUrlOpen répété) : rien ne se passe.
    await listening(page);
    await emit(page, link);
    await page.waitForTimeout(500);
    expect(page.url()).toBe(`${APP}/it/app`);
    expect((await redeems(page)).length).toBe(after.length);
    expect(named(calls, "Browser.close")).toHaveLength(1);
  } finally {
    await context.close();
  }
});

test("app iOS 17.4+ : la session LeadAuthSession (start&m=auto) rend le lien vérifié → connectée, sans Browser.open ni Browser.close", async ({
  browser,
  page: plain,
}) => {
  await appGoogle(plain, true);
  await nextUser(plain, "sub-google-ios", "Session iOS Sàrl");
  const { context, page, calls } = await webview(browser, { platform: "ios", session: "https" });
  try {
    const before = (await redeems(page)).length;
    const d = await toRelay(page, calls, "LeadAuthSession.start", "auto");
    expect(named(calls, "LeadAuthSession.isAvailable").map((c) => c.arg)).toEqual([true]);
    const { link } = await googleReturn(page, d);
    expect(await endSession(page, { url: link })).toBe(true);
    await page.waitForURL(`${APP}/it/app`);
    await expect(page.locator("body")).toContainText("Session iOS Sàrl");
    expect((await redeems(page)).slice(before)).toEqual([{ ok: true, cookie: true }]);
    expect(named(calls, "Browser.open")).toHaveLength(0);
    expect(named(calls, "Browser.close")).toHaveLength(0);
    expect(named(calls, "LeadAuthSession.openExternal")).toHaveLength(0);
  } finally {
    await context.close();
  }
});

test("app iOS 15 à 17.3 : Safari (start&m=tap), « Ouvrir InvoiceLead » dit sur la page relais, puis le lien touché (appUrlOpen) → connectée", async ({
  browser,
  page: plain,
}) => {
  await appGoogle(plain, true);
  await nextUser(plain, "sub-google-safari", "Safari Sàrl");
  const { context, page, calls } = await webview(browser, { platform: "ios", session: "old" });
  try {
    const before = (await redeems(page)).length;
    const d = await toRelay(page, calls, "LeadAuthSession.openExternal", "tap");
    await expect(page.locator("[data-lead-auth-mode=safari]")).toHaveText(
      "Completa l'accesso nel tuo browser, poi tocca «Apri InvoiceLead».",
    );
    const { link } = await googleReturn(page, d);
    await emit(page, link);
    await page.waitForURL(`${APP}/it/app`);
    await expect(page.locator("body")).toContainText("Safari Sàrl");
    expect((await redeems(page)).slice(before)).toEqual([{ ok: true, cookie: true }]);
    expect(named(calls, "LeadAuthSession.start")).toHaveLength(0);
  } finally {
    await context.close();
  }
});

test("app iOS : session annulée → l'écran de connexion du Compte Lead revient ; session refusée → Safari", async ({
  browser,
  page: plain,
}) => {
  await appGoogle(plain, true);
  const { context, page, calls } = await webview(browser, { platform: "ios" });
  try {
    await toRelay(page, calls, "LeadAuthSession.start", "auto");
    await endSession(page, { error: "canceled" });
    await page.waitForURL(`${LEAD}/login?**`);
    expect(new URL(page.url()).searchParams.get("locale")).toBe("it");
    expect(named(calls, "LeadAuthSession.openExternal")).toHaveLength(0);
    // Deuxième essai : la session échoue (association absente) → Safari, mode tap.
    calls.length = 0;
    await toRelay(page, calls, "LeadAuthSession.start", "auto");
    await endSession(page, { error: "failed" });
    await expect.poll(() => named(calls, "LeadAuthSession.openExternal").length).toBe(1);
    const tap = new URL(String(named(calls, "LeadAuthSession.openExternal")[0]?.arg));
    expect(tap.searchParams.getAll("m")).toEqual(["tap"]);
    await expect(page.locator("[data-lead-auth-mode=safari]")).toBeVisible();
  } finally {
    await context.close();
  }
});

test("page relais rechargée pendant sa connexion (iOS tue la vue web, Capacitor recharge la page) : aucun départ rouvert, le lien reçu après connecte ; session iOS perdue → écran de connexion ; page relais sans Referer ni cache", async ({
  browser,
  page: plain,
}) => {
  await appGoogle(plain, true);
  await nextUser(plain, "sub-google-ricarica", "Ricarica Sàrl");
  // iOS 15 à 17.3 (ou session refusée) : la connexion se finit dans le navigateur par défaut.
  const { context, page, calls } = await webview(browser, { platform: "ios", session: "old" });
  try {
    const before = (await redeems(plain)).length;
    const d = await toRelay(page, calls, "LeadAuthSession.openExternal", "tap");
    const relay = page.url();
    // La personne est dans son navigateur ; iOS tue le processus de la vue web, Capacitor recharge l'adresse.
    await page.reload();
    await expect(page.locator("[data-lead-auth-mode=safari]")).toHaveText(
      "Completa l'accesso nel tuo browser, poi tocca «Apri InvoiceLead».",
    );
    await page.waitForTimeout(500);
    expect(openings(calls)).toHaveLength(1);
    expect(page.url()).toBe(relay);
    // « Apri InvoiceLead » touché : rechargée encore (processus tué en arrière-plan), la page reçoit le lien
    // retenu par la coque (et le même lien de lancement : iOS, dernier lien ouvert).
    const { link } = await googleReturn(plain, d);
    await context.addInitScript((u) => {
      const w = window as unknown as { __FAKE_CAPACITOR: Record<string, unknown> };
      w.__FAKE_CAPACITOR = { ...w.__FAKE_CAPACITOR, launchUrl: u, retained: u };
    }, link);
    await page.reload();
    await page.waitForURL(`${APP}/it/app`);
    await expect(page.locator("body")).toContainText("Ricarica Sàrl");
    expect((await redeems(plain)).slice(before)).toEqual([{ ok: true, cookie: true }]);
    expect(openings(calls)).toHaveLength(1);
    // En-têtes et balise de la page relais : son adresse porte le départ à usage unique et la demande OpenID.
    const head = await page.request.get(relay, { maxRedirects: 0 });
    expect(head.headers()["referrer-policy"]).toBe("no-referrer");
    expect(head.headers()["cache-control"]).toContain("no-store");
    expect(await head.text()).toContain('<meta name="referrer" content="no-referrer"/>');
  } finally {
    await context.close();
  }
  // iOS 17.4+ : rechargée pendant la session ; le module de l'app (sans resume) a perdu son résultat avec
  // la page : jamais une nouvelle session ni le navigateur sur le départ déjà servi → écran de connexion.
  const ios = await webview(browser, { platform: "ios", session: "https" });
  try {
    await toRelay(ios.page, ios.calls, "LeadAuthSession.start", "auto");
    await ios.page.reload();
    await ios.page.waitForURL(`${LEAD}/login?**`);
    expect(new URL(ios.page.url()).searchParams.get("locale")).toBe("it");
    expect(openings(ios.calls)).toHaveLength(1);
  } finally {
    await ios.context.close();
  }
});

test("navigateur du téléphone refermé sans retour (Android) : l'écran de connexion du Compte Lead revient", async ({
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
  // L'app est « tuée » pendant la connexion Google ; cookies et localStorage de la vue web restent.
  const stored = await first.context.storageState();
  await first.context.close();
  const { link } = await googleReturn(plain, d);
  const relaunched = await webview(browser, { launchUrl: link, stored });
  try {
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

test("app relancée par le lien de retour avec un cookie de session périmé : la garde passe par l'écran de connexion de l'app, qui suit le lien ; connectée du premier coup", async ({
  browser,
  page: plain,
}) => {
  await appGoogle(plain, true);
  await nextUser(plain, "sub-google-app-stale", "Session Périmée Sàrl");
  const first = await webview(browser);
  const d = await toRelay(first.page, first.calls);
  // Déconnexion « de partout » passée : le cookie de session d'InvoiceLead reste, sans session.
  await first.context.addCookies([{ name: "il_session", value: "perime".repeat(8), url: APP }]);
  const stored = await first.context.storageState();
  await first.context.close();
  const { link } = await googleReturn(plain, d);
  const relaunched = await webview(browser, { launchUrl: link, stored });
  try {
    const before = (await redeems(plain)).length;
    await relaunched.page.goto(`${APP}/it/app`);
    await relaunched.page.waitForURL(`${APP}/it/app`);
    await expect(relaunched.page.locator("body")).toContainText("Session Périmée Sàrl");
    expect((await redeems(plain)).slice(before)).toEqual([{ ok: true, cookie: true }]);
    expect(named(relaunched.calls, "Browser.close")).toHaveLength(1);
  } finally {
    await relaunched.context.close();
  }
});

test("app relancée par son lien sur l'accueil (appUrlOpen retenu par la coque, livré avant getLaunchUrl), rachat retenu 3 s : l'écran de connexion de l'app ne part pas, connectée", async ({
  browser,
  page: plain,
}) => {
  await appGoogle(plain, true);
  await nextUser(plain, "sub-google-relance", "Relance Sàrl");
  const first = await webview(browser);
  const d = await toRelay(first.page, first.calls);
  // Android tue l'app pendant le Custom Tab (iOS : l'app terminée pendant le navigateur) ; cookies et
  // localStorage de la vue web restent.
  const stored = await first.context.storageState();
  await first.context.close();
  const { link } = await googleReturn(plain, d);
  // L'App Link relance l'app : activité neuve, évènement appUrlOpen retenu, même lien pour getLaunchUrl.
  const relaunched = await webview(browser, { launchUrl: link, retained: link, stored });
  const departures: string[] = [];
  relaunched.context.on("request", (r) => {
    if (r.url().startsWith(`${APP}/auth/lead/start`)) departures.push(r.url());
  });
  // Le rachat d'ERPlead met quelques secondes (réseau, base) : rien ne doit l'annuler entre-temps.
  let held = 0;
  await relaunched.context.route(`${LEAD}/auth/google/app/redeem?**`, async (route) => {
    held++;
    await new Promise((done) => setTimeout(done, 3000));
    await route.continue().catch(() => {});
  });
  try {
    const before = (await redeems(plain)).length;
    // La coque charge son adresse (server.url) : l'accueil, sans session → /it/app → /it/login.
    await relaunched.page.goto(`${APP}/`);
    await relaunched.page.waitForURL(`${APP}/it/app`, { timeout: 15_000 }).catch(() => {});
    // Aucun départ de l'écran de connexion de l'app pendant le rachat (il l'annulerait).
    expect(departures).toEqual([]);
    expect(held).toBe(1);
    expect(relaunched.page.url()).toBe(`${APP}/it/app`);
    await expect(relaunched.page.locator("body")).toContainText("Relance Sàrl");
    expect((await redeems(plain)).slice(before)).toEqual([{ ok: true, cookie: true }]);
    expect(named(relaunched.calls, "App.appUrlOpen").map((c) => c.arg)).toEqual([link]);
    expect(named(relaunched.calls, "Browser.close")).toHaveLength(1);
  } finally {
    await relaunched.context.close();
  }
});

test("nouvelle connexion après une app relancée sans lecture du lien : l'ancien lien de lancement n'est pas suivi par la page relais, le nouveau connecte", async ({
  browser,
  page: plain,
}) => {
  await appGoogle(plain, true);
  const first = await webview(browser);
  const d1 = await toRelay(first.page, first.calls);
  // L'écran du Compte Lead tel que l'app l'a ouvert (sa demande d'autorisation, son state) : `next` de
  // `back`, dans l'adresse de la page relais.
  const back = new URL(first.page.url()).searchParams.get("back") ?? "";
  const authorize = new URL(back).searchParams.get("next") ?? "";
  const stored = await first.context.storageState();
  await first.context.close();
  const { link: old } = await googleReturn(plain, d1);
  // L'app relancée par l'ancien lien est menée au Compte Lead sans qu'aucune page d'InvoiceLead ne le
  // lise ; la personne touche de nouveau « Continuer avec Google ».
  const again = await webview(browser, { launchUrl: old, stored });
  try {
    const before = (await redeems(plain)).length;
    expect(authorize.startsWith("/oauth/authorize?")).toBe(true);
    await again.page.goto(`${LEAD}${authorize}`);
    await again.page.locator("#google").click();
    await again.page.waitForURL(`${APP}/it/lead-auth/google?**`);
    await expect.poll(() => named(again.calls, "Browser.open").length).toBe(1);
    await again.page.waitForTimeout(500);
    // L'ancien lien (rendu par getLaunchUrl) : ni navigateur fermé, ni rachat.
    expect(named(again.calls, "App.getLaunchUrl").map((c) => c.arg)).toContain(old);
    expect(named(again.calls, "Browser.close")).toHaveLength(0);
    expect((await redeems(plain)).length).toBe(before);
    const d2 =
      new URL(String(named(again.calls, "Browser.open")[0]?.arg)).searchParams.get("d") ?? "";
    const { link } = await googleReturn(plain, d2);
    await emit(again.page, link);
    await again.page.waitForURL(`${APP}/it/app`);
    expect((await redeems(plain)).slice(before)).toEqual([{ ok: true, cookie: true }]);
  } finally {
    await again.context.close();
  }
});

test("deux demandes expirées de suite : le lien d'erreur ramène chaque fois à l'écran de connexion du Compte Lead", async ({
  browser,
  page: plain,
}) => {
  await appGoogle(plain, true);
  const { context, page, calls } = await webview(browser);
  try {
    for (const round of [1, 2]) {
      calls.length = 0;
      await toRelay(page, calls);
      await listening(page);
      await emit(page, `${RETOUR}?error=expired&locale=it`);
      await page.waitForURL(`${LEAD}/login?**`);
      expect(named(calls, "Browser.close"), `essai ${round}`).toHaveLength(1);
      // La coque rend ensuite le dernier lien ouvert (ici le lien d'erreur) à getLaunchUrl.
      if (round === 1)
        await context.addInitScript((u) => {
          (window as unknown as { __FAKE_CAPACITOR: unknown }).__FAKE_CAPACITOR = {
            launchUrl: u,
            platform: "android",
          };
        }, `${RETOUR}?error=expired&locale=it`);
    }
  } finally {
    await context.close();
  }
});

test("lien de retour reçu sans connexion en cours (page de l'app ouverte) : ignoré, la page reste", async ({
  browser,
  page: plain,
}) => {
  await nextUser(plain, "sub-app-trap", "Piège Sàrl");
  const { context, page, calls } = await webview(browser);
  try {
    await page.goto(`${APP}/it/login`);
    await page.waitForURL(`${APP}/it/app`);
    const before = (await redeems(plain)).length;
    await listening(page);
    for (const url of [`${RETOUR}?code=${"T".repeat(43)}`, `${RETOUR}?error=expired`])
      await emit(page, url);
    await page.waitForTimeout(800);
    expect(page.url()).toBe(`${APP}/it/app`);
    expect(named(calls, "Browser.close")).toHaveLength(0);
    expect((await redeems(plain)).length).toBe(before);
    await expect(page.locator("body")).toContainText("Piège Sàrl");
  } finally {
    await context.close();
  }
});

test("liens étrangers (dont l'ancien schéma io.invoicelead.app) ignorés dans l'app ; hors de l'app, la page relais ne fait que revenir à l'écran de connexion", async ({
  browser,
  page: plain,
}) => {
  await appGoogle(plain, true);
  const { context, page, calls } = await webview(browser);
  try {
    await toRelay(page, calls);
    const relay = page.url();
    await listening(page);
    for (const url of [
      `io.invoicelead.app://lead-auth?code=${"A".repeat(43)}`,
      `io.crmlead.app://sso?code=${"A".repeat(43)}`,
      `https://projectlead.io/lead-auth/return?code=${"A".repeat(43)}`,
      `https://invoicelead.io/lead-auth/autre?code=${"A".repeat(43)}`,
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

test("ancienne version de l'app (sans LeadAppAuth/2, dont LeadAppAuth/1) et navigateur : l'écran de connexion part tout droit, comme avant", async ({
  browser,
  page: plain,
}) => {
  for (const ua of [OLD_APP, FIRST_APP, undefined]) {
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

test("page de repli /lead-auth/return hors de l'app : 200 sans redirection ni langue, no-referrer, no-store, code effacé de l'adresse, message dans la langue du lien", async ({
  page,
}) => {
  const code = "R".repeat(43);
  const raw = await page.request.get(`${APP}/lead-auth/return?code=${code}&locale=it`, {
    maxRedirects: 0,
    headers: { "user-agent": "Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/140.0 Mobile" },
  });
  expect(raw.status()).toBe(200);
  expect(raw.headers().location).toBeUndefined();
  expect(raw.headers()["referrer-policy"]).toBe("no-referrer");
  expect(raw.headers()["cache-control"]).toBe("no-store");
  expect(raw.headers()["x-robots-tag"]).toBe("noindex");
  const html = await raw.text();
  expect(html).not.toContain(code);
  expect(html).toContain("Impostazioni &gt; App &gt; InvoiceLead");
  const res = await page.goto(`${APP}/lead-auth/return?code=${code}&locale=it`);
  expect(res?.status()).toBe(200);
  expect(res?.request().redirectedFrom()).toBeNull();
  // Le code a quitté l'adresse et l'entrée d'historique.
  expect(page.url()).toBe(`${APP}/lead-auth/return`);
  await expect(page.getByRole("heading", { name: "Torna su InvoiceLead" })).toBeVisible();
  await expect(page.locator("body")).toContainText("«Continua con Google»");
  expect(await page.content()).not.toContain(code);
  // Aucune requête vers un autre site (aucun script tiers, aucune mesure d'audience).
  const others: string[] = [];
  page.on("request", (r) => {
    if (!r.url().startsWith(APP)) others.push(r.url());
  });
  await page.reload();
  expect(others).toEqual([]);
});

test("lien de retour ouvert par la vue web de l'app (/lead-auth/return) : mené à la page de l'app, rachat pendant une connexion en cours", async ({
  browser,
  page: plain,
}) => {
  await appGoogle(plain, true);
  await nextUser(plain, "sub-google-page", "Page Retour Sàrl");
  const { context, page, calls } = await webview(browser);
  try {
    const before = (await redeems(plain)).length;
    const d = await toRelay(page, calls);
    const { code } = await googleReturn(plain, d);
    // La vue web ouvre elle-même l'adresse de retour (au lieu de la recevoir par appUrlOpen).
    await page.goto(`${APP}/lead-auth/return?code=${code}&locale=it`);
    await page.waitForURL(`${APP}/it/app`);
    await expect(page.locator("body")).toContainText("Page Retour Sàrl");
    expect((await redeems(plain)).slice(before)).toEqual([{ ok: true, cookie: true }]);
    // Sans connexion en cours (lien piégé) : ni rachat, l'app s'ouvre.
    await page.goto(`${APP}/lead-auth/return?code=${"P".repeat(43)}&locale=it`);
    await page.waitForURL(`${APP}/it/app`);
    expect((await redeems(plain)).length).toBe(before + 1);
  } finally {
    await context.close();
  }
});

test("fichiers d'association servis tels quels : /.well-known/apple-app-site-association et /.well-known/assetlinks.json (200, application/json, sans redirection, contenu du contrat)", async ({
  page,
}) => {
  for (const ua of ["AASA-Bot/1.0.0", "Mozilla/5.0 (Linux; Android 14)", undefined]) {
    const headers: Record<string, string> = ua ? { "user-agent": ua } : {};
    const aasa = await page.request.get(`${APP}/.well-known/apple-app-site-association`, {
      maxRedirects: 0,
      headers,
    });
    expect(aasa.status()).toBe(200);
    expect(aasa.headers()["content-type"]).toBe("application/json");
    const a = await aasa.json();
    expect(a.applinks.details).toEqual([
      {
        appIDs: ["X6K5247J6G.io.invoicelead.app"],
        components: [
          {
            "/": "/lead-auth/return",
            comment: "Retour de « Continuer avec Google » (Compte Lead) vers l'app",
          },
        ],
      },
    ]);
    expect(a.webcredentials).toEqual({ apps: ["X6K5247J6G.io.invoicelead.app"] });
    const links = await page.request.get(`${APP}/.well-known/assetlinks.json`, {
      maxRedirects: 0,
      headers,
    });
    expect(links.status()).toBe(200);
    expect(links.headers()["content-type"]).toBe("application/json");
    const [l] = await links.json();
    expect(l.relation).toEqual(["delegate_permission/common.handle_all_urls"]);
    expect(l.target.package_name).toBe("io.invoicelead.app");
    expect(l.target.sha256_cert_fingerprints).toHaveLength(2);
  }
  const head = await page.request.head(`${APP}/.well-known/apple-app-site-association`, {
    maxRedirects: 0,
  });
  expect(head.status()).toBe(200);
  expect(head.headers()["content-type"]).toBe("application/json");
});
