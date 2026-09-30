/** Configuration minimale pour les modules qui lisent l'environnement (env()). */
export function setTestEnv(extra: Record<string, string> = {}) {
  Object.assign(process.env, {
    DATABASE_URL: process.env.TEST_DATABASE_URL,
    APP_URL: "https://invoicelead.io",
    SESSION_SECRET: "unit-secret-unit-secret-unit-secret-unit",
    LEAD_ID_ISSUER: "https://crmlead.io",
    LEAD_ID_CLIENT_ID: "invoicelead",
    LEAD_ID_CLIENT_SECRET: "x",
    LEAD_ID_REDIRECT_URI: "https://invoicelead.io/auth/lead/callback",
    LEAD_ID_APP: "invoicelead",
    ...extra,
  });
}
