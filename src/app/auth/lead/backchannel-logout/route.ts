import { type NextRequest, NextResponse } from "next/server";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { BACKCHANNEL_EVENT, backchannelLogout } from "@/server/lead-id/backchannel";
import { verifyLeadJwt } from "@/server/lead-id/leadId";

export const dynamic = "force-dynamic";

/**
 * OpenID Connect Back-Channel Logout : ERPlead poste un `logout_token` quand une personne est retirée de son
 * organisation (src/server/lead-id/backchannel.ts). Le jeton est vérifié comme un jeton d'identité (signature
 * d'ERPlead, émetteur, audience, expiration), doit porter l'événement de déconnexion, un `sub`, pas de `nonce`,
 * et dater de moins de cinq minutes. Pas de cookie, pas de redirection : 200 ou 400.
 */
export async function POST(request: NextRequest) {
  const headers = { "Cache-Control": "no-store" };
  const form = await request.formData().catch(() => null);
  const token = String(form?.get("logout_token") ?? "");
  const claims = token ? await verifyLeadJwt(token, env().LEAD_ID_CLIENT_ID) : null;
  const fresh = typeof claims?.iat === "number" && claims.iat * 1000 > Date.now() - 5 * 60_000;
  if (
    !claims ||
    !fresh ||
    typeof claims.sub !== "string" ||
    claims.nonce !== undefined ||
    !claims.events?.[BACKCHANNEL_EVENT]
  ) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400, headers });
  }
  await backchannelLogout(db(), {
    sub: claims.sub,
    org: typeof claims.org === "string" ? claims.org : null,
    lead_status: typeof claims.lead_status === "string" ? claims.lead_status : null,
  });
  return new NextResponse(null, { status: 200, headers });
}
