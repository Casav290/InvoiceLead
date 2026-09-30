import { defineConfig, devices } from "@playwright/test";

const APP_PORT = 3100;
const LEAD_PORT = 4010;
const DATABASE_URL =
  process.env.E2E_DATABASE_URL ?? "postgres://postgres@localhost:5432/invoicelead_test";

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
