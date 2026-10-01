import { cookies } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";
import { LOGIN_COOKIE_PATH, loginCookieName, SESSION_COOKIE } from "@/lib/cookies";
import {
  cookieBytes,
  hashState,
  invitePath,
  LOGIN_REQUEST_SECONDS,
  pickLocale,
  safeInvite,
  safeNext,
  sealLogin,
  stalePending,
} from "@/server/auth/login-cookie";
import { nextForState, sealState } from "@/server/auth/login-state";
import { cookieOptions, findSession } from "@/server/auth/session";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { startLogin } from "@/server/lead-id/leadId";

export const dynamic = "force-dynamic";

/** Départ vers le Compte Lead (bouton « Se connecter avec mon compte Lead »). */
export async function GET(request: NextRequest) {
  // Lecture par le routeur de Next (en-tête RSC) d'une redirection vers ici, lancée par une page ou
  // une action serveur dont la session a expiré : rien à lancer. Sans contenu, le routeur rouvre
  // cette adresse en navigation complète, et c'est elle qui pose l'unique demande de connexion.
  if (request.headers.get("rsc") === "1")
    return new NextResponse(null, { status: 204, headers: { "Cache-Control": "no-store" } });

  const { APP_URL, SESSION_SECRET } = env();
  const locale = pickLocale(request.nextUrl.searchParams.get("locale"));
  const invite = safeInvite(request.nextUrl.searchParams.get("invite"));
  // Page demandée avant la connexion (« /fr/app/invoices/… ») : on y revient ensuite.
  const next = invite ? undefined : safeNext(request.nextUrl.searchParams.get("next"));
  // Depuis « Créer un compte » : le Compte Lead ouvre directement son inscription.
  const signup = request.nextUrl.searchParams.get("signup") === "1";

  const current = (await cookies()).get(SESSION_COOKIE)?.value;
  if (current && (await findSession(db(), current))) {
    const target = invite ? invitePath(locale, invite) : (next ?? `/${locale}/app`);
    return NextResponse.redirect(`${APP_URL}${target}`, 303);
  }

  const login = startLogin({ locale, ...(signup ? { prompt: "create" as const } : {}) });
  // La demande (langue, page, invitation) part dans le `state`, chiffrée : elle revient même sans
  // ce cookie (login-state.ts). Le cookie garde ce qui prouve que le retour est le sien.
  const state = sealState(
    { locale, ...(invite ? { invite } : {}), ...(next ? { next } : {}) },
    SESSION_SECRET,
  );
  const authorize = new URL(login.url);
  authorize.searchParams.set("state", state);
  const response = NextResponse.redirect(authorize, 303);

  const name = loginCookieName(state);
  const value = sealLogin(
    {
      stateHash: hashState(state),
      nonce: login.nonce,
      verifier: login.verifier,
      at: Date.now(),
      // Page trop longue pour le `state` (lien d'import de CRMlead) : entière ici.
      ...(next && nextForState(next) !== next ? { next } : {}),
    },
    SESSION_SECRET,
  );
  // Demandes abandonnées : seules les plus récentes restent, sous la limite d'en-têtes de Node.
  for (const old of stalePending(
    request.cookies.getAll(),
    SESSION_SECRET,
    cookieBytes(name, value),
  ))
    response.cookies.set(old, "", { ...cookieOptions(0), path: LOGIN_COOKIE_PATH });
  response.cookies.set(name, value, {
    ...cookieOptions(LOGIN_REQUEST_SECONDS),
    path: LOGIN_COOKIE_PATH,
  });
  return response;
}
