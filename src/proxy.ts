import { NextRequest, NextResponse } from "next/server";
import createMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";
import {
  AFTER_LOGOUT_COOKIE,
  AFTER_LOGOUT_PATH,
  REQUESTED_PATH_HEADER,
  SESSION_COOKIE,
} from "./lib/cookies";
import { returnPage } from "./lib/return-page";

const intl = createMiddleware(routing);
const PROTECTED = new RegExp(`^/(${routing.locales.join("|")})/(?:app|no-access)(?:/|$)`, "i");
/** Accueil : « / » ou « /fr », là où le Compte Lead ramène après une déconnexion. */
const HOME = new RegExp(`^/(?:(?:${routing.locales.join("|")})/?)?$`, "i");

function decodedPath(pathname: string): string {
  try {
    return decodeURIComponent(pathname);
  } catch {
    return pathname;
  }
}

export default function proxy(request: NextRequest) {
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
  // Page où revenir après la connexion : celle demandée, ou celle du formulaire d'un fichier à
  // télécharger (return-page.ts), jamais le fichier lui-même.
  const wanted = returnPage(request.nextUrl.pathname, request.nextUrl.search);
  if (match && navigable && !request.cookies.has(SESSION_COOKIE)) {
    // Vers la connexion, avec la page demandée pour y revenir. Pas tout droit vers le Compte Lead :
    // un préchargement de Next suivrait la redirection et lancerait une connexion en arrière-plan.
    const locale = match[1]?.toLowerCase() ?? "de";
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
