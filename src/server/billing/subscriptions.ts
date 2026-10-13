import { createHash } from "node:crypto";
import { and, desc, eq, gt, inArray, isNull, or, sql } from "drizzle-orm";
import { hasInvoiceLeadAccess } from "../auth/attach";
import type { Db } from "../db";
import { auditLog, billingEvents, billingSubscriptions, organizations } from "../db/schema";
import { env } from "../env";
import { type LeadEntitlements, reportSubscription } from "../lead-id/leadId";
import {
  APP,
  BillingError,
  classify,
  customerOf,
  GRANTING,
  type Interval,
  type PaidPlan,
  periodEnd,
  planOfPrice,
  priceIds,
  priceOf,
  type StripeEvent,
  type StripeSubscription,
  stripeBilling,
  stripeLocale,
} from "./stripe";

/**
 * Abonnement InvoiceLead (décision d'Ève du 13.10.2026) : chaque application Lead vend son propre
 * abonnement, valable chez elle seule. InvoiceLead encaisse Pro et Pro+ par Stripe Checkout, le gère
 * par le portail Stripe, l'apprend par son webhook signé, puis le déclare au Compte Lead (ERPlead,
 * POST /api/lead-id/v1/subscriptions), qui en tire la formule InvoiceLead de l'organisation.
 *
 * L'état fait foi chez Stripe : chaque événement fait relire l'abonnement (GET /v1/subscriptions),
 * sous un verrou par abonnement. Deux événements arrivés dans le désordre ne laissent donc jamais un
 * état ancien. La formule payée ici vaut tout de suite (organizations.billing_plan), même si le
 * Compte Lead tarde ; la déclaration est reprise par la tâche quotidienne.
 */

/** Trois jours de grâce après la fin de période, comme ERPlead (identity.ts). */
export const GRACE_MS = 3 * 86_400_000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RANK: Record<string, number> = { pro: 1, pro_plus: 2 };
/** Le Compte Lead ne retient pas un webhook plus longtemps que ceci. */
const LEAD_WAIT_MS = 5_000;

export type ApplyResult = "applied" | "other_app" | "unknown_price" | "unknown_account";

type BillingOrg = {
  id: string;
  name: string;
  legalName?: string | null;
  billingCustomerId: string | null;
};

const lockSubscription = (database: Db, id: string) =>
  database.execute(sql`select pg_advisory_xact_lock(hashtext(${`billing:${id}`}))`);

/** L'abonnement tel que Stripe le connaît maintenant. */
export function fetchSubscription(id: string): Promise<StripeSubscription> {
  return stripeBilling<StripeSubscription>("GET", `/v1/subscriptions/${encodeURIComponent(id)}`);
}

/**
 * L'entreprise d'un abonnement : par son client Stripe (qui fait foi), sinon par
 * metadata.account_id, posé par InvoiceLead au Checkout ; le client est alors rattaché.
 */
async function organizationFor(
  database: Db,
  customer: string,
  accountId: string | null | undefined,
): Promise<string | null> {
  const [byCustomer] = await database
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.billingCustomerId, customer));
  if (byCustomer) return byCustomer.id;
  if (!accountId || !UUID_RE.test(accountId)) return null;
  const [org] = await database
    .select({ id: organizations.id, customer: organizations.billingCustomerId })
    .from(organizations)
    .where(eq(organizations.id, accountId));
  if (!org) return null;
  if (!org.customer) {
    await database
      .update(organizations)
      .set({ billingCustomerId: customer })
      .where(and(eq(organizations.id, org.id), isNull(organizations.billingCustomerId)));
  }
  return org.id;
}

/**
 * Formule payée ici, tirée des abonnements de l'entreprise : le meilleur abonnement actif, en essai
 * ou en retard de paiement, jusqu'à trois jours après la fin de sa période.
 */
export async function refreshOrganizationPlan(
  database: Db,
  organizationId: string,
  now = Date.now(),
): Promise<{ plan: PaidPlan | null; until: Date | null }> {
  const rows = await database
    .select({ plan: billingSubscriptions.plan, end: billingSubscriptions.currentPeriodEnd })
    .from(billingSubscriptions)
    .where(
      and(
        eq(billingSubscriptions.organizationId, organizationId),
        inArray(billingSubscriptions.status, [...GRANTING]),
        or(
          isNull(billingSubscriptions.currentPeriodEnd),
          gt(billingSubscriptions.currentPeriodEnd, new Date(now - GRACE_MS)),
        ),
      ),
    );
  const endOf = (r: { end: Date | null }) => r.end?.getTime() ?? Number.POSITIVE_INFINITY;
  const best = rows
    .filter((r) => RANK[r.plan])
    .sort((a, b) => (RANK[b.plan] ?? 0) - (RANK[a.plan] ?? 0) || endOf(b) - endOf(a))[0];
  const plan = (best?.plan as PaidPlan | undefined) ?? null;
  const until = best?.end ? new Date(best.end.getTime() + GRACE_MS) : null;
  await database
    .update(organizations)
    .set({ billingPlan: plan, billingPlanUntil: until, updatedAt: new Date(now) })
    .where(eq(organizations.id, organizationId));
  return { plan, until };
}

/**
 * Enregistre un abonnement relu chez Stripe, s'il est bien celui d'InvoiceLead (metadata.app et prix
 * reconnu), puis recalcule la formule payée de l'entreprise. À appeler sous le verrou de
 * l'abonnement (processSubscription).
 */
export async function applySubscription(
  database: Db,
  sub: StripeSubscription,
): Promise<ApplyResult> {
  if (sub.metadata?.app !== APP) return "other_app";
  const price = priceOf(sub);
  const plan = planOfPrice(price);
  if (!plan) return "unknown_price";
  const customer = customerOf(sub);
  if (!customer) return "unknown_account";
  const organizationId = await organizationFor(database, customer, sub.metadata?.account_id);
  if (!organizationId) return "unknown_account";
  const [before] = await database
    .select({ organizationId: billingSubscriptions.organizationId })
    .from(billingSubscriptions)
    .where(eq(billingSubscriptions.id, sub.id));
  // Verrou par entreprise (après celui de l'abonnement, toujours dans cet ordre) : deux abonnements
  // de la même entreprise traités en même temps recalculent sa formule l'un après l'autre, chacun
  // voyant la ligne de l'autre.
  const orgs = [...new Set([organizationId, before?.organizationId ?? organizationId])].sort();
  for (const id of orgs)
    await database.execute(sql`select pg_advisory_xact_lock(hashtext(${`billing-org:${id}`}))`);
  const values = {
    organizationId,
    customerId: customer,
    plan: plan.plan,
    interval: plan.interval,
    priceId: price?.id ?? null,
    status: sub.status,
    currentPeriodEnd: periodEnd(sub),
    cancelAtPeriodEnd: sub.cancel_at_period_end === true,
    cancelAt: typeof sub.cancel_at === "number" ? new Date(sub.cancel_at * 1000) : null,
    livemode: sub.livemode === true,
  };
  const t = billingSubscriptions;
  // updated_at posé ici (milliseconde) et non par la base (microseconde) : reportToLead le compare.
  await database
    .insert(billingSubscriptions)
    .values({ id: sub.id, ...values, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: billingSubscriptions.id,
      set: {
        ...values,
        updatedAt: new Date(),
        // Ce que le Compte Lead connaît (entreprise, formule, statut, fin) n'a pas changé : la
        // déclaration reste à jour ; sinon elle est à refaire.
        erpleadSyncedAt: sql`case when (${t.organizationId}, ${t.plan}, ${t.status}, ${t.currentPeriodEnd})
          is not distinct from (excluded.organization_id, excluded.plan, excluded.status, excluded.current_period_end)
          then ${t.erpleadSyncedAt} else null end`,
      },
    });
  await refreshOrganizationPlan(database, organizationId);
  if (before && before.organizationId !== organizationId)
    await refreshOrganizationPlan(database, before.organizationId);
  return "applied";
}

/**
 * Relit l'abonnement chez Stripe et l'enregistre, sous un verrou par abonnement : deux événements
 * simultanés passent l'un après l'autre, et le dernier enregistre l'état le plus récent. `event` :
 * l'événement Stripe à inscrire (un événement déjà inscrit n'a pas d'effet). Une erreur de Stripe
 * annule tout (rien n'est inscrit) : Stripe renverra l'événement.
 */
export async function processSubscription(
  database: Db,
  subscriptionId: string,
  event?: { id: string; type: string },
): Promise<ApplyResult | "duplicate" | "unknown_subscription"> {
  const result = await database.transaction(async (tx) => {
    const t = tx as unknown as Db;
    await lockSubscription(t, subscriptionId);
    if (event) {
      const claimed = await t
        .insert(billingEvents)
        .values({ id: event.id, type: event.type, subscriptionId, result: "processing" })
        .onConflictDoNothing()
        .returning({ id: billingEvents.id });
      if (claimed.length === 0) return "duplicate" as const;
    }
    let sub: StripeSubscription | null;
    try {
      sub = await fetchSubscription(subscriptionId);
    } catch (e) {
      // Abonnement inconnu de ce compte Stripe (événement d'un autre compte, rejoué) : inscrit, sans effet.
      if (e instanceof BillingError && e.status === 404) sub = null;
      else throw e;
    }
    const out = sub ? await applySubscription(t, sub) : ("unknown_subscription" as const);
    if (event) {
      await t.update(billingEvents).set({ result: out }).where(eq(billingEvents.id, event.id));
    }
    return out;
  });
  if (result === "applied") await reportToLead(database, subscriptionId, { onlyPending: true });
  return result;
}

export type EventResult =
  | ApplyResult
  | "duplicate"
  | "unknown_subscription"
  | "connect"
  | "ignored";

/**
 * Un événement Stripe reçu sur /api/billing/webhook, signature déjà vérifiée. Un événement qui n'est
 * pas un abonnement d'InvoiceLead (autre application Lead, Stripe Connect, autre type) rend son
 * verdict sans AUCUNE écriture ni appel à Stripe.
 */
export async function handleBillingEvent(database: Db, event: StripeEvent): Promise<EventResult> {
  const c = classify(event);
  if (c.verdict !== "own") return c.verdict;
  return processSubscription(database, c.subscription, { id: event.id, type: event.type });
}

/**
 * Déclare l'abonnement au Compte Lead (ERPlead) et enregistre les droits qu'il rend, comme une
 * relecture de formule (plan-refresh.ts). Rend false si le Compte Lead n'a pas répondu : la
 * déclaration reste à faire (erplead_synced_at vide) et la tâche quotidienne la reprend.
 */
export async function reportToLead(
  database: Db,
  subscriptionId: string,
  options: { onlyPending?: boolean } = {},
): Promise<boolean> {
  const [row] = await database
    .select({
      syncedAt: billingSubscriptions.erpleadSyncedAt,
      id: billingSubscriptions.id,
      organizationId: billingSubscriptions.organizationId,
      plan: billingSubscriptions.plan,
      status: billingSubscriptions.status,
      currentPeriodEnd: billingSubscriptions.currentPeriodEnd,
      updatedAt: billingSubscriptions.updatedAt,
      leadOrg: organizations.leadOrg,
    })
    .from(billingSubscriptions)
    .innerJoin(organizations, eq(organizations.id, billingSubscriptions.organizationId))
    .where(eq(billingSubscriptions.id, subscriptionId));
  if (!row?.leadOrg) return false;
  // Déjà déclaré dans cet état (organisation, formule, statut, fin inchangés) : rien à redire.
  if (options.onlyPending && row.syncedAt) return true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const lead = await Promise.race([
      reportSubscription({
        org: row.leadOrg,
        external_id: row.id,
        plan: row.plan,
        status: row.status,
        current_period_end: row.currentPeriodEnd,
      }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("lead_id:timeout")), LEAD_WAIT_MS);
      }),
    ]);
    const { org: _org, ...entitlements } = lead as LeadEntitlements & { org?: string };
    const now = new Date();
    if (entitlements.plan && entitlements.apps) {
      await database
        .update(organizations)
        .set({
          leadPlan: entitlements.plan.code ?? "free",
          hasAccess: hasInvoiceLeadAccess({ lead: entitlements }),
          entitlements,
          entitlementsAt: now,
          updatedAt: now,
        })
        .where(eq(organizations.id, row.organizationId));
    }
    // Seulement l'état déclaré : changé entre-temps, il reste à déclarer.
    await database
      .update(billingSubscriptions)
      .set({ erpleadSyncedAt: now })
      .where(
        and(eq(billingSubscriptions.id, row.id), eq(billingSubscriptions.updatedAt, row.updatedAt)),
      );
    return true;
  } catch (e) {
    console.warn("[billing] déclaration au Compte Lead en échec", row.id, (e as Error).message);
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** Tâche quotidienne : déclare au Compte Lead les abonnements qui ne le sont pas encore. */
export async function reportPendingToLead(
  database: Db,
  limit = 100,
): Promise<{ reported: number; pending: number }> {
  const rows = await database
    .select({ id: billingSubscriptions.id, leadOrg: organizations.leadOrg })
    .from(billingSubscriptions)
    .innerJoin(organizations, eq(organizations.id, billingSubscriptions.organizationId))
    .where(isNull(billingSubscriptions.erpleadSyncedAt))
    .orderBy(billingSubscriptions.updatedAt)
    .limit(limit);
  let reported = 0;
  let silent = 0;
  for (const row of rows) {
    // Entreprise sans organisation Lead (impossible par la connexion) : rien à déclarer, on passe.
    if (!row.leadOrg) continue;
    if (await reportToLead(database, row.id)) {
      reported += 1;
      silent = 0;
    } else if (++silent >= 3) break;
  }
  return { reported, pending: rows.length - reported };
}

/**
 * Abonnement InvoiceLead de l'entreprise à afficher : le meilleur qui ouvre la formule, sinon le
 * dernier connu (résilié, impayé).
 */
export async function subscriptionOf(database: Db, organizationId: string) {
  const rows = await database
    .select()
    .from(billingSubscriptions)
    .where(eq(billingSubscriptions.organizationId, organizationId))
    .orderBy(desc(billingSubscriptions.updatedAt));
  const granting = rows.filter((r) => (GRANTING as readonly string[]).includes(r.status));
  granting.sort((a, b) => (RANK[b.plan] ?? 0) - (RANK[a.plan] ?? 0));
  return granting[0] ?? rows[0] ?? null;
}

/** Un abonnement InvoiceLead ouvre-t-il déjà la formule ? Le changement passe alors par le portail. */
async function hasOpenSubscription(database: Db, organizationId: string): Promise<boolean> {
  const [row] = await database
    .select({ id: billingSubscriptions.id })
    .from(billingSubscriptions)
    .where(
      and(
        eq(billingSubscriptions.organizationId, organizationId),
        inArray(billingSubscriptions.status, [...GRANTING]),
      ),
    )
    .limit(1);
  return !!row;
}

/**
 * Client Stripe de l'entreprise pour InvoiceLead : créé une fois (metadata app et account_id),
 * jamais retrouvé par e-mail ni partagé avec une autre application Lead. La clé d'idempotence
 * dépend des données envoyées : un double clic reçoit le même client.
 */
export async function ensureCustomer(database: Db, org: BillingOrg, email: string, salt = "") {
  if (org.billingCustomerId) return org.billingCustomerId;
  const name = org.legalName || org.name;
  const digest = createHash("sha256")
    .update(`${name}\n${email}\n${salt}`)
    .digest("hex")
    .slice(0, 16);
  const customer = await stripeBilling<{ id: string }>(
    "POST",
    "/v1/customers",
    { name, email, metadata: { app: APP, account_id: org.id } },
    `${APP}-customer-${org.id}-${digest}`,
  );
  const [kept] = await database
    .update(organizations)
    .set({ billingCustomerId: customer.id })
    .where(and(eq(organizations.id, org.id), isNull(organizations.billingCustomerId)))
    .returning({ id: organizations.billingCustomerId });
  if (kept?.id) return kept.id;
  // Une autre demande l'a rattaché entre-temps : on garde le sien.
  const [row] = await database
    .select({ id: organizations.billingCustomerId })
    .from(organizations)
    .where(eq(organizations.id, org.id));
  return row?.id ?? customer.id;
}

/** Page Formule d'InvoiceLead, où reviennent le Checkout et le portail. */
export function planPageUrl(locale: string, query = ""): string {
  return `${env().APP_URL}/${locale}/app/settings/plan${query}`;
}

/**
 * Session Stripe Checkout d'un abonnement InvoiceLead. Les métadonnées {app, account_id, plan,
 * interval} vont sur la session ET sur l'abonnement ; pas de client_reference_id (Scanlead le lit),
 * pas d'invoice_id ni d'organization_id (Stripe Connect).
 */
export async function createCheckout(
  database: Db,
  input: { org: BillingOrg; email: string; plan: PaidPlan; interval: Interval; locale: string },
): Promise<string> {
  const { org } = input;
  if (await hasOpenSubscription(database, org.id))
    throw new BillingError(409, "already_subscribed", "abonnement déjà actif");
  const customer = await ensureCustomer(database, org, input.email);
  try {
    return await startCheckout(database, input, customer);
  } catch (e) {
    // Client Stripe supprimé dans le tableau de bord : on oublie la référence locale (rien n'est
    // supprimé chez Stripe), un nouveau client est créé, une seule fois.
    if (!(e instanceof BillingError && e.code === "resource_missing" && e.param === "customer"))
      throw e;
    await database
      .update(organizations)
      .set({ billingCustomerId: null })
      .where(and(eq(organizations.id, org.id), eq(organizations.billingCustomerId, customer)));
    // Autre clé d'idempotence : la première rendrait le client supprimé pendant 24 heures.
    const fresh = await ensureCustomer(
      database,
      { ...org, billingCustomerId: null },
      input.email,
      `remplace ${customer}`,
    );
    return startCheckout(database, input, fresh);
  }
}

async function startCheckout(
  database: Db,
  input: { org: BillingOrg; plan: PaidPlan; interval: Interval; locale: string },
  customer: string,
): Promise<string> {
  const { org, plan, interval, locale } = input;
  const metadata = { app: APP, account_id: org.id, plan, interval };
  const params: Record<string, unknown> = {
    mode: "subscription",
    customer,
    line_items: [{ price: priceIds()[plan][interval], quantity: 1 }],
    // Retour par /api/billing/return, qui enregistre l'abonnement avant d'ouvrir la page Formule.
    success_url: `${env().APP_URL}/api/billing/return?locale=${locale}&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: planPageUrl(locale, "?checkout=cancel"),
    locale: stripeLocale(locale),
    metadata,
    subscription_data: { metadata },
    // La carte seule, comme CRMlead et Scanlead : sinon Stripe propose tout ce qui est activé sur le
    // compte partagé.
    payment_method_types: ["card"],
    billing_address_collection: "required",
    tax_id_collection: { enabled: true },
    customer_update: { address: "auto", name: "auto" },
    ...(env().STRIPE_BILLING_AUTOMATIC_TAX === "1" ? { automatic_tax: { enabled: true } } : {}),
  };
  // Le compte Stripe s'appelle « scanlead.io » : sans ceci, la page de paiement titrerait SCANLEAD.
  const branding = {
    display_name: "InvoiceLead",
    border_style: "rectangular",
    icon: { type: "url", url: "https://invoicelead.io/icons/icon-512.png" },
  };
  const create = (p: Record<string, unknown>) =>
    stripeBilling<{ id: string; url: string }>("POST", "/v1/checkout/sessions", p);
  const session = await create({ ...params, branding_settings: branding }).catch((e) => {
    // Version d'API qui ne connaîtrait pas branding_settings : le paiement passe sans la marque.
    if (e instanceof BillingError && e.status === 400 && /branding/i.test(e.message))
      return create(params);
    throw e;
  });
  await database.insert(auditLog).values({
    organizationId: org.id,
    action: "billing.checkout",
    data: { plan, interval, session: session.id },
  });
  return session.url;
}

/** Portail client Stripe d'InvoiceLead : sa configuration propre, ses seuls abonnements. */
export async function createPortal(
  _database: Db,
  input: { org: BillingOrg; locale: string },
): Promise<string> {
  const configuration = env().STRIPE_BILLING_PORTAL_CONFIGURATION;
  if (!configuration) throw new BillingError(503, "billing_not_configured", "portail");
  if (!input.org.billingCustomerId) throw new BillingError(409, "no_customer", "aucun client");
  const portal = await stripeBilling<{ url: string }>("POST", "/v1/billing_portal/sessions", {
    customer: input.org.billingCustomerId,
    return_url: planPageUrl(input.locale),
    locale: stripeLocale(input.locale),
    configuration,
  });
  return portal.url;
}

/**
 * Retour du Checkout : la session est relue chez Stripe, et son abonnement enregistré tout de suite
 * s'il est bien celui de cette entreprise (sans attendre le webhook, qui fera de même).
 */
export async function syncCheckoutSession(
  database: Db,
  organizationId: string,
  sessionId: string,
): Promise<ApplyResult | "duplicate" | "unknown_subscription" | "not_ours" | "pending"> {
  if (!/^cs_[A-Za-z0-9_]{8,200}$/.test(sessionId)) return "not_ours";
  const session = await stripeBilling<{
    mode?: string;
    status?: string;
    subscription?: string | { id: string } | null;
    metadata?: Record<string, string> | null;
  }>("GET", `/v1/checkout/sessions/${encodeURIComponent(sessionId)}`);
  if (
    session.mode !== "subscription" ||
    session.metadata?.app !== APP ||
    session.metadata?.account_id !== organizationId
  )
    return "not_ours";
  const sub =
    typeof session.subscription === "string" ? session.subscription : session.subscription?.id;
  if (session.status !== "complete" || !sub) return "pending";
  return processSubscription(database, sub);
}
