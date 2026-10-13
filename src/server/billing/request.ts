import "server-only";
import { NextResponse } from "next/server";
import { pickLocale } from "../auth/login-cookie";
import { type CurrentSession, getSession } from "../auth/session";
import { env } from "../env";
import { planPageUrl } from "./subscriptions";

/**
 * Départ d'un formulaire de la page Formule (Checkout, portail) : même origine, session valable,
 * administrateur de l'organisation (le Compte Lead ne laisse que lui gérer l'organisation). Rend la
 * session, ou la réponse à renvoyer telle quelle (connexion, retour à la page Formule avec l'erreur).
 */
export async function billingRequest(request: Request): Promise<
  | {
      ok: true;
      session: CurrentSession;
      locale: string;
      form: FormData;
      back: (q: string) => Response;
    }
  | { ok: false; response: Response }
> {
  // Formulaire envoyé par un autre site : refusé (le cookie de session, SameSite=Lax, ne le suivrait
  // pas non plus).
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(env().APP_URL).origin)
    return { ok: false, response: NextResponse.json({ error: "origin" }, { status: 403 }) };
  const form = await request.formData().catch(() => new FormData());
  const locale = pickLocale(form.get("locale"));
  const back = (q: string) => NextResponse.redirect(planPageUrl(locale, q), 303);
  const session = await getSession();
  if (!session) {
    // Session expirée : reconnexion, puis retour à la page Formule pour cliquer à nouveau.
    const next = `/${locale}/app/settings/plan`;
    return {
      ok: false,
      response: NextResponse.redirect(
        `${env().APP_URL}/${locale}/login?${new URLSearchParams({ next })}`,
        303,
      ),
    };
  }
  if (!session.organization.hasAccess || session.membership.role !== "admin")
    return { ok: false, response: back("?error=admin") };
  return { ok: true, session, locale, form, back };
}
