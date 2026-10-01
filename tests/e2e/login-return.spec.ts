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
    `${APP}/auth/lead/start?locale=fr&next=%2Ffr%2Fapp%2Fquotes%3Fstatus%3Ddraft&retry=1`,
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
  expect(back.headers().location).toBe(`${APP}/auth/lead/start?locale=fr&invite=${INVITE}&retry=1`);
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
      `${APP}/auth/lead/start?locale=de&next=%2Fde%2Fapp%2Finvoices&retry=1`,
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
  // Connexion refusée au Compte Lead : écran d'erreur.
  await page.goto(`/auth/lead/callback?error=access_denied&state=${state}`);
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

test("lien d'import long, retour sans le cookie de la demande : la page entière revient", async ({
  page,
  context,
}) => {
  const d = Buffer.from(
    JSON.stringify({
      v: 1,
      kind: "quote",
      lead: { id: `lead-ref-${Date.now()}`, title: "Rénovation de la façade et des combles" },
      contact: { id: `co-ref-${Date.now()}`, name: "Menuiserie Dupont & Fils Sàrl" },
      lines: [
        {
          description: "Rénovation complète, façade et toiture. ".repeat(10),
          quantity: 1,
          unit: "flat",
          unitPriceCents: 1250000,
        },
      ],
    }),
  ).toString("base64url");
  const link = `/fr/app/import/crmlead?d=${d}`;
  expect(link.length).toBeGreaterThan(300);
  const { authorize, state } = await startState(
    context,
    `locale=fr&next=${encodeURIComponent(link)}`,
  );
  // Le Compte Lead ne voit ni la page ni sa référence : tout est dans le `state` chiffré.
  expect(authorize.toString()).not.toContain("crmlead");
  // Lien de l'email ouvert ailleurs, ou écran resté ouvert : le cookie de la demande manque.
  await context.clearCookies();
  const back = await context.request.get(`/auth/lead/callback?code=x&state=${state}`, {
    maxRedirects: 0,
  });
  expect(back.headers().location).toBe(
    `${APP}/auth/lead/start?${new URLSearchParams({ locale: "fr", next: link, retry: "1" })}`,
  );
  await context.clearCookies();
  await page.goto(`/auth/lead/callback?code=x&state=${state}`);
  await expect(page).toHaveURL(`${APP}${link}`);
  await expect(page.getByTestId("crm-import")).toBeVisible();
});

test("recherche avec « * » après la fin de la session : retour sur la même recherche", async ({
  page,
  context,
}) => {
  await login(page, "fr");
  const search = "/fr/app/contacts?q=M%C3%BCller*";
  for (const expire of ["cookie", "serveur"] as const) {
    if (expire === "cookie") await dropCookies(context, (name) => name === "il_session");
    else await context.addCookies([{ name: "il_session", value: "expiree", url: `${APP}/` }]);
    await page.goto(search);
    await expect(page).toHaveURL(`${APP}${search}`);
    await expect(page.locator("#contacts-q")).toHaveValue("Müller*");
  }
});

test("fichier à télécharger après la fin de la session : retour sur la page de son formulaire", async ({
  page,
  context,
}) => {
  const year = "0b6f3f0e-6a51-4a1e-9a43-1f2d3c4b5a69";
  const doc = "6c33e4a5-1b3d-489d-96ed-28de6a32fadd";
  const cases: [string, string][] = [
    [
      `/de/app/accounting/reports/datev?year=${year}&consultant=1001&client=1`,
      `/de/app/accounting/reports?year=${year}`,
    ],
    [`/fr/app/accounting/reports/fec?year=${year}`, `/fr/app/accounting/reports?year=${year}`],
    ["/fr/app/accounting/vat/xml?period=2026-07-01", "/fr/app/accounting/vat?period=2026-07-01"],
    [`/de/app/invoices/${doc}/xrechnung`, `/de/app/invoices/${doc}`],
    [`/de/app/credit-notes/${doc}/xrechnung`, `/de/app/credit-notes/${doc}`],
  ];
  for (const [file, form] of cases) {
    const locale = file.slice(1, 3);
    // Sans cookie : l'écran de connexion garde la page du formulaire, jamais le fichier.
    await context.clearCookies();
    const cold = await context.request.get(file, { maxRedirects: 0 });
    expect(cold.status()).toBe(307);
    expect(cold.headers().location).toContain(
      `/${locale}/login?${new URLSearchParams({ next: form })}`,
    );
    // Cookie encore là, session échue côté serveur : la garde de la route aussi.
    await context.addCookies([{ name: "il_session", value: "expiree", url: `${APP}/` }]);
    const warm = await context.request.get(file, { maxRedirects: 0 });
    expect(warm.headers().location).toContain(
      `/auth/lead/start?${new URLSearchParams({ locale, next: form })}`,
    );
  }
  // Jusqu'au bout : la connexion ramène sur la page des rapports, l'onglet n'est pas laissé en plan.
  await context.clearCookies();
  await page.goto(cases[0]?.[0] ?? "");
  await expect(page).toHaveURL(`${APP}${cases[0]?.[1]}`);
});

test("« Relier Stripe » après la fin de la session : retour sur la page Paiements", async ({
  page,
  context,
}) => {
  await context.addCookies([{ name: "il_session", value: "expiree", url: `${APP}/` }]);
  const res = await context.request.get("/api/stripe/connect?locale=fr", { maxRedirects: 0 });
  expect(res.headers().location).toContain(
    "/auth/lead/start?locale=fr&next=%2Ffr%2Fapp%2Fsettings%2Fpayments",
  );
  await page.goto("/api/stripe/connect?locale=fr");
  await expect(page).toHaveURL(`${APP}/fr/app/settings/payments`);
  await expect(page.getByTestId("stripe-connect")).toBeVisible();
});

test("entrée fraîche du Compte Lead : jamais la session InvoiceLead d'une autre personne", async ({
  page,
  context,
}) => {
  const run = Date.now();
  await login(page, "fr", {
    sub: `sub-adm-${run}`,
    email: `adm-${run}@atelier.test`,
    name: "Admin Partagé",
    org: `org-adm-${run}`,
    org_name: "Poste Partagé Sàrl",
  });
  const admin = (await context.cookies()).find((c) => c.name === "il_session")?.value ?? "";
  // Sans `fresh` : la session ouverte est reprise, sans aller-retour.
  const plain = await context.request.get("/auth/lead/start?locale=fr", { maxRedirects: 0 });
  expect(plain.headers().location).toBe(`${APP}/fr/app`);
  // Le collègue vient d'accepter son invitation dans le Compte Lead, sur ce poste : `fresh=1`.
  await page.request.post(`${LEAD}/test/next-user`, {
    data: {
      sub: `sub-col-${run}`,
      email: `col-${run}@atelier.test`,
      name: "Collègue Invité",
      org: `org-col-${run}`,
      org_name: "Collègue Sàrl",
    },
  });
  await page.goto("/auth/lead/start?locale=fr&fresh=1");
  await page.waitForURL(/\/fr\/app$/);
  await expect(page.getByTestId("user-menu")).toHaveAttribute("aria-label", "Collègue Invité");
  // La session de l'administrateur ne vaut plus rien.
  const mine = (await context.cookies()).find((c) => c.name === "il_session")?.value ?? "";
  await context.addCookies([{ name: "il_session", value: admin, url: `${APP}/` }]);
  const old = await context.request.get("/fr/app", { maxRedirects: 0 });
  expect(old.headers().location).toContain("/auth/lead/start");

  // Entrée fraîche qui échoue : l'écran d'erreur, sans reprendre la session restée là.
  await context.addCookies([{ name: "il_session", value: mine, url: `${APP}/` }]);
  const { authorize } = await startState(context, "locale=fr&fresh=1");
  const answer = await context.request.get(authorize.toString(), { maxRedirects: 0 });
  const callback = new URL(answer.headers().location ?? "");
  callback.searchParams.delete("code");
  callback.searchParams.set("error", "access_denied");
  await page.goto(callback.toString());
  await expect(page).toHaveURL(/\/fr\/login\?erreur=lead/);
  await expect(page.getByTestId("lead-login")).toBeVisible();
  expect((await context.cookies()).some((c) => c.name === "il_session")).toBe(false);
  await context.addCookies([{ name: "il_session", value: mine, url: `${APP}/` }]);
  const gone = await context.request.get("/fr/app", { maxRedirects: 0 });
  expect(gone.headers().location).toContain("/auth/lead/start");
});

test("invitation pour une autre adresse : « Changer de compte » ramène sur l'invitation", async ({
  browser,
  page,
}) => {
  const run = Date.now();
  await login(page, "fr", {
    sub: `sub-sw-${run}`,
    email: `sw-${run}@atelier.test`,
    org: `org-sw-${run}`,
    org_name: "Changement Sàrl",
    plan: "pro",
  });
  await page.goto("/fr/app/settings/team");
  const fiduEmail = `fidu-sw-${run}@fidu.test`;
  await page.getByLabel("Adresse e-mail de la fiduciaire").fill(fiduEmail);
  await page.getByTestId("fiduciary-invite").click();
  const link = new URL(await page.getByTestId("invite-link").inputValue());
  const invite = `${link.pathname}${link.search}`;

  const ctx = await browser.newContext();
  const fidu = await ctx.newPage();
  const signIn = fidu.getByRole("link", { name: "Se connecter avec mon Compte Lead" });
  // Navigateur connecté avec un autre compte.
  await fidu.request.post(`${LEAD}/test/next-user`, {
    data: {
      sub: `sub-wrong-${run}`,
      email: `wrong-${run}@fidu.test`,
      org: `org-wrong-${run}`,
      org_name: "Mauvais Compte SA",
    },
  });
  await fidu.goto(invite);
  await signIn.click();
  await fidu.waitForURL(`${APP}${invite}`);
  await fidu.getByTestId("invite-accept").click();
  await fidu.waitForURL(/&error=wrongEmail$/);
  await fidu.getByTestId("invite-switch").click();
  await fidu.waitForURL(`${APP}${invite}`);
  await expect(signIn).toBeVisible();
  const names = (await ctx.cookies()).map((c) => c.name);
  expect(names).not.toContain("il_session");
  expect(names).not.toContain("il_after_logout");
  // Le bon compte : retour sur l'invitation, qui s'accepte.
  await fidu.request.post(`${LEAD}/test/next-user`, {
    data: {
      sub: `sub-fidu-sw-${run}`,
      email: fiduEmail,
      org: `org-fidu-sw-${run}`,
      org_name: "Fidu Changement SA",
    },
  });
  await signIn.click();
  await fidu.waitForURL(`${APP}${invite}`);
  await fidu.getByTestId("invite-accept").click();
  await fidu.waitForURL(/\/fr\/app\/accounting\?welcome=fiduciary/);
  await expect(fidu.getByTestId("org-name")).toHaveText("Changement Sàrl");

  // Déconnexion ordinaire (formulaire du menu) : l'accueil, comme avant.
  await fidu.evaluate(() => {
    const f = document.createElement("form");
    f.method = "post";
    f.action = "/auth/lead/logout";
    const locale = document.createElement("input");
    locale.name = "locale";
    locale.value = "fr";
    f.append(locale);
    document.body.append(f);
    f.submit();
  });
  await fidu.waitForURL(`${APP}/fr`);
  // Cookie posé à la main : seule une adresse d'invitation est suivie, et il s'efface.
  for (const value of ["//evil.example/x", "/fr/app/settings/team", `${invite}&next=/x`]) {
    await ctx.addCookies([{ name: "il_after_logout", value, url: `${APP}/` }]);
    await fidu.goto("/");
    await expect(fidu).toHaveURL(`${APP}/fr`);
    expect((await ctx.cookies()).map((c) => c.name)).not.toContain("il_after_logout");
  }
  await ctx.close();
});

test("fiduciaire : la reconnexion revient chez le client, sur la même fiche", async ({
  browser,
  page,
}) => {
  const run = Date.now();
  await login(page, "fr", {
    sub: `sub-cli-${run}`,
    email: `cli-${run}@atelier.test`,
    org: `org-cli-${run}`,
    org_name: "Client Reprise Sàrl",
    plan: "pro",
  });
  await page.goto("/fr/app/contacts/new");
  await page
    .getByTestId("contact-form")
    .getByLabel("Nom ou raison sociale")
    .fill("Client du client SA");
  await page.getByTestId("contact-save").click();
  await expect(page).toHaveURL(/\/fr\/app\/contacts\?saved=1$/);
  await page.getByRole("link", { name: "Client du client SA" }).first().click();
  await page.waitForURL(/\/fr\/app\/contacts\/[0-9a-f-]{36}$/);
  const card = new URL(page.url()).pathname;
  await page.goto("/fr/app/settings/team");
  const fiduEmail = `fidu-rep-${run}@fidu.test`;
  await page.getByLabel("Adresse e-mail de la fiduciaire").fill(fiduEmail);
  await page.getByTestId("fiduciary-invite").click();
  const link = new URL(await page.getByTestId("invite-link").inputValue());

  const ctx = await browser.newContext();
  const fidu = await ctx.newPage();
  const asFidu = {
    sub: `sub-fidu-rep-${run}`,
    email: fiduEmail,
    org: `org-fidu-rep-${run}`,
    org_name: "Fidu Reprise SA",
  };
  const nextIsFidu = () => fidu.request.post(`${LEAD}/test/next-user`, { data: asFidu });
  await nextIsFidu();
  await fidu.goto(`${link.pathname}${link.search}`);
  await fidu.getByRole("link", { name: "Se connecter avec mon Compte Lead" }).click();
  await fidu.waitForURL(/\/fr\/invite\?token=/);
  await fidu.getByTestId("invite-accept").click();
  await fidu.waitForURL(/\/fr\/app\/accounting\?welcome=fiduciary/);
  await fidu.goto(card);
  await expect(fidu.locator("#contact-name")).toHaveValue("Client du client SA");

  for (const expire of ["cookie", "serveur"] as const) {
    if (expire === "cookie") await dropCookies(ctx, (name) => name === "il_session");
    else await ctx.addCookies([{ name: "il_session", value: "expiree", url: `${APP}/` }]);
    await nextIsFidu();
    await fidu.reload();
    await expect(fidu).toHaveURL(`${APP}${card}`);
    await expect(fidu.locator("#contact-name")).toHaveValue("Client du client SA");
    await expect(fidu.getByTestId("org-name")).toHaveText("Client Reprise Sàrl");
  }
  // Liste : celle du client, pas la sienne.
  await fidu.goto("/fr/app/contacts");
  await expect(fidu.getByRole("link", { name: "Client du client SA" }).first()).toBeVisible();

  // Le client retire la fiduciaire : la reconnexion la ramène chez elle, sans accès au client.
  await page.goto("/fr/app/settings/team");
  await page.getByTestId("fiduciary-remove").click();
  await expect(page.getByText("Accès retiré.")).toBeVisible();
  await dropCookies(ctx, (name) => name === "il_session");
  await nextIsFidu();
  await fidu.goto("/fr/app/contacts");
  await expect(fidu).toHaveURL(`${APP}/fr/app/contacts`);
  await expect(fidu.getByTestId("org-name")).toHaveText("Fidu Reprise SA");
  await expect(fidu.getByRole("link", { name: "Client du client SA" })).toHaveCount(0);
  await ctx.close();
});

test("poste partagé : un retour sans sa demande ne reprend jamais la session d'une autre personne", async ({
  browser,
  page,
  context,
}) => {
  const run = Date.now();
  // B est connectée à InvoiceLead (et au Compte Lead) sur le poste partagé.
  await login(page, "de", {
    sub: `sub-shb-${run}`,
    email: `shb-${run}@atelier.test`,
    name: "Personne B",
    org: `org-shb-${run}`,
    org_name: "Poste B GmbH",
  });
  const sessionB = (await context.cookies()).find((c) => c.name === "il_session")?.value ?? "";
  // A a commencé sa connexion ailleurs : son cookie de demande n'est pas sur ce poste.
  const elsewhere = await browser.newContext();
  const { state } = await startState(
    elsewhere,
    "locale=de&next=%2Fde%2Fapp%2Finvoices%3Fstatus%3Dopen",
  );
  await elsewhere.close();
  // A ouvre ici son lien « mot de passe oublié » : le Compte Lead l'authentifie, elle, et rend un code.
  await page.request.post(`${LEAD}/test/next-user`, {
    data: {
      sub: `sub-sha-${run}`,
      email: `sha-${run}@atelier.test`,
      name: "Personne A",
      org: `org-sha-${run}`,
      org_name: "Poste A GmbH",
    },
  });
  const back = await context.request.get(`/auth/lead/callback?code=x&state=${state}`, {
    maxRedirects: 0,
  });
  expect(back.headers().location).toBe(
    `${APP}/auth/lead/start?locale=de&next=%2Fde%2Fapp%2Finvoices%3Fstatus%3Dopen&fresh=1&retry=1`,
  );
  await page.goto(`/auth/lead/callback?code=x&state=${state}`);
  await expect(page).toHaveURL(`${APP}/de/app/invoices?status=open`);
  await expect(page.getByTestId("user-menu")).toHaveAttribute("aria-label", "Personne A");
  // La session de B ne vaut plus rien.
  const probe = await browser.newContext();
  await probe.addCookies([{ name: "il_session", value: sessionB, url: `${APP}/` }]);
  const old = await probe.request.get("/de/app", { maxRedirects: 0 });
  expect(old.headers().location).toContain("/auth/lead/start");
  await probe.close();

  // Même personne, sa session à elle : la relance la ramène sur sa page, comme elle-même.
  await page.request.post(`${LEAD}/test/next-user`, {
    data: {
      sub: `sub-sha-${run}`,
      email: `sha-${run}@atelier.test`,
      name: "Personne A",
      org: `org-sha-${run}`,
      org_name: "Poste A GmbH",
    },
  });
  const mine = await browser.newContext();
  const second = await startState(mine, "locale=de&next=%2Fde%2Fapp%2Fquotes");
  await mine.close();
  await page.goto(`/auth/lead/callback?code=x&state=${second.state}`);
  await expect(page).toHaveURL(`${APP}/de/app/quotes`);
  await expect(page.getByTestId("user-menu")).toHaveAttribute("aria-label", "Personne A");
});

test("un lien vers le retour posé par un autre site ne déconnecte jamais", async ({
  browser,
  page,
  context,
}) => {
  const run = Date.now();
  await login(page, "fr", {
    sub: `sub-csrf-${run}`,
    email: `csrf-${run}@atelier.test`,
    name: "Personne Visée",
    org: `org-csrf-${run}`,
    org_name: "Visée Sàrl",
  });
  const session = (await context.cookies()).find((c) => c.name === "il_session")?.value ?? "";
  expect(session).not.toBe("");
  // L'autre site obtient, sans aucun cookie, un `state` scellé par ce serveur : départ frais, déjà relancé.
  const elsewhere = await browser.newContext();
  const { state } = await startState(
    elsewhere,
    "locale=fr&fresh=1&retry=1&next=%2Ffr%2Fapp%2Finvoices",
  );
  await elsewhere.close();
  const target = `${APP}/fr/login?erreur=session&next=%2Ffr%2Fapp%2Finvoices&fresh=1`;
  const alive = async () => {
    expect((await context.cookies()).find((c) => c.name === "il_session")?.value).toBe(session);
    const probe = await browser.newContext();
    await probe.addCookies([{ name: "il_session", value: session, url: `${APP}/` }]);
    const app = await probe.request.get("/fr/app", { maxRedirects: 0 });
    expect(app.status()).toBe(200);
    await probe.close();
  };

  // La personne connectée suit le lien, avec ou sans code : l'écran d'erreur, sa session intacte.
  for (const query of [`state=${state}`, `code=x&state=${state}`]) {
    const back = await context.request.get(`/auth/lead/callback?${query}`, { maxRedirects: 0 });
    expect(back.headers().location).toBe(target);
    expect(back.headers()["set-cookie"] ?? "").not.toContain("il_session=");
    await page.goto(`/auth/lead/callback?${query}`);
    await expect(page).toHaveURL(target);
    await expect(page.getByText("La demande de connexion a expiré")).toBeVisible();
    // Le retour n'est pas prouvé : la session restée là ne prend pas le relais derrière l'écran, et
    // « Réessayer » repasse par le Compte Lead.
    await expect(page.getByTestId("lead-login")).toHaveAttribute(
      "href",
      "/auth/lead/start?locale=fr&next=%2Ffr%2Fapp%2Finvoices&fresh=1",
    );
    await expect(
      page.locator("header").getByRole("link", { name: "de", exact: true }),
    ).toHaveAttribute("href", "/de/login?erreur=session&next=%2Fde%2Fapp%2Finvoices&fresh=1");
    await alive();
  }

  // Ancien cookie commun d'une autre demande resté dans ce navigateur (refus du `state`) : pareil.
  // (`fresh` : session ouverte, un départ ordinaire irait tout droit à la page, sans demande.)
  const own = await startState(context, "locale=fr&fresh=1&next=%2Ffr%2Fapp%2Fquotes");
  const pending = (await context.cookies()).find(
    (c) => c.name === `il_lead_login_${own.state.slice(0, 16)}`,
  );
  expect(pending).toBeDefined();
  await dropCookies(context, (name) => name.startsWith("il_lead_login_"));
  await context.addCookies([
    { name: "il_lead_login", value: pending?.value ?? "", domain: "localhost", path: "/auth/lead" },
  ]);
  await page.goto(`/auth/lead/callback?code=x&state=${state}`);
  await expect(page).toHaveURL(`${APP}/fr/login?erreur=lead&next=%2Ffr%2Fapp%2Finvoices&fresh=1`);
  await alive();

  // Un écran d'erreur ordinaire (sans `fresh`) mène toujours tout droit dans l'application.
  await page.goto("/fr/login?erreur=session&next=%2Ffr%2Fapp%2Finvoices");
  await expect(page).toHaveURL(`${APP}/fr/app/invoices`);
  // « Réessayer » d'un écran `fresh` : de nouveau la personne connectée au Compte Lead, sur sa page.
  await page.request.post(`${LEAD}/test/next-user`, {
    data: {
      sub: `sub-csrf-${run}`,
      email: `csrf-${run}@atelier.test`,
      name: "Personne Visée",
      org: `org-csrf-${run}`,
      org_name: "Visée Sàrl",
    },
  });
  await page.goto(target);
  await page.getByTestId("lead-login").click();
  await expect(page).toHaveURL(`${APP}/fr/app/invoices`);
  await expect(page.getByTestId("user-menu")).toHaveAttribute("aria-label", "Personne Visée");
});

test("retour rejoué après une réponse perdue : relance silencieuse, jamais l'écran d'erreur", async ({
  page,
  context,
}) => {
  const run = Date.now();
  await page.request.post(`${LEAD}/test/next-user`, {
    data: { sub: `sub-rep-${run}`, email: `rep-${run}@atelier.test`, name: "Rejoué" },
  });
  const cookieHeader = async (url: string) =>
    (await context.cookies(url)).map((c) => `${c.name}=${c.value}`).join("; ");
  const replay = async (query: string) => {
    const { authorize } = await startState(context, query);
    const answer = await context.request.get(authorize.toString(), { maxRedirects: 0 });
    const callback = answer.headers().location ?? "";
    // Le serveur reçoit le retour et échange le code, mais sa réponse n'arrive jamais au navigateur.
    const lost = await fetch(callback, {
      headers: { cookie: await cookieHeader(callback) },
      redirect: "manual",
    });
    expect(lost.status).toBe(303);
    // La personne recharge la page d'erreur du navigateur : le même retour, son cookie toujours là.
    return callback;
  };
  await page.goto(await replay("locale=fr&next=%2Ffr%2Fapp%2Finvoices%3Fstatus%3Dopen"));
  await expect(page).toHaveURL(`${APP}/fr/app/invoices?status=open`);
  // Une relance déjà faite qui échoue encore : l'écran d'erreur, sans boucle.
  await context.clearCookies();
  await page.goto(await replay("locale=fr&next=%2Ffr%2Fapp%2Fquotes&retry=1"));
  await expect(page).toHaveURL(`${APP}/fr/login?erreur=lead&next=%2Ffr%2Fapp%2Fquotes`);
});

test("fiduciaire : un lien de son propre CRMlead et ses pièces s'ouvrent dans son entreprise", async ({
  browser,
  page,
}) => {
  const run = Date.now();
  await login(page, "fr", {
    sub: `sub-cl2-${run}`,
    email: `cl2-${run}@atelier.test`,
    org: `org-cl2-${run}`,
    org_name: "Client Lien Sàrl",
    plan: "pro",
  });
  await page.goto("/fr/app/settings/team");
  const fiduEmail = `fidu-lien-${run}@fidu.test`;
  await page.getByLabel("Adresse e-mail de la fiduciaire").fill(fiduEmail);
  await page.getByTestId("fiduciary-invite").click();
  const link = new URL(await page.getByTestId("invite-link").inputValue());

  const ctx = await browser.newContext();
  const fidu = await ctx.newPage();
  const asFidu = {
    sub: `sub-fidu-lien-${run}`,
    email: fiduEmail,
    org: `org-fidu-lien-${run}`,
    org_name: "Fidu Lien SA",
  };
  const nextIsFidu = () => fidu.request.post(`${LEAD}/test/next-user`, { data: asFidu });
  const toClient = async () => {
    await fidu.goto("/fr/app");
    await fidu.getByTestId("org-switcher").locator("summary").click();
    await fidu.getByRole("button", { name: "Client Lien Sàrl" }).click();
    await expect(fidu.getByTestId("org-name")).toHaveText("Client Lien Sàrl");
  };
  const expire = async () => {
    const keep = (await ctx.cookies()).filter((c) => c.name !== "il_session");
    await ctx.clearCookies();
    await ctx.addCookies(keep);
    await nextIsFidu();
  };
  await nextIsFidu();
  await fidu.goto(`${link.pathname}${link.search}`);
  await fidu.getByRole("link", { name: "Se connecter avec mon Compte Lead" }).click();
  await fidu.waitForURL(/\/fr\/invite\?token=/);
  await fidu.getByTestId("invite-accept").click();
  await fidu.waitForURL(/\/fr\/app\/accounting\?welcome=fiduciary/);
  await expect(fidu.getByTestId("org-name")).toHaveText("Client Lien Sàrl");

  const d = Buffer.from(
    JSON.stringify({
      v: 1,
      kind: "quote",
      lead: { id: `lead-fid-${run}`, title: "Audit annuel" },
      contact: { name: "Prospect de la fiduciaire SA" },
      lines: [{ description: "Audit annuel", quantity: 1, unitPriceCents: 90000 }],
    }),
  ).toString("base64url");
  const importLink = `/fr/app/import/crmlead?d=${d}`;

  // Session ouverte chez le client : le lien propose de passer dans son entreprise, et y revient.
  await fidu.goto(importLink);
  await expect(fidu.getByTestId("crm-import-confirm")).toBeDisabled();
  await fidu
    .getByTestId("crm-import-switch")
    .getByRole("button", { name: "Passer dans Fidu Lien SA" })
    .click();
  await fidu.waitForURL(`${APP}${importLink}`);
  await expect(fidu.getByTestId("org-name")).toHaveText("Fidu Lien SA");
  await expect(fidu.getByTestId("crm-import-confirm")).toBeEnabled();

  // Session échue alors qu'elle travaillait chez le client : le lien s'ouvre dans son entreprise.
  await toClient();
  await expire();
  await fidu.goto(importLink);
  await expect(fidu).toHaveURL(`${APP}${importLink}`);
  await expect(fidu.getByTestId("org-name")).toHaveText("Fidu Lien SA");
  await fidu.getByTestId("crm-import-confirm").click();
  await fidu.waitForURL(/\/fr\/app\/quotes\/[0-9a-f-]{36}\?from=crmlead$/);
  const quote = new URL(fidu.url()).pathname;

  // Sa propre pièce (lien « ouvrir dans InvoiceLead » de CRMlead), session échue chez le client.
  await toClient();
  await expire();
  await fidu.goto(quote);
  await expect(fidu).toHaveURL(`${APP}${quote}`);
  await expect(fidu.getByTestId("org-name")).toHaveText("Fidu Lien SA");
  await expect(fidu.getByTestId("document-status")).toBeVisible();

  // Session ouverte chez le client : la pièce propose de passer dans son entreprise, sans rien montrer.
  await toClient();
  await fidu.goto(quote);
  await expect(fidu.getByTestId("document-elsewhere")).toContainText("Fidu Lien SA");
  await expect(fidu.getByTestId("document-status")).toHaveCount(0);
  await fidu.getByTestId("document-elsewhere-switch").click();
  await fidu.waitForURL(`${APP}${quote}`);
  await expect(fidu.getByTestId("org-name")).toHaveText("Fidu Lien SA");
  await expect(fidu.getByTestId("document-status")).toBeVisible();

  // Une pièce du client ouverte par le client : pas de passage proposé chez qui n'y a pas accès.
  await page.goto(quote);
  await expect(page.getByTestId("document-elsewhere")).toHaveCount(0);
  await ctx.close();
});
