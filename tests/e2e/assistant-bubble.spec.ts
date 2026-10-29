import { expect, type Page, test } from "@playwright/test";
import { appIds, assistantUsageRows, closeDb, spendAssistant } from "./db";
import { login, traitNetIssues } from "./helpers";

/**
 * Bulle « Assistant IA » dans le navigateur : présente sur les pages de l'application, absente des
 * pages publiques, accessible au clavier, carte « À confirmer » qui n'écrit qu'au clic. Les réponses
 * du modèle sont simulées (page.route) : aucun appel à l'API d'Anthropic pendant les tests.
 */

const SUMMARY = {
  action: "create_invoice_draft",
  fields: [
    { key: "documentKind", value: "invoice" },
    { key: "customer", value: "Kunde AG" },
    { key: "issueDate", value: "2026-10-24" },
    { key: "status", value: "draft" },
  ],
  lines: [
    {
      description: "Beratung",
      quantity: "2",
      unit: "hour",
      unitPriceCents: 15000,
      netCents: 30000,
    },
  ],
  totals: { currency: "CHF", netCents: 30000, vatCents: 0, totalCents: 30000 },
};

async function fakeAssistant(page: Page, sent: unknown[]) {
  await page.route("**/api/assistant", async (route) => {
    const body = route.request().postDataJSON() as { messages: unknown[] };
    sent.push(body);
    await route.fulfill({
      json: {
        messages: [...body.messages, { role: "assistant", content: "Bereit zur Bestätigung." }],
        reply: "Der Entwurf ist **bereit**. Bitte bestätigen. <b>kein HTML</b>",
        actions: [{ type: "confirm", token: "signed.token", summary: SUMMARY }],
        notice: null,
      },
    });
  });
}

test.afterAll(() => closeDb());

test("la bulle n'apparaît pas sur les pages publiques", async ({ page }) => {
  for (const path of ["/de", "/fr/pricing", "/en/faq", "/fr/login?erreur=lead"]) {
    await page.goto(path);
    await expect(page.getByTestId("assistant-bubble")).toHaveCount(0);
  }
});

test("/api/assistant refuse une requête sans session (401)", async ({ request }) => {
  const res = await request.post("/api/assistant", {
    data: { messages: [{ role: "user", content: "Hallo" }] },
  });
  expect(res.status()).toBe(401);
  const confirm = await request.post("/api/assistant/confirm", { data: { token: "x.y" } });
  expect(confirm.status()).toBe(401);
});

test("bulle : ouverture au clavier, suggestions, Échap et retour du focus", async ({ page }) => {
  await login(page, "de");
  const bubble = page.getByTestId("assistant-bubble");
  await expect(bubble).toBeVisible();
  await expect(bubble).toHaveAttribute("aria-label", "KI-Assistent öffnen");
  await bubble.focus();
  await page.keyboard.press("Enter");
  const panel = page.getByTestId("assistant-panel");
  await expect(panel).toBeVisible();
  await expect(panel.getByRole("heading", { name: "KI-Assistent" })).toBeVisible();
  await expect(page.getByTestId("assistant-input")).toBeFocused();
  await expect(page.getByTestId("assistant-suggestion-overdue")).toBeVisible();
  await expect(page.getByTestId("assistant-suggestion-draft")).toBeVisible();
  await expect(page.getByTestId("assistant-suggestion-collected")).toBeVisible();
  const box = await panel.boundingBox();
  expect(box?.width).toBeLessThanOrEqual(400);
  expect(box?.height).toBeLessThanOrEqual(600);
  expect(await traitNetIssues(page)).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  await expect(page.getByTestId("assistant-bubble")).toBeFocused();
  expect(await traitNetIssues(page)).toEqual([]);
});

test("bulle : carte « À confirmer », Annuler n'écrit rien, Confirmer appelle la confirmation", async ({
  page,
}) => {
  await login(page, "fr");
  const sent: unknown[] = [];
  await fakeAssistant(page, sent);
  const confirmations: unknown[] = [];
  await page.route("**/api/assistant/confirm", async (route) => {
    confirmations.push(route.request().postDataJSON());
    await route.fulfill({
      json: {
        ok: true,
        result: {
          action: "create_invoice_draft",
          id: "0b8f8c1e-7a0e-4a43-9a31-3b1b3a7b1c22",
          path: "/app/invoices",
          label: "Kunde AG",
        },
      },
    });
  });
  await page.getByTestId("assistant-bubble").click();
  const input = page.getByTestId("assistant-input");
  await input.fill("Prépare une facture");
  await input.press("Shift+Enter");
  await input.pressSequentially("pour Kunde AG");
  await expect(input).toHaveValue("Prépare une facture\npour Kunde AG");
  await input.press("Enter");
  await expect(page.getByTestId("assistant-reply")).toContainText("Der Entwurf ist bereit");
  // Le gras du modèle devient <strong> ; le HTML reste du texte.
  await expect(page.getByTestId("assistant-reply").first().locator("strong")).toHaveText("bereit");
  await expect(page.getByTestId("assistant-reply").first()).toContainText("<b>kein HTML</b>");
  const cards = page.getByTestId("assistant-confirm-card");
  await expect(cards).toHaveCount(1);
  await expect(cards.first()).toContainText("À confirmer");
  await expect(cards.first()).toContainText("Kunde AG");
  await expect(cards.first()).toContainText("CHF 300.00");
  await expect(cards.first()).toContainText("Brouillon, ni émis ni envoyé");

  await page.getByTestId("assistant-cancel").click();
  await expect(cards.first()).toHaveAttribute("data-state", "cancelled");
  expect(confirmations).toEqual([]);

  // Deuxième demande : la note « annulé » part avec la question suivante, puis on confirme.
  await input.fill("Recommence");
  await input.press("Enter");
  await expect(cards).toHaveCount(2);
  const second = sent[1] as { messages: { role: string; content: unknown }[] };
  expect(JSON.stringify(second.messages.at(-1))).toContain("Cancel");
  await page.getByTestId("assistant-confirm").click();
  await expect(cards.nth(1)).toHaveAttribute("data-state", "done");
  expect(confirmations).toEqual([{ token: "signed.token", locale: "fr" }]);
  await expect(page.getByTestId("assistant-done")).toContainText("Kunde AG");

  // Le fil tient dans l'onglet (sessionStorage) : il revient après un rechargement.
  await page.reload();
  await page.getByTestId("assistant-bubble").click();
  await expect(page.getByTestId("assistant-confirm-card")).toHaveCount(2);
  await page.getByTestId("assistant-new").click();
  await expect(page.getByTestId("assistant-confirm-card")).toHaveCount(0);
  await expect(page.getByTestId("assistant-suggestion-overdue")).toBeVisible();
});

test("bulle : carte d'un lot groupée et plafonnée, puis la page du résultat s'ouvre", async ({
  page,
}) => {
  await login(page, "fr");
  const contacts = Array.from({ length: 7 }, (_, i) => ({
    action: "create_contact",
    label: `Client ${i + 1} SA`,
    detail: "company",
  }));
  await page.route("**/api/assistant", (route) => {
    const body = route.request().postDataJSON() as { messages: unknown[] };
    return route.fulfill({
      json: {
        messages: [...body.messages, { role: "assistant", content: "Prêt." }],
        reply: "Les huit changements sont prêts à confirmer.",
        actions: [
          {
            type: "confirm",
            token: "batch.token",
            summary: {
              action: "batch",
              fields: [],
              count: 8,
              groups: [
                { action: "create_contact", count: 7, items: contacts.slice(0, 5) },
                {
                  action: "create_invoice_draft",
                  count: 1,
                  items: [
                    {
                      action: "create_invoice_draft",
                      label: "Client 1 SA",
                      detail: "quote",
                      amountCents: 374000,
                      currency: "CHF",
                      lines: [
                        {
                          description: "Création site vitrine",
                          quantity: "1",
                          unit: "flat",
                          unitPriceCents: 350000,
                          netCents: 350000,
                        },
                        {
                          description: "Hébergement 1 an",
                          quantity: "1",
                          unit: "flat",
                          unitPriceCents: 24000,
                          netCents: 24000,
                        },
                      ],
                      totals: {
                        currency: "CHF",
                        netCents: 374000,
                        vatCents: 0,
                        totalCents: 374000,
                      },
                    },
                  ],
                },
              ],
            },
          },
        ],
        notice: null,
      },
    });
  });
  const confirmations: unknown[] = [];
  await page.route("**/api/assistant/confirm", async (route) => {
    confirmations.push(route.request().postDataJSON());
    await route.fulfill({
      json: {
        ok: true,
        result: { action: "batch", id: "x", path: "/app/contacts", label: "8", items: [] },
      },
    });
  });
  await page.getByTestId("assistant-bubble").click();
  await page.getByTestId("assistant-input").fill("Crée ces clients et le devis");
  await page.getByTestId("assistant-input").press("Enter");
  const card = page.getByTestId("assistant-confirm-card");
  await expect(card).toHaveCount(1);
  await expect(card).toContainText("8 changements");
  await expect(card).toContainText("Nouveau contact (7)");
  await expect(card).toContainText("Client 5 SA");
  await expect(card).not.toContainText("Client 6 SA");
  await expect(card).toContainText("+ 2 autres");
  await expect(card).toContainText("Devis · Client 1 SA");
  await expect(card).toContainText("Création site vitrine");
  await expect(card).toContainText("CHF 3'740.00");
  expect(await traitNetIssues(page)).toEqual([]);
  await page.getByTestId("assistant-confirm").click();
  await expect(card).toHaveAttribute("data-state", "done");
  expect(confirmations).toEqual([{ token: "batch.token", locale: "fr" }]);
  // La page qui montre le résultat s'ouvre ; la bulle reste ouverte et dit ce qui a été enregistré.
  await page.waitForURL("**/fr/app/contacts");
  await expect(page.getByTestId("assistant-done")).toContainText(
    "Nouveau contact (7), Nouveau brouillon (1)",
  );
});

test("bulle : une modification se lit « avant → après »", async ({ page }) => {
  await login(page, "fr");
  await page.route("**/api/assistant", (route) => {
    const body = route.request().postDataJSON() as { messages: unknown[] };
    return route.fulfill({
      json: {
        messages: [...body.messages, { role: "assistant", content: "Prêt." }],
        reply: "La modification est prête.",
        actions: [
          {
            type: "confirm",
            token: "update.token",
            summary: {
              action: "update_product",
              fields: [
                { key: "product", value: "Maintenance" },
                {
                  key: "unitPrice",
                  value: "9550",
                  before: "9000",
                  format: "money",
                  currency: "CHF",
                },
                { key: "unit", value: "month", before: "flat", format: "enum" },
              ],
            },
          },
        ],
        notice: null,
      },
    });
  });
  await page.getByTestId("assistant-bubble").click();
  await page.getByTestId("assistant-input").fill("Passe la maintenance à 95.50 par mois");
  await page.getByTestId("assistant-input").press("Enter");
  const card = page.getByTestId("assistant-confirm-card");
  await expect(card).toContainText("Modifier l'article");
  await expect(card).toContainText("Prix unitaire HT");
  await expect(card).toContainText("CHF 90.00");
  await expect(card).toContainText("CHF 95.50");
  await expect(card).toContainText("Forfait");
  await expect(card).toContainText("Mois");
  await expect(card.locator(".line-through").first()).toHaveText("CHF 90.00");
  expect(await traitNetIssues(page)).toEqual([]);
});

test("carte d'un lot : chaque ligne montre ce qu'elle écrit (« avant → après », IBAN, référence de paiement, devise d'avant), chaque avertissement sous ce qu'il concerne ; données changées depuis la carte → refus 409 « stale »", async ({
  page,
}) => {
  await login(page, "fr");
  // Ce que rend batchSummary (src/server/ai-assistant/operations.ts) pour trois modifications et
  // l'émission d'une facture et d'un devis (remarques par groupe et par opération).
  await page.route(
    "**/api/assistant",
    reply("Les cinq changements sont prêts.", [
      {
        type: "confirm",
        token: "batch.token",
        summary: {
          action: "batch",
          fields: [],
          count: 5,
          groups: [
            {
              action: "update_contact",
              count: 1,
              items: [
                {
                  action: "update_contact",
                  label: "Client SA",
                  fields: [
                    { key: "contact", value: "Client SA" },
                    { key: "email", value: "compta@client.example", before: "info@client.example" },
                    { key: "notes", value: "Rappeler en janvier", before: "" },
                  ],
                },
              ],
            },
            {
              action: "update_company_settings",
              count: 1,
              items: [
                {
                  action: "update_company_settings",
                  label: "Atelier SA",
                  fields: [
                    {
                      key: "company.iban",
                      value: "CH5604835012345678009",
                      before: "CH9300762011623852957",
                    },
                    { key: "company.currency", value: "EUR", before: "CHF" },
                  ],
                  notes: ["checkBankDetails"],
                },
              ],
            },
            {
              action: "issue_document",
              count: 2,
              notes: ["issueFinal"],
              items: [
                {
                  action: "issue_document",
                  label: "Brouillon facture · Client SA",
                  notes: ["autoReminders"],
                },
                {
                  action: "issue_document",
                  label: "Brouillon devis · Client SA",
                  notes: ["nothingSent"],
                },
              ],
            },
            {
              action: "update_supplier_bill",
              count: 1,
              items: [
                {
                  action: "update_supplier_bill",
                  label: "Imprimerie SA",
                  fields: [
                    {
                      key: "total",
                      value: "54000",
                      before: "54000",
                      format: "money",
                      currency: "EUR",
                      beforeCurrency: "CHF",
                    },
                    { key: "supplierCountry", value: "DE", before: "CH" },
                    { key: "paymentReference", value: "RF18539007547034", before: "" },
                  ],
                },
              ],
            },
          ],
        },
      },
    ]),
  );
  const confirmations: unknown[] = [];
  await page.route("**/api/assistant/confirm", (route) => {
    confirmations.push(route.request().postDataJSON());
    return route.fulfill({ status: 409, json: { error: "stale" } });
  });
  await page.getByTestId("assistant-bubble").click();
  await page.getByTestId("assistant-input").fill("Mets à jour ces trois fiches");
  await page.getByTestId("assistant-input").press("Enter");
  const card = page.getByTestId("assistant-confirm-card");
  await expect(card).toContainText("5 changements");
  const fields = card.getByTestId("assistant-batch-field");
  // Le nom répété (« Client SA ») n'est pas une ligne de plus ; chaque champ écrit l'est.
  await expect(fields).toHaveText([
    "info@client.example → devient compta@client.example",
    "(vide) → devient Rappeler en janvier",
    "CH9300762011623852957 → devient CH5604835012345678009",
    "CHF → devient EUR",
    "CHF 540.00 → devient EUR 540.00",
    "Suisse → devient Allemagne",
    "(vide) → devient RF18539007547034",
  ]);
  // Libellés lisibles, jamais une clé brute.
  for (const label of [
    "E-mail",
    "Notes internes",
    "IBAN",
    "Devise",
    "Pays du fournisseur",
    "Référence de paiement",
  ])
    await expect(card.getByText(label, { exact: true })).toBeVisible();
  await expect(card).not.toContainText(/company\.|supplierCountry|paymentReference/);
  // Chaque avertissement est sous ce qu'il concerne (suites du 29.10.2026) : la facture dit que les
  // relances partiront, le devis que rien n'est envoyé, le groupe que le numéro est définitif.
  const itemOf = (label: string) => card.locator("li", { hasText: label });
  await expect(itemOf("Atelier SA").getByTestId("assistant-batch-notes")).toHaveText(
    "Vérifiez les coordonnées bancaires : elles figurent sur vos factures.",
  );
  await expect(itemOf("Brouillon facture").getByTestId("assistant-batch-notes")).toHaveText(
    /^Les relances automatiques de votre entreprise sont activées/,
  );
  await expect(itemOf("Brouillon facture")).not.toContainText("Rien n'est envoyé");
  await expect(itemOf("Brouillon devis").getByTestId("assistant-batch-notes")).toHaveText(
    /^Rien n.est envoyé au client/,
  );
  await expect(itemOf("Brouillon devis")).not.toContainText("relances automatiques");
  await expect(card.getByTestId("assistant-batch-notes").last()).toHaveText(
    /^Le numéro est définitif/,
  );
  expect(await traitNetIssues(page)).toEqual([]);
  await page.getByTestId("assistant-confirm").click();
  await expect(card).toHaveAttribute("data-state", "stale");
  await expect(card.getByTestId("assistant-card-error")).toHaveText(
    "Les données ont changé depuis cette proposition. Rien n'a été enregistré ; redemandez à l'assistant pour voir la proposition à jour.",
  );
  await expect(page.getByTestId("assistant-confirm")).toHaveCount(0);
  expect(confirmations).toEqual([{ token: "batch.token", locale: "fr" }]);
});

test("bulle : erreur et quota affichés clairement dans le fil", async ({ page }) => {
  await login(page, "en");
  let status = 429;
  await page.route("**/api/assistant", (route) =>
    route.fulfill({
      status,
      json: status === 429 ? { error: "quota", scope: "user" } : { error: "unavailable" },
    }),
  );
  await page.getByTestId("assistant-bubble").click();
  await page.getByTestId("assistant-suggestion-collected").click();
  await expect(page.getByTestId("assistant-notice")).toContainText("40 messages in an hour");
  status = 502;
  await page.getByTestId("assistant-input").fill("Again");
  await page.getByTestId("assistant-send").click();
  await expect(page.getByTestId("assistant-notice").nth(1)).toContainText("not responding");
});

test.describe("bulle sur téléphone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("panneau plein écran, rien ne déborde", async ({ page }) => {
    await login(page, "fr");
    await page.getByTestId("assistant-bubble").click();
    const box = await page.getByTestId("assistant-panel").boundingBox();
    expect(box).toMatchObject({ x: 0, y: 0, width: 390, height: 844 });
    expect(await traitNetIssues(page)).toEqual([]);
    await page.getByTestId("assistant-close").click();
    await expect(page.getByTestId("assistant-bubble")).toBeFocused();
  });
});

/*
 * Alignement des bulles des applications Lead (cahier du 28.10.2026, B1–B14) : ce que la personne
 * voit et fait dans le navigateur. Le tableau de docs/ASSISTANT-IA.md renvoie à ces tests ; la porte
 * G7 les relance (scripts/assistant-actions-gates.mjs).
 */

/** Une réponse simulée de /api/assistant : texte, actions, notice. */
function reply(text: string, actions: unknown[] = [], notice: string | null = null) {
  return async (route: import("@playwright/test").Route) => {
    const body = route.request().postDataJSON() as { messages: unknown[] };
    await route.fulfill({
      json: {
        messages: [...body.messages, { role: "assistant", content: text || "…" }],
        reply: text,
        actions,
        notice,
      },
    });
  };
}

/** Texte du fil hors messages de la personne : réponses, lignes « Page ouverte », erreurs, cartes. */
const threadText = (page: Page) =>
  page.getByTestId("assistant-thread").evaluate((el) =>
    Array.from(el.children)
      .filter((c) => !c.matches(".ml-8"))
      .map((c) => (c as HTMLElement).innerText)
      .join("\n"),
  );

/** Fin de page : le contenu le plus bas de <main> et la bulle, une fois défilé jusqu'au bout. */
async function pageBottom(page: Page) {
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForTimeout(200);
  return page.evaluate(() => {
    const fab = document.querySelector('[data-testid="assistant-bubble"]')?.getBoundingClientRect();
    let bottom = 0;
    for (const el of Array.from(document.querySelectorAll("main *"))) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0 && r.bottom > bottom) bottom = r.bottom;
    }
    return {
      bottom,
      fabTop: fab?.top ?? 0,
      atEnd:
        Math.ceil(window.scrollY + window.innerHeight) >= document.documentElement.scrollHeight - 1,
    };
  });
}

test("délai dépassé et fil refusé : chacun son texte ; « Nouvelle conversation » dans le message du fil refusé, pas dans les autres erreurs", async ({
  page,
}) => {
  await login(page, "fr");
  const answers = [
    { status: 504, json: { error: "timeout" } },
    { status: 502, json: { error: "unavailable" } },
    { status: 400, json: { error: "history" } },
  ];
  await page.route("**/api/assistant", (route) => route.fulfill(answers.shift() ?? answers[0]));
  await page.getByTestId("assistant-bubble").click();
  const input = page.getByTestId("assistant-input");
  const notices = page.getByTestId("assistant-notice");
  for (const q of ["Un", "Deux", "Trois"]) {
    await input.fill(q);
    await input.press("Enter");
    await expect(input).toBeEnabled();
  }
  await expect(notices).toHaveCount(3);
  await expect(notices.nth(0)).toContainText("La demande a pris trop de temps.");
  await expect(notices.nth(1)).toContainText("L'assistant ne répond pas pour le moment.");
  await expect(notices.nth(2)).toContainText("Cette conversation ne peut pas continuer.");
  for (const i of [0, 1, 2]) await expect(notices.nth(i)).toHaveAttribute("role", "alert");
  await expect(notices.nth(0).getByTestId("assistant-reset-inline")).toHaveCount(0);
  await expect(notices.nth(1).getByTestId("assistant-reset-inline")).toHaveCount(0);
  const again = notices.nth(2).getByTestId("assistant-reset-inline");
  await expect(again).toHaveText("Nouvelle conversation");
  expect(await traitNetIssues(page)).toEqual([]);
  await again.click();
  await expect(notices).toHaveCount(0);
  await expect(page.getByTestId("assistant-suggestion-overdue")).toBeVisible();
  await expect(input).toBeFocused();
});

test("« Page ouverte : <libellé> » quand la bulle navigue, jamais de chemin brut dans le fil", async ({
  page,
}) => {
  await login(page, "fr");
  await page.route(
    "**/api/assistant",
    reply("J'ouvre l'écran de votre entreprise.", [
      { type: "navigate", path: "/app/settings/company", label: "Réglages › Entreprise" },
    ]),
  );
  await page.getByTestId("assistant-bubble").click();
  await page.getByTestId("assistant-input").fill("Ouvre les réglages de l'entreprise");
  await page.getByTestId("assistant-input").press("Enter");
  await page.waitForURL("**/fr/app/settings/company");
  const opened = page.getByTestId("assistant-navigated");
  await expect(opened).toHaveText("Page ouverte : Réglages › Entreprise");
  expect(await threadText(page)).not.toMatch(/\/app|\/fr\/|#/);
  // La bulle reste ouverte sur la nouvelle page.
  await expect(page.getByTestId("assistant-panel")).toBeVisible();
});

test("rendu dans le navigateur : gras, <br>, titre, tableau en ligne simple, <script> reste du texte", async ({
  page,
}) => {
  await login(page, "fr");
  const dialogs: string[] = [];
  page.on("dialog", (d) => {
    dialogs.push(d.message());
    void d.dismiss();
  });
  await page.route(
    "**/api/assistant",
    reply(
      '## Vos devis\n| Numéro | Client |\n|---|---|\n| OF-1 | Kunde AG |\nTotal : **3 740 CHF**<br>Fin. <script>alert("x")</script>',
    ),
  );
  await page.getByTestId("assistant-bubble").click();
  await page.getByTestId("assistant-input").fill("Mes devis en tableau");
  await page.getByTestId("assistant-input").press("Enter");
  const answer = page.getByTestId("assistant-reply");
  await expect(answer.locator("strong")).toHaveText("3 740 CHF");
  const shown = await answer.innerText();
  expect(shown).toContain("Vos devis\nNuméro · Client\nOF-1 · Kunde AG");
  expect(shown).toContain('Fin. <script>alert("x")</script>');
  expect(shown).not.toMatch(/\|\s*-{3}|<br|\*\*|^#/m);
  await expect(answer.locator("script")).toHaveCount(0);
  expect(dialogs).toEqual([]);
});

test("carte lisible : dates du pays, langue et pays en toutes lettres, montant avec devise, « avant → après » lu « devient », refus distincts", async ({
  page,
}) => {
  await login(page, "fr");
  await page.route(
    "**/api/assistant",
    reply("La modification est prête.", [
      {
        type: "confirm",
        token: "update.token",
        summary: {
          action: "update_contact",
          fields: [
            { key: "contact", value: "Kunde AG" },
            { key: "country", value: "DE", before: "CH" },
            { key: "language", value: "fr", before: "de" },
            { key: "dueDate", value: "2026-11-30", before: "2026-11-15", format: "date" },
            {
              key: "unitPrice",
              value: "9550",
              before: "9000",
              format: "money",
              currency: "CHF",
            },
          ],
        },
      },
    ]),
  );
  let confirmCalls = 0;
  await page.route("**/api/assistant/confirm", (route) => {
    confirmCalls += 1;
    // Premier clic : réseau coupé ; second : la proposition a déjà servi (autre onglet).
    return confirmCalls === 1
      ? route.abort("internetdisconnected")
      : route.fulfill({ status: 403, json: { error: "token_used" } });
  });
  await page.getByTestId("assistant-bubble").click();
  await page.getByTestId("assistant-input").fill("Passe Kunde AG en Allemagne");
  await page.getByTestId("assistant-input").press("Enter");
  const card = page.getByTestId("assistant-confirm-card");
  const fields = card.getByTestId("assistant-field");
  await expect(fields.nth(1)).toHaveText("Suisse → devient Allemagne");
  await expect(fields.nth(2)).toHaveText("allemand → devient français");
  await expect(fields.nth(3)).toHaveText("15.11.2026 → devient 30.11.2026");
  await expect(fields.nth(4)).toHaveText("CHF 90.00 → devient CHF 95.50");
  // La flèche est cachée aux lecteurs d'écran, qui lisent « devient ».
  await expect(fields.nth(1).locator('[aria-hidden="true"]')).toHaveText("→");
  await expect(fields.nth(1).locator(".sr-only")).toHaveText("devient");
  // Jamais un code (« CH », « de ») à la place d'un nom.
  expect((await fields.allInnerTexts()).join("\n")).not.toMatch(/\b(CH|DE|de|fr)\b/);
  await page.getByTestId("assistant-confirm").click();
  const error = card.getByTestId("assistant-card-error");
  await expect(error).toContainText("La connexion a été perdue.");
  await expect(error).toHaveAttribute("role", "alert");
  await expect(card).toHaveAttribute("data-state", "network");
  await page.getByTestId("assistant-confirm").click();
  await expect(card).toHaveAttribute("data-state", "used");
  await expect(error).toHaveText(
    "Cette proposition a déjà été utilisée. Rien n'a été enregistré une seconde fois.",
  );
  await expect(page.getByTestId("assistant-confirm")).toHaveCount(0);
});

test("clavier : focus dans le champ à l'ouverture, Échap ferme d'où que ce soit et rend le focus à la bulle, IME, préfixes masqués, fil aria-live", async ({
  page,
}) => {
  await login(page, "fr");
  let calls = 0;
  await page.route("**/api/assistant", async (route) => {
    calls += 1;
    await reply("Voici la réponse.")(route);
  });
  const bubble = page.getByTestId("assistant-bubble");
  await bubble.click();
  // Sans délai : le focus est déjà dans le champ quand le panneau s'affiche.
  expect(
    await page.evaluate(
      () => document.activeElement?.getAttribute("data-testid") === "assistant-input",
    ),
  ).toBe(true);
  await page.getByTestId("assistant-new").focus();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("assistant-panel")).toHaveCount(0);
  await expect(page.getByTestId("assistant-bubble")).toBeFocused();
  await page.keyboard.press("Enter");
  const input = page.getByTestId("assistant-input");
  await expect(input).toBeFocused();
  await input.fill("Bonjour");
  // Entrée pendant une composition IME (japonais, chinois…) : rien n'est envoyé.
  await input.evaluate((el) =>
    el.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        isComposing: true,
        bubbles: true,
        cancelable: true,
      }),
    ),
  );
  await page.waitForTimeout(300);
  expect(calls).toBe(0);
  await expect(input).toHaveValue("Bonjour");
  await input.press("Enter");
  await expect(page.getByTestId("assistant-reply")).toContainText("Voici la réponse.");
  expect(calls).toBe(1);
  const thread = page.getByTestId("assistant-thread");
  await expect(thread).toHaveAttribute("aria-live", "polite");
  await expect(thread.locator(".ml-8 .sr-only")).toHaveText("Vous: ");
  await expect(page.getByTestId("assistant-reply").locator(".sr-only")).toHaveText(
    "Assistant IA: ",
  );
  // Échap depuis la carte ou le fil : fermé aussi.
  await page.getByTestId("assistant-reply").click();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("assistant-panel")).toHaveCount(0);
  await expect(bubble).toBeFocused();
});

test("mention « peut se tromper » visible sous le champ, liée au champ", async ({ page }) => {
  await login(page, "fr");
  await page.getByTestId("assistant-bubble").click();
  const note = page.getByTestId("assistant-disclaimer");
  await expect(note).toHaveText("L'assistant peut se tromper : vérifiez avant de confirmer.");
  const [noteBox, inputBox] = [
    await note.boundingBox(),
    await page.getByTestId("assistant-input").boundingBox(),
  ];
  expect(noteBox && inputBox && noteBox.y >= inputBox.y + inputBox.height).toBe(true);
  await expect(page.getByTestId("assistant-input")).toHaveAttribute(
    "aria-describedby",
    (await note.getAttribute("id")) ?? "absent",
  );
});

test("fil propre à la personne et à l'entreprise (clé de l'onglet), stockage refusé toléré", async ({
  page,
  browser,
}) => {
  await login(page, "fr");
  await page.route("**/api/assistant", reply("Bien reçu."));
  await page.getByTestId("assistant-bubble").click();
  await page.getByTestId("assistant-input").fill("Bonjour");
  await page.getByTestId("assistant-input").press("Enter");
  await expect(page.getByTestId("assistant-reply")).toContainText("Bien reçu.");
  const ids = await appIds("org-atelier", "ada@atelier.test");
  const keys = await page.evaluate(() =>
    Object.keys(window.sessionStorage).filter((k) => k.startsWith("il-assistant")),
  );
  expect(keys).toEqual([`il-assistant:${ids.org}:${ids.user}`]);

  // Stockage plein ou refusé : la bulle marche quand même, sans erreur.
  const ctx = await browser.newContext({ locale: "fr-CH" });
  await ctx.addInitScript(() => {
    // Seul le fil de la bulle : le reste de la page garde son stockage.
    const mine = (k: string) => String(k).startsWith("il-assistant");
    const { getItem, setItem } = Storage.prototype;
    Storage.prototype.setItem = function (k: string, v: string) {
      if (mine(k)) throw new DOMException("plein", "QuotaExceededError");
      return setItem.call(this, k, v);
    };
    Storage.prototype.getItem = function (k: string) {
      if (mine(k)) throw new DOMException("refusé", "SecurityError");
      return getItem.call(this, k);
    };
  });
  const other = await ctx.newPage();
  const errors: string[] = [];
  other.on("pageerror", (e) => errors.push(e.message));
  await login(other, "fr");
  await other.route("**/api/assistant", reply("Toujours là."));
  await other.getByTestId("assistant-bubble").click();
  await other.getByTestId("assistant-input").fill("Bonjour");
  await other.getByTestId("assistant-input").press("Enter");
  await expect(other.getByTestId("assistant-reply")).toContainText("Toujours là.");
  expect(errors).toEqual([]);
  await ctx.close();
});

test.describe("rien de masqué (téléphone, impression)", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("rien de masqué : à 390 px le bas de la page défile au-dessus de la bulle, champ en 16 px, panneau plein écran jusqu'à 640 px, rien à l'impression", async ({
    page,
  }) => {
    await login(page, "fr");
    for (const path of ["/fr/app/settings/company", "/fr/app"]) {
      await page.goto(path);
      const g = await pageBottom(page);
      expect(g.atEnd, path).toBe(true);
      expect(g.bottom, path).toBeGreaterThan(0);
      expect(g.bottom, `${path} : ${JSON.stringify(g)}`).toBeLessThanOrEqual(g.fabTop - 16);
    }
    await page.getByTestId("assistant-bubble").click();
    const input = page.getByTestId("assistant-input");
    expect(await input.evaluate((el) => getComputedStyle(el).fontSize)).toBe("16px");
    expect(await page.getByTestId("assistant-panel").boundingBox()).toMatchObject({
      x: 0,
      y: 0,
      width: 390,
      height: 844,
    });
    await page.setViewportSize({ width: 640, height: 800 });
    expect(await page.getByTestId("assistant-panel").boundingBox()).toMatchObject({
      x: 0,
      width: 640,
      height: 800,
    });
    await page.setViewportSize({ width: 641, height: 800 });
    expect((await page.getByTestId("assistant-panel").boundingBox())?.width).toBeLessThanOrEqual(
      400,
    );
    expect(await input.evaluate((el) => getComputedStyle(el).fontSize)).toBe("14px");
    await page.emulateMedia({ media: "print" });
    await expect(page.getByTestId("assistant-panel")).toBeHidden();
    await page.getByTestId("assistant-close").evaluate((el) => (el as HTMLElement).click());
    await expect(page.getByTestId("assistant-bubble")).toBeHidden();
    await page.emulateMedia({ media: "screen" });
    await expect(page.getByTestId("assistant-bubble")).toBeVisible();
  });
});

/*
 * Périmètre et limite gratuite (29.10.2026, ~/projets/.unlazy/ia-limites/CAHIER.md, L4–L5) : en
 * formule gratuite, la bulle dit ce qui reste ce mois-ci, puis, budget atteint, le dit avec la date
 * du retour et le lien des formules, champ désactivé ; une formule payante ne voit rien de tout cela.
 */

/** Une entreprise neuve du Compte Lead, rien que pour ce test ; rend son organisation. */
async function newCompany(page: Page, tag: string, plan?: "pro" | "proplus"): Promise<string> {
  const run = `${tag}-${Date.now()}`;
  await login(page, "fr", {
    sub: `sub-${run}`,
    email: `${run}@budget.test`,
    org: `org-${run}`,
    org_name: "Budget Sàrl",
    ...(plan ? { plan } : {}),
  });
  return `org-${run}`;
}

/** « novembre » : le mois qui suit, comme la bulle l'écrit. */
const nextMonth = () => {
  const now = new Date();
  return new Intl.DateTimeFormat("fr", { month: "long", timeZone: "UTC" }).format(
    new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)),
  );
};

test("formule gratuite : compteur « environ N demandes » mis à jour après chaque tour, puis message de fin, lien des formules et champ désactivé", async ({
  page,
}) => {
  await newCompany(page, "compteur");
  await page.getByTestId("assistant-bubble").click();
  const counter = page.getByTestId("assistant-budget");
  await expect(counter).toHaveText(
    "Formule gratuite\u202f: il vous reste environ 10 demandes ce mois-ci.",
  );
  let budget = { left: 3, exhausted: false, resetOn: "2026-11-01", requests: 10 };
  await page.route("**/api/assistant", async (route) => {
    const body = route.request().postDataJSON() as { messages: unknown[] };
    await route.fulfill({
      json: {
        messages: [...body.messages, { role: "assistant", content: "Voici." }],
        reply: "Voici.",
        actions: [],
        notice: null,
        budget,
      },
    });
  });
  const input = page.getByTestId("assistant-input");
  await input.fill("Combien ai-je encaissé ce mois-ci ?");
  await input.press("Enter");
  await expect(counter).toHaveText(
    "Formule gratuite\u202f: il vous reste environ 3 demandes ce mois-ci.",
  );
  budget = { ...budget, left: 1 };
  await input.fill("Et le mois passé ?");
  await input.press("Enter");
  await expect(counter).toHaveText(
    "Formule gratuite\u202f: il vous reste environ 1 demande ce mois-ci.",
  );
  budget = { ...budget, left: 0 };
  await input.fill("Et l'an passé ?");
  await input.press("Enter");
  await expect(counter).toHaveText(
    "Formule gratuite\u202f: il vous reste moins d'une demande ce mois-ci.",
  );
  await expect(input).toBeEnabled();
  // Le tour qui atteint le budget : message de fin, date du retour, lien des formules.
  budget = { ...budget, exhausted: true };
  await input.fill("Une dernière ?");
  await input.press("Enter");
  const limit = page.getByTestId("assistant-free-limit");
  await expect(limit).toContainText(
    "Vous avez utilisé l'assistant IA prévu par la formule gratuite pour ce mois (l'équivalent de 10 demandes). Il revient le 1er novembre.",
  );
  await expect(limit).toContainText("Avec la formule Pro, il n'a pas cette limite.");
  await expect(page.getByTestId("assistant-plans-link")).toHaveText("Voir les formules");
  await expect(page.getByTestId("assistant-plans-link")).toHaveAttribute(
    "href",
    "/fr/app/settings/plan?plan=pro",
  );
  await expect(counter).toHaveCount(0);
  await expect(input).toBeDisabled();
  await expect(page.getByTestId("assistant-send")).toBeDisabled();
  await expect(limit).toBeFocused();
  expect(await traitNetIssues(page)).toEqual([]);
});

test("formule gratuite : budget du mois atteint en base → message dès l'ouverture, champ désactivé, /api/assistant refuse sans appel au modèle ; une formule payante n'est pas limitée", async ({
  page,
}) => {
  const org = await newCompany(page, "budget-atteint");
  await spendAssistant(org, 200_000);
  const rows = await assistantUsageRows(org);
  await page.reload();
  await page.getByTestId("assistant-bubble").click();
  const limit = page.getByTestId("assistant-free-limit");
  await expect(limit).toContainText(`Il revient le 1er ${nextMonth()}.`);
  await expect(limit).toBeFocused();
  await expect(page.getByTestId("assistant-input")).toBeDisabled();
  await expect(page.getByTestId("assistant-suggestion-overdue")).toBeDisabled();
  // Demande forgée depuis la page (même origine, même session) : refusée, aucun appel au modèle.
  const forged = await page.evaluate(async () => {
    const r = await fetch("/api/assistant", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: "Bonjour" }], locale: "fr" }),
    });
    return { status: r.status, body: await r.json() };
  });
  expect(forged.status).toBe(429);
  expect(forged.body).toMatchObject({
    error: "free_limit",
    budget: { left: 0, exhausted: true, requests: 10 },
  });
  expect(await assistantUsageRows(org)).toBe(rows);
  // La confirmation d'une carte reste permise (elle n'appelle pas le modèle) : un jeton illisible est
  // refusé pour lui-même (403), pas pour la limite.
  const confirm = await page.evaluate(async () => {
    const r = await fetch("/api/assistant/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: "x.y" }),
    });
    return { status: r.status, body: await r.json() };
  });
  expect(confirm).toEqual({ status: 403, body: { error: "invalid_token" } });

  // Formule payante, même consommation : ni compteur ni limite (nouvelle connexion, autre entreprise).
  await page.context().clearCookies();
  const pro = await newCompany(page, "budget-pro", "pro");
  await spendAssistant(pro, 5_000_000);
  await page.reload();
  await page.getByTestId("assistant-bubble").click();
  await expect(page.getByTestId("assistant-input")).toBeFocused();
  await expect(page.getByTestId("assistant-budget")).toHaveCount(0);
  await expect(page.getByTestId("assistant-free-limit")).toHaveCount(0);
});
