import { cookies } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";
import { isLocale } from "@/i18n/locales";
import {
  LOGIN_COOKIE_PATH,
  loginCookieName,
  PROBE_COOKIE,
  PROBE_SECONDS,
  SESSION_COOKIE,
} from "@/lib/cookies";
import { hasProbeMarker, safeFrom, silentReturn } from "@/lib/lead-entry";
import { isNativeAgent } from "@/lib/native";
import {
  cookieBytes,
  hashState,
  invitePath,
  LOGIN_REQUEST_SECONDS,
  localeFromRequest,
  pickLocale,
  safeInvite,
  safeNext,
  sealLogin,
  stalePending,
} from "@/server/auth/login-cookie";
import { clientKey, savePage } from "@/server/auth/login-pages";
import { nextForState, sealState } from "@/server/auth/login-state";
import { cookieOptions, findSession, probeCookieOptions } from "@/server/auth/session";
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
  const q = request.nextUrl.searchParams;
  // Langue donnée par l'adresse. Sans elle (/login des lanceurs, racine « / »), l'arrivée prend celle
  // du Compte Lead (callback, claims.locale) ; la langue du navigateur ne sert qu'aux écrans d'erreur.
  const asked = q.get("locale");
  const given = isLocale(asked) ? asked : undefined;
  const locale =
    given ??
    localeFromRequest(
      request.cookies.get("NEXT_LOCALE")?.value,
      request.headers.get("accept-language"),
    );
  const invite = safeInvite(q.get("invite"));
  // Page demandée avant la connexion (« /fr/app/invoices/… ») : on y revient ensuite.
  const next = invite ? undefined : safeNext(q.get("next"));
  // Depuis « Créer un compte » : le Compte Lead ouvre directement son inscription.
  const signup = q.get("signup") === "1";
  // Essai silencieux depuis une adresse d'entrée (racine tapée, lead-entry.ts) : le Compte Lead rend
  // un code sans écran si sa session est ouverte, sinon une erreur (login_required), et l'on revient
  // sur `from`, la page publique (callback). Jamais avec l'inscription, qui montre un écran.
  const silent = q.get("prompt") === "none" && !signup;
  const from = silent ? (safeFrom(q.get("from")) ?? (given ? `/${given}` : "/")) : undefined;
  // Depuis une page du Compte Lead qui vient d'ouvrir ou de changer sa session (invitation acceptée,
  // adresse confirmée) : la session InvoiceLead de ce navigateur peut être celle d'une autre personne
  // (poste partagé, administrateur qui essaie le lien). On repasse toujours par le Compte Lead, sans
  // écran puisqu'il est ouvert : la session locale suit alors son identité (callback). Rien n'est
  // effacé ici : n'importe quel site peut ouvrir cette adresse.
  const fresh = q.get("fresh") === "1";
  // Relance automatique d'un retour sans sa demande (callback) : la nouvelle demande le porte, pour
  // qu'un second retour sans demande montre l'écran d'erreur au lieu de relancer encore. Posé par un
  // autre site, il ne fait que retirer cette relance-là ; il ne donne jamais de session.
  const retry = q.get("retry") === "1";
  // « Changer de compte » (page de refus, refusal.ts) : le Compte Lead redemande l'identifiant
  // (prompt=login, formulaire vide), jamais la session reprise, même ouverte ici ou chez lui. Comme
  // une entrée fraîche, la session InvoiceLead restée dans ce navigateur ne prend pas le relais : la
  // nouvelle identité la remplace au retour (callback). Rien n'est effacé ici : n'importe quel site
  // peut ouvrir cette adresse, qui ne fait que montrer le formulaire du Compte Lead.
  const switching = q.get("switch") === "1" && !signup && !silent;

  const current = (await cookies()).get(SESSION_COOKIE)?.value;
  const found = !fresh && !switching && current ? await findSession(db(), current) : null;
  if (found) {
    // Déjà connectée ici : l'accueil de l'espace, dans la langue de l'adresse ou, sans elle, dans
    // celle de son Compte Lead (relue à chaque connexion, attach.ts).
    const home = `/${given ?? pickLocale(found.user.chosenLocale ?? found.user.locale)}/app`;
    const target = invite ? invitePath(locale, invite) : (next ?? home);
    return NextResponse.redirect(`${APP_URL}${target}`, 303);
  }
  // Essai silencieux avec le cookie d'une session qui n'existe plus (fermée par le Compte Lead,
  // déconnexion de partout) : le cookie ne vaut plus rien. Effacé, pour que le retour sur la racine
  // montre la page publique au lieu de repartir ici (lead-entry.ts).
  const stale = silent && !fresh && Boolean(current);
  // Essai silencieux déjà fait (cookie lead_probe, ou marque « lead_probe » dans la page de retour
  // quand les cookies sont refusés) : retour immédiat sur la page publique, sans passer par le Compte
  // Lead. Pas de boucle possible, même sans aucun cookie (la marque reste alors dans l'adresse).
  const probed = request.cookies.has(PROBE_COOKIE);
  if (silent && from && (probed || hasProbeMarker(from))) {
    const response = NextResponse.redirect(`${APP_URL}${silentReturn(from, probed)}`, 303);
    response.headers.set("Cache-Control", "no-store");
    if (stale) response.cookies.set(SESSION_COOKIE, "", cookieOptions(0));
    return response;
  }

  const login = startLogin({
    ...(given ? { locale: given } : {}),
    ...(isNativeAgent(request.headers.get("user-agent")) ? { app: true } : {}),
    ...(signup
      ? { prompt: "create" as const }
      : silent
        ? { prompt: "none" as const }
        : switching
          ? { prompt: "login" as const }
          : {}),
  });
  // Page trop longue pour le `state` (lien d'import de CRMlead) : gardée côté serveur, le `state`
  // en porte la référence (login-pages.ts). Elle revient entière même sans le cookie de la demande.
  // Écriture sans session : plafonnée par réseau (clientKey) et au total.
  const long = next !== undefined && nextForState(next) !== next;
  const ref = long
    ? await savePage(db(), next, SESSION_SECRET, clientKey(request.headers, SESSION_SECRET))
    : undefined;
  // La demande (langue, page, invitation) part dans le `state`, chiffrée : elle revient même sans
  // ce cookie (login-state.ts). Le cookie garde ce qui prouve que le retour est le sien.
  const state = sealState(
    {
      locale,
      ...(given ? {} : { auto: true as const }),
      ...(silent ? { silent: true as const, from } : {}),
      ...(invite ? { invite } : {}),
      ...(next ? { next } : {}),
      ...(fresh || switching ? { fresh: true as const } : {}),
      ...(ref ? { ref } : {}),
      ...(retry ? { retry: true as const } : {}),
    },
    SESSION_SECRET,
  );
  const authorize = new URL(login.url);
  authorize.searchParams.set("state", state);
  const response = NextResponse.redirect(authorize, 303);
  response.headers.set("Cache-Control", "no-store");
  if (stale) response.cookies.set(SESSION_COOKIE, "", cookieOptions(0));
  // Un seul essai silencieux : le retour sur la racine, réussi ou non, ne repart pas vers le Compte
  // Lead. Une connexion aboutie efface la marque (callback).
  if (silent) response.cookies.set(PROBE_COOKIE, "1", probeCookieOptions(PROBE_SECONDS));

  const name = loginCookieName(state);
  const value = sealLogin(
    {
      stateHash: hashState(state),
      nonce: login.nonce,
      verifier: login.verifier,
      at: Date.now(),
      // Page trop longue pour le `state` (lien d'import de CRMlead) : entière ici aussi.
      ...(long ? { next } : {}),
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
