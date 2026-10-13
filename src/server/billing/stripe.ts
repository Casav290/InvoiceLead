import { env } from "../env";

/**
 * Stripe pour l'abonnement InvoiceLead (Pro, Pro+), sans SDK : quelques appels REST et le filtre des
 * événements. Même modèle que CRMlead (server/lib/stripe.ts, server/routes/billing.ts) et le kit
 * commun des applications Lead (crmlead-vercel/docs/lead-billing-kit), avec app = « invoicelead ».
 *
 * Le compte Stripe est partagé par toutes les applications Lead (« scanlead.io »). InvoiceLead ne
 * crée, ne lit et ne modifie QUE des objets marqués `metadata.app = "invoicelead"` ; tout autre
 * événement reçoit 200 sans aucune écriture (own). Jamais de client_reference_id ni de
 * metadata.workspace_id (lus par Scanlead, qui annule ce qu'il ne reconnaît pas), jamais
 * invoice_id ni organization_id (clés de Stripe Connect, src/server/stripe.ts, à part).
 *
 * Le serveur ne crée JAMAIS l'endpoint webhook (son secret tournerait) : il se déclare une fois,
 * par scripts/stripe-billing-setup.mjs ou le script commun de CRMlead.
 */

export const APP = "invoicelead";

export type PaidPlan = "pro" | "pro_plus";
export type Interval = "month" | "year";

/** Prix affichés (page Formule, page Tarifs), hors taxes, en euros : les mêmes dans toute la famille. */
export const PRICES: Record<PaidPlan, Record<Interval, number>> = {
  pro: { month: 19, year: 190 },
  pro_plus: { month: 39, year: 390 },
};

/** Clés de recherche des prix (lookup_key) : repli si un identifiant de prix change. */
export const LOOKUP_KEYS: Record<string, { plan: PaidPlan; interval: Interval }> = {
  invoicelead_pro_monthly: { plan: "pro", interval: "month" },
  invoicelead_pro_yearly: { plan: "pro", interval: "year" },
  invoicelead_proplus_monthly: { plan: "pro_plus", interval: "month" },
  invoicelead_proplus_yearly: { plan: "pro_plus", interval: "year" },
};

/** Statuts Stripe qui ouvrent la formule (les mêmes qu'ERPlead, identity.ts : GRANTING). */
export const GRANTING = ["active", "trialing", "past_due"] as const;

export function priceIds(): Record<PaidPlan, Record<Interval, string>> {
  const e = env();
  return {
    pro: {
      month: e.STRIPE_BILLING_PRICE_PRO_MONTHLY ?? "",
      year: e.STRIPE_BILLING_PRICE_PRO_YEARLY ?? "",
    },
    pro_plus: {
      month: e.STRIPE_BILLING_PRICE_PROPLUS_MONTHLY ?? "",
      year: e.STRIPE_BILLING_PRICE_PROPLUS_YEARLY ?? "",
    },
  };
}

/** Paiement possible : la clé et les quatre prix (le secret du webhook est vérifié à part). */
export function billingConfigured(): boolean {
  const p = priceIds();
  return (
    !!env().STRIPE_BILLING_SECRET_KEY &&
    [p.pro.month, p.pro.year, p.pro_plus.month, p.pro_plus.year].every(Boolean)
  );
}

/** Portail client : seulement la configuration propre à InvoiceLead, jamais celle par défaut. */
export function portalConfigured(): boolean {
  return billingConfigured() && !!env().STRIPE_BILLING_PORTAL_CONFIGURATION;
}

type Price = {
  id?: string;
  lookup_key?: string | null;
  metadata?: Record<string, string> | null;
  recurring?: { interval?: string } | null;
};

/** Formule d'un prix Stripe : par son identifiant, sinon sa lookup_key, sinon ses métadonnées. */
export function planOfPrice(
  price: Price | string | null | undefined,
): { plan: PaidPlan; interval: Interval } | null {
  if (!price) return null;
  const id = typeof price === "string" ? price : price.id;
  const p = priceIds();
  for (const plan of ["pro", "pro_plus"] as const) {
    for (const interval of ["month", "year"] as const) {
      if (id && p[plan][interval] === id) return { plan, interval };
    }
  }
  if (typeof price === "string") return null;
  const byKey = price.lookup_key ? LOOKUP_KEYS[price.lookup_key] : undefined;
  if (byKey) return byKey;
  const m = price.metadata ?? {};
  const plan = m.invoicelead_plan;
  if (m.app === APP && (plan === "pro" || plan === "pro_plus")) {
    return { plan, interval: price.recurring?.interval === "year" ? "year" : "month" };
  }
  return null;
}

/** Aplatit un objet à la manière de Stripe : `a[b][0][c]=…`. */
export function formEncode(
  obj: Record<string, unknown>,
  prefix = "",
  out = new URLSearchParams(),
): URLSearchParams {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) {
      v.forEach((x, i) => {
        if (x !== null && typeof x === "object")
          formEncode(x as Record<string, unknown>, `${key}[${i}]`, out);
        else out.append(`${key}[${i}]`, String(x));
      });
    } else if (typeof v === "object") formEncode(v as Record<string, unknown>, key, out);
    else out.append(key, String(v));
  }
  return out;
}

export class BillingError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    /** Paramètre en cause selon Stripe (« customer »…). */
    public param?: string,
  ) {
    super(message);
  }
}

/** Un appel à l'API Stripe de l'abonnement. `idem` : clé d'idempotence. */
export async function stripeBilling<T = Record<string, unknown>>(
  method: "GET" | "POST",
  path: string,
  params?: Record<string, unknown>,
  idem?: string,
): Promise<T> {
  const e = env();
  const key = e.STRIPE_BILLING_SECRET_KEY;
  if (!key) throw new BillingError(503, "billing_not_configured", "STRIPE_BILLING_SECRET_KEY");
  const body = params ? formEncode(params).toString() : "";
  const base = e.STRIPE_BILLING_API_URL.replace(/\/+$/, "");
  const url = `${base}${path}${method === "GET" && body ? `?${body}` : ""}`;
  const headers: Record<string, string> = { Authorization: `Bearer ${key}` };
  if (method === "POST") headers["Content-Type"] = "application/x-www-form-urlencoded";
  if (idem) headers["Idempotency-Key"] = idem;
  const res = await fetch(url, {
    method,
    headers,
    body: method === "POST" ? body : undefined,
    signal: AbortSignal.timeout(15_000),
  });
  const data = (await res.json().catch(() => ({}))) as {
    error?: { code?: string; type?: string; message?: string; param?: string };
  };
  if (!res.ok) {
    throw new BillingError(
      res.status,
      data.error?.code ?? data.error?.type ?? "stripe_error",
      data.error?.message ?? `HTTP ${res.status}`,
      data.error?.param,
    );
  }
  return data as T;
}

const idOf = (x: unknown): string | null =>
  typeof x === "string" ? x : x && typeof x === "object" && "id" in x ? String(x.id) : null;

export type StripeSubscription = {
  id: string;
  object?: string;
  customer: string | { id: string };
  status: string;
  livemode?: boolean;
  cancel_at_period_end?: boolean;
  cancel_at?: number | null;
  current_period_end?: number | null;
  metadata?: Record<string, string> | null;
  items?: { data?: { price?: Price; current_period_end?: number | null }[] };
};

export type StripeEvent = {
  id: string;
  type: string;
  created?: number;
  account?: string | null;
  livemode?: boolean;
  data?: { object?: Record<string, unknown> };
};

/** Fin de période : à la racine (anciennes versions d'API) ou sur l'élément (depuis 2025). */
export function periodEnd(sub: StripeSubscription): Date | null {
  const s = sub.current_period_end ?? sub.items?.data?.[0]?.current_period_end;
  return typeof s === "number" ? new Date(s * 1000) : null;
}

export const priceOf = (sub: StripeSubscription): Price | undefined => sub.items?.data?.[0]?.price;
export const customerOf = (sub: StripeSubscription): string | null => idOf(sub.customer);

type InvoiceObject = {
  subscription?: unknown;
  subscription_details?: { metadata?: Record<string, string> | null } | null;
  parent?: {
    subscription_details?: {
      subscription?: unknown;
      metadata?: Record<string, string> | null;
    } | null;
  } | null;
};

/** L'abonnement d'une facture : à la racine (anciennes versions) ou sous `parent` (depuis 2025). */
export function invoiceSubscription(inv: InvoiceObject): string | null {
  return idOf(inv.subscription ?? inv.parent?.subscription_details?.subscription ?? null);
}

/** Métadonnées de l'abonnement d'une facture, recopiées par Stripe sur la facture. */
function invoiceSubscriptionMetadata(inv: InvoiceObject): Record<string, string> {
  return inv.parent?.subscription_details?.metadata ?? inv.subscription_details?.metadata ?? {};
}

/**
 * Ce que dit un événement Stripe reçu sur /api/billing/webhook, AVANT toute écriture :
 * - « own » et l'abonnement à relire : un événement d'abonnement d'InvoiceLead ;
 * - « connect » : un événement d'un compte connecté (Stripe Connect, factures des clients) ;
 * - « other_app » : un événement d'une autre application Lead, ou sans la marque d'InvoiceLead ;
 * - « ignored » : un type que l'abonnement ne traite pas.
 * Le même filtre que le kit commun (own(event)) : seul « own » touche à la base.
 */
export function classify(
  event: StripeEvent,
):
  | { verdict: "own"; subscription: string }
  | { verdict: "connect" | "other_app" | "ignored"; subscription?: undefined } {
  if (event.account) return { verdict: "connect" };
  const obj = (event.data?.object ?? {}) as Record<string, unknown>;
  const metadata = (obj.metadata ?? {}) as Record<string, string>;
  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded": {
      if (obj.mode !== "subscription" || metadata.app !== APP) return { verdict: "other_app" };
      const subscription = idOf(obj.subscription);
      return subscription ? { verdict: "own", subscription } : { verdict: "ignored" };
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const sub = obj as unknown as StripeSubscription;
      if (metadata.app !== APP || !planOfPrice(priceOf(sub))) return { verdict: "other_app" };
      return typeof sub.id === "string"
        ? { verdict: "own", subscription: sub.id }
        : { verdict: "ignored" };
    }
    case "invoice.payment_failed": {
      const inv = obj as InvoiceObject;
      if (invoiceSubscriptionMetadata(inv).app !== APP) return { verdict: "other_app" };
      const subscription = invoiceSubscription(inv);
      return subscription ? { verdict: "own", subscription } : { verdict: "ignored" };
    }
    default:
      return { verdict: "ignored" };
  }
}

/** Les langues que Stripe Checkout et le portail affichent, parmi celles d'InvoiceLead. */
export const stripeLocale = (l: string | null | undefined): string =>
  l === "fr" || l === "de" || l === "en" ? l : "auto";
