import { NextResponse } from "next/server";
import type { StripeEvent } from "@/server/billing/stripe";
import { handleBillingEvent } from "@/server/billing/subscriptions";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { verifyStripeSignature } from "@/server/stripe";

export const dynamic = "force-dynamic";

/**
 * Événements Stripe de l'abonnement InvoiceLead, signés avec STRIPE_BILLING_WEBHOOK_SECRET : un
 * endpoint et un secret distincts de Stripe Connect (/api/stripe/webhook, STRIPE_WEBHOOK_SECRET).
 *
 * Le compte Stripe est partagé par les applications Lead : un événement d'une autre application,
 * ou de Stripe Connect, reçoit 200 sans aucune écriture (handleBillingEvent). Le corps est lu brut :
 * la signature porte sur les octets reçus.
 */
export async function POST(request: Request) {
  const secret = env().STRIPE_BILLING_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: "billing_not_configured" }, { status: 503 });
  const payload = await request.text();
  if (!verifyStripeSignature(payload, request.headers.get("stripe-signature"), secret))
    return NextResponse.json({ error: "signature" }, { status: 400 });
  let event: StripeEvent;
  try {
    event = JSON.parse(payload);
  } catch {
    return NextResponse.json({ error: "payload" }, { status: 400 });
  }
  if (typeof event?.id !== "string" || typeof event?.type !== "string")
    return NextResponse.json({ error: "payload" }, { status: 400 });
  try {
    const result = await handleBillingEvent(db(), event);
    return NextResponse.json({ received: true, result });
  } catch (e) {
    // Stripe injoignable ou base en échec : rien n'est inscrit, Stripe renverra l'événement.
    console.error("[billing] webhook", event.id, event.type, (e as Error).message);
    return NextResponse.json({ error: "retry" }, { status: 500 });
  }
}
