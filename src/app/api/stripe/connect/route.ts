import { type NextRequest, NextResponse } from "next/server";
import { sign } from "@/server/auth/crypto";
import { requirePermission } from "@/server/auth/guard";
import { pickLocale } from "@/server/auth/login-cookie";
import { env } from "@/server/env";
import { connectAuthorizeUrl, stripeConfigured } from "@/server/stripe";

export const dynamic = "force-dynamic";

/** Départ vers Stripe Connect pour relier le compte Stripe de l'entreprise. */
export async function GET(request: NextRequest) {
  const locale = pickLocale(request.nextUrl.searchParams.get("locale"));
  // /api/* échappe au proxy (pas de page de retour en en-tête) : session expirée, retour après la
  // reconnexion sur la page Paiements d'où part le bouton, pour cliquer à nouveau. Jamais ce départ
  // vers Stripe lui-même, qui partirait sans un nouveau clic.
  const session = await requirePermission(locale, "company", {
    next: `/${locale}/app/settings/payments`,
  });
  const { APP_URL, SESSION_SECRET } = env();
  if (!stripeConfigured())
    return NextResponse.redirect(`${APP_URL}/${locale}/app/settings/payments`, 303);
  // État signé : entreprise, personne, langue et heure, vérifiés au retour.
  const state = sign(
    [session.organization.id, session.user.id, locale, Date.now()].join("."),
    SESSION_SECRET,
  );
  return NextResponse.redirect(connectAuthorizeUrl(state, `${APP_URL}/api/stripe/callback`), 303);
}
