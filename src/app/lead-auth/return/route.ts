import type { NextRequest } from "next/server";
import { RETURN_PAGE_HEADERS, returnPageHtml, returnPageLocale } from "@/server/lead-app-return";

/**
 * https://invoicelead.io/lead-auth/return : le lien de retour de « Continuer avec Google », réservé à l'app
 * (Universal Link, App Link vérifié : src/app/.well-known/…). Cette page ne s'affiche que s'il ne s'est pas
 * ouvert dans l'app (server/lead-app-return.ts). Hors du proxy (aucun préfixe de langue, aucune redirection).
 */
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const locale = returnPageLocale(
    request.nextUrl.searchParams.get("locale"),
    request.cookies.get("NEXT_LOCALE")?.value,
    request.headers.get("accept-language"),
  );
  const android = /\bAndroid\b/i.test(request.headers.get("user-agent") ?? "");
  return new Response(await returnPageHtml({ locale, android }), {
    status: 200,
    headers: { ...RETURN_PAGE_HEADERS, Vary: "Accept-Language, User-Agent, Cookie" },
  });
}
