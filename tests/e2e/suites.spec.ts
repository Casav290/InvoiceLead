import { expect, test } from "@playwright/test";
import { LEAD, login } from "./helpers";

/**
 * Suites de l'abonnement par application (billing-followups-design.md, points 1, 2, 4 et 6a), dans
 * InvoiceLead, de bout en bout avec le faux Compte Lead et le faux Stripe :
 * - Formule : jamais une offre égale ou inférieure à la formule acquise, contrat data-plan-*, origine
 *   et date d'une formule propre du Compte Lead, refus du serveur sans session Stripe ;
 * - Équipe : liste des places (contrat data-seat-*), dernière venue, « Retirer » en deux temps
 *   réservé aux responsables et jamais sur soi, retrait gardé à la reconnexion, « Rétablir » ;
 * - refus « places » servi sans session, « Changer de compte » (prompt=login), lien Compte ERPlead,
 *   conseil selon la formule, « Voir les formules » pour une personne qui n'administre pas.
 */
const DAY = 86_400_000;
const dotted = (iso: string) => {
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}.${m}.${y}`;
};

async function billingCounts(request: import("@playwright/test").APIRequestContext) {
  const b = (await (await request.get(`${LEAD}/test/billing`)).json()) as {
    customers: unknown[];
    checkouts: unknown[];
  };
  return { customers: b.customers.length, checkouts: b.checkouts.length };
}

test("Formule : Pro+ par le Compte Lead, aucune offre, origine et date dites, Checkout refusé", async ({
  page,
}) => {
  const run = Date.now();
  const until = new Date(Date.now() + 40 * DAY).toISOString();
  await login(page, "fr", {
    sub: `sub-s1-${run}`,
    email: `s1-${run}@atelier.test`,
    org: `org-s1-${run}`,
    org_name: "Plus Sàrl",
    plan: "proplus",
    plan_source: "own",
    plan_until: until,
  });
  await page.goto("/fr/app/settings/plan");
  const current = page.getByTestId("plan-current");
  await expect(current).toHaveAttribute("data-plan-current", "pro_plus");
  await expect(current).toHaveAttribute("data-plan-acquired", "pro_plus");
  await expect(current).toContainText("Votre formule : Pro+");
  await expect(current).toContainText(
    `Pro+ par votre Compte ERPlead jusqu'au ${dotted(until)} : cette formule se gère dans ERPlead.`,
  );
  await expect(current.getByRole("link", { name: "Ouvrir mon Compte ERPlead" })).toHaveAttribute(
    "href",
    "https://erplead.io/account",
  );
  await expect(page.locator("[data-plan-offer]")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Passer à Pro/ })).toHaveCount(0);

  // Serveur : un envoi direct (Pro ou Pro+) revient sur la page Formule, sans client ni session Stripe.
  const before = await billingCounts(page.request);
  for (const plan of ["pro", "pro_plus"]) {
    const direct = await page.request.post("/api/billing/checkout", {
      form: { locale: "fr", plan, interval: "month" },
      maxRedirects: 0,
    });
    expect(direct.status()).toBe(303);
    expect(direct.headers().location).toContain("/fr/app/settings/plan?error=already");
  }
  expect(await billingCounts(page.request)).toEqual(before);
  await page.goto("/fr/app/settings/plan?error=already");
  await expect(page.locator('p[role="alert"]')).toHaveText(
    "Votre entreprise a déjà Pro+ dans InvoiceLead : rien à payer de plus.",
  );
});

test("Formule : Pro propre du Compte Lead, seul Pro+ est proposé ; héritage Pro+, Pro et Pro+ restent", async ({
  page,
  browser,
}) => {
  const run = Date.now();
  await login(page, "fr", {
    sub: `sub-s2-${run}`,
    email: `s2-${run}@atelier.test`,
    org: `org-s2-${run}`,
    org_name: "Pro Sàrl",
    plan: "pro",
    plan_source: "own",
  });
  await page.goto("/fr/app/settings/plan");
  const current = page.getByTestId("plan-current");
  await expect(current).toHaveAttribute("data-plan-current", "pro");
  await expect(current).toHaveAttribute("data-plan-acquired", "pro");
  await expect(current).toContainText(
    "Pro par votre Compte ERPlead : cette formule se gère dans ERPlead.",
  );
  const offers = page.locator("[data-plan-offer]");
  await expect(offers).toHaveCount(1);
  await expect(offers).toHaveAttribute("data-plan-offer", "pro_plus");
  await expect(offers).toHaveText("Passer à Pro+");

  // Héritage de la transition (abonnement CRMlead d'avant la bascule) : la formule acquise est
  // Gratuit, s'abonner reste le chemin prévu.
  const other = await browser.newContext();
  const heir = await other.newPage();
  const until = new Date(Date.now() + 9 * DAY).toISOString();
  await login(heir, "fr", {
    sub: `sub-s3-${run}`,
    email: `s3-${run}@atelier.test`,
    org: `org-s3-${run}`,
    org_name: "Héritage Sàrl",
    plan: "proplus",
    plan_source: "family",
    plan_until: until,
  });
  await heir.goto("/fr/app/settings/plan");
  const inherited = heir.getByTestId("plan-current");
  await expect(inherited).toHaveAttribute("data-plan-current", "pro_plus");
  await expect(inherited).toHaveAttribute("data-plan-acquired", "free");
  await expect(inherited).toContainText(`Jusqu'au ${dotted(until)}, votre abonnement CRMlead`);
  await expect(heir.locator("[data-plan-offer]")).toHaveCount(2);
  await expect(heir.locator('[data-plan-offer="pro"]')).toHaveText("Passer à Pro");
  await expect(heir.locator('[data-plan-offer="pro_plus"]')).toHaveText("Passer à Pro+");
  await other.close();
});

test("Équipe : places, dernière venue, « Retirer » en deux temps, retrait gardé, « Rétablir »", async ({
  page,
  browser,
}) => {
  const run = Date.now();
  const org = `org-s4-${run}`;
  const person = (who: string, role = "user") => ({
    sub: `sub-s4-${who}-${run}`,
    email: `${who}-${run}@atelier.test`,
    name: `${who[0]?.toUpperCase()}${who.slice(1)} Muster`,
    org,
    org_name: "Places Pro+ Sàrl",
    org_role: role,
    plan: "proplus" as const,
    plan_source: "own" as const,
  });
  await login(page, "fr", person("ada", "admin"));
  const bobContext = await browser.newContext();
  const bob = await bobContext.newPage();
  await login(bob, "fr", person("bob"));
  const carlContext = await browser.newContext();
  const carl = await carlContext.newPage();
  await login(carl, "fr", person("carl"));

  await page.goto("/fr/app/settings/team");
  const list = page.locator("[data-seat-list]");
  await expect(list).toHaveAttribute("data-seats-used", "3");
  await expect(list).toHaveAttribute("data-seats-max", "5");
  const holders = list.locator("[data-seat-holder]");
  await expect(holders).toHaveCount(3);
  for (const who of ["ada", "bob", "carl"]) {
    const row = list.locator(`[data-seat-holder="${who}-${run}@atelier.test"]`);
    await expect(row.locator("[data-last-seen]")).toHaveAttribute(
      "data-last-seen",
      /^\d{4}-\d{2}-\d{2}T/,
    );
    await expect(row.locator("[data-last-seen]")).toContainText(
      `Dernière venue : ${dotted(new Date().toISOString())}`,
    );
    // « Retirer » sur chaque ligne sauf la sienne.
    await expect(row.locator("[data-seat-remove]")).toHaveCount(who === "ada" ? 0 : 1);
  }

  // Premier temps : la confirmation nomme la personne et dit l'effet ; « Annuler » ne change rien.
  const bobRow = list.locator(`[data-seat-holder="bob-${run}@atelier.test"]`);
  await bobRow.locator("[data-seat-remove]").click();
  const confirm = page.getByTestId("remove-confirm");
  await expect(confirm).toContainText("Retirer Bob Muster d'InvoiceLead ?");
  await expect(confirm).toContainText("Sa place se libère tout de suite");
  await confirm.getByRole("link", { name: "Annuler" }).click();
  await expect(page.getByTestId("remove-confirm")).toHaveCount(0);
  await expect(list).toHaveAttribute("data-seats-used", "3");
  // Second temps : retirée, sa place est libre, elle passe à part.
  await bobRow.locator("[data-seat-remove]").click();
  await page
    .getByTestId("remove-confirm")
    .getByRole("button", { name: "Retirer Bob Muster" })
    .click();
  await expect(page.getByTestId("team-notice")).toHaveText(
    "Personne retirée : sa place est libre.",
  );
  await expect(list).toHaveAttribute("data-seats-used", "2");
  await expect(page.locator(`[data-seat-removed="bob-${run}@atelier.test"]`)).toBeVisible();

  // Sa session est fermée ; à la reconnexion, elle n'entre pas, même s'il reste des places.
  const closed = await bob.request.get("/fr/app", { maxRedirects: 0 });
  expect([303, 307, 308]).toContain(closed.status());
  expect(closed.headers().location).toContain("/auth/lead/start");
  await login(bob, "fr", person("bob"), "**/fr/no-access?**");
  await expect(bob.getByTestId("no-access")).toHaveAttribute("data-reason", "blocked");

  // Une membre ne voit aucun « Retirer » ni « Rétablir ».
  await carl.goto("/fr/app/settings/team");
  await expect(carl.locator("[data-seat-list]")).toBeVisible();
  await expect(carl.locator("[data-seat-remove]")).toHaveCount(0);
  await expect(carl.getByRole("button", { name: /^Retirer|^Rétablir/ })).toHaveCount(0);
  await expect(carl.getByRole("link", { name: /^Retirer/ })).toHaveCount(0);
  // Et le serveur refuse : la page de confirmation ne s'ouvre pas pour elle.
  await carl.goto(`/fr/app/settings/team?retirer=00000000-0000-4000-8000-000000000000`);
  await expect(carl.getByTestId("remove-confirm")).toHaveCount(0);

  // L'administratrice la rétablit : elle retrouve sa place et entre.
  await page
    .locator(`[data-seat-removed="bob-${run}@atelier.test"]`)
    .getByRole("button", {
      name: "Rétablir",
    })
    .click();
  await expect(page.getByTestId("team-notice")).toHaveText("Accès rétabli.");
  await expect(list).toHaveAttribute("data-seats-used", "3");
  await bob.goto("/fr/app");
  await expect(bob).toHaveURL(/\/fr\/app$/);
  await bobContext.close();
  await carlContext.close();
});

test("Refus « places » sans session : Changer de compte, Compte ERPlead, conseil selon la formule", async ({
  browser,
}) => {
  const anon = await browser.newContext({ locale: "fr-CH" });
  const page = await anon.newPage();
  const res = await page.goto("/fr/no-access?raison=places&formule=proplus");
  expect(res?.status()).toBe(200);
  expect(new URL(page.url()).pathname).toBe("/fr/no-access");
  const screen = page.getByTestId("no-access");
  await expect(screen).toHaveAttribute("data-reason", "seat");
  await expect(screen).toHaveAttribute("data-formule", "proplus");
  await expect(screen).toContainText("Les 5 places Pro+ d'InvoiceLead de votre entreprise");
  await expect(screen).toContainText("libérer une place");
  await expect(screen).not.toContainText("Passez à Pro+");
  await expect(page.locator("[data-upgrade]")).toHaveCount(0);
  const change = page.locator("a[data-switch-account]");
  await expect(change).toHaveText("Changer de compte");
  await expect(change).toHaveAttribute("href", "/auth/lead/start?switch=1&locale=fr");
  await expect(page.getByRole("link", { name: "Compte ERPlead" })).toHaveAttribute(
    "href",
    "https://erplead.io/account",
  );
  await expect(page.getByRole("button", { name: "Se déconnecter" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /^(Se connecter|Réessayer)$/ })).toHaveCount(0);

  for (const formule of ["free", "pro"] as const) {
    await page.goto(`/fr/no-access?raison=places&formule=${formule}`);
    const s = page.getByTestId("no-access");
    await expect(s).toHaveAttribute("data-formule", formule);
    await expect(s).toContainText(formule === "free" ? "formule Gratuite" : "formule Pro");
    await expect(s).toContainText("passer à Pro+ (5 places)");
    const plans = page.locator("a[data-upgrade]");
    await expect(plans).toHaveText("Voir les formules");
    await expect(plans).toHaveAttribute("href", "/fr/pricing");
  }

  // « Changer de compte » redemande l'identifiant au Compte Lead (prompt=login), puis arrive.
  const run = Date.now();
  await page.request.post(`${LEAD}/test/next-user`, {
    data: { sub: `sub-s5-${run}`, email: `s5-${run}@atelier.test`, org: `org-s5-${run}` },
  });
  await page.locator("a[data-switch-account]").click();
  await page.waitForURL("**/fr/app");
  const asked = (await (await page.request.get(`${LEAD}/test/authorizes`)).json()) as {
    prompt: string | null;
  }[];
  expect(asked.at(-1)?.prompt).toBe("login");
  await anon.close();
});

test("Refus « places » avec session : adresse raison=places&formule, la formule de la session prime", async ({
  page,
  browser,
}) => {
  const run = Date.now();
  const org = `org-s6-${run}`;
  const admin = {
    sub: `sub-s6-a-${run}`,
    email: `s6a-${run}@atelier.test`,
    name: "Alma Muster",
    org,
    org_name: "Une Place Sàrl",
    plan: "pro" as const,
    plan_source: "own" as const,
  };
  await login(page, "fr", admin);
  const other = await browser.newContext();
  const member = await other.newPage();
  await login(
    member,
    "fr",
    { ...admin, sub: `sub-s6-b-${run}`, email: `s6b-${run}@atelier.test`, org_role: "user" },
    "**/fr/no-access?**",
  );
  const url = new URL(member.url());
  expect(url.searchParams.get("raison")).toBe("places");
  expect(url.searchParams.get("formule")).toBe("pro");
  const screen = member.getByTestId("no-access");
  await expect(screen).toHaveAttribute("data-reason", "seat");
  await expect(screen).toContainText("La formule Pro d'InvoiceLead compte une seule place");
  await expect(screen).toContainText("Demandez à l'administrateur de Une Place Sàrl");
  await expect(member.locator("a[data-upgrade]")).toHaveText("Voir les formules");
  await expect(member.locator("[data-plan-offer]")).toHaveCount(0);
  // Une adresse qui dirait Pro+ ne change rien : la session dit Pro.
  await member.goto("/fr/no-access?raison=places&formule=proplus");
  await expect(member.getByTestId("no-access")).toHaveAttribute("data-formule", "pro");
  await expect(member.locator("a[data-upgrade]")).toHaveText("Voir les formules");
  // Avec une session : « Se déconnecter » reste, « Changer de compte » mène à une autre personne.
  await expect(member.getByRole("button", { name: "Se déconnecter" })).toBeVisible();
  await member.request.post(`${LEAD}/test/next-user`, { data: admin });
  await member.locator("a[data-switch-account]").click();
  await member.waitForURL("**/fr/app");
  await member.goto("/fr/app/settings/team");
  await expect(member.locator(`[data-seat-holder="${admin.email}"]`)).toBeVisible();
  await other.close();
});
