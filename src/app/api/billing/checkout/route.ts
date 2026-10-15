import { billingRequest } from "@/server/billing/request";
import { BillingError, billingConfigured } from "@/server/billing/stripe";
import { createCheckout } from "@/server/billing/subscriptions";
import { db } from "@/server/db";
import { refreshPlan } from "@/server/plan-refresh";

export const dynamic = "force-dynamic";

/**
 * « Passer à Pro / Pro+ » (page Formule, administrateur) : une session Stripe Checkout pour un
 * abonnement InvoiceLead, puis le paiement chez Stripe. Formulaire : plan (pro, pro_plus), interval
 * (month, year), locale. Une formule qui n'est pas au-dessus de la formule acquise (formule propre du
 * Compte Lead comprise, relue si elle a plus de 12 h) revient sur la page Formule (?error=already)
 * sans aucun appel à Stripe.
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
    // Formule du Compte Lead de plus de 12 h : relue avant de décider (createCheckout lit la base).
    await refreshPlan(db(), session.organization);
    const url = await createCheckout(db(), {
      org: session.organization,
      email: session.user.email,
      plan,
      interval,
      locale,
    });
    return Response.redirect(url, 303);
  } catch (e) {
    if (
      e instanceof BillingError &&
      (e.code === "already_subscribed" || e.code === "plan_not_above")
    )
      return back("?error=already");
    console.error("[billing] checkout", e instanceof BillingError ? e.code : e);
    return back("?error=stripe");
  }
}
