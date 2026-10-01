import { cookies } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";
import { LOGIN_COOKIE, LOGIN_COOKIE_PATH, loginCookieName, SESSION_COOKIE } from "@/lib/cookies";
import { attachLeadIdentity } from "@/server/auth/attach";
import {
  cookieBytes,
  describeLoginError,
  doneValue,
  invitePath,
  LOGIN_REQUEST_SECONDS,
  localeFromRequest,
  openLogin,
  readDone,
  returnParams,
  staleDone,
  stateOf,
} from "@/server/auth/login-cookie";
import { loadPage } from "@/server/auth/login-pages";
import { openState } from "@/server/auth/login-state";
import { cookieOptions, createSession, destroySession, SESSION_HOURS } from "@/server/auth/session";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { finishLogin } from "@/server/lead-id/leadId";
import { resumeOrganization } from "@/server/team";

export const dynamic = "force-dynamic";

/** Marque d'une relance automatique de la connexion, pour n'en faire qu'une. */
const RETRY_COOKIE = "il_login_retry";

/**
 * Durée de la trace d'une demande aboutie. L'écran du Compte Lead resté ouvert dans l'onglet d'origine
 * peut reprendre la demande bien après (trois heures au moins) ; la trace ne sert que tant que la
 * session ouverte par cette demande vit, et elle vit SESSION_HOURS.
 */
const DONE_SECONDS = Math.max(SESSION_HOURS * 3600, LOGIN_REQUEST_SECONDS);

/** Retour du Compte Lead : vérifie le jeton, rattache la personne, ouvre la session locale. */
export async function GET(request: NextRequest) {
  const { APP_URL, SESSION_SECRET } = env();
  const store = await cookies();
  const q = request.nextUrl.searchParams;
  const state = q.get("state") ?? "";
  // La demande de cet onglet (cookie nommé d'après son `state`) ; l'ancien cookie commun en secours.
  const cookieName = loginCookieName(state);
  const saved =
    openLogin(store.get(cookieName)?.value, SESSION_SECRET) ??
    openLogin(store.get(LOGIN_COOKIE)?.value, SESSION_SECRET);
  const own = saved && stateOf(saved, state) ? saved : null;
  // La demande voyage aussi dans le `state` (login-state.ts) : lisible même sans son cookie (lien
  // ouvert dans un autre navigateur, écran resté ouvert plus de trois heures).
  const asked = openState(state, SESSION_SECRET);
  // Même demande déjà menée à bout dans un autre onglet : la page exacte où elle a mené.
  const doneName = `${cookieName}_ok`;
  const finished = cookieName === LOGIN_COOKIE ? undefined : readDone(store.get(doneName)?.value);
  const locale =
    asked?.locale ??
    saved?.locale ??
    localeFromRequest(store.get("NEXT_LOCALE")?.value, request.headers.get("accept-language"));
  // Ce que la demande voulait : l'invitation d'abord, sinon la page. Une page trop longue pour le
  // `state` revient entière par le cookie de la demande, sinon par sa référence (login-pages.ts) :
  // le `state` seul n'en a que le chemin. Un `state` d'avant le 01.10.2026 ne porte rien : l'ancien
  // cookie seul le dit.
  const legacy = asked ? null : saved;
  const invite = own?.invite ?? asked?.invite ?? legacy?.invite;
  const kept =
    !own?.next && asked?.ref ? await loadPage(db(), asked.ref, SESSION_SECRET) : undefined;
  const next = own?.next ?? kept ?? asked?.next ?? legacy?.next;
  const wanted = invite ? invitePath(locale, invite) : next;
  // Pour repartir vers le Compte Lead : la trace d'abord (page entière), sinon la demande.
  const back = returnParams(finished?.target ?? wanted);

  const done = (url: string) => {
    const response = NextResponse.redirect(url, 303);
    response.cookies.set(cookieName, "", { ...cookieOptions(0), path: LOGIN_COOKIE_PATH });
    return response;
  };
  // Session InvoiceLead déjà dans ce navigateur : remplacée par celle-ci au succès, et sa ligne
  // effacée (elle peut être celle d'une autre personne : poste partagé, invitation d'un collègue).
  const previous = store.get(SESSION_COOKIE)?.value;

  // Demande de connexion introuvable (plus de trois heures, cookie effacé, autre navigateur) : on la
  // relance une fois, sans écran, vers la même page. Le Compte Lead est maintenant ouvert :
  // l'aller-retour est invisible et la personne arrive sur sa page. Un second échec d'affilée montre
  // l'écran d'erreur, qui garde la page pour « Réessayer ».
  const retried = store.get(RETRY_COOKIE)?.value === "1";
  // Entrée « fraîche » (invitation acceptée, adresse confirmée dans le Compte Lead) : la relance la
  // garde, pour ne jamais retomber sur la session InvoiceLead d'une autre personne restée ici.
  const fresh: Record<string, string> = asked?.fresh ? { fresh: "1" } : {};
  const restart = () => {
    const again = new URLSearchParams({ locale, ...back, ...fresh });
    const response = done(`${APP_URL}/auth/lead/start?${again}`);
    response.cookies.set(RETRY_COOKIE, "1", { ...cookieOptions(120), path: LOGIN_COOKIE_PATH });
    return response;
  };
  const failed = async (reason: "lead" | "session") => {
    const response = done(
      `${APP_URL}/${locale}/login?${new URLSearchParams({ erreur: reason, ...back })}`,
    );
    // Entrée fraîche qui n'aboutit pas : l'identité du Compte Lead n'est pas confirmée, la session
    // InvoiceLead restée dans ce navigateur (peut-être celle d'une autre personne) ne doit pas
    // prendre le relais derrière l'écran d'erreur. Seul un `state` scellé par ce serveur le dit.
    if (asked?.fresh && previous) {
      await destroySession(db(), previous).catch(() => null);
      response.cookies.set(SESSION_COOKIE, "", cookieOptions(0));
    }
    return response;
  };
  // Même demande déjà menée à bout dans un autre onglet (lien d'email, onglet resté ouvert) :
  // la session est ouverte, on va tout droit à la page qu'elle demandait.
  if (!saved && finished && store.get(SESSION_COOKIE)?.value)
    return done(`${APP_URL}${finished.target}`);
  if (!saved) return retried ? failed("session") : restart();

  try {
    const { claims, tokens } = await finishLogin(
      {
        code: q.get("code") ?? undefined,
        state: state || undefined,
        error: q.get("error") ?? undefined,
      },
      // Le `state` n'est rendu que s'il est celui de ce cookie : sinon refus (state_mismatch).
      { state: stateOf(saved, state) ?? "", nonce: saved.nonce, verifier: saved.verifier },
    );
    const { user, organization } = await attachLeadIdentity(db(), claims);
    // Fiduciaire passée chez un client : la session repart dans cette entreprise tant que son accès
    // y tient, pour que la page demandée (fiche, liste) soit bien celle du client. Une invitation à
    // accepter part de l'entreprise du Compte Lead : l'acceptation change d'entreprise.
    const organizationId = invite
      ? organization.id
      : await resumeOrganization(db(), user, organization.id);
    const session = await createSession(db(), {
      userId: user.id,
      organizationId,
      idToken: tokens.id_token,
    });
    if (previous) await destroySession(db(), previous).catch(() => null);
    // Retour sur la page demandée avant la connexion, sinon le tableau de bord.
    const landing = wanted ?? `/${locale}/app`;
    const response = done(`${APP_URL}${landing}`);
    response.cookies.set(SESSION_COOKIE, session.token, cookieOptions(SESSION_HOURS * 3600));
    response.cookies.set(RETRY_COOKIE, "", { ...cookieOptions(0), path: LOGIN_COOKIE_PATH });
    // Trace de la demande aboutie (sa page seulement, rien de secret), pour l'onglet d'origine qui
    // reprendrait la même demande plus tard. Les plus anciennes s'effacent.
    if (cookieName !== LOGIN_COOKIE) {
      const trace = doneValue(landing);
      for (const old of staleDone(store.getAll(), cookieBytes(doneName, trace), doneName))
        response.cookies.set(old, "", { ...cookieOptions(0), path: LOGIN_COOKIE_PATH });
      response.cookies.set(doneName, trace, {
        ...cookieOptions(DONE_SECONDS),
        path: LOGIN_COOKIE_PATH,
      });
    }
    return response;
  } catch (error) {
    console.error("[lead-id] callback", describeLoginError(error));
    // `state` d'une autre demande (deux onglets) : même relance unique, sans écran.
    if (!retried && /state_mismatch/.test(describeLoginError(error))) return restart();
    // L'écran d'erreur garde la page demandée (ou l'invitation) : « Réessayer » y ramène.
    return failed("lead");
  }
}
