import { type NextRequest, NextResponse } from "next/server";
import createMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";
import { SESSION_COOKIE } from "./lib/cookies";

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
  // chaque page (requireAppSession) : ce filtre n'est qu'un raccourci.
  const match = decodedPath(request.nextUrl.pathname).match(PROTECTED);
  if (match && !request.cookies.has(SESSION_COOKIE)) {
    const url = request.nextUrl.clone();
    url.pathname = `/${match[1]?.toLowerCase()}/login`;
    url.search = "";
    return NextResponse.redirect(url);
  }
  return intl(request);
}

export const config = {
  matcher: "/((?!api|auth|_next|_vercel|.*\\..*).*)",
};
