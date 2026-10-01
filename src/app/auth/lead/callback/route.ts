import { cookies } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";
import { LOGIN_COOKIE, LOGIN_COOKIE_PATH, loginCookieName, SESSION_COOKIE } from "@/lib/cookies";
import { attachLeadIdentity } from "@/server/auth/attach";
import { describeLoginError, localeFromRequest, openLogin } from "@/server/auth/login-cookie";
import { cookieOptions, createSession, SESSION_HOURS } from "@/server/auth/session";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { finishLogin } from "@/server/lead-id/leadId";

export const dynamic = "force-dynamic";

/** Marque d'une relance automatique de la connexion, pour n'en faire qu'une. */
const RETRY_COOKIE = "il_login_retry";

/** Retour du Compte Lead : vérifie le jeton, rattache la personne, ouvre la session locale. */
export async function GET(request: NextRequest) {
  const { APP_URL, SESSION_SECRET } = env();
  const store = await cookies();
  // La demande de cet onglet (cookie nommé d'après son `state`) ; l'ancien cookie commun en secours.
  const cookieName = loginCookieName(request.nextUrl.searchParams.get("state") ?? "");
  const saved =
    openLogin(store.get(cookieName)?.value, SESSION_SECRET) ??
    openLogin(store.get(LOGIN_COOKIE)?.value, SESSION_SECRET);
  const locale =
    saved?.locale ??
    localeFromRequest(store.get("NEXT_LOCALE")?.value, request.headers.get("accept-language"));

  const done = (url: string) => {
    const response = NextResponse.redirect(url, 303);
    response.cookies.set(cookieName, "", { ...cookieOptions(0), path: LOGIN_COOKIE_PATH });
    return response;
  };

  // Demande de connexion introuvable (plus de 30 minutes, autre onglet, cookie effacé) : on la
  // relance une fois, sans écran. Le Compte Lead est maintenant ouvert : l'aller-retour est invisible
  // et la personne arrive dans l'application. Un second échec d'affilée montre l'écran d'erreur.
  const retried = store.get(RETRY_COOKIE)?.value === "1";
  const restart = () => {
    const again = new URLSearchParams({ locale, ...(saved?.next ? { next: saved.next } : {}) });
    const response = done(`${APP_URL}/auth/lead/start?${again}`);
    response.cookies.set(RETRY_COOKIE, "1", { ...cookieOptions(120), path: LOGIN_COOKIE_PATH });
    return response;
  };
  if (!saved) return retried ? done(`${APP_URL}/${locale}/login?erreur=session`) : restart();

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
    response.cookies.set(RETRY_COOKIE, "", { ...cookieOptions(0), path: LOGIN_COOKIE_PATH });
    return response;
  } catch (error) {
    console.error("[lead-id] callback", describeLoginError(error));
    // `state` d'une autre demande (deux onglets) : même relance unique, sans écran.
    if (!retried && /state_mismatch/.test(describeLoginError(error))) return restart();
    // L'écran d'erreur garde la page demandée : « Réessayer » y ramène.
    const back = saved.next ? `&${new URLSearchParams({ next: saved.next })}` : "";
    return done(`${APP_URL}/${locale}/login?erreur=lead${back}`);
  }
}
