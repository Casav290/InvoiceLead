import { timingSafeEqual } from "node:crypto";
import { deliverCrmlead } from "@/server/crmlead-sync";
import { db } from "@/server/db";
import { env } from "@/server/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorized(request: Request): boolean {
  const secret = env().CRON_SECRET;
  if (!secret) return false;
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/**
 * Reprise horaire des états de devis et factures vers CRMlead (pannes, entreprise pas encore connue
 * de CRMlead). Formule Vercel Hobby : une tâche ne tourne qu'une fois par jour, d'où 24 tâches sur ce
 * même chemin dans vercel.json, une par heure.
 */
export async function GET(request: Request) {
  if (!authorized(request)) return new Response("unauthorized", { status: 401 });
  const crmlead = await deliverCrmlead(db(), { limit: 500 });
  return Response.json({ crmlead });
}
