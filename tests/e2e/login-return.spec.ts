import { type BrowserContext, expect, test } from "@playwright/test";
import { LEAD, login } from "./helpers";

/**
 * Reconnexion par le Compte Lead : la personne revient toujours sur la page qu'elle demandait, même
 * sans le cookie de sa demande (autre navigateur, plus de trois heures), après une session échue en
 * plein envoi de formulaire, ou quand un autre onglet a déjà mené la demande à bout.
 */

const APP = "http://localhost:3100";
const INVITE = "I".repeat(43);

async function dropCookies(context: BrowserContext, drop: (name: string) => boolean) {
  const keep = (await context.cookies()).filter((c) => !drop(c.name));
  await context.clearCookies();
  await context.addCookies(keep);
}

/** Départ réel vers le faux Compte Lead : le `state` qu'il rendra au retour. */
async function startState(context: BrowserContext, query: string) {
  const start = await context.request.get(`/auth/lead/start?${query}`, { maxRedirects: 0 });
  expect(start.status()).toBe(303);
  const authorize = new URL(start.headers().location ?? "");
  expect(authorize.pathname).toBe("/oauth/authorize");
  return { authorize, state: authorize.searchParams.get("state") ?? "" };
}

test("demande sans son cookie : la reconnexion garde la page et la langue", async ({
  page,
  context,
}) => {
  const { authorize, state } = await startState(
    context,
    "locale=fr&next=%2Ffr%2Fapp%2Fquotes%3Fstatus%3Ddraft",
  );
  // Le Compte Lead ne voit pas la page demandée : elle voyage chiffrée.
  expect(authorize.toString()).not.toContain("quotes");
  // Cookie de la demande perdu (lien ouvert ailleurs, plus de trois heures).
  await context.clearCookies();
  const back = await context.request.get(`/auth/lead/callback?code=x&state=${state}`, {
    maxRedirects: 0,
  });
  expect(back.status()).toBe(303);
  expect(back.headers().location).toBe(
    `${APP}/auth/lead/start?locale=fr&next=%2Ffr%2Fapp%2Fquotes%3Fstatus%3Ddraft`,
  );
  // Jusqu'au bout : la relance passe par le Compte Lead ouvert et arrive sur la page.
  await context.clearCookies();
  await page.goto(`/auth/lead/callback?code=x&state=${state}`);
  await expect(page).toHaveURL(/\/fr\/app\/quotes\?status=draft$/);
});

test("demande sans son cookie : l'invitation est reprise", async ({ context }) => {
  const { state } = await startState(context, `locale=fr&invite=${INVITE}`);
  await context.clearCookies();
  const back = await context.request.get(`/auth/lead/callback?code=x&state=${state}`, {
    maxRedirects: 0,
  });
  expect(back.headers().location).toBe(`${APP}/auth/lead/start?locale=fr&invite=${INVITE}`);
});

test("demande ouverte dans un navigateur d'une autre langue : la langue demandée reste", async ({
  browser,
  context,
}) => {
  const { state } = await startState(context, "locale=de&next=%2Fde%2Fapp%2Finvoices");
  for (const locale of ["en-US", "fr-CH"]) {
    const other = await browser.newContext({ locale });
    const back = await other.request.get(`/auth/lead/callback?code=x&state=${state}`, {
      maxRedirects: 0,
    });
    expect(back.headers().location).toBe(
      `${APP}/auth/lead/start?locale=de&next=%2Fde%2Fapp%2Finvoices`,
    );
    const page = await other.newPage();
    await other.clearCookies();
    await page.goto(`/auth/lead/callback?code=x&state=${state}`);
    await expect(page).toHaveURL(/\/de\/app\/invoices$/);
    await other.close();
  }
});

test("échec au retour pendant une invitation : « Réessayer » reprend l'invitation", async ({
  page,
  context,
}) => {
  const { state } = await startState(context, `locale=fr&invite=${INVITE}`);
  // Code refusé par le Compte Lead (échange impossible) : écran d'erreur.
  await page.goto(`/auth/lead/callback?code=falsifie&state=${state}`);
  await expect(page).toHaveURL(new RegExp(`/fr/login\\?erreur=lead&invite=${INVITE}$`));
  await expect(page.getByTestId("lead-login")).toHaveAttribute(
    "href",
    `/auth/lead/start?locale=fr&invite=${INVITE}`,
  );
  await page.goto(`/fr/login?erreur=session&invite=${INVITE}&next=%2Ffr%2Fapp`);
  await expect(page.getByTestId("lead-login")).toHaveAttribute(
    "href",
    `/auth/lead/start?locale=fr&invite=${INVITE}`,
  );
});

test("onglet d'origine d'une invitation déjà acceptée ailleurs : il arrive sur l'invitation", async ({
  page,
  context,
}) => {
  const { authorize } = await startState(context, `locale=fr&invite=${INVITE}`);
  const answer = await context.request.get(authorize.toString(), { maxRedirects: 0 });
  const callback = answer.headers().location ?? "";
  expect(callback).toContain("/auth/lead/callback?");
  await page.goto(callback);
  await expect(page).toHaveURL(new RegExp(`/fr/invite\\?token=${INVITE}$`));
  // La trace vit au moins trois heures, comme l'écran du Compte Lead qui peut encore la reprendre.
  const trace = (await context.cookies()).find((c) => c.name.endsWith("_ok"));
  expect(trace?.expires ?? 0).toBeGreaterThan(Date.now() / 1000 + 3 * 3600);
  const origin = await context.newPage();
  await origin.goto(callback);
  await expect(origin).toHaveURL(new RegExp(`/fr/invite\\?token=${INVITE}$`));
});

test("onglet d'origine revenu après l'échéance de la trace : la page reste celle demandée", async ({
  page,
  context,
}) => {
  const { authorize } = await startState(context, "locale=fr&next=%2Ffr%2Fapp%2Fquotes");
  const answer = await context.request.get(authorize.toString(), { maxRedirects: 0 });
  const callback = answer.headers().location ?? "";
  await page.goto(callback);
  await expect(page).toHaveURL(/\/fr\/app\/quotes$/);
  await dropCookies(context, (name) => name.endsWith("_ok"));
  const origin = await context.newPage();
  await origin.goto(callback);
  await expect(origin).toHaveURL(/\/fr\/app\/quotes$/);
});

test("une lecture du routeur de Next ne lance aucune demande de connexion", async ({ context }) => {
  // Next ajoute d'abord son paramètre `_rsc` (redirection 307), comme le fait le routeur.
  let url = "/auth/lead/start?locale=fr&next=%2Ffr%2Fapp";
  let res = await context.request.get(url, { headers: { rsc: "1" }, maxRedirects: 0 });
  if (res.status() === 307) {
    url = res.headers().location ?? "";
    expect(url).toContain("_rsc");
    res = await context.request.get(url, { headers: { rsc: "1" }, maxRedirects: 0 });
  }
  expect(res.status()).toBe(204);
  expect(res.headers()["set-cookie"]).toBeUndefined();
});

test("session échue pendant la navigation interne : une seule demande de connexion", async ({
  page,
  context,
}) => {
  await login(page, "fr");
  await page.goto("/fr/app/invoices");
  await context.addCookies([{ name: "il_session", value: "expiree", url: `${APP}/` }]);
  const starts: { status: number; rsc: boolean }[] = [];
  page.on("response", (r) => {
    if (r.url().includes("/auth/lead/start"))
      starts.push({ status: r.status(), rsc: r.request().headers().rsc === "1" });
  });
  // Lien interne : le routeur lit la page, qui redirige vers la connexion.
  await page.evaluate(() => {
    const a = document.querySelector<HTMLAnchorElement>('a[href="/fr/app/quotes"]');
    a?.click();
  });
  await page.waitForURL(/\/fr\/app\/quotes$/);
  // La lecture du routeur ne pose rien (204) ; seule la navigation complète part vers le Compte Lead,
  // et sa demande s'efface au retour : aucune demande orpheline ne reste.
  expect(starts.filter((s) => s.rsc).every((s) => s.status === 204)).toBe(true);
  const pending = (await context.cookies()).filter((c) =>
    /^il_lead_login_[A-Za-z0-9_-]{16}$/.test(c.name),
  );
  expect(pending).toHaveLength(0);
});

test("départs abandonnés en série : cinq demandes au plus, la connexion marche toujours", async ({
  page,
  context,
}) => {
  const long = `/fr/app/import/crmlead?d=${"e".repeat(2300)}`;
  for (let i = 0; i < 12; i += 1) {
    await startState(context, `locale=fr&next=${encodeURIComponent(i % 2 ? long : "/fr/app")}`);
  }
  const pending = (await context.cookies()).filter((c) =>
    /^il_lead_login_[A-Za-z0-9_-]{16}$/.test(c.name),
  );
  expect(pending.length).toBeLessThanOrEqual(5);
  const bytes = pending.reduce((sum, c) => sum + c.name.length + c.value.length + 3, 0);
  expect(bytes).toBeLessThanOrEqual(6000);
  await page.goto("/fr/app/quotes");
  await expect(page).toHaveURL(/\/fr\/app\/quotes$/);
});

test("lien d'import long de CRMlead après la fin de la session : le formulaire s'ouvre", async ({
  page,
  context,
}) => {
  await login(page, "fr");
  const text = (n: number) => "Prestation détaillée ".repeat(30).slice(0, n);
  const d = Buffer.from(
    JSON.stringify({
      v: 1,
      kind: "invoice",
      lead: { id: `lead-long-${Date.now()}`, title: text(180) },
      contact: { id: `co-long-${Date.now()}`, name: "Boulangerie Rochat SA" },
      lines: [
        { description: text(480), quantity: 1, unit: "flat", unitPriceCents: 100000 },
        { description: text(480), quantity: 2, unit: "hour", unitPriceCents: 15000 },
      ],
    }),
  ).toString("base64url");
  const link = `/fr/app/import/crmlead?d=${d}`;
  expect(link.length).toBeGreaterThan(2000);
  expect(link.length).toBeLessThanOrEqual(2400);

  // Session échue : le cookie a disparu du navigateur.
  await dropCookies(context, (name) => name === "il_session");
  await page.goto(link);
  await expect(page).toHaveURL(`${APP}${link}`);
  await expect(page.getByTestId("crm-import")).toBeVisible();

  // Session échue côté serveur : le cookie est encore là.
  await context.addCookies([{ name: "il_session", value: "expiree", url: `${APP}/` }]);
  await page.goto(link);
  await expect(page).toHaveURL(`${APP}${link}`);
  await expect(page.getByTestId("crm-import")).toBeVisible();
});

test("formulaire envoyé après la fin de la session : retour sur la même page, sans erreur", async ({
  page,
  context,
}) => {
  await login(page, "fr");
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  for (const expire of ["cookie", "serveur"] as const) {
    await page.goto("/fr/app/contacts/new");
    await page.getByTestId("contact-form").getByLabel("Nom ou raison sociale").fill("Rochat SA");
    if (expire === "cookie") await dropCookies(context, (name) => name === "il_session");
    else await context.addCookies([{ name: "il_session", value: "expiree", url: `${APP}/` }]);
    const relogin = page.waitForResponse((r) => r.url().includes("/auth/lead/callback"));
    await page.getByTestId("contact-save").click();
    await relogin;
    await expect(page).toHaveURL(/\/fr\/app\/contacts\/new$/);
    await expect(page.getByTestId("contact-form")).toBeVisible();
    await expect(page.getByText("This page couldn't load")).toHaveCount(0);
  }
  expect(errors).toEqual([]);
});

test("export des paiements après la fin de la session : retour sur les factures fournisseurs", async ({
  page,
  context,
}) => {
  for (const expire of ["cookie", "serveur"] as const) {
    await context.clearCookies();
    if (expire === "serveur")
      await context.addCookies([{ name: "il_session", value: "expiree", url: `${APP}/` }]);
    const res = await context.request.post("/fr/app/accounting/bills/export", {
      form: { id: "x" },
      maxRedirects: 0,
    });
    expect(res.status()).toBe(303);
    const location = res.headers().location ?? "";
    expect(location).toContain("/auth/lead/start?locale=fr&next=%2Ffr%2Fapp%2Faccounting%2Fbills");
    expect(location).not.toContain("export");
    await page.goto(location);
    await expect(page).toHaveURL(/\/fr\/app\/accounting\/bills$/);
  }
  // Une page qui s'ouvre sans cookie passe toujours par l'écran de connexion.
  await context.clearCookies();
  const get = await context.request.get("/fr/app/invoices", { maxRedirects: 0 });
  expect(get.status()).toBe(307);
  expect(get.headers().location).toContain("/fr/login?next=%2Ffr%2Fapp%2Finvoices");
});

test("la page de retour ne vient que du proxy", async ({ context }) => {
  // Un en-tête forgé par le navigateur ne devient jamais la page de retour : c'est la page ouverte.
  await context.addCookies([{ name: "il_session", value: "expiree", url: `${APP}/` }]);
  const res = await context.request.get("/fr/app/invoices", {
    headers: { "x-il-requested-path": "/fr/app/settings/team" },
    maxRedirects: 0,
  });
  const location = res.headers().location ?? "";
  expect(location).toContain("/auth/lead/start?locale=fr&next=%2Ffr%2Fapp%2Finvoices");
  expect(location).not.toContain("team");
});

test("invitation de fiduciaire : session échue avant « Accepter », retour sur l'invitation", async ({
  browser,
  page,
}) => {
  const run = Date.now();
  await login(page, "fr", {
    sub: `sub-exp-${run}`,
    email: `exp-${run}@atelier.test`,
    org: `org-exp-${run}`,
    org_name: "Échéance Sàrl",
    plan: "pro",
  });
  await page.goto("/fr/app/settings/team");
  const fiduEmail = `fidu-exp-${run}@fidu.test`;
  await page.getByLabel("Adresse e-mail de la fiduciaire").fill(fiduEmail);
  await page.getByTestId("fiduciary-invite").click();
  const link = new URL(await page.getByTestId("invite-link").inputValue());

  const fiduContext = await browser.newContext();
  const fidu = await fiduContext.newPage();
  const asFidu = {
    sub: `sub-fidu-exp-${run}`,
    email: fiduEmail,
    org: `org-fidu-exp-${run}`,
    org_name: "Fidu Échéance SA",
  };
  await fidu.request.post(`${LEAD}/test/next-user`, { data: asFidu });
  await fidu.goto(link.pathname + link.search);
  await fidu.getByRole("link", { name: "Se connecter avec mon Compte Lead" }).click();
  await fidu.waitForURL(/\/fr\/invite\?token=/);

  // La session échoit pendant que l'invitation est ouverte : reconnexion, puis retour sur l'invitation.
  const keep = (await fiduContext.cookies()).filter((c) => c.name !== "il_session");
  await fiduContext.clearCookies();
  await fiduContext.addCookies(keep);
  await fidu.request.post(`${LEAD}/test/next-user`, { data: asFidu });
  const relogin = fidu.waitForResponse((r) => r.url().includes("/auth/lead/callback"));
  await fidu.getByTestId("invite-accept").click();
  await relogin;
  await expect(fidu).toHaveURL(`http://localhost:3100${link.pathname}${link.search}`);
  await fidu.getByTestId("invite-accept").click();
  await fidu.waitForURL(/\/fr\/app\/accounting\?welcome=fiduciary/);
  await expect(fidu.getByTestId("org-name")).toHaveText("Échéance Sàrl");
  await fiduContext.close();
});
