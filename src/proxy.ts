import { NextRequest, NextResponse } from "next/server";
import createMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";
import { REQUESTED_PATH_HEADER, SESSION_COOKIE } from "./lib/cookies";

const intl = createMiddleware(routing);
const PROTECTED = new RegExp(`^/(${routing.locales.join("|")})/(?:app|no-access)(?:/|$)`, "i");

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
  if (match && navigable && !request.cookies.has(SESSION_COOKIE)) {
    // Vers la connexion, avec la page demandée pour y revenir. Pas tout droit vers le Compte Lead :
    // un préchargement de Next suivrait la redirection et lancerait une connexion en arrière-plan.
    const locale = match[1]?.toLowerCase() ?? "de";
    const url = request.nextUrl.clone();
    const wanted = `${request.nextUrl.pathname}${request.nextUrl.search}`;
    url.pathname = `/${locale}/login`;
    url.search = `?${new URLSearchParams({ next: wanted })}`;
    return NextResponse.redirect(url);
  }
  // Page de l'application : la page demandée suit, au cas où la session aurait expiré
  // (requireSession la redonne au Compte Lead pour y revenir après la connexion). Une action serveur
  // part de la page qu'elle vise, qui s'ouvre aussi en GET. Une route en POST seulement (export) ne
  // devient jamais la page de retour : sa garde donne la page de son formulaire. L'en-tête ne vient
  // que d'ici : celui qu'enverrait le navigateur est retiré.
  if (match || request.headers.has(REQUESTED_PATH_HEADER)) {
    const headers = new Headers(request.headers);
    headers.delete(REQUESTED_PATH_HEADER);
    if (match && (navigable || action))
      headers.set(REQUESTED_PATH_HEADER, `${request.nextUrl.pathname}${request.nextUrl.search}`);
    return intl(new NextRequest(request, { headers }));
  }
  return intl(request);
}

export const config = {
  matcher: "/((?!api|auth|_next|_vercel|.*\\..*).*)",
};
