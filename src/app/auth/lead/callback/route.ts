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
  restartable,
  returnParams,
  staleDone,
  stateOf,
} from "@/server/auth/login-cookie";
import { loadPage } from "@/server/auth/login-pages";
import { openState } from "@/server/auth/login-state";
import {
  checkOtherSessionsSoon,
  cookieOptions,
  createSession,
  destroySession,
  dropSessionsBefore,
  SESSION_HOURS,
} from "@/server/auth/session";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { finishLogin } from "@/server/lead-id/leadId";
import { organizationForPage } from "@/server/team";

export const dynamic = "force-dynamic";

/**
 * Ancienne marque de relance, commune à tous les onglets (avant le 01.10.2026) : plus lue, la relance
 * voyage dans le `state` de la demande. Effacée au passage.
 */
const OLD_RETRY_COOKIE = "il_login_retry";

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
    if (store.get(OLD_RETRY_COOKIE))
      response.cookies.set(OLD_RETRY_COOKIE, "", { ...cookieOptions(0), path: LOGIN_COOKIE_PATH });
    return response;
  };
  // Session InvoiceLead déjà dans ce navigateur : remplacée par celle-ci au succès, et sa ligne
  // effacée (elle peut être celle d'une autre personne : poste partagé, invitation d'un collègue).
  const previous = store.get(SESSION_COOKIE)?.value;
  // Le Compte Lead vient d'authentifier quelqu'un (un code est revenu), mais ce retour ne peut pas
  // être vérifié ici (demande introuvable, code refusé) : on ne sait pas qui. La session InvoiceLead
  // de ce navigateur peut être celle d'une autre personne : lien « mot de passe oublié » ouvert sur un
  // poste partagé, écran resté ouvert plus de trois heures pendant qu'une autre personne se connectait
  // dans un autre onglet. La relance ne la reprend donc jamais telle quelle (voir `fresh`). Elle n'est
  // pas effacée pour autant : un code ou un `state` peuvent venir de n'importe quel site (`failed`).
  const unverified = Boolean(previous && q.get("code"));

  // Demande de connexion introuvable (plus de trois heures, cookie effacé, autre navigateur) : on la
  // relance une fois, sans écran, vers la même page. Le Compte Lead est maintenant ouvert :
  // l'aller-retour est invisible et la personne arrive sur sa page. Un second échec d'affilée montre
  // l'écran d'erreur, qui garde la page pour « Réessayer ». La relance est marquée dans le `state` de
  // la nouvelle demande (retry), et non dans un cookie : deux onglets qui reprennent chacun une vieille
  // demande ont chacun la leur.
  const retried = asked?.retry === true;
  // Entrée « fraîche » (invitation acceptée, adresse confirmée dans le Compte Lead, retour qu'on ne
  // peut pas vérifier) : la relance repasse par le Compte Lead, sans écran puisqu'il est ouvert, et la
  // session suit son identité. Jamais celle d'une autre personne restée dans ce navigateur.
  const fresh: Record<string, string> = asked?.fresh || unverified ? { fresh: "1" } : {};
  const restart = () =>
    done(
      `${APP_URL}/auth/lead/start?${new URLSearchParams({ locale, ...back, ...fresh, retry: "1" })}`,
    );
  const failed = async (reason: "lead" | "session") => {
    // Entrée fraîche (ou retour invérifiable) qui n'aboutit pas : l'identité du Compte Lead n'est pas
    // confirmée, la session InvoiceLead restée dans ce navigateur (peut-être celle d'une autre
    // personne) ne doit pas prendre le relais derrière l'écran d'erreur.
    // Elle n'est effacée que si ce retour est celui d'une demande de CE navigateur : son cookie, nommé
    // d'après ce `state`, que seul /auth/lead/start pose ici. Un `state` scellé prouve que ce serveur
    // l'a émis, pas que ce navigateur l'a demandé : le départ en remet un à n'importe qui, et un code
    // se fabrique. Un lien vers ce retour, posé par un autre site, ne déconnecte donc jamais personne.
    const erase = Boolean(asked?.fresh && previous && own);
    // Sans cette preuve, rien n'est effacé : l'écran d'erreur porte `fresh`. Il ne laisse pas entrer la
    // session restée là (login/page.tsx), et « Réessayer » repasse par le Compte Lead, dont l'identité
    // remplace alors la session (succès ci-dessous).
    const shield = Boolean(previous && !own && (asked?.fresh || unverified));
    const response = done(
      `${APP_URL}/${locale}/login?${new URLSearchParams({ erreur: reason, ...back, ...(shield ? { fresh: "1" } : {}) })}`,
    );
    if (erase && previous) {
      await destroySession(db(), previous).catch(() => null);
      response.cookies.set(SESSION_COOKIE, "", cookieOptions(0));
    }
    return response;
  };
  // Même demande déjà menée à bout dans un autre onglet (lien d'email, onglet resté ouvert), sans
  // nouveau code : la session est ouverte, on va tout droit à la page qu'elle demandait. Avec un code,
  // le Compte Lead vient d'authentifier quelqu'un, peut-être une autre personne que celle de la session
  // (poste partagé) : relance fraîche ci-dessous, invisible, vers la même page entière.
  if (!saved && finished && previous && !q.get("code")) return done(`${APP_URL}${finished.target}`);
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
    // Entreprise de la session : celle de la page demandée (lien d'import de CRMlead : l'entreprise du
    // Compte Lead ; pièce : l'entreprise qui la possède, si la personne y a accès), sinon celle où la
    // fiduciaire travaillait (organizationForPage). Une invitation à accepter part de l'entreprise du
    // Compte Lead : l'acceptation change d'entreprise.
    const organizationId = invite
      ? organization.id
      : await organizationForPage(db(), user, organization.id, wanted);
    const session = await createSession(db(), {
      userId: user.id,
      organizationId,
      idToken: tokens.id_token,
      refreshToken: tokens.refresh_token ?? null,
    });
    if (previous) await destroySession(db(), previous).catch(() => null);
    // Ses sessions d'autres navigateurs revérifient leur accès au Compte Lead dès leur page suivante :
    // un mot de passe réinitialisé (compte ouvert d'avance repris par la vraie personne) y a révoqué
    // les jetons de l'auteur, dont la session tombe aussitôt. Avec la date du dernier changement
    // d'identifiants (`cred_at`), celles ouvertes avant tombent tout de suite.
    await checkOtherSessionsSoon(db(), user.id, session.id);
    // `cred_at` est arrondi à la seconde (parfois vers le haut) : une seconde de marge, pour qu'une
    // session ouverte dans la même seconde que le nouveau mot de passe ne tombe pas.
    const credAt = (claims as { cred_at?: unknown }).cred_at;
    if (typeof credAt === "number" && Number.isFinite(credAt) && credAt > 0)
      await dropSessionsBefore(db(), user.id, new Date((credAt - 1) * 1000), session.id);
    // Retour sur la page demandée avant la connexion, sinon le tableau de bord.
    const landing = wanted ?? `/${locale}/app`;
    const response = done(`${APP_URL}${landing}`);
    response.cookies.set(SESSION_COOKIE, session.token, cookieOptions(SESSION_HOURS * 3600));
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
    const why = describeLoginError(error);
    console.error("[lead-id] callback", why);
    // `state` d'une autre demande (deux onglets), ou code déjà échangé (même retour rejoué : la réponse
    // du premier s'est perdue en route, coupure du réseau ou page d'erreur, puis la personne recharge) :
    // même relance unique, sans écran.
    if (!retried && restartable(why)) return restart();
    // L'écran d'erreur garde la page demandée (ou l'invitation) : « Réessayer » y ramène.
    return failed("lead");
  }
}
