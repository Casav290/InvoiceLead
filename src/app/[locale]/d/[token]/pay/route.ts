import { type NextRequest, NextResponse } from "next/server";
import { pickLocale } from "@/server/auth/login-cookie";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { findSharedDocument } from "@/server/sharing";
import { createCheckout, stripeConfigured } from "@/server/stripe";

export const dynamic = "force-dynamic";

/** Paiement en ligne depuis le lien de consultation : ouvre Stripe Checkout pour le solde. */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ locale: string; token: string }> },
) {
  const { locale: raw, token } = await params;
  const locale = pickLocale(raw);
  const page = `${env().APP_URL}/${locale}/d/${token}`;
  const found = stripeConfigured() ? await findSharedDocument(db(), token) : null;
  if (!found) return NextResponse.redirect(page, 303);
  try {
    const url = await createCheckout(db(), {
      organizationId: found.invoice.organizationId,
      invoiceId: found.invoice.id,
      successUrl: `${page}?paid=1`,
      cancelUrl: page,
    });
    return NextResponse.redirect(url ?? page, 303);
  } catch (e) {
    console.error("[stripe] checkout", e instanceof Error ? e.message : "inconnu");
    return NextResponse.redirect(`${page}?payError=1`, 303);
  }
}
