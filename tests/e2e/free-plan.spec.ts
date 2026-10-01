import { expect, type Locator, type Page, test } from "@playwright/test";
import { camt053 } from "../support/camt";
import { samplePdf } from "../support/pdf";
import { addContacts, closeDb, setPlanRank, useQuota } from "./db";
import { login, setupBilling, traitNetIssues } from "./helpers";

/**
 * Décision d'Ève (1er octobre 2026) : en formule gratuite, chaque fonction Pro reste visible à sa
 * place, grisée, avec sa marque et un lien de mise à niveau ; de petites allocations gratuites
 * deviennent grisées une fois utilisées ; le serveur refuse ce que l'écran ne permet plus.
 */

/** Entreprise en formule gratuite ; rend son identifiant d'organisation du Compte Lead. */
async function freeCompany(page: Page, tag: string): Promise<string> {
  const run = `${tag}-${Date.now()}`;
  await login(page, "fr", {
    sub: `sub-${run}`,
    email: `${run}@gratuit.test`,
    org: `org-${run}`,
    org_name: "Gratuit Sàrl",
  });
  return `org-${run}`;
}

test.afterAll(() => closeDb());

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

/**
 * Le lien s'atteint à la touche Tab : on part de l'élément atteignable au clavier qui le précède
 * dans la page, et une seule tabulation doit tomber sur lui (un tabindex="-1" le ferait sauter).
 */
async function expectTabReachable(page: Page, link: Locator) {
  const from = await link.evaluate((target) => {
    for (const el of document.querySelectorAll("[data-tab-from]"))
      el.removeAttribute("data-tab-from");
    const candidates = Array.from(
      document.querySelectorAll<HTMLElement>(
        "a[href], button, input, select, textarea, summary, [tabindex]",
      ),
    ).filter(
      (el) =>
        el !== target &&
        !el.matches(":disabled") &&
        el.tabIndex >= 0 &&
        el.getClientRects().length > 0 &&
        getComputedStyle(el).visibility !== "hidden" &&
        Boolean(el.compareDocumentPosition(target) & Node.DOCUMENT_POSITION_FOLLOWING),
    );
    const before = candidates.at(-1);
    before?.setAttribute("data-tab-from", "1");
    return before ? "element" : "start";
  });
  if (from === "element") await page.locator("[data-tab-from]").focus();
  else await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press("Tab");
  await expect(link).toBeFocused();
}

/** Bloc grisé : commandes désactivées, marque, raison, lien atteignable au clavier. */
async function expectLocked(lock: Locator, tier: "Pro" | "Pro+", reason: string | RegExp) {
  await expect(lock).toBeVisible();
  await expect(lock.locator("fieldset").first()).toHaveAttribute("aria-disabled", "true");
  await expect(lock.getByTestId("pro-badge").last()).toHaveText(tier);
  await expect(lock.getByTestId("lock-note")).toContainText(reason);
  const link = lock.getByRole("link", { name: tier === "Pro" ? "Passer à Pro" : "Passer à Pro+" });
  await expect(link).toHaveAttribute("href", /^https:\/\//);
  await expectTabReachable(lock.page(), link);
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
  // Gris de bout en bout : le panneau enveloppé prend le fond du cadre, sans blanc dedans.
  for (const id of ["vat-review-lock", "vat-validate-lock"]) {
    await expect(page.getByTestId(id)).toHaveCSS("background-color", "rgb(242, 240, 238)");
    await expect(page.getByTestId(id).locator("fieldset > *").first()).toHaveCSS(
      "background-color",
      "rgba(0, 0, 0, 0)",
    );
  }
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
  // Sur la facture modèle, le panneau dit qu'elle se répète déjà, sans verrou.
  await page.getByTestId("recurring-row").getByRole("link").first().click();
  await expect(panel).not.toHaveAttribute("open");
  await panel.locator("summary").click();
  await expect(panel.getByTestId("recurring-model")).toContainText("Cette facture se répète déjà.");
  await expect(panel.getByTestId("recurring-panel-lock")).toHaveCount(0);
  await expect(panel.getByTestId("recurring-create")).toHaveCount(0);
  // Sur une autre facture émise, l'allocation utilisée grise le panneau. Il reste fermé, avec la
  // marque Pro sur son titre, et ne repousse pas l'aperçu de la pièce.
  await page.goto("/fr/app/invoices/new");
  await page
    .getByTestId("invoice-form")
    .getByLabel("Client", { exact: true })
    .selectOption({ label: "Client SA" });
  await page.getByTestId("invoice-line-0").getByLabel("Article").selectOption({ label: "Conseil" });
  await page.getByTestId("invoice-save").click();
  await page.getByTestId("document-issue").click();
  await expect(page.getByText(/Facture émise/)).toBeVisible();
  await expect(panel).not.toHaveAttribute("open");
  await expect(panel.locator("summary").getByTestId("pro-badge")).toHaveText("Pro");
  await panel.locator("summary").click();
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
  await expectLocked(lock, "Pro", "Vous avez posé vos 10 questions gratuites de ce mois.");
  await expect(page.getByTestId("assistant-ask")).toBeDisabled();
  expect(await traitNetIssues(page)).toEqual([]);

  // Demande forgée : la boîte réactivée envoie la onzième question ; le serveur la refuse.
  await lock.locator("fieldset").evaluate(unlock);
  await page.getByLabel("Votre question").fill("Et une onzième ?");
  await page.getByTestId("assistant-ask").click();
  await expect(page.getByRole("alert").filter({ hasText: "Question non envoyée." })).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("assistant-quota")).toContainText(/10 sur 10 ce mois-ci/);
  await page.goto("/fr/app");
  await expect(page.getByTestId("dashboard-assistant").getByTestId("pro-badge")).toHaveText("Pro");
});

test("formule gratuite : allocations du mois utilisées, chaque commande grisée avec sa marque et sa phrase", async ({
  page,
}) => {
  const org = await freeCompany(page, "epuise");
  await setupBilling(page);
  // Une facture échue depuis 15 jours : sa première relance est due.
  const issued = new Date(Date.now() - 45 * 86_400_000).toISOString().slice(0, 10);
  await page.goto("/fr/app/invoices/new");
  const invoice = page.getByTestId("invoice-form");
  await invoice.getByLabel("Client", { exact: true }).selectOption({ label: "Client SA" });
  await invoice.getByLabel("Date de facture").fill(issued);
  await invoice.getByLabel("Date de la prestation").fill(issued);
  await page.getByTestId("invoice-line-0").getByLabel("Article").selectOption({ label: "Conseil" });
  await page.getByTestId("invoice-save").click();
  await page.getByTestId("document-issue").click();
  await expect(page.getByText(/Facture émise/)).toBeVisible();
  // Un justificatif au long nom de fournisseur, lu pendant qu'il reste des lectures.
  await page.goto("/fr/app/accounting/receipts");
  await page.getByLabel("Factures ou tickets").setInputFiles({
    name: "papeterie.pdf",
    mimeType: "application/pdf",
    buffer: await samplePdf(["Papeterie Muster und Partner", "Date 2026-09-02", "Total CHF 24.90"]),
  });
  await page.getByTestId("receipts-upload").click();
  await expect(page.getByText("1 justificatif ajouté.")).toBeVisible();

  // Le reste du mois est utilisé : 20 lectures, 5 relances, 50 contacts.
  await useQuota(org, "aiReads", 20);
  await useQuota(org, "reminders", 5);
  await addContacts(org, 49);
  const aiReads = "Vos 20 lectures gratuites de ce mois sont utilisées.";

  await page.goto("/fr/app/expenses");
  await expectLocked(page.getByTestId("scan-ticket-lock"), "Pro", aiReads);
  await expect(page.getByTestId("scan-quota")).toContainText(/20 sur 20/);
  // Grisé comme les autres verrous, avec la saisie à la main en solution de repli.
  await expect(page.getByTestId("scan-ticket-lock")).toHaveCSS(
    "background-color",
    "rgb(242, 240, 238)",
  );
  await expect(page.getByTestId("scan-ticket-disabled")).toHaveCSS(
    "background-color",
    "rgb(242, 240, 238)",
  );
  await expect(page.getByTestId("scan-ticket-lock")).toContainText(
    "Vous pouvez saisir la dépense à la main ci-dessous.",
  );
  await expect(page.getByTestId("scan-ticket-lock")).not.toContainText("appareil photo");

  await page.goto("/fr/app/accounting/receipts");
  await expectLocked(page.getByTestId("receipts-lock"), "Pro", aiReads);
  await expect(page.getByTestId("receipts-upload")).toBeDisabled();
  await expect(page.getByTestId("receipt-read")).toBeDisabled();
  // Onglet des justificatifs : grisé (fond gris) avec la marque ; un onglet ouvert ne l'est pas.
  const billsTab = page.getByTestId("accounting-tab-bills");
  await expect(page.getByTestId("accounting-tab-receipts").getByTestId("pro-badge")).toHaveText(
    "Pro",
  );
  await expect(page.getByTestId("accounting-tab-vat")).toHaveCSS(
    "background-color",
    "rgb(242, 240, 238)",
  );
  await expect(billsTab).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  expect(await traitNetIssues(page)).toEqual([]);

  await page.goto("/fr/app/accounting/receipts/capture");
  await expectLocked(page.getByTestId("capture-lock"), "Pro", aiReads);

  // Relances : la phrase du mois, la marque, le lien ; la relance due reste visible, grisée.
  await page.goto("/fr/app/invoices/reminders");
  const reminders = page.getByTestId("reminders-lock");
  await expect(reminders).toContainText("Vos 5 relances gratuites de ce mois sont envoyées.");
  await expect(reminders.getByTestId("pro-badge")).toHaveText("Pro");
  const upgrade = reminders.getByRole("link", { name: "Passer à Pro" });
  await expect(upgrade).toHaveAttribute("href", /^https:\/\//);
  await expectTabReachable(page, upgrade);
  const mailed = page
    .getByTestId("reminder-row")
    .getByRole("button", { name: "Noter comme envoyée (courrier)" });
  await expect(mailed).toBeDisabled();
  await expect(mailed).toHaveAttribute("aria-describedby", "reminders-lock-reason");
  // Grisé lisible : gris sur gris, sans transparence.
  await expect(mailed).toHaveCSS("color", "rgb(103, 98, 92)");
  await expect(mailed).toHaveCSS("opacity", "1");

  // Contacts : 50 sur 50. La liste grise « Nouveau contact », l'adresse directe aussi.
  await page.goto("/fr/app/contacts");
  const newContact = page.getByRole("button", { name: "Nouveau contact" });
  await expect(newContact).toBeDisabled();
  await expect(newContact).toHaveCSS("background-color", "rgb(242, 240, 238)");
  await page.goto("/fr/app/contacts/new");
  await expectLocked(
    page.getByTestId("contact-new-lock"),
    "Pro",
    "La formule gratuite compte 50 contacts au plus.",
  );
  await expect(page.getByTestId("contact-save")).toBeDisabled();
  // La raison vient en tête, au premier écran, avant le long formulaire grisé.
  const reason = await page.getByTestId("contact-new-lock").getByTestId("lock-note").boundingBox();
  const fields = await page
    .getByTestId("contact-new-lock")
    .locator("fieldset")
    .first()
    .boundingBox();
  expect(reason && fields && reason.y < fields.y).toBe(true);
  expect((reason?.y ?? Number.POSITIVE_INFINITY) + (reason?.height ?? 0)).toBeLessThan(
    page.viewportSize()?.height ?? 0,
  );

  // Tableau de bord : chaque allocation utilisée porte la marque, la ligne des contacts aussi.
  await page.goto("/fr/app");
  await expect(page.getByTestId("plan-usage")).toContainText("50 contacts sur 50");
  await expect(page.getByTestId("plan-usage").getByTestId("pro-badge")).toHaveText("Pro");
  for (const id of ["quota-aiReads", "quota-reminders"])
    await expect(page.getByTestId(id).getByTestId("pro-badge")).toHaveText("Pro");
  expect(await traitNetIssues(page)).toEqual([]);

  // Téléphone (390 px), en allemand : le nom du fournisseur garde sa largeur, l'encart TVA aussi.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/de/app/accounting/receipts");
  const supplier = page.getByTestId("receipt-supplier");
  await expect(supplier).toHaveText("Papeterie Muster und Partner");
  expect((await supplier.boundingBox())?.width ?? 0).toBeGreaterThan(150);
  expect(await traitNetIssues(page)).toEqual([]);
  await page.goto("/de/app/accounting/vat");
  const notice = page.getByTestId("plan-notice").locator("p");
  expect((await notice.boundingBox())?.width ?? 0).toBeGreaterThan(200);
  expect(await traitNetIssues(page)).toEqual([]);
});

test("formule gratuite : une e-facture en EUR s'importe, son approbation reste grisée et le serveur la refuse", async ({
  page,
}) => {
  await freeCompany(page, "devise");
  const today = new Date().toISOString().slice(0, 10);
  const ubl = `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:ID>R-77</cbc:ID>
  <cbc:IssueDate>${today}</cbc:IssueDate>
  <cbc:DocumentCurrencyCode>EUR</cbc:DocumentCurrencyCode>
  <cac:AccountingSupplierParty><cac:Party>
    <cac:PostalAddress><cbc:StreetName>Hauptstrasse 1</cbc:StreetName><cbc:CityName>Berlin</cbc:CityName><cbc:PostalZone>10115</cbc:PostalZone><cac:Country><cbc:IdentificationCode>DE</cbc:IdentificationCode></cac:Country></cac:PostalAddress>
    <cac:PartyLegalEntity><cbc:RegistrationName>Lieferant Berlin GmbH</cbc:RegistrationName></cac:PartyLegalEntity>
  </cac:Party></cac:AccountingSupplierParty>
  <cac:LegalMonetaryTotal><cbc:PayableAmount currencyID="EUR">119.00</cbc:PayableAmount></cac:LegalMonetaryTotal>
  <cac:InvoiceLine><cbc:ID>1</cbc:ID><cac:Item><cbc:Name>Papier</cbc:Name></cac:Item></cac:InvoiceLine>
</Invoice>`;
  await page.goto("/fr/app/accounting/bills");
  await page.getByLabel(/E-factures reçues/).setInputFiles({
    name: "rechnung.xml",
    mimeType: "application/xml",
    buffer: Buffer.from(ubl),
  });
  await page.getByTestId("einvoice-import").click();
  await expect(page.getByText("1 facture importée.")).toBeVisible();
  await page
    .getByTestId("bills-draft")
    .getByRole("link", { name: /Lieferant Berlin GmbH/ })
    .click();
  const lock = page.getByTestId("bill-approve-lock");
  await expectLocked(lock, "Pro", "Facture en EUR");
  await expect(page.getByTestId("bill-approve")).toBeDisabled();
  expect(await traitNetIssues(page)).toEqual([]);

  // Demande forgée : le bouton réactivé envoie quand même ; le serveur refuse, rien n'est approuvé.
  await lock.locator("fieldset").evaluate(unlock);
  await page.getByTestId("bill-approve").click();
  await page.waitForURL(/error=plan/);
  await expect(page.getByRole("alert").filter({ hasText: "Facture en EUR" })).toBeVisible();
  await expect(page.getByTestId("bill-status")).toContainText("EUR 119.00");
  await expect(page.getByTestId("bill-approve-lock")).toBeVisible();
});

test("retour à la formule gratuite : un brouillon en EUR reste modifiable, son émission est grisée et le serveur la refuse", async ({
  page,
}) => {
  const run = `fxdraft-${Date.now()}`;
  await login(page, "fr", {
    sub: `sub-${run}`,
    email: `${run}@atelier.test`,
    org: `org-${run}`,
    org_name: "Devises Sàrl",
    plan: "pro",
  });
  await setupBilling(page);
  // En Pro : un brouillon de facture en EUR.
  await page.goto("/fr/app/invoices/new");
  const form = page.getByTestId("invoice-form");
  await form.getByLabel("Client", { exact: true }).selectOption({ label: "Client SA" });
  await form.getByLabel("Devise").selectOption("EUR");
  await page.getByTestId("invoice-line-0").getByLabel("Article").selectOption({ label: "Conseil" });
  await page.getByTestId("invoice-save").click();
  await expect(page).toHaveURL(/\/fr\/app\/invoices\/[0-9a-f-]+\?saved=1$/);

  // Formule résiliée : le brouillon reste là, « Émettre » est grisé avec la marque Pro.
  await setPlanRank(`org-${run}`, 0);
  await page.reload();
  const lock = page.getByTestId("issue-lock");
  await expectLocked(lock, "Pro", "Ce document est en EUR.");
  await expect(lock).toContainText("Repassez-le en CHF pour l'émettre maintenant.");
  await expect(page.getByTestId("document-issue")).toBeDisabled();
  expect(await traitNetIssues(page)).toEqual([]);

  // Demande forgée : le bouton réactivé dans la page envoie quand même ; le serveur refuse.
  await lock.locator("fieldset").evaluate(unlock);
  await page.getByTestId("document-issue").click();
  await page.waitForURL(/error=plan/);
  await expect(page.getByRole("alert").filter({ hasText: "Document en EUR" })).toBeVisible();
  await expect(page.getByTestId("document-status")).toHaveText("Brouillon");
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
  await expect(free).toContainText(
    "1 relevé bancaire par mois (un compte, un mois au plus), pilote automatique compris",
  );
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
      "Chaque mois\u202f: 10 factures, 20 pièces lues par l'IA, 10 questions à l'assistant, 5 relances de premier niveau et 1 relevé bancaire (un compte, un mois au plus) avec le pilote automatique.",
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
      "Jeden Monat: 10 Rechnungen, 20 von der KI gelesene Belege, 10 Fragen an den Assistenten, 5 Mahnungen der ersten Stufe und 1 Kontoauszug (ein Konto, höchstens ein Monat) mit Autopilot.",
      { exact: false },
    ),
  ).toBeVisible();
});
