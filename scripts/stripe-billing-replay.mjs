#!/usr/bin/env node
/**
 * Rejoue, signés, les événements Stripe de MODE TEST vers un webhook d'abonnement LOCAL
 * (/api/billing/webhook), comme Stripe les enverrait : il n'y a pas d'endpoint de test vers un
 * serveur local. Tous les événements du compte de test depuis --since sont rejoués, ceux des
 * autres applications Lead compris : chacun doit rendre 200 et « other_app » sans effet.
 *
 *   STRIPE_SECRET_KEY=sk_test_… STRIPE_BILLING_WEBHOOK_SECRET=whsec_local_… \
 *     node scripts/stripe-billing-replay.mjs --since 1791880000 --to http://localhost:3100/api/billing/webhook
 *
 * - Refuse toute clé de production (sk_live_, rk_live_) : jamais de rejeu en réel.
 * - Refuse une adresse qui n'est pas locale (localhost, 127.0.0.1).
 * - Affiche type, identifiant et résultat ; jamais une valeur de secret.
 */
import { createHmac } from "node:crypto";

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};
const key = process.env.STRIPE_SECRET_KEY ?? "";
const secret = process.env.STRIPE_BILLING_WEBHOOK_SECRET ?? "";
const to = opt("--to") ?? "http://localhost:3100/api/billing/webhook";
const since = Number(opt("--since") ?? Math.floor(Date.now() / 1000) - 3600);
const types = (opt("--types") ?? "").split(",").filter(Boolean);

if (!key.startsWith("sk_test_")) {
  console.error("Clé de TEST (sk_test_…) exigée : le rejeu ne se fait jamais en réel.");
  process.exit(1);
}
if (!secret) {
  console.error("STRIPE_BILLING_WEBHOOK_SECRET manquant (le secret du serveur local).");
  process.exit(1);
}
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(to)) {
  console.error(`Adresse refusée (locale seulement) : ${to}`);
  process.exit(1);
}

const events = [];
let after = null;
for (;;) {
  const q = new URLSearchParams({ limit: "100", "created[gte]": String(since) });
  if (after) q.set("starting_after", after);
  for (const t of types) q.append("types[]", t);
  const res = await fetch(`https://api.stripe.com/v1/events?${q}`, {
    headers: { Authorization: `Bearer ${key}` },
  });
  const page = await res.json();
  if (!res.ok) {
    console.error("Lecture des événements en échec :", page?.error?.message ?? res.status);
    process.exit(1);
  }
  events.push(...page.data);
  if (!page.has_more || page.data.length === 0) break;
  after = page.data.at(-1).id;
}
// Dans l'ordre de création, comme Stripe les enverrait (le serveur doit aussi tenir le désordre).
events.sort((a, b) => a.created - b.created);

const counts = {};
for (const event of events) {
  const payload = JSON.stringify(event);
  const at = Math.floor(Date.now() / 1000);
  const v1 = createHmac("sha256", secret).update(`${at}.${payload}`).digest("hex");
  const res = await fetch(to, {
    method: "POST",
    headers: { "content-type": "application/json", "stripe-signature": `t=${at},v1=${v1}` },
    body: payload,
  });
  const body = await res.json().catch(() => ({}));
  const result = res.ok ? body.result : `HTTP ${res.status}`;
  counts[result] = (counts[result] ?? 0) + 1;
  const app = event.data?.object?.metadata?.app ?? "-";
  console.log(`${res.status} ${result.padEnd(20)} ${event.type.padEnd(34)} ${event.id} app=${app}`);
}
console.log(JSON.stringify({ events: events.length, ...counts }));
