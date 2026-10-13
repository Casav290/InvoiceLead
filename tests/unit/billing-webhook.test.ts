import { createHmac } from "node:crypto";
import { count, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as billingWebhook } from "@/app/api/billing/webhook/route";
import { POST as connectWebhook } from "@/app/api/stripe/webhook/route";
import { attachLeadIdentity } from "@/server/auth/attach";
import { classify } from "@/server/billing/stripe";
import {
  createCheckout,
  createPortal,
  reportPendingToLead,
  syncCheckoutSession,
} from "@/server/billing/subscriptions";
import { billingEvents, billingSubscriptions, organizations } from "@/server/db/schema";
import { tierOf } from "@/server/plans";
import { handleStripeEvent } from "@/server/stripe";
import { claims } from "../support/claims";
import { testDb } from "../support/db";
import { setTestEnv } from "../support/env";
import { leadPlan } from "../support/lead-plan";

/**
 * Abonnement InvoiceLead (décision d'Ève du 13.10.2026) : le webhook /api/billing/webhook n'écrit
 * que pour un abonnement d'InvoiceLead (metadata.app « invoicelead », prix reconnu). Le compte Stripe
 * est partagé par les applications Lead : un événement de CRMlead, Scanlead, ProjectLead, Greetlead
 * ou de Stripe Connect reçoit 200 sans aucune écriture ni appel. Faux Stripe et faux Compte Lead
 * par fetch.
 */

const STRIPE = "https://stripe.billing.test";
const LEAD = "https://crmlead.io";
const SECRET = "whsec_billing_test";
const CONNECT_SECRET = "whsec_connect_test";
const PRICE = {
  pro: { month: "price_il_pro_m", year: "price_il_pro_y" },
  pro_plus: { month: "price_il_plus_m", year: "price_il_plus_y" },
};
const t = testDb();
const db = t.database;
setTestEnv({
  STRIPE_BILLING_SECRET_KEY: "sk_test_billing",
  STRIPE_BILLING_WEBHOOK_SECRET: SECRET,
  STRIPE_BILLING_PRICE_PRO_MONTHLY: PRICE.pro.month,
  STRIPE_BILLING_PRICE_PRO_YEARLY: PRICE.pro.year,
  STRIPE_BILLING_PRICE_PROPLUS_MONTHLY: PRICE.pro_plus.month,
  STRIPE_BILLING_PRICE_PROPLUS_YEARLY: PRICE.pro_plus.year,
  STRIPE_BILLING_PORTAL_CONFIGURATION: "bpc_invoicelead_test",
  STRIPE_BILLING_API_URL: STRIPE,
  // Stripe Connect : autre clé, autre secret, autre adresse.
  STRIPE_SECRET_KEY: "sk_test_connect",
  STRIPE_CONNECT_CLIENT_ID: "ca_test",
  STRIPE_WEBHOOK_SECRET: CONNECT_SECRET,
  STRIPE_API_URL: "https://stripe.connect.test",
});

type Call = { method: string; url: string; body: string; headers: Record<string, string> };
let calls: Call[] = [];
/** Abonnements tels que le faux Stripe les connaît. */
let subs: Map<string, Record<string, unknown>>;
let sessions: Map<string, Record<string, unknown>>;
let leadDown = false;
let stripeDown = false;

function fakeFetch() {
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? init.body : String(init?.body ?? "");
    calls.push({
      method,
      url,
      body,
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
    });
    if (url.startsWith(STRIPE)) {
      if (stripeDown) return Response.json({ error: { message: "down" } }, { status: 500 });
      const path = url.slice(STRIPE.length).split("?")[0] ?? "";
      const sub = /^\/v1\/subscriptions\/([^/]+)$/.exec(path);
      if (sub && method === "GET") {
        const found = subs.get(decodeURIComponent(sub[1] ?? ""));
        return found
          ? Response.json(found)
          : Response.json(
              { error: { code: "resource_missing", message: "No such" } },
              { status: 404 },
            );
      }
      const cs = /^\/v1\/checkout\/sessions\/([^/]+)$/.exec(path);
      if (cs && method === "GET") {
        const found = sessions.get(decodeURIComponent(cs[1] ?? ""));
        return found ? Response.json(found) : Response.json({ error: {} }, { status: 404 });
      }
      if (path === "/v1/customers" && method === "POST")
        return Response.json({ id: `cus_new_${calls.length}` });
      if (path === "/v1/checkout/sessions" && method === "POST")
        return Response.json({
          id: "cs_test_new",
          url: "https://checkout.stripe.test/cs_test_new",
        });
      if (path === "/v1/billing_portal/sessions" && method === "POST")
        return Response.json({ url: "https://billing.stripe.test/p/session" });
      return Response.json({ error: { message: `inconnu ${path}` } }, { status: 400 });
    }
    if (url === `${LEAD}/oauth/token`) {
      if (leadDown) return new Response("down", { status: 503 });
      return Response.json({ access_token: "billing-token", expires_in: 300 });
    }
    if (url === `${LEAD}/api/lead-id/v1/subscriptions` && method === "POST") {
      if (leadDown) return new Response("down", { status: 503 });
      const b = JSON.parse(body) as { plan: string; status: string; org: string };
      const granting = ["active", "trialing", "past_due"].includes(b.status);
      // Comme ERPlead par application : la formule d'InvoiceLead, tirée de son abonnement.
      return Response.json({
        org: b.org,
        app: "invoicelead",
        plan: {
          ...leadPlan(granting ? (b.plan === "pro_plus" ? 2 : 1) : 0),
          source: granting ? "own" : "free",
        },
        apps: { invoicelead: { access: true, status: "live", name: "InvoiceLead", url: null } },
        subscriptions: [],
      });
    }
    return new Response("{}", { status: 404 });
  });
}

beforeEach(async () => {
  await t.reset();
  calls = [];
  subs = new Map();
  sessions = new Map();
  leadDown = false;
  stripeDown = false;
  vi.stubGlobal("fetch", fakeFetch());
});
afterEach(() => vi.unstubAllGlobals());
afterAll(() => t.close());

function sign(payload: string, secret = SECRET, at = Math.floor(Date.now() / 1000)) {
  const v1 = createHmac("sha256", secret).update(`${at}.${payload}`).digest("hex");
  return `t=${at},v1=${v1}`;
}

let seq = 0;
function event(type: string, object: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  seq += 1;
  return {
    id: `evt_test_${Date.now()}_${seq}`,
    object: "event",
    type,
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    data: { object },
    ...extra,
  };
}

async function post(
  route: (r: Request) => Promise<Response>,
  body: unknown,
  secret = SECRET,
  path = "/api/billing/webhook",
) {
  const payload = JSON.stringify(body);
  const res = await route(
    new Request(`https://invoicelead.io${path}`, {
      method: "POST",
      headers: { "stripe-signature": sign(payload, secret), "content-type": "application/json" },
      body: payload,
    }),
  );
  return { status: res.status, body: (await res.json()) as { result?: string; error?: string } };
}

const future = () => Math.floor(Date.now() / 1000) + 30 * 86_400;

/** Un abonnement Stripe tel que le compte partagé le rend. */
function subscription(
  id: string,
  opts: {
    app?: string | null;
    account?: string;
    price?: Record<string, unknown>;
    status?: string;
    customer?: string;
    cancelAtPeriodEnd?: boolean;
  } = {},
) {
  const metadata: Record<string, string> = {};
  if (opts.app !== null) metadata.app = opts.app ?? "invoicelead";
  if (opts.account) metadata.account_id = opts.account;
  return {
    id,
    object: "subscription",
    customer: opts.customer ?? "cus_atelier",
    status: opts.status ?? "active",
    livemode: false,
    cancel_at_period_end: opts.cancelAtPeriodEnd ?? false,
    metadata,
    items: {
      data: [
        {
          current_period_end: future(),
          price: opts.price ?? {
            id: PRICE.pro.month,
            lookup_key: "invoicelead_pro_monthly",
            recurring: { interval: "month" },
            metadata: { app: "invoicelead", invoicelead_plan: "pro" },
          },
        },
      ],
    },
  };
}

async function company() {
  const a = await attachLeadIdentity(db, claims());
  return a.organization;
}

async function orgRow(id: string) {
  const [row] = await db.select().from(organizations).where(eq(organizations.id, id));
  if (!row) throw new Error("organisation absente");
  return row;
}

async function writes() {
  const [e] = await db.select({ n: count() }).from(billingEvents);
  const [s] = await db.select({ n: count() }).from(billingSubscriptions);
  return { events: e?.n ?? 0, subscriptions: s?.n ?? 0 };
}

const reports = () =>
  calls
    .filter((c) => c.url === `${LEAD}/api/lead-id/v1/subscriptions`)
    .map((c) => JSON.parse(c.body) as Record<string, unknown>);

describe("webhook d'abonnement InvoiceLead", () => {
  it("un abonnement InvoiceLead ouvre Pro ici, aussitôt, et se déclare au Compte Lead", async () => {
    const org = await company();
    expect(tierOf(org)).toBe("free");
    const sub = subscription("sub_il_1", { account: org.id });
    subs.set(sub.id, sub);
    const res = await post(billingWebhook, event("customer.subscription.created", sub));
    expect(res).toEqual({ status: 200, body: { received: true, result: "applied" } });

    const after = await orgRow(org.id);
    expect(after.billingCustomerId).toBe("cus_atelier");
    expect(after.billingPlan).toBe("pro");
    expect(tierOf(after)).toBe("pro");
    const [row] = await db.select().from(billingSubscriptions);
    expect(row).toMatchObject({
      id: "sub_il_1",
      organizationId: org.id,
      plan: "pro",
      interval: "month",
      status: "active",
    });
    expect(row?.erpleadSyncedAt).toBeInstanceOf(Date);
    // Déclaré au Compte Lead (jeton de portée billing), et sa réponse enregistrée.
    expect(reports()).toEqual([
      {
        org: "org-atelier",
        external_id: "sub_il_1",
        plan: "pro",
        status: "active",
        current_period_end: expect.any(String),
      },
    ]);
    expect(calls.find((c) => c.url === `${LEAD}/oauth/token`)?.body).toContain("scope=billing");
    expect(after.leadPlan).toBe("pro");
    expect((after.entitlements as { plan: { code: string } }).plan.code).toBe("pro");
    // L'état est relu chez Stripe, avec la clé de l'abonnement (pas celle de Stripe Connect).
    const read = calls.find((c) => c.url === `${STRIPE}/v1/subscriptions/sub_il_1`);
    expect(read?.headers.authorization).toBe("Bearer sk_test_billing");

    // Le même événement renvoyé par Stripe : sans effet.
    const again = event("customer.subscription.created", sub);
    await post(billingWebhook, again);
    expect((await post(billingWebhook, again)).body.result).toBe("duplicate");
  });

  it("l'abonnement d'une autre application reçoit 200 sans aucune écriture ni appel", async () => {
    const org = await company();
    const before = await orgRow(org.id);
    const crmPrice = {
      id: "price_crm_pro_m",
      lookup_key: "crmlead_pro_monthly",
      recurring: { interval: "month" },
      metadata: { app: "crmlead", crmlead_plan: "pro" },
    };
    const others = [
      // CRMlead : son abonnement, son prix, même le compte de cette entreprise en account_id.
      event(
        "customer.subscription.updated",
        subscription("sub_crm", { app: "crmlead", account: org.id, price: crmPrice }),
      ),
      event("customer.subscription.deleted", {
        ...subscription("sub_crm", { app: "crmlead", price: crmPrice }),
        status: "canceled",
      }),
      event("checkout.session.completed", {
        id: "cs_crm",
        mode: "subscription",
        subscription: "sub_crm",
        metadata: { app: "crmlead", account_id: org.id, plan: "pro" },
      }),
      event("invoice.payment_failed", {
        id: "in_crm",
        customer: "cus_x",
        parent: {
          subscription_details: { subscription: "sub_crm", metadata: { app: "crmlead" } },
        },
      }),
      // ProjectLead et Greetlead.
      event(
        "customer.subscription.created",
        subscription("sub_pl", {
          app: "projectlead",
          account: org.id,
          price: {
            id: "price_pl",
            lookup_key: "projectlead_pro_monthly",
            metadata: { app: "projectlead" },
          },
        }),
      ),
      event("checkout.session.completed", {
        id: "cs_greet",
        mode: "payment",
        client_reference_id: "card_123",
        metadata: { app: "greetlead" },
      }),
      // Scanlead : ni metadata.app, seulement workspace_id et plan solo/team.
      event(
        "customer.subscription.updated",
        subscription("sub_scan", {
          app: null,
          price: { id: "price_scan", metadata: { plan: "team" } },
        }),
      ),
      event("checkout.session.completed", {
        id: "cs_scan",
        mode: "subscription",
        subscription: "sub_scan",
        client_reference_id: "8e758d02-0000-4000-8000-000000000000",
        metadata: { workspace_id: "8e758d02-0000-4000-8000-000000000000", plan: "team" },
      }),
      // Marqué InvoiceLead mais avec un prix d'une autre application : refusé aussi.
      event("customer.subscription.created", subscription("sub_mix", { price: crmPrice })),
    ];
    for (const e of others) {
      const res = await post(billingWebhook, e);
      expect(res, e.type).toEqual({ status: 200, body: { received: true, result: "other_app" } });
    }
    // Rien d'écrit, rien demandé à Stripe ni au Compte Lead.
    expect(await writes()).toEqual({ events: 0, subscriptions: 0 });
    expect(calls).toEqual([]);
    const after = await orgRow(org.id);
    expect(after).toEqual(before);
    expect(tierOf(after)).toBe("free");
  });

  it("un événement Stripe Connect envoyé à l'abonnement est ignoré, et inversement", async () => {
    const org = await company();
    const connect = event(
      "checkout.session.completed",
      {
        id: "cs_connect",
        mode: "payment",
        payment_status: "paid",
        amount_total: 1000,
        metadata: {
          invoice_id: "11111111-1111-4111-8111-111111111111",
          organization_id: org.id,
        },
      },
      { account: "acct_e2e" },
    );
    expect((await post(billingWebhook, connect)).body).toEqual({
      received: true,
      result: "connect",
    });
    // Même un abonnement marqué InvoiceLead, venu d'un compte connecté : pas le nôtre.
    const fromConnected = event(
      "customer.subscription.created",
      subscription("sub_connected", { account: org.id }),
      { account: "acct_e2e" },
    );
    expect((await post(billingWebhook, fromConnected)).body.result).toBe("connect");
    expect(await writes()).toEqual({ events: 0, subscriptions: 0 });
    expect(calls).toEqual([]);

    // L'abonnement InvoiceLead envoyé au webhook Connect : « ignored », sans paiement enregistré.
    const sub = subscription("sub_il_2", { account: org.id });
    const toConnect = event("customer.subscription.created", sub);
    expect(await handleStripeEvent(db, toConnect)).toBe("ignored");
    const viaRoute = await post(connectWebhook, toConnect, CONNECT_SECRET, "/api/stripe/webhook");
    expect(viaRoute.body).toEqual({ received: true, result: "ignored" });
    const checkout = event("checkout.session.completed", {
      id: "cs_il",
      mode: "subscription",
      payment_status: "paid",
      amount_total: 1900,
      subscription: "sub_il_2",
      metadata: { app: "invoicelead", account_id: org.id, plan: "pro", interval: "month" },
    });
    expect(await handleStripeEvent(db, checkout)).toBe("ignored");
    expect(await writes()).toEqual({ events: 0, subscriptions: 0 });
  });

  it("signature : la sienne seulement (ni fausse, ni celle de Stripe Connect)", async () => {
    await company();
    const sub = subscription("sub_sig");
    const e = event("customer.subscription.created", sub);
    expect((await post(billingWebhook, e, "whsec_faux")).status).toBe(400);
    expect((await post(billingWebhook, e, CONNECT_SECRET)).status).toBe(400);
    // Signature trop ancienne (rejeu) : refusée.
    const payload = JSON.stringify(e);
    const old = await billingWebhook(
      new Request("https://invoicelead.io/api/billing/webhook", {
        method: "POST",
        headers: { "stripe-signature": sign(payload, SECRET, Math.floor(Date.now() / 1000) - 600) },
        body: payload,
      }),
    );
    expect(old.status).toBe(400);
    expect(await writes()).toEqual({ events: 0, subscriptions: 0 });
  });

  it("résiliation, impayé, désordre : l'état relu chez Stripe fait foi", async () => {
    const org = await company();
    const sub = subscription("sub_il_3", { account: org.id });
    subs.set(sub.id, sub);
    await post(billingWebhook, event("customer.subscription.created", sub));
    expect(tierOf(await orgRow(org.id))).toBe("pro");

    // Paiement en échec : past_due ouvre encore la formule.
    subs.set(sub.id, { ...sub, status: "past_due" });
    const failed = event("invoice.payment_failed", {
      id: "in_1",
      customer: "cus_atelier",
      parent: {
        subscription_details: { subscription: sub.id, metadata: { app: "invoicelead" } },
      },
    });
    expect((await post(billingWebhook, failed)).body.result).toBe("applied");
    expect(tierOf(await orgRow(org.id))).toBe("pro");

    // Résilié chez Stripe ; un « updated » plus ancien arrive APRÈS la résiliation : sans effet.
    subs.set(sub.id, { ...sub, status: "canceled" });
    await post(
      billingWebhook,
      event("customer.subscription.deleted", { ...sub, status: "canceled" }),
    );
    await post(billingWebhook, event("customer.subscription.updated", sub));
    const after = await orgRow(org.id);
    expect(after.billingPlan).toBeNull();
    expect(tierOf(after)).toBe("free");
    expect(reports().at(-1)).toMatchObject({ external_id: sub.id, status: "canceled" });

    // Abonnement inconnu de ce compte Stripe (événement rejoué d'ailleurs) : inscrit, sans effet.
    const ghost = event("customer.subscription.updated", subscription("sub_ghost"));
    expect((await post(billingWebhook, ghost)).body.result).toBe("unknown_subscription");
  });

  it("Pro+ annuel : cinq places ; changement de formule dans le portail", async () => {
    const org = await company();
    const plus = subscription("sub_il_4", {
      account: org.id,
      price: { id: PRICE.pro_plus.year, recurring: { interval: "year" } },
    });
    subs.set(plus.id, plus);
    await post(billingWebhook, event("customer.subscription.created", plus));
    const after = await orgRow(org.id);
    expect(tierOf(after)).toBe("proplus");
    const [row] = await db.select().from(billingSubscriptions);
    expect(row).toMatchObject({ plan: "pro_plus", interval: "year" });
  });

  it("Compte Lead en panne : Pro ici quand même, déclaration reprise ensuite", async () => {
    const org = await company();
    const sub = subscription("sub_il_5", { account: org.id });
    subs.set(sub.id, sub);
    leadDown = true;
    expect(
      (await post(billingWebhook, event("customer.subscription.created", sub))).body.result,
    ).toBe("applied");
    const [pending] = await db.select().from(billingSubscriptions);
    expect(pending?.erpleadSyncedAt).toBeNull();
    expect(tierOf(await orgRow(org.id))).toBe("pro");

    leadDown = false;
    expect(await reportPendingToLead(db)).toEqual({ reported: 1, pending: 0 });
    const [synced] = await db.select().from(billingSubscriptions);
    expect(synced?.erpleadSyncedAt).toBeInstanceOf(Date);
    expect(await reportPendingToLead(db)).toEqual({ reported: 0, pending: 0 });
  });

  it("Stripe injoignable : 500, rien d'inscrit, l'événement renvoyé passe ensuite", async () => {
    const org = await company();
    const sub = subscription("sub_il_6", { account: org.id });
    subs.set(sub.id, sub);
    const e = event("customer.subscription.created", sub);
    stripeDown = true;
    expect((await post(billingWebhook, e)).status).toBe(500);
    expect(await writes()).toEqual({ events: 0, subscriptions: 0 });
    stripeDown = false;
    expect((await post(billingWebhook, e)).body.result).toBe("applied");
  });

  it("Checkout terminé : l'abonnement relu, le client Stripe rattaché à l'entreprise", async () => {
    const org = await company();
    const sub = subscription("sub_il_7", { account: org.id, customer: "cus_checkout" });
    subs.set(sub.id, sub);
    const done = event("checkout.session.completed", {
      id: "cs_il_7",
      mode: "subscription",
      customer: "cus_checkout",
      subscription: sub.id,
      metadata: { app: "invoicelead", account_id: org.id, plan: "pro", interval: "month" },
    });
    expect((await post(billingWebhook, done)).body.result).toBe("applied");
    const after = await orgRow(org.id);
    expect(after.billingCustomerId).toBe("cus_checkout");
    expect(tierOf(after)).toBe("pro");
  });
});

describe("paiement et portail", () => {
  it("Checkout : client propre à InvoiceLead, marques app/account_id, rien de Scanlead ni de Connect", async () => {
    const org = await company();
    const url = await createCheckout(db, {
      org: await orgRow(org.id),
      email: "ada@atelier.test",
      plan: "pro_plus",
      interval: "year",
      locale: "fr",
    });
    expect(url).toBe("https://checkout.stripe.test/cs_test_new");
    const customer = calls.find((c) => c.url === `${STRIPE}/v1/customers`);
    const cust = new URLSearchParams(customer?.body);
    expect(cust.get("metadata[app]")).toBe("invoicelead");
    expect(cust.get("metadata[account_id]")).toBe(org.id);
    expect(customer?.headers["idempotency-key"]).toMatch(
      new RegExp(`^invoicelead-customer-${org.id}-`),
    );
    const session = new URLSearchParams(
      calls.find((c) => c.url === `${STRIPE}/v1/checkout/sessions`)?.body,
    );
    expect(session.get("mode")).toBe("subscription");
    expect(session.get("line_items[0][price]")).toBe(PRICE.pro_plus.year);
    for (const key of ["metadata", "subscription_data[metadata]"]) {
      expect(session.get(`${key}[app]`)).toBe("invoicelead");
      expect(session.get(`${key}[account_id]`)).toBe(org.id);
      expect(session.get(`${key}[plan]`)).toBe("pro_plus");
      expect(session.get(`${key}[interval]`)).toBe("year");
    }
    const keys = [...session.keys()].join(" ");
    expect(keys).not.toMatch(/client_reference_id|workspace_id|invoice_id|organization_id/);
    expect(session.get("success_url")).toBe(
      "https://invoicelead.io/fr/app/settings/plan?checkout=success&session_id={CHECKOUT_SESSION_ID}",
    );
    // Le client est gardé : un second départ ne le recrée pas.
    expect((await orgRow(org.id)).billingCustomerId).toMatch(/^cus_new_/);
    calls = [];
    await createCheckout(db, {
      org: await orgRow(org.id),
      email: "ada@atelier.test",
      plan: "pro",
      interval: "month",
      locale: "de",
    });
    expect(calls.filter((c) => c.url === `${STRIPE}/v1/customers`)).toEqual([]);
  });

  it("déjà abonné : pas de second abonnement, le portail (sa configuration) s'ouvre", async () => {
    const org = await company();
    const sub = subscription("sub_il_8", { account: org.id });
    subs.set(sub.id, sub);
    await post(billingWebhook, event("customer.subscription.created", sub));
    const row = await orgRow(org.id);
    await expect(
      createCheckout(db, {
        org: row,
        email: "a@b.c",
        plan: "pro_plus",
        interval: "month",
        locale: "fr",
      }),
    ).rejects.toMatchObject({ code: "already_subscribed" });
    calls = [];
    expect(await createPortal(db, { org: row, locale: "en" })).toBe(
      "https://billing.stripe.test/p/session",
    );
    const portal = new URLSearchParams(calls[0]?.body);
    expect(portal.get("customer")).toBe("cus_atelier");
    expect(portal.get("configuration")).toBe("bpc_invoicelead_test");
    expect(portal.get("return_url")).toBe("https://invoicelead.io/en/app/settings/plan");
  });

  it("retour du paiement : seule la session de cette entreprise est appliquée", async () => {
    const org = await company();
    const other = await attachLeadIdentity(
      db,
      claims({ sub: "sub-bea", email: "bea@autre.test", org: "org-autre" }),
    );
    const sub = subscription("sub_il_9", { account: org.id });
    subs.set(sub.id, sub);
    sessions.set("cs_test_mine_0001", {
      id: "cs_test_mine_0001",
      mode: "subscription",
      status: "complete",
      subscription: sub.id,
      metadata: { app: "invoicelead", account_id: org.id },
    });
    sessions.set("cs_test_crm_00001", {
      id: "cs_test_crm_00001",
      mode: "subscription",
      status: "complete",
      subscription: "sub_crm",
      metadata: { app: "crmlead", account_id: org.id },
    });
    expect(await syncCheckoutSession(db, other.organization.id, "cs_test_mine_0001")).toBe(
      "not_ours",
    );
    expect(await syncCheckoutSession(db, org.id, "cs_test_crm_00001")).toBe("not_ours");
    expect(await syncCheckoutSession(db, org.id, "../v1/customers")).toBe("not_ours");
    expect(await writes()).toEqual({ events: 0, subscriptions: 0 });
    expect(await syncCheckoutSession(db, org.id, "cs_test_mine_0001")).toBe("applied");
    expect(tierOf(await orgRow(org.id))).toBe("pro");
    expect(tierOf(await orgRow(other.organization.id))).toBe("free");
  });
});

describe("formule par application", () => {
  it("un abonnement pris ailleurs n'ouvre rien ici : seule la formule d'InvoiceLead compte", () => {
    // ERPlead par application : formule InvoiceLead Gratuit, même avec un Pro+ CRMlead à côté.
    const elsewhere = {
      leadPlan: "free",
      entitlements: {
        app: "invoicelead",
        plan: { ...leadPlan(0), source: "free", valid_until: null },
        apps: {},
        subscriptions: [{ app: "crmlead", plan: "pro_plus", status: "active" }],
      },
    };
    expect(tierOf(elsewhere)).toBe("free");
    // Héritage accordé par le Compte Lead jusqu'à la fin de la période payée : Pro jusque-là.
    const inherited = {
      leadPlan: "pro",
      entitlements: {
        app: "invoicelead",
        plan: { ...leadPlan(1), source: "family", valid_until: "2026-10-25T11:40:27.000Z" },
        apps: {},
        subscriptions: [{ app: "crmlead", plan: "pro", inherited: true }],
      },
    };
    expect(tierOf(inherited)).toBe("pro");
  });

  it("filtre : chaque type d'événement, avant toute écriture", () => {
    expect(classify({ id: "e", type: "customer.created", data: { object: {} } }).verdict).toBe(
      "ignored",
    );
    expect(
      classify({
        id: "e",
        type: "customer.subscription.updated",
        data: { object: subscription("sub_x") },
      }),
    ).toEqual({ verdict: "own", subscription: "sub_x" });
  });
});
