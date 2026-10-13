#!/usr/bin/env node
/**
 * Met en place l'abonnement InvoiceLead (Pro, Pro+) dans le compte Stripe de la famille Lead, et
 * affiche les identifiants à poser dans les variables STRIPE_BILLING_*. Idempotent : relancé, il
 * retrouve ce qui existe (produits à identifiant fixe, prix par lookup_key, portail par
 * metadata.app, endpoint par adresse) et ne crée que ce qui manque. Mêmes conventions que le script
 * commun de CRMlead (scripts/stripe-setup.mjs --app invoicelead) : on peut utiliser l'un ou l'autre.
 *
 *   STRIPE_SECRET_KEY=sk_test_… node scripts/stripe-billing-setup.mjs
 *   STRIPE_SECRET_KEY=sk_test_… node scripts/stripe-billing-setup.mjs --portal http://127.0.0.1:3100/fr/app/settings/plan
 *   STRIPE_SECRET_KEY=sk_live_… node scripts/stripe-billing-setup.mjs --live \
 *     --portal https://invoicelead.io/app/settings/plan \
 *     --webhook https://invoicelead.io/api/billing/webhook --secret-file ~/.invoicelead-billing-whsec
 *
 * - Une clé de production (sk_live_, rk_live_) est refusée sans --live (accord d'Ève).
 * - --webhook déclare l'endpoint UNE FOIS (5 événements, metadata app=invoicelead) ; existant, il
 *   n'est ni modifié ni recréé. Son secret whsec_ n'est donné qu'à la création : il est écrit dans
 *   --secret-file (mode 600), JAMAIS affiché, pour être posé tel quel dans
 *   STRIPE_BILLING_WEBHOOK_SECRET. Le serveur ne crée jamais d'endpoint.
 * - --portal <adresse de retour> : configuration de portail propre à InvoiceLead (ses 4 prix,
 *   changement avec prorata, sans quantité, résiliation en fin de période, factures, carte,
 *   adresse et numéro de TVA). Jamais la configuration par défaut du compte (celle de Scanlead).
 * - Ne supprime, n'archive et ne modifie rien d'autre ; ne touche à aucun abonnement.
 * - STRIPE_API_BASE (facultatif) : un faux Stripe.
 */
import { chmodSync, existsSync, writeFileSync } from "node:fs";

const APP = "invoicelead";
const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};
const live = args.includes("--live");
const webhookUrl = opt("--webhook");
const secretFile = opt("--secret-file");
const portalReturn = opt("--portal");
const key = process.env.STRIPE_SECRET_KEY || process.env.STRIPE_BILLING_SECRET_KEY || "";
const base = (process.env.STRIPE_API_BASE || "https://api.stripe.com").replace(/\/+$/, "");

const fail = (message) => {
  console.error(message);
  process.exit(1);
};
if (!key) fail("STRIPE_SECRET_KEY manquant.");
const liveKey = /^(sk|rk)_live_/.test(key);
if (liveKey && !live) fail("Clé de production refusée sans --live (accord d'Ève nécessaire).");
if (live && !liveKey) console.warn("--live demandé, mais la clé n'est pas une clé de production.");
if (webhookUrl && !secretFile)
  fail("--webhook exige --secret-file <fichier> : le secret n'est jamais affiché.");
for (const url of [webhookUrl, portalReturn]) {
  if (url && !/^https:\/\//.test(url) && !/^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(url))
    fail(`Adresse refusée : ${url}`);
}

const EVENTS = [
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.payment_failed",
];

const PRODUCTS = [
  {
    id: "invoicelead_pro",
    name: "InvoiceLead Pro",
    description: "Factures et contacts illimités, 1 personne",
    plan: "pro",
    prices: [
      {
        lookup: "invoicelead_pro_monthly",
        amount: 1900,
        interval: "month",
        env: "STRIPE_BILLING_PRICE_PRO_MONTHLY",
      },
      {
        lookup: "invoicelead_pro_yearly",
        amount: 19000,
        interval: "year",
        env: "STRIPE_BILLING_PRICE_PRO_YEARLY",
      },
    ],
  },
  {
    id: "invoicelead_pro_plus",
    name: "InvoiceLead Pro+",
    description: "API et webhooks, jusqu'à 5 personnes",
    plan: "pro_plus",
    prices: [
      {
        lookup: "invoicelead_proplus_monthly",
        amount: 3900,
        interval: "month",
        env: "STRIPE_BILLING_PRICE_PROPLUS_MONTHLY",
      },
      {
        lookup: "invoicelead_proplus_yearly",
        amount: 39000,
        interval: "year",
        env: "STRIPE_BILLING_PRICE_PROPLUS_YEARLY",
      },
    ],
  },
];

function form(obj, prefix = "", out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const kk = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v))
      v.forEach((x, i) => {
        if (typeof x === "object") form(x, `${kk}[${i}]`, out);
        else out.append(`${kk}[${i}]`, String(x));
      });
    else if (typeof v === "object") form(v, kk, out);
    else out.append(kk, String(v));
  }
  return out;
}

async function call(method, path, params) {
  const q = params ? form(params).toString() : "";
  const res = await fetch(`${base}${path}${method === "GET" && q ? `?${q}` : ""}`, {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      ...(method === "POST" ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
    },
    body: method === "POST" ? q : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}
const must = (r, what) => {
  if (r.status >= 300) fail(`Échec : ${what} — ${r.data?.error?.message ?? r.status}`);
  return r.data;
};

console.log(`Stripe ${liveKey ? "PRODUCTION (réel)" : "test"} — ${base}`);
const env = {};
const priceIds = {};
for (const p of PRODUCTS) {
  const found = await call("GET", `/v1/products/${p.id}`);
  if (found.status === 404) {
    must(
      await call("POST", "/v1/products", {
        id: p.id,
        name: p.name,
        description: p.description,
        metadata: { app: APP, [`${APP}_plan`]: p.plan },
        statement_descriptor: "INVOICELEAD.IO",
        tax_code: "txcd_10103001",
      }),
      `création du produit ${p.id}`,
    );
    console.log(`  produit ${p.id} créé`);
  } else {
    const prod = must(found, `lecture du produit ${p.id}`);
    if (prod.metadata?.app !== APP)
      fail(`Le produit ${p.id} existe sans metadata.app=${APP} : à vérifier à la main.`);
    console.log(`  produit ${p.id} déjà là`);
  }
  priceIds[p.id] = [];
  for (const pr of p.prices) {
    const list = must(
      await call("GET", "/v1/prices", { lookup_keys: [pr.lookup], active: "true", limit: 1 }),
      `recherche du prix ${pr.lookup}`,
    );
    const cur = list.data?.[0];
    const same =
      cur &&
      cur.unit_amount === pr.amount &&
      cur.currency === "eur" &&
      cur.recurring?.interval === pr.interval &&
      cur.product === p.id &&
      cur.metadata?.app === APP;
    if (same) {
      env[pr.env] = cur.id;
      priceIds[p.id].push(cur.id);
      console.log(`  prix ${pr.lookup} déjà là (${cur.id})`);
      continue;
    }
    // Un prix ne change pas de montant : on en crée un autre, qui reprend la lookup_key.
    const created = must(
      await call("POST", "/v1/prices", {
        product: p.id,
        currency: "eur",
        unit_amount: pr.amount,
        recurring: { interval: pr.interval },
        tax_behavior: "exclusive",
        lookup_key: pr.lookup,
        transfer_lookup_key: "true",
        metadata: { app: APP, [`${APP}_plan`]: p.plan, interval: pr.interval },
      }),
      `création du prix ${pr.lookup}`,
    );
    env[pr.env] = created.id;
    priceIds[p.id].push(created.id);
    console.log(
      `  prix ${pr.lookup} créé (${created.id})${cur ? ` — remplace ${cur.id} pour la lookup_key` : ""}`,
    );
  }
}

if (portalReturn) {
  const configuration = {
    business_profile: {
      headline: "InvoiceLead",
      privacy_policy_url: "https://invoicelead.io/fr/legal/privacy",
      terms_of_service_url: "https://invoicelead.io/fr/legal/terms",
    },
    default_return_url: portalReturn,
    features: {
      invoice_history: { enabled: true },
      payment_method_update: { enabled: true },
      customer_update: { enabled: true, allowed_updates: ["address", "tax_id"] },
      subscription_cancel: { enabled: true, mode: "at_period_end" },
      subscription_update: {
        enabled: true,
        default_allowed_updates: ["price"],
        proration_behavior: "create_prorations",
        // Une seule place achetée par abonnement : la quantité ne se règle pas (Stripe l'ouvre
        // par défaut).
        products: PRODUCTS.map((p) => ({
          product: p.id,
          prices: priceIds[p.id],
          adjustable_quantity: { enabled: false },
        })),
      },
    },
    metadata: { app: APP },
  };
  const list = must(
    await call("GET", "/v1/billing_portal/configurations", { limit: 100 }),
    "liste des portails",
  );
  const mine = (list.data ?? []).find((c) => c.metadata?.app === APP && !c.is_default);
  if (mine) {
    must(
      await call("POST", `/v1/billing_portal/configurations/${mine.id}`, configuration),
      "mise à jour du portail",
    );
    env.STRIPE_BILLING_PORTAL_CONFIGURATION = mine.id;
    console.log(`  portail ${mine.id} mis à jour`);
  } else {
    const created = must(
      await call("POST", "/v1/billing_portal/configurations", configuration),
      "création du portail",
    );
    env.STRIPE_BILLING_PORTAL_CONFIGURATION = created.id;
    console.log(`  portail ${created.id} créé`);
  }
}

if (webhookUrl) {
  const list = must(
    await call("GET", "/v1/webhook_endpoints", { limit: 100 }),
    "liste des webhooks",
  );
  const existing = (list.data ?? []).find((w) => w.url === webhookUrl);
  if (existing) {
    console.log(
      `  webhook ${webhookUrl} déjà déclaré (${existing.id}) : laissé tel quel, son secret reste valable.`,
    );
    const missing = EVENTS.filter((e) => !(existing.enabled_events ?? []).includes(e));
    if (missing.length)
      console.log(`  événements absents (à ajouter à la main) : ${missing.join(", ")}`);
  } else {
    if (existsSync(secretFile)) fail(`${secretFile} existe déjà : choisir un autre fichier.`);
    const created = must(
      await call("POST", "/v1/webhook_endpoints", {
        url: webhookUrl,
        enabled_events: EVENTS,
        description: "InvoiceLead — abonnements (ne pas recréer : le secret changerait)",
        metadata: { app: APP },
      }),
      "déclaration du webhook",
    );
    writeFileSync(secretFile, `${created.secret}\n`, { mode: 0o600 });
    chmodSync(secretFile, 0o600);
    console.log(
      `  webhook ${webhookUrl} déclaré (${created.id}) ; secret écrit dans ${secretFile} (non affiché)`,
    );
  }
}

console.log("\nÀ poser dans les variables (Production seulement) :");
for (const [k, v] of Object.entries(env)) console.log(`${k}=${v}`);
console.log(
  "STRIPE_BILLING_SECRET_KEY : la clé du compte ; STRIPE_BILLING_WEBHOOK_SECRET : le fichier --secret-file.",
);
