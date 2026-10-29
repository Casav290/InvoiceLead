import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { assistantAuth, assistantDeps } from "@/server/ai-assistant/auth";
import { confirmPost } from "@/server/ai-assistant/handlers";
import { sameOrigin } from "@/server/ai-assistant/origin";
import { env } from "@/server/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Un lot de 150 opérations dans une transaction, puis la comptabilisation : jusqu'à deux minutes. */
export const maxDuration = 120;

/** Bulle « Assistant IA » : exécute l'écriture que la personne vient de confirmer. */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const auth = await assistantAuth();
  // Même origine exigée (B13), après le contrôle de session (sans session : 401).
  if (auth.status === 200 && !sameOrigin(request, env().APP_URL))
    return NextResponse.json(
      { error: "cross_origin" },
      { status: 403, headers: { "Cache-Control": "no-store" } },
    );
  const { status, body: out } = await confirmPost(auth, body, assistantDeps());
  if (status === 200) revalidatePath("/", "layout");
  return NextResponse.json(out, { status, headers: { "Cache-Control": "no-store" } });
}
