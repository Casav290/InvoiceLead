import { cookies } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";
import { LOGIN_COOKIE, LOGIN_COOKIE_PATH, SESSION_COOKIE } from "@/lib/cookies";
import { INVITE_TOKEN, pickLocale, sealLogin } from "@/server/auth/login-cookie";
import { cookieOptions, findSession } from "@/server/auth/session";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { startLogin } from "@/server/lead-id/leadId";

export const dynamic = "force-dynamic";

/** Départ vers le Compte Lead (bouton « Se connecter avec mon compte Lead »). */
export async function GET(request: NextRequest) {
  const { APP_URL, SESSION_SECRET } = env();
  const locale = pickLocale(request.nextUrl.searchParams.get("locale"));
  const inviteParam = request.nextUrl.searchParams.get("invite") ?? "";
  const invite = INVITE_TOKEN.test(inviteParam) ? inviteParam : undefined;

  const current = (await cookies()).get(SESSION_COOKIE)?.value;
  if (current && (await findSession(db(), current))) {
    const next = invite ? `/${locale}/invite?token=${invite}` : `/${locale}/app`;
    return NextResponse.redirect(`${APP_URL}${next}`, 303);
  }

  const login = startLogin({ locale });
  const response = NextResponse.redirect(login.url, 303);
  response.cookies.set(
    LOGIN_COOKIE,
    sealLogin(
      { state: login.state, nonce: login.nonce, verifier: login.verifier, locale, invite },
      SESSION_SECRET,
    ),
    { ...cookieOptions(600), path: LOGIN_COOKIE_PATH },
  );
  return response;
}
