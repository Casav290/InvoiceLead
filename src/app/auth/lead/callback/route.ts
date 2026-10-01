import { cookies } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";
import { LOGIN_COOKIE, LOGIN_COOKIE_PATH, SESSION_COOKIE } from "@/lib/cookies";
import { attachLeadIdentity } from "@/server/auth/attach";
import { describeLoginError, localeFromRequest, openLogin } from "@/server/auth/login-cookie";
import { cookieOptions, createSession, SESSION_HOURS } from "@/server/auth/session";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { finishLogin } from "@/server/lead-id/leadId";

export const dynamic = "force-dynamic";

/** Retour du Compte Lead : vérifie le jeton, rattache la personne, ouvre la session locale. */
export async function GET(request: NextRequest) {
  const { APP_URL, SESSION_SECRET } = env();
  const store = await cookies();
  const saved = openLogin(store.get(LOGIN_COOKIE)?.value, SESSION_SECRET);
  const locale =
    saved?.locale ??
    localeFromRequest(store.get("NEXT_LOCALE")?.value, request.headers.get("accept-language"));

  const done = (url: string) => {
    const response = NextResponse.redirect(url, 303);
    response.cookies.set(LOGIN_COOKIE, "", { ...cookieOptions(0), path: LOGIN_COOKIE_PATH });
    return response;
  };

  if (!saved) return done(`${APP_URL}/${locale}/login?erreur=session`);

  try {
    const q = request.nextUrl.searchParams;
    const { claims, tokens } = await finishLogin(
      {
        code: q.get("code") ?? undefined,
        state: q.get("state") ?? undefined,
        error: q.get("error") ?? undefined,
      },
      saved,
    );
    const { user, organization } = await attachLeadIdentity(db(), claims);
    const session = await createSession(db(), {
      userId: user.id,
      organizationId: organization.id,
      idToken: tokens.id_token,
    });
    // Retour sur la page demandée avant la connexion, sinon le tableau de bord.
    const next = saved.invite
      ? `/${locale}/invite?token=${saved.invite}`
      : (saved.next ?? `/${locale}/app`);
    const response = done(`${APP_URL}${next}`);
    response.cookies.set(SESSION_COOKIE, session.token, cookieOptions(SESSION_HOURS * 3600));
    return response;
  } catch (error) {
    console.error("[lead-id] callback", describeLoginError(error));
    return done(`${APP_URL}/${locale}/login?erreur=lead`);
  }
}
