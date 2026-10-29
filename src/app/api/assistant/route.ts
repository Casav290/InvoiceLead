import { NextResponse } from "next/server";
import { assistantAuth, assistantDeps } from "@/server/ai-assistant/auth";
import { assistantPost } from "@/server/ai-assistant/handlers";
import { sameOrigin } from "@/server/ai-assistant/origin";
import { env } from "@/server/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/**
 * Plusieurs appels au modèle et aux outils par message, et un plan complet en un seul appel d'outil :
 * jusqu'à cinq minutes, le maximum du plan Hobby avec Fluid compute (le tour s'arrête à 290 s, run.ts).
 */
export const maxDuration = 300;

/** Bulle « Assistant IA » : un message de la conversation (docs : src/server/ai-assistant). */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const auth = await assistantAuth();
  // Même origine exigée (B13), après le contrôle de session (sans session : 401).
  if (auth.status === 200 && !sameOrigin(request, env().APP_URL))
    return NextResponse.json(
      { error: "cross_origin" },
      { status: 403, headers: { "Cache-Control": "no-store" } },
    );
  const { status, body: out } = await assistantPost(auth, body, assistantDeps());
  return NextResponse.json(out, { status, headers: { "Cache-Control": "no-store" } });
}
