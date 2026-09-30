import { createHmac, timingSafeEqual } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { Db } from "./db";
import { auditLog, invoicePayments, invoices, organizations } from "./db/schema";
import { env } from "./env";
import { invoiceBalance, paymentFxRate } from "./payments";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Paiement en ligne par Stripe Connect (comptes « Standard ») : l'entreprise relie son compte
 * Stripe, le client paie par carte, TWINT, SEPA ou ACH selon ce que ce compte accepte, et Stripe
 * prévient InvoiceLead, qui enregistre le paiement. L'argent va directement à l'entreprise.
 */
export function stripeConfigured(): boolean {
  const e = env();
  return !!(e.STRIPE_SECRET_KEY && e.STRIPE_CONNECT_CLIENT_ID);
}

const base = (url: string) => url.replace(/\/+$/, "");

/** Adresse d'autorisation Stripe Connect. */
export function connectAuthorizeUrl(state: string, redirectUri: string): string {
  const e = env();
  const q = new URLSearchParams({
    response_type: "code",
    client_id: e.STRIPE_CONNECT_CLIENT_ID ?? "",
    scope: "read_write",
    state,
    redirect_uri: redirectUri,
  });
  return `${base(e.STRIPE_CONNECT_URL)}/oauth/authorize?${q}`;
}

async function stripePost(url: string, form: Record<string, string>, account?: string) {
  const e = env();
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${e.STRIPE_SECRET_KEY ?? ""}`,
      "Content-Type": "application/x-www-form-urlencoded",
      ...(account ? { "Stripe-Account": account } : {}),
    },
    body: new URLSearchParams(form),
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error(`stripe:${res.status}`);
  return body;
}

/** Échange le code d'autorisation contre l'identifiant du compte connecté (acct_…). */
export async function exchangeConnectCode(code: string): Promise<string> {
  const body = await stripePost(`${base(env().STRIPE_CONNECT_URL)}/oauth/token`, {
    grant_type: "authorization_code",
    code,
  });
  const account = body.stripe_user_id;
  if (typeof account !== "string" || !account.startsWith("acct_"))
    throw new Error("stripe:account");
  return account;
}

export async function saveStripeAccount(
  database: Db,
  who: { organizationId: string; userId: string },
  account: string | null,
) {
  await database
    .update(organizations)
    .set({ stripeAccountId: account, updatedAt: new Date() })
    .where(eq(organizations.id, who.organizationId));
  await database.insert(auditLog).values({
    organizationId: who.organizationId,
    userId: who.userId,
    action: account ? "stripe.connect" : "stripe.disconnect",
  });
}

/**
 * Session de paiement Stripe Checkout pour le solde d'une facture, sur le compte de l'entreprise.
 * Les moyens de paiement proposés sont ceux activés dans ce compte (paiements automatiques).
 */
export async function createCheckout(
  database: Db,
  input: {
    organizationId: string;
    invoiceId: string;
    successUrl: string;
    cancelUrl: string;
  },
): Promise<string | null> {
  const [row] = await database
    .select({ invoice: invoices, account: organizations.stripeAccountId })
    .from(invoices)
    .innerJoin(organizations, eq(organizations.id, invoices.organizationId))
    .where(
      and(eq(invoices.id, input.invoiceId), eq(invoices.organizationId, input.organizationId)),
    );
  if (!row?.account || row.invoice.kind !== "invoice" || row.invoice.status !== "issued")
    return null;
  const { openCents } = await invoiceBalance(database, row.invoice.id, row.invoice.totalCents);
  if (openCents <= 0) return null;
  const session = await stripePost(
    `${base(env().STRIPE_API_URL)}/v1/checkout/sessions`,
    {
      mode: "payment",
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      "line_items[0][quantity]": "1",
      "line_items[0][price_data][currency]": row.invoice.currency.toLowerCase(),
      "line_items[0][price_data][unit_amount]": String(openCents),
      "line_items[0][price_data][product_data][name]": `${row.invoice.number ?? ""} · ${row.invoice.sender?.name ?? ""}`,
      "metadata[invoice_id]": row.invoice.id,
      "metadata[organization_id]": row.invoice.organizationId,
      "payment_intent_data[metadata][invoice_id]": row.invoice.id,
      ...(row.invoice.recipient?.email ? { customer_email: row.invoice.recipient.email } : {}),
    },
    row.account,
  );
  return typeof session.url === "string" ? session.url : null;
}

/**
 * Vérifie la signature d'une notification Stripe (en-tête Stripe-Signature : t=…,v1=…), avec une
 * tolérance de cinq minutes contre le rejeu.
 */
export function verifyStripeSignature(
  payload: string,
  header: string | null,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): boolean {
  if (!header) return false;
  const parts = Object.fromEntries(
    header.split(",").map((p) => {
      const i = p.indexOf("=");
      return [p.slice(0, i).trim(), p.slice(i + 1).trim()];
    }),
  );
  const t = Number(parts.t);
  if (!Number.isFinite(t) || Math.abs(nowSeconds - t) > 300) return false;
  const expected = createHmac("sha256", secret).update(`${t}.${payload}`).digest("hex");
  const given = header
    .split(",")
    .filter((p) => p.trim().startsWith("v1="))
    .map((p) => p.trim().slice(3));
  return given.some(
    (g) => g.length === expected.length && timingSafeEqual(Buffer.from(g), Buffer.from(expected)),
  );
}

type CheckoutEvent = {
  type?: string;
  account?: string;
  data?: {
    object?: {
      id?: string;
      payment_status?: string;
      amount_total?: number;
      created?: number;
      metadata?: { invoice_id?: string; organization_id?: string };
    };
  };
};

/**
 * Traite une notification : un paiement Checkout abouti devient un paiement de la facture (moyen
 * « online »), une seule fois par session. Rend ce qui a été fait, pour le journal du serveur.
 */
export async function handleStripeEvent(
  database: Db,
  event: CheckoutEvent,
): Promise<"recorded" | "duplicate" | "ignored"> {
  const s = event.data?.object;
  if (event.type !== "checkout.session.completed" || s?.payment_status !== "paid") return "ignored";
  const invoiceId = s.metadata?.invoice_id;
  const organizationId = s.metadata?.organization_id;
  if (!s.id || !invoiceId || !organizationId || !s.amount_total) return "ignored";
  if (!UUID_RE.test(invoiceId) || !UUID_RE.test(organizationId)) return "ignored";
  const paidOn = new Date((s.created ?? Date.now() / 1000) * 1000).toISOString().slice(0, 10);
  // Facture en devise : cours du jour du paiement, cherché avant de verrouiller la facture.
  const fxRate = await paymentFxRate(database, invoiceId, paidOn, null);
  return database.transaction(async (tx) => {
    const [row] = await tx
      .select({ invoice: invoices, account: organizations.stripeAccountId })
      .from(invoices)
      .innerJoin(organizations, eq(organizations.id, invoices.organizationId))
      .where(and(eq(invoices.id, invoiceId), eq(invoices.organizationId, organizationId)))
      .for("update");
    // La notification doit venir du compte relié à l'entreprise de la facture.
    if (!row?.account || row.account !== event.account) return "ignored";
    // Stripe renvoie parfois la même notification : une session déjà enregistrée n'est pas rejouée.
    const [known] = await tx
      .select({ id: invoicePayments.id })
      .from(invoicePayments)
      .where(eq(invoicePayments.externalRef, s.id ?? ""))
      .limit(1);
    if (known) return "duplicate";
    const { openCents } = await invoiceBalance(
      tx as unknown as Db,
      invoiceId,
      row.invoice.totalCents,
    );
    const amount = Math.min(s.amount_total ?? 0, openCents);
    if (amount <= 0) {
      await tx.insert(auditLog).values({
        organizationId,
        action: "payment.online.overpaid",
        entity: "invoice",
        entityId: invoiceId,
        data: { session: s.id, amountCents: s.amount_total },
      });
      return "ignored";
    }
    const inserted = await tx
      .insert(invoicePayments)
      .values({
        organizationId,
        invoiceId,
        paidOn,
        amountCents: amount,
        method: "online",
        note: "Stripe",
        externalRef: s.id,
        fxRate,
      })
      .onConflictDoNothing()
      .returning({ id: invoicePayments.id });
    if (inserted.length === 0) return "duplicate";
    await tx.insert(auditLog).values({
      organizationId,
      action: "payment.online",
      entity: "invoice",
      entityId: invoiceId,
      data: { paymentId: inserted[0]?.id, amountCents: amount, session: s.id },
    });
    return "recorded";
  });
}
