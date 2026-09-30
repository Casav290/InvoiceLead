import { timingSafeEqual } from "node:crypto";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { runRecurring } from "@/server/recurring";
import { sendWithDefaults } from "@/server/send";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorized(request: Request): boolean {
  const secret = env().CRON_SECRET;
  if (!secret) return false;
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** Tâche quotidienne (Vercel Cron) : factures récurrentes échues. */
export async function GET(request: Request) {
  if (!authorized(request)) return new Response("unauthorized", { status: 401 });
  const today = new Date().toISOString().slice(0, 10);
  const recurring = await runRecurring(db(), today, async (who, id) => {
    return (await sendWithDefaults(db(), who, id)) === "sent";
  });
  return Response.json({ today, recurring });
}
