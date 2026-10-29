/**
 * Écrans que la bulle « Assistant IA » peut ouvrir (chemins sans la langue ; `:id` = un identifiant
 * rendu par un outil) et leur libellé lisible (cahier d'alignement du 28.10.2026, B5) : des clés des
 * messages `app.*`, les titres mêmes des écrans, jointes par « › ». Le serveur s'en sert pour dire au
 * modèle quel écran s'ouvre, la bulle pour la ligne « Page ouverte : <libellé> » ; aucun chemin brut
 * n'est montré. Les écrans d'abonnement, d'équipe ou de clés s'ouvrent aussi : la personne y agit
 * elle-même.
 */
export const ASSISTANT_PAGES = {
  "/app": ["nav.dashboard"],
  "/app/invoices": ["invoices.title"],
  "/app/invoices/new": ["invoices.title", "invoices.new"],
  "/app/invoices/:id": ["aiBubble.confirm.values.invoice"],
  "/app/invoices/reminders": ["invoices.title", "reminders.title"],
  "/app/invoices/recurring": ["recurring.title"],
  "/app/quotes": ["quotes.title"],
  "/app/quotes/new": ["quotes.title", "quotes.new"],
  "/app/quotes/:id": ["aiBubble.confirm.values.quote"],
  "/app/credit-notes": ["creditNotes.title"],
  "/app/credit-notes/:id": ["aiBubble.confirm.values.credit_note"],
  "/app/contacts": ["contacts.title"],
  "/app/contacts/new": ["contacts.title", "contacts.new"],
  "/app/contacts/:id": ["contacts.title"],
  "/app/products": ["products.title"],
  "/app/products/new": ["products.title", "products.new"],
  "/app/products/:id": ["products.title"],
  "/app/expenses": ["expenses.title"],
  "/app/time": ["time.title"],
  "/app/time/projects": ["time.title", "time.projects"],
  "/app/time/projects/:id": ["time.title", "time.projects"],
  "/app/accounting": ["accountingHome.title"],
  "/app/accounting/bank": ["accountingHome.title", "bank.title"],
  "/app/accounting/bills": ["accountingHome.title", "bills.title"],
  "/app/accounting/bills/new": ["bills.title", "bills.new"],
  "/app/accounting/bills/:id": ["accountingHome.title", "bills.title"],
  "/app/accounting/receipts": ["accountingHome.title", "receipts.title"],
  "/app/accounting/review": ["accountingHome.title", "review.title"],
  "/app/accounting/reports": ["accountingHome.title", "reports.title"],
  "/app/accounting/vat": ["accountingHome.title", "vat.title"],
  "/app/accounting/cashflow": ["accountingHome.title", "cashflow.title"],
  "/app/assistant": ["assistant.title"],
  "/app/feedback": ["feedback.title"],
  "/app/import/crmlead": ["crmImport.title"],
  "/app/settings/company": ["nav.settings", "settingsNav.company"],
  "/app/settings/team": ["nav.settings", "settingsNav.team"],
  "/app/settings/plan": ["nav.settings", "settingsNav.plan"],
  "/app/settings/payments": ["nav.settings", "settingsNav.payments"],
  "/app/settings/api": ["nav.settings", "settingsNav.api"],
  "/app/settings/accounts": ["nav.settings", "settingsNav.accounts"],
  "/app/settings/fiscal-years": ["nav.settings", "settingsNav.fiscalYears"],
  "/app/settings/lead-apps": ["nav.settings", "settingsNav.leadApps"],
  "/app/settings/einvoicing": ["nav.settings", "settingsNav.einvoicing"],
} as const satisfies Record<string, readonly string[]>;

export type OpenablePage = keyof typeof ASSISTANT_PAGES;

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const PATTERNS = (Object.keys(ASSISTANT_PAGES) as OpenablePage[]).map(
  (page) =>
    [page, new RegExp(`^${page.replace(":id", UUID).replace(/\//g, "\\/")}$`, "i")] as const,
);

/** Le modèle d'écran d'un chemin sans la langue (« /app/invoices/<uuid> » → « /app/invoices/:id »). */
export function openablePage(path: string): OpenablePage | null {
  return PATTERNS.find(([, re]) => re.test(path))?.[0] ?? null;
}

/** Libellé d'un écran avec un traducteur de l'espace `app` (titres des écrans, variantes du pays). */
export function pageLabel(path: string, t: (key: string) => string): string | null {
  const page = openablePage(path);
  return page ? ASSISTANT_PAGES[page].map((key) => t(key)).join(" › ") : null;
}
