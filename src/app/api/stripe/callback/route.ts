import { type NextRequest, NextResponse } from "next/server";
import { unsign } from "@/server/auth/crypto";
import { pickLocale } from "@/server/auth/login-cookie";
import { getSession } from "@/server/auth/session";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { can } from "@/server/roles";
import { exchangeConnectCode, saveStripeAccount } from "@/server/stripe";

export const dynamic = "force-dynamic";

/** Retour de Stripe Connect : vérifie l'état, récupère le compte relié et l'enregistre. */
export async function GET(request: NextRequest) {
  const { APP_URL, SESSION_SECRET } = env();
  const q = request.nextUrl.searchParams;
  const value = unsign(q.get("state") ?? "", SESSION_SECRET);
  const [orgId, userId, rawLocale, at] = (value ?? "").split(".");
  const locale = pickLocale(rawLocale);
  const back = `${APP_URL}/${locale}/app/settings/payments`;
  const session = await getSession();
  const fresh = Number(at) > Date.now() - 15 * 60_000;
  if (
    !value ||
    !fresh ||
    !session ||
    session.organization.id !== orgId ||
    session.user.id !== userId ||
    !can(session.membership, "company")
  )
    return NextResponse.redirect(`${back}?error=state`, 303);
  const code = q.get("code");
  if (!code) return NextResponse.redirect(`${back}?error=denied`, 303);
  try {
    const account = await exchangeConnectCode(code);
    await saveStripeAccount(db(), { organizationId: orgId, userId }, account);
  } catch (e) {
    console.error("[stripe] connect", e instanceof Error ? e.message : "inconnu");
    return NextResponse.redirect(`${back}?error=failed`, 303);
  }
  return NextResponse.redirect(`${back}?connected=1`, 303);
}
