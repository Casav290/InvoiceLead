import { NextRequest, NextResponse } from "next/server";
import createMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";
import {
  AFTER_LOGOUT_COOKIE,
  AFTER_LOGOUT_PATH,
  REQUESTED_PATH_HEADER,
  SESSION_COOKIE,
} from "./lib/cookies";
import { entryRedirect } from "./lib/lead-entry";
import { isNativeAgent } from "./lib/native";
import { returnPage } from "./lib/return-page";

const intl = createMiddleware(routing);
/**
 * Pages de l'application, réservées aux sessions. L'écran « sans accès » (/xx/no-access) n'en fait
 * plus partie : le refus « places » se lit aussi sans session (refusal.ts), et la page elle-même
 * renvoie à la connexion pour les autres raisons.
 */
const PROTECTED = new RegExp(`^/(${routing.locales.join("|")})/app(?:/|$)`, "i");
/**
 * Accueil : « / » ou « /fr », là où le Compte Lead ramène après une déconnexion. L'entrée par la
 * racine (session, essai silencieux) est dans lead-entry.ts.
 */
const HOME = new RegExp(`^/(?:(?:${routing.locales.join("|")})/?)?$`, "i");

function decodedPath(pathname: string): string {
  try {
    return decodeURIComponent(pathname);
  } catch {
    return pathname;
  }
}

/** Pages de présentation (accueil, tarifs, FAQ) : l'app Android / iOS ouvre l'application à leur place. */
const NATIVE_TO_APP = new RegExp(
  `^/(?:(${routing.locales.join("|")})(?:/(?:pricing|faq)(?:/.*)?)?/?)?$`,
  "i",
);

/** Langue de l'app quand l'adresse n'en donne pas : celle choisie sur le site, sinon celle du téléphone. */
function nativeLocale(request: NextRequest, fromPath: string | undefined): string {
  const locales: readonly string[] = routing.locales;
  const chosen = [fromPath, request.cookies.get("NEXT_LOCALE")?.value]
    .map((l) => l?.toLowerCase())
    .find((l) => l && locales.includes(l));
  if (chosen) return chosen;
  for (const part of (request.headers.get("accept-language") ?? "").split(",")) {
    const l = part.trim().slice(0, 2).toLowerCase();
    if (locales.includes(l)) return l;
  }
  return routing.defaultLocale;
}

export default function proxy(request: NextRequest) {
  // L'app Android / iOS (lib/native.ts) n'a pas de pages de présentation : ni prix ni offre, Apple
  // (règle 3.1.1) et Google Play l'exigent. Elle ouvre l'application (connexion si besoin, PROTECTED).
  if (request.method === "GET" && isNativeAgent(request.headers.get("user-agent"))) {
    const home = decodedPath(request.nextUrl.pathname).match(NATIVE_TO_APP);
    if (home) {
      const response = NextResponse.redirect(
        new URL(`/${nativeLocale(request, home[1])}/app`, request.url),
        303,
      );
      response.headers.set("Cache-Control", "no-store");
      response.headers.set("Vary", "User-Agent");
      return response;
    }
  }
  // Filtre rapide : sans cookie de session, l'application renvoie vers la connexion. Le chemin est
  // décodé (« /de/%61pp » est « /de/app » pour le routeur). La vraie vérification est faite par
  // chaque page, action serveur et route (requireAppSession) : ce filtre n'est qu'un raccourci.
  const match = decodedPath(request.nextUrl.pathname).match(PROTECTED);
  // Seule une page qui s'ouvre (GET, HEAD) passe par l'écran de connexion. Un envoi (action serveur,
  // formulaire en POST) n'est pas renvoyé tel quel vers /login, qui ne sait que s'afficher : il suit
  // son cours, et sa propre garde relance la connexion vers la page d'où il part.
  const navigable = request.method === "GET" || request.method === "HEAD";
  const action = request.headers.has("next-action");
  // Retour de la déconnexion du Compte Lead après « Changer de compte » sur une invitation : on
  // reprend l'invitation (logout/route.ts), une seule fois. Seule une adresse d'invitation de ce site
  // est suivie, jamais une autre valeur ; le cookie s'efface dans tous les cas.
  if (
    navigable &&
    request.cookies.has(AFTER_LOGOUT_COOKIE) &&
    HOME.test(decodedPath(request.nextUrl.pathname))
  ) {
    const value = request.cookies.get(AFTER_LOGOUT_COOKIE)?.value ?? "";
    const resume = AFTER_LOGOUT_PATH.test(value) && !request.cookies.has(SESSION_COOKIE);
    const response = resume
      ? NextResponse.redirect(new URL(value, request.url), 303)
      : intl(request);
    response.cookies.set(AFTER_LOGOUT_COOKIE, "", { path: "/", maxAge: 0 });
    return response;
  }
  // Adresses d'entrée (racine tapée, /login sans langue) : connectée au Compte Lead, la personne
  // arrive tout droit dans l'espace de son entreprise ; sinon un seul essai silencieux, puis la page
  // publique (lead-entry.ts). Un préchargement du navigateur reçoit 204 sans contenu. Jamais mis en
  // cache : la réponse dépend des cookies.
  const entry = entryRedirect({
    method: request.method,
    pathname: decodedPath(request.nextUrl.pathname),
    search: request.nextUrl.search,
    header: (name) => request.headers.get(name),
    hasCookie: (name) => request.cookies.has(name),
  });
  if (entry) {
    const response =
      entry.status === 204
        ? new NextResponse(null, { status: 204 })
        : NextResponse.redirect(new URL(entry.location, request.url), entry.status);
    response.headers.set("Cache-Control", "no-store");
    response.headers.set("Vary", "Cookie");
    return response;
  }
  // Page où revenir après la connexion : celle demandée, ou celle du formulaire d'un fichier à
  // télécharger (return-page.ts), jamais le fichier lui-même.
  const wanted = returnPage(request.nextUrl.pathname, request.nextUrl.search);
  if (match && navigable && !request.cookies.has(SESSION_COOKIE)) {
    // Vers la connexion, avec la page demandée pour y revenir. Pas tout droit vers le Compte Lead :
    // un préchargement de Next suivrait la redirection et lancerait une connexion en arrière-plan.
    const locale = match[1]?.toLowerCase() ?? "fr";
    const url = request.nextUrl.clone();
    url.pathname = `/${locale}/login`;
    url.search = `?${new URLSearchParams({ next: wanted })}`;
    return NextResponse.redirect(url);
  }
  // Page de l'application : la page demandée suit, au cas où la session aurait expiré
  // (requireSession la redonne au Compte Lead pour y revenir après la connexion). Une action serveur
  // part de la page qu'elle vise, qui s'ouvre aussi en GET. Un fichier à télécharger ou une route en
  // POST seulement (export) ne devient jamais la page de retour : c'est la page de son formulaire.
  // L'en-tête ne vient que d'ici : celui qu'enverrait le navigateur est retiré.
  if (match || request.headers.has(REQUESTED_PATH_HEADER)) {
    const headers = new Headers(request.headers);
    headers.delete(REQUESTED_PATH_HEADER);
    if (match && (navigable || action)) headers.set(REQUESTED_PATH_HEADER, wanted);
    return intl(new NextRequest(request, { headers }));
  }
  return intl(request);
}

export const config = {
  matcher: "/((?!api|auth|_next|_vercel|.*\\..*).*)",
};
