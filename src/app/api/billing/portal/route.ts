import { billingRequest } from "@/server/billing/request";
import { BillingError, portalConfigured } from "@/server/billing/stripe";
import { createPortal } from "@/server/billing/subscriptions";
import { db } from "@/server/db";

export const dynamic = "force-dynamic";

/**
 * « Gérer l'abonnement » (page Formule, administrateur) : le portail client Stripe d'InvoiceLead,
 * avec sa configuration propre (ses formules, résiliation en fin de période) et le client Stripe
 * propre à InvoiceLead : on n'y voit ni ne résilie l'abonnement d'une autre application Lead.
 */
export async function POST(request: Request) {
  const r = await billingRequest(request);
  if (!r.ok) return r.response;
  const { session, locale, back } = r;
  if (!portalConfigured()) return back("?error=unavailable");
  try {
    return Response.redirect(await createPortal(db(), { org: session.organization, locale }), 303);
  } catch (e) {
    if (e instanceof BillingError && e.code === "no_customer") return back("?error=noCustomer");
    console.error("[billing] portail", e instanceof BillingError ? e.code : e);
    return back("?error=stripe");
  }
}
