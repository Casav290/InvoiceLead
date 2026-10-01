import { cookies } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";
import { AFTER_LOGOUT_COOKIE, SESSION_COOKIE } from "@/lib/cookies";
import { invitePath, pickLocale, safeInvite } from "@/server/auth/login-cookie";
import { cookieOptions, destroySession } from "@/server/auth/session";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { logoutUrl } from "@/server/lead-id/leadId";

export const dynamic = "force-dynamic";

/**
 * Déconnexion : la session locale, puis celle du Compte Lead, retour à l'accueil. Depuis une
 * invitation envoyée à une autre adresse (« Changer de compte »), retour sur cette invitation : le
 * Compte Lead ramène à l'accueil, où le proxy reprend l'invitation (AFTER_LOGOUT_COOKIE).
 */
export async function POST(request: NextRequest) {
  const { APP_URL } = env();
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(APP_URL).origin) {
    return new NextResponse("Forbidden", { status: 403 });
  }
  const form = await request.formData().catch(() => null);
  const locale = pickLocale(form?.get("locale"));
  const invite = safeInvite(String(form?.get("invite") ?? ""));

  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const idToken = token ? await destroySession(db(), token) : null;

  const response = NextResponse.redirect(logoutUrl(idToken, `${APP_URL}/`), 303);
  response.cookies.set(SESSION_COOKIE, "", cookieOptions(0));
  response.cookies.set("NEXT_LOCALE", locale, { path: "/", sameSite: "lax", maxAge: 31_536_000 });
  // Lax : le cookie part avec le retour du Compte Lead (navigation depuis un autre site). Dix minutes.
  if (invite)
    response.cookies.set(AFTER_LOGOUT_COOKIE, invitePath(locale, invite), cookieOptions(600));
  else if (request.cookies.has(AFTER_LOGOUT_COOKIE))
    response.cookies.set(AFTER_LOGOUT_COOKIE, "", cookieOptions(0));
  return response;
}
