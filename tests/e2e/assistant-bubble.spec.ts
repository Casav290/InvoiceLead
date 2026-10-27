import { expect, type Page, test } from "@playwright/test";
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
