import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { assistantAuth, assistantDeps } from "@/server/ai-assistant/auth";
import { confirmPost } from "@/server/ai-assistant/handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Bulle « Assistant IA » : exécute l'écriture que la personne vient de confirmer. */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const { status, body: out } = await confirmPost(await assistantAuth(), body, assistantDeps());
  if (status === 200) revalidatePath("/", "layout");
  return NextResponse.json(out, { status, headers: { "Cache-Control": "no-store" } });
}
