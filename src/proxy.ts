import { type NextRequest, NextResponse } from "next/server";
import createMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";
import { SESSION_COOKIE } from "./lib/cookies";

const intl = createMiddleware(routing);
const APP_PATH = new RegExp(`^/(${routing.locales.join("|")})/app(?:/|$)`);

export default function proxy(request: NextRequest) {
  const match = request.nextUrl.pathname.match(APP_PATH);
  // Filtre rapide : sans cookie de session, l'application renvoie vers la connexion.
  // La session elle-même est vérifiée en base par la mise en page de l'application.
  if (match && !request.cookies.has(SESSION_COOKIE)) {
    const url = request.nextUrl.clone();
    url.pathname = `/${match[1]}/login`;
    url.search = "";
    return NextResponse.redirect(url);
  }
  return intl(request);
}

export const config = {
  matcher: "/((?!api|auth|_next|_vercel|.*\\..*).*)",
};
