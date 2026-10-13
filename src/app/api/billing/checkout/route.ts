import { billingRequest } from "@/server/billing/request";
import { BillingError, billingConfigured } from "@/server/billing/stripe";
import { createCheckout } from "@/server/billing/subscriptions";
import { db } from "@/server/db";

export const dynamic = "force-dynamic";

/**
 * « Passer à Pro / Pro+ » (page Formule, administrateur) : une session Stripe Checkout pour un
 * abonnement InvoiceLead, puis le paiement chez Stripe. Formulaire : plan (pro, pro_plus), interval
 * (month, year), locale.
 */
export async function POST(request: Request) {
  const r = await billingRequest(request);
  if (!r.ok) return r.response;
  const { session, locale, form, back } = r;
  if (!billingConfigured()) return back("?error=unavailable");
  const plan = form.get("plan");
  const interval = form.get("interval");
  if ((plan !== "pro" && plan !== "pro_plus") || (interval !== "month" && interval !== "year"))
    return back("?error=invalid");
  try {
    const url = await createCheckout(db(), {
      org: session.organization,
      email: session.user.email,
      plan,
      interval,
      locale,
    });
    return Response.redirect(url, 303);
  } catch (e) {
    if (e instanceof BillingError && e.code === "already_subscribed") return back("?error=already");
    console.error("[billing] checkout", e instanceof BillingError ? e.code : e);
    return back("?error=stripe");
  }
}
