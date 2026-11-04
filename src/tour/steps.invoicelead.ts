import type { TourStep } from "./types";

/**
 * Les étapes de la visite d'InvoiceLead (04.11.2026). Une idée par étape, fidèle aux vraies fonctions ; les rubriques
 * voisines du menu sont groupées (Temps + Frais, Contacts + Articles) pour garder la visite courte. Textes :
 * `app.tour.*` (messages/<langue>.json, variantes de pays par suffixe : `titleIntl`…, src/i18n/country.ts).
 * Cibles : les `data-tour` d'AppNav, d'AppSwitcher et d'UserMenu, et la bulle de l'Assistant IA
 * (`data-testid="assistant-bubble"`, AssistantBubble.tsx).
 */
const nav = (...to: string[]) => to.map((p) => `[data-tour="nav:${p}"]`);
const BUBBLE = '[data-testid="assistant-bubble"]';

export function invoiceLeadSteps({ assistant }: { assistant: boolean }): TourStep[] {
  const steps: TourStep[] = [
    { id: "welcome", title: "tour.welcome.title", body: "tour.welcome.body", art: "map" },
    {
      id: "dashboard",
      target: nav("/app"),
      title: "tour.dashboard.title",
      body: "tour.dashboard.body",
      art: "home",
    },
    {
      id: "quotes",
      target: nav("/app/quotes"),
      title: "tour.quotes.title",
      body: "tour.quotes.body",
      art: "quote",
    },
    {
      id: "invoices",
      target: nav("/app/invoices"),
      title: "tour.invoices.title",
      body: "tour.invoices.body",
      art: "invoice",
    },
    {
      id: "time",
      target: nav("/app/time", "/app/expenses"),
      title: "tour.time.title",
      body: "tour.time.body",
      art: "clock",
    },
    {
      id: "contacts",
      target: nav("/app/contacts", "/app/products"),
      title: "tour.contacts.title",
      body: "tour.contacts.body",
      art: "contacts",
    },
    {
      id: "accounting",
      target: nav("/app/accounting"),
      title: "tour.accounting.title",
      body: "tour.accounting.body",
      art: "ledger",
    },
    {
      id: "settings",
      target: nav("/app/settings/company"),
      title: "tour.settings.title",
      body: "tour.settings.body",
      art: "toggles",
    },
    {
      id: "apps",
      target: '[data-tour="apps"]',
      title: "tour.apps.title",
      body: "tour.apps.body",
      art: "apps",
    },
  ];
  // La bulle n'existe que si l'Assistant IA est branché sur ce serveur (layout de l'espace connecté).
  if (assistant) {
    steps.push({
      id: "assistant",
      target: BUBBLE,
      title: "tour.assistant.title",
      body: "tour.assistant.body",
      art: "chat",
      action: {
        label: "tour.try",
        run: () => document.querySelector<HTMLButtonElement>(BUBBLE)?.click(),
      },
    });
  }
  steps.push({
    id: "replay",
    target: '[data-tour="profile"]',
    title: "tour.replay.title",
    body: "tour.replay.body",
    art: "menu",
  });
  return steps;
}
