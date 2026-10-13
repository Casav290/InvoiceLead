import { type NextRequest, NextResponse } from "next/server";
import { pickLocale } from "@/server/auth/login-cookie";
import { getSession } from "@/server/auth/session";
import { BillingError, billingConfigured } from "@/server/billing/stripe";
import { planPageUrl, syncCheckoutSession } from "@/server/billing/subscriptions";
import { db } from "@/server/db";
import { env } from "@/server/env";

export const dynamic = "force-dynamic";

/**
 * Retour de Stripe Checkout (success_url) : la session est relue chez Stripe et son abonnement
 * enregistré tout de suite, s'il est bien celui de l'entreprise de la session (sans attendre le
 * webhook, qui fera de même), puis la page Formule. Ici et non dans la page : l'en-tête et le
 * contrôle des places de l'application voient déjà la nouvelle formule (un administrateur sans
 * place qui vient de passer à Pro+ entre directement).
 */
export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams;
  const locale = pickLocale(q.get("locale"));
  const sessionId = q.get("session_id") ?? "";
  const session = await getSession();
  if (!session) {
    // Session expirée pendant le paiement : reconnexion ; le webhook aura enregistré l'abonnement.
    const next = `/${locale}/app/settings/plan?checkout=pending`;
    return NextResponse.redirect(
      `${env().APP_URL}/${locale}/login?${new URLSearchParams({ next })}`,
      303,
    );
  }
  let done = false;
  if (billingConfigured()) {
    const result = await syncCheckoutSession(db(), session.organization.id, sessionId).catch(
      (e) => {
        console.error("[billing] retour du paiement", e instanceof BillingError ? e.code : e);
        return "pending" as const;
      },
    );
    done = result === "applied" || result === "duplicate";
  }
  return NextResponse.redirect(planPageUrl(locale, `?checkout=${done ? "done" : "pending"}`), 303);
}
