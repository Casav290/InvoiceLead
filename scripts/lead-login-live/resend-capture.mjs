/**
 * Crochet de capture des emails d'un CRMlead de test (étape CRM-LEAD-EMAILS-HTML de e2e-login5.mjs) : aucun appel
 * ne part vers Resend, chaque email est écrit dans le fichier MAILCAP (une ligne JSON : from, to, subject, text, html).
 *
 *   MAILCAP=<fichier> NODE_OPTIONS="--import <ce fichier>" RESEND_API_KEY=re_capture_only npx tsx server/index.ts
 */
import { appendFileSync } from "node:fs";

const out = process.env.MAILCAP;
const real = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  if (String(url?.url ?? url).includes("api.resend.com")) {
    appendFileSync(out, `${JSON.stringify(JSON.parse(init.body))}\n`);
    return new Response(JSON.stringify({ id: `cap-${Date.now()}` }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }
  return real(url, init);
};
