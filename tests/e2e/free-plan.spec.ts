import { expect, type Locator, type Page, test } from "@playwright/test";
import { camt053 } from "../support/camt";
import { login, setupBilling, traitNetIssues } from "./helpers";

/**
 * Décision d'Ève (1er octobre 2026) : en formule gratuite, chaque fonction Pro reste visible à sa
 * place, grisée, avec sa marque et un lien de mise à niveau ; de petites allocations gratuites
 * deviennent grisées une fois utilisées ; le serveur refuse ce que l'écran ne permet plus.
 */

async function freeCompany(page: Page, tag: string) {
  const run = `${tag}-${Date.now()}`;
  await login(page, "fr", {
    sub: `sub-${run}`,
    email: `${run}@gratuit.test`,
    org: `org-${run}`,
    org_name: "Gratuit Sàrl",
  });
}

async function chartAndYear(page: Page) {
  await page.goto("/fr/app/settings/accounts");
  await page.getByTestId("chart-install").click();
  await page.goto("/fr/app/settings/fiscal-years");
  await page.getByTestId("fiscal-year-first").click();
  await expect(page.getByText("Exercice ouvert.")).toBeVisible();
}

/** Ce que ferait une page modifiée à la main : le bloc grisé redevient actif dans le navigateur. */
function unlock(fieldset: Element) {
  fieldset.removeAttribute("disabled");
  fieldset.removeAttribute("aria-disabled");
}

/** Bloc grisé : commandes désactivées, marque, raison, lien atteignable au clavier. */
async function expectLocked(lock: Locator, tier: "Pro" | "Pro+", reason: string | RegExp) {
  await expect(lock).toBeVisible();
  await expect(lock.locator("fieldset").first()).toHaveAttribute("aria-disabled", "true");
  await expect(lock.getByTestId("pro-badge").last()).toHaveText(tier);
  await expect(lock.getByTestId("lock-note")).toContainText(reason);
  const link = lock.getByRole("link", { name: tier === "Pro" ? "Passer à Pro" : "Passer à Pro+" });
  await expect(link).toHaveAttribute("href", /^https:\/\//);
  await link.focus();
  await expect(link).toBeFocused();
}

test("formule gratuite : chaque fonction Pro reste visible, grisée, avec sa marque", async ({
  page,
}) => {
  await freeCompany(page, "grise");

  // Tableau de bord : la formule, ses limites et toutes les allocations du mois.
  await expect(page.getByTestId("plan-usage")).toContainText(
    "Formule gratuite\u202f: 0 facture sur 10 ce mois-ci, 0 contact sur 50.",
  );
  const quotas: [string, RegExp][] = [
    ["quota-aiReads", /0 sur 20 ce mois-ci/],
    ["quota-assistant", /0 sur 10 ce mois-ci/],
    ["quota-reminders", /0 sur 5 ce mois-ci/],
    ["quota-bankImports", /0 sur 1 ce mois-ci/],
    ["quota-recurring", /0 sur 1/],
  ];
  for (const [id, text] of quotas) await expect(page.getByTestId(id)).toContainText(text);
  await page.getByTestId("user-menu").click();
  await expect(page.getByTestId("menu-upgrade")).toHaveText("Passer à Pro");
  await expect(page.getByTestId("menu-upgrade")).toHaveAttribute("href", /^https:\/\//);
  await page.keyboard.press("Escape");

  await setupBilling(page);
  await chartAndYear(page);

  // Décompte TVA : onglet marqué Pro, structure visible, montants réservés à Pro (ils ne sont
  // pas dans la page), relecture et validation grisées.
  await page.goto("/fr/app/accounting/vat");
  await expect(page.getByTestId("accounting-tab-vat").getByTestId("pro-badge")).toHaveText("Pro");
  await expect(page.getByTestId("accounting-tab-bank").getByTestId("pro-badge")).toHaveCount(0);
  const figures = page.getByTestId("vat-figures");
  await expect(figures).toHaveAttribute("data-masked", "true");
  await expect(figures.getByTestId("figure-200")).toBeVisible();
  await expect(figures.getByTestId("vat-amount-hidden").first()).toBeVisible();
  await expect(figures.locator("tbody")).not.toContainText(/\d+\.\d{2}/);
  await expect(figures.getByTestId("vat-figures-lock")).toContainText(
    "Les montants du décompte s'affichent avec Pro.",
  );
  await expect(
    figures.getByTestId("vat-figures-lock").getByRole("link", { name: "Passer à Pro" }),
  ).toHaveAttribute("href", /^https:\/\//);
  await expect(
    page.getByTestId("plan-notice").getByRole("link", { name: "Passer à Pro" }),
  ).toHaveAttribute("href", /^https:\/\//);
  await expectLocked(
    page.getByTestId("vat-validate-lock"),
    "Pro",
    "Passez à Pro pour valider et déposer votre décompte.",
  );
  await expect(page.getByTestId("vat-validate")).toBeDisabled();
  await expectLocked(page.getByTestId("vat-review-lock"), "Pro", "Fonction Pro.");
  await expect(page.getByTestId("vat-review-run")).toBeDisabled();
  expect(await traitNetIssues(page)).toEqual([]);

  // Banque, justificatifs, capture, tickets, assistant : ouverts, avec leur compteur.
  await page.goto("/fr/app/accounting/bank");
  await expect(page.getByTestId("plan-notice")).toHaveCount(0);
  await expect(page.getByTestId("bank-quota")).toContainText(/0 sur 1 ce mois-ci/);
  await expect(page.getByTestId("bank-import")).toBeEnabled();
  await page.goto("/fr/app/accounting/receipts");
  await expect(page.getByTestId("receipts-quota")).toContainText(/0 sur 20 ce mois-ci/);
  await expect(page.getByTestId("receipts-upload")).toBeEnabled();
  await page.goto("/fr/app/accounting/receipts/capture");
  await expect(page.getByTestId("capture-input")).toBeAttached();
  await expect(page.getByTestId("capture-quota")).toContainText(/0 sur 20/);
  await page.goto("/fr/app/expenses");
  await expect(page.getByTestId("scan-ticket-input")).toBeAttached();
  await expect(page.getByTestId("scan-quota")).toContainText(/0 sur 20/);
  await page.goto("/fr/app/assistant");
  await expect(page.getByTestId("assistant-ask")).toBeEnabled();
  await expect(page.getByTestId("assistant-quota")).toContainText(/0 sur 10 ce mois-ci/);

  // Pilote automatique ouvert ; son récapitulatif du lundi grisé.
  await page.goto("/fr/app/accounting/review");
  await expect(page.getByTestId("autopilot-form").getByLabel("Pilote automatique")).toBeEnabled();
  await expectLocked(
    page.getByTestId("autopilot-digest-lock"),
    "Pro",
    "Le récapitulatif du lundi par e-mail fait partie de la formule Pro.",
  );

  // Devises étrangères : options grisées sur les factures et les factures fournisseurs.
  await page.goto("/fr/app/invoices/new");
  await expect(
    page.getByTestId("invoice-form").getByLabel("Devise").locator('option[value="USD"]'),
  ).toBeDisabled();
  await page.goto("/fr/app/accounting/bills/new");
  await expect(
    page.getByTestId("bill-form").getByLabel("Devise").locator('option[value="EUR"]'),
  ).toHaveText("EUR (Pro)");
  await expect(page.getByTestId("bill-form").getByTestId("currency-lock")).toBeVisible();

  // Relances : réglages Pro grisés, relances intelligentes comprises.
  await page.goto("/fr/app/invoices/reminders");
  await expectLocked(
    page.getByTestId("reminder-settings-lock"),
    "Pro",
    "les relances intelligentes font partie de la formule Pro",
  );
  await expect(
    page.getByTestId("reminder-settings-lock").getByTestId("reminder-smart"),
  ).toContainText("Rappel courtois 3 jours avant l'échéance");

  // Factures fournisseurs : les e-factures, lues sans IA, s'importent sans compteur ni verrou.
  await page.goto("/fr/app/accounting/bills");
  await expect(page.getByTestId("einvoice-import")).toBeEnabled();
  await expect(page.getByTestId("accounting-tab-bills").getByTestId("pro-badge")).toHaveCount(0);
  await expect(page.getByText(/Pièces lues par l'IA/)).toHaveCount(0);

  // Facture émise : le panneau « facture récurrente » est là, la première est permise.
  await page.goto("/fr/app/invoices/new");
  await page
    .getByTestId("invoice-form")
    .getByLabel("Client", { exact: true })
    .selectOption({ label: "Client SA" });
  await page.getByTestId("invoice-line-0").getByLabel("Article").selectOption({ label: "Conseil" });
  await page.getByTestId("invoice-save").click();
  await page.getByTestId("document-issue").click();
  await expect(page.getByText(/Facture émise/)).toBeVisible();
  const panel = page.getByTestId("recurring-panel");
  await expect(panel).toBeVisible();
  await panel.locator("summary").click();
  await expect(panel.getByTestId("recurring-create")).toBeEnabled();
  await expect(panel.getByTestId("recurring-panel-quota")).toContainText(/0 sur 1/);
  await panel.getByTestId("recurring-create").click();
  await page.waitForURL("**/fr/app/invoices/recurring?created=1");
  await expect(page.getByTestId("recurring-quota")).toContainText(/1 sur 1/);
  // L'allocation est utilisée : sur la même facture, le panneau est maintenant grisé.
  await page.getByTestId("recurring-row").getByRole("link").first().click();
  await expectLocked(
    page.getByTestId("recurring-panel-lock"),
    "Pro",
    "La formule gratuite compte une facture récurrente active.",
  );
  await expect(page.getByTestId("recurring-create")).toBeDisabled();
  expect(await traitNetIssues(page)).toEqual([]);

  // Réglages : API et webhooks marqués Pro+, fiduciaire marquée Pro.
  await page.goto("/fr/app/settings/api");
  await expect(page.getByTestId("settings-tab-api").getByTestId("pro-badge")).toHaveText("Pro+");
  await expectLocked(page.getByTestId("api-plan"), "Pro+", "formule Pro+");
  await expect(page.getByTestId("api-key-create")).toBeDisabled();
  await expectLocked(page.getByTestId("webhooks-plan"), "Pro+", "formule Pro+");
  await expect(page.getByTestId("webhook-create")).toBeDisabled();
  await page.goto("/fr/app/settings/team");
  await expectLocked(page.getByTestId("fiduciary-lock"), "Pro", "formules Pro et Pro+");
  await expect(page.getByTestId("fiduciary-invite")).toBeDisabled();
  // Places : 1 en formule gratuite ; la marque Pro et le lien disent qu'il y en a davantage.
  const seats = page.getByTestId("seats-lock");
  await expect(seats.getByTestId("pro-badge")).toHaveText("Pro");
  await expect(seats).toContainText("Pro compte 2 places et Pro+ en compte 5.");
  await expect(seats.getByRole("link", { name: "Passer à Pro" })).toHaveAttribute(
    "href",
    /^https:\/\//,
  );
  expect(await traitNetIssues(page)).toEqual([]);
});

test("formule gratuite : l'import du mois utilisé, la banque se grise et le serveur refuse la suite", async ({
  page,
}) => {
  await freeCompany(page, "quota");
  await setupBilling(page);
  await chartAndYear(page);
  const today = new Date().toISOString().slice(0, 10);
  const statement = (id: string) => ({
    name: `releve-${id}.xml`,
    mimeType: "application/xml",
    buffer: Buffer.from(
      camt053("CH9300762011623852957", [
        { id, date: today, amount: "5.00", credit: false, party: "Banque", text: "Frais" },
      ]),
    ),
  });

  await page.goto("/fr/app/accounting/bank");
  await expect(page.getByTestId("bank-quota")).toContainText(/0 sur 1/);
  await page.getByLabel("Relevé bancaire (camt.053)").setInputFiles(statement(`A${Date.now()}`));
  await page.getByTestId("bank-import").click();
  await expect(page.getByText(/1 mouvement importé/)).toBeVisible();

  // Allocation utilisée : la commande reste visible, grisée, avec la marque Pro et l'explication.
  const lock = page.getByTestId("bank-import-lock");
  await expectLocked(lock, "Pro", "Votre relevé gratuit de ce mois est importé.");
  await expect(page.getByTestId("bank-import")).toBeDisabled();
  await expect(page.getByTestId("bank-quota")).toContainText(/1 sur 1/);
  await expect(page.getByTestId("accounting-tab-bank").getByTestId("pro-badge")).toHaveText("Pro");
  expect(await traitNetIssues(page)).toEqual([]);
  await page.goto("/fr/app");
  await expect(page.getByTestId("quota-bankImports").getByTestId("pro-badge")).toHaveText("Pro");

  // Demande forgée : le formulaire réactivé dans la page envoie quand même ; le serveur refuse.
  await page.goto("/fr/app/accounting/bank");
  const before = await page.getByTestId("bank-review").locator(":scope > li").count();
  await lock.locator("fieldset").evaluate(unlock);
  await page.getByLabel("Relevé bancaire (camt.053)").setInputFiles(statement(`B${Date.now()}`));
  await page.getByTestId("bank-import").click();
  await page.waitForURL(/error=quota/);
  await expect(
    page.getByRole("alert").filter({ hasText: "Votre relevé gratuit de ce mois est importé." }),
  ).toBeVisible();
  await expect(page.getByTestId("bank-review").locator(":scope > li")).toHaveCount(before);
});

test("formule gratuite : dix questions à l'assistant, puis la boîte grisée et la onzième refusée", async ({
  page,
}) => {
  await freeCompany(page, "assistant");
  await page.goto("/fr/app/assistant");
  const box = page.getByTestId("assistant-form");
  for (let i = 1; i <= 10; i++) {
    await box.getByLabel("Votre question").fill(`Qui me doit de l'argent ? (${i})`);
    await page.getByTestId("assistant-ask").click();
    await expect(page.getByTestId("assistant-quota")).toContainText(
      new RegExp(`${i} sur 10 ce mois-ci`),
    );
  }
  const lock = page.getByTestId("assistant-lock");
  await expectLocked(lock, "Pro", "Vos 10 questions gratuites de ce mois sont posées.");
  await expect(page.getByTestId("assistant-ask")).toBeDisabled();
  expect(await traitNetIssues(page)).toEqual([]);

  // Demande forgée : la boîte réactivée envoie la onzième question ; le serveur la refuse.
  await lock.locator("fieldset").evaluate(unlock);
  await page.getByLabel("Votre question").fill("Et une onzième ?");
  await page.getByTestId("assistant-ask").click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Les questions gratuites de ce mois sont posées." }),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("assistant-quota")).toContainText(/10 sur 10 ce mois-ci/);
  await page.goto("/fr/app");
  await expect(page.getByTestId("dashboard-assistant").getByTestId("pro-badge")).toHaveText("Pro");
});

test("tarifs et FAQ : les allocations gratuites décidées sont annoncées", async ({ page }) => {
  await page.goto("/fr/pricing");
  const free = page.getByTestId("plan-free");
  await expect(free).toContainText(
    "20 pièces lues par l'IA chaque mois (tickets, justificatifs), e-factures reçues sans limite",
  );
  await expect(free).toContainText("10 questions par mois");
  await expect(free).toContainText("Première relance à la main, 5 par mois");
  await expect(free).toContainText("1 facture récurrente active");
  await expect(free).toContainText("1 relevé bancaire par mois, pilote automatique compris");
  await expect(free).not.toContainText("Bientôt");
  await expect(page.getByTestId("plan-pro")).toContainText("50 pièces lues par l'IA chaque mois");
  await expect(page.getByTestId("plan-proPlus")).toContainText(
    "300 pièces lues par l'IA chaque mois",
  );
  await expect(page.getByTestId("plan-pro")).toContainText(
    "Factures récurrentes sans limite, multidevise",
  );
  // FAQ : la réponse elle-même porte les allocations décidées, en français et en allemand.
  await page.goto("/fr/faq");
  await page.getByText("Que comprend la formule gratuite\u202f?").click();
  await expect(
    page.getByText(
      "Chaque mois\u202f: 10 factures, 20 pièces lues par l'IA, 10 questions à l'assistant, 5 relances de premier niveau et 1 relevé bancaire avec le pilote automatique.",
      { exact: false },
    ),
  ).toBeVisible();
  await expect(
    page.getByText("Les fonctions Pro et Pro+ restent visibles", { exact: false }),
  ).toBeVisible();
  await page.goto("/de/faq");
  await page.getByText("Was umfasst das Gratis-Abo?").click();
  await expect(
    page.getByText(
      "Jeden Monat: 10 Rechnungen, 20 von der KI gelesene Belege, 10 Fragen an den Assistenten, 5 Mahnungen der ersten Stufe und 1 Kontoauszug mit Autopilot.",
      { exact: false },
    ),
  ).toBeVisible();
});
