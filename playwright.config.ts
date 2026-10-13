import { defineConfig, devices } from "@playwright/test";

// Ports changeables (E2E_APP_PORT, E2E_LEAD_PORT) pour lancer deux suites côte à côte sur un même
// serveur ; 3100 et 4010 par défaut.
const APP_PORT = Number(process.env.E2E_APP_PORT ?? 3100);
const LEAD_PORT = Number(process.env.E2E_LEAD_PORT ?? 4010);
const DATABASE_URL =
  process.env.E2E_DATABASE_URL ?? "postgres://postgres@localhost:5432/invoicelead_test";
// Les tests qui préparent un état en base (tests/e2e/db.ts) passent par la même adresse.
process.env.E2E_DATABASE_URL = DATABASE_URL;
// Les tests joignent InvoiceLead et le faux Compte Lead par ces adresses (tests/e2e/helpers.ts).
process.env.E2E_APP_URL = `http://localhost:${APP_PORT}`;
process.env.E2E_LEAD_URL = `http://localhost:${LEAD_PORT}`;

const appEnv = {
  DATABASE_URL,
  APP_URL: `http://localhost:${APP_PORT}`,
  SESSION_SECRET: "e2e-secret-e2e-secret-e2e-secret-e2e",
  LEAD_ID_ISSUER: `http://localhost:${LEAD_PORT}`,
  LEAD_ID_CLIENT_ID: "invoicelead",
  LEAD_ID_CLIENT_SECRET: "lid_test_secret",
  LEAD_ID_REDIRECT_URI: `http://localhost:${APP_PORT}/auth/lead/callback`,
  LEAD_ID_APP: "invoicelead",
  RESEND_API_KEY: "re_test",
  RESEND_API_URL: `http://localhost:${LEAD_PORT}/resend`,
  AI_API_KEY: "ai_test",
  CRON_SECRET: "cron-secret-for-tests-only",
  AI_BASE_URL: `http://localhost:${LEAD_PORT}/ai`,
  STRIPE_SECRET_KEY: "sk_test_e2e",
  STRIPE_CONNECT_CLIENT_ID: "ca_test_e2e",
  STRIPE_WEBHOOK_SECRET: "whsec_e2e",
  STRIPE_API_URL: `http://localhost:${LEAD_PORT}/stripe`,
  STRIPE_CONNECT_URL: `http://localhost:${LEAD_PORT}/stripe-connect`,
  // Abonnement InvoiceLead : autre clé, autre secret, autre faux Stripe que Stripe Connect.
  STRIPE_BILLING_SECRET_KEY: "sk_test_billing_e2e",
  STRIPE_BILLING_WEBHOOK_SECRET: "whsec_billing_e2e",
  STRIPE_BILLING_PRICE_PRO_MONTHLY: "price_e2e_pro_monthly",
  STRIPE_BILLING_PRICE_PRO_YEARLY: "price_e2e_pro_yearly",
  STRIPE_BILLING_PRICE_PROPLUS_MONTHLY: "price_e2e_proplus_monthly",
  STRIPE_BILLING_PRICE_PROPLUS_YEARLY: "price_e2e_proplus_yearly",
  STRIPE_BILLING_PORTAL_CONFIGURATION: "bpc_e2e_invoicelead",
  STRIPE_BILLING_API_URL: `http://localhost:${LEAD_PORT}/stripe-billing`,
  FX_API_URL: `http://localhost:${LEAD_PORT}/fx/v1`,
  WEBHOOK_ALLOW_LOCAL: "1",
  NEXT_TELEMETRY_DISABLED: "1",
};

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://localhost:${APP_PORT}`,
    locale: "de-CH",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "node tests/support/fake-lead-id.mjs",
      url: `http://localhost:${LEAD_PORT}/health`,
      env: { FAKE_LEAD_ID_PORT: String(LEAD_PORT), ...appEnv },
      reuseExistingServer: false,
    },
    {
      command: `npx next start -p ${APP_PORT}`,
      url: `http://localhost:${APP_PORT}/api/health`,
      env: appEnv,
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
