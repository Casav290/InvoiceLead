import { NextResponse } from "next/server";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { handleStripeEvent, verifyStripeSignature } from "@/server/stripe";

export const dynamic = "force-dynamic";

/** Notifications Stripe (événements des comptes connectés), signées avec STRIPE_WEBHOOK_SECRET. */
export async function POST(request: Request) {
  const secret = env().STRIPE_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: "not_configured" }, { status: 503 });
  const payload = await request.text();
  if (!verifyStripeSignature(payload, request.headers.get("stripe-signature"), secret))
    return NextResponse.json({ error: "signature" }, { status: 400 });
  let event: Parameters<typeof handleStripeEvent>[1];
  try {
    event = JSON.parse(payload);
  } catch {
    return NextResponse.json({ error: "payload" }, { status: 400 });
  }
  const result = await handleStripeEvent(db(), event);
  return NextResponse.json({ received: true, result });
}
