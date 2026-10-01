import { timingSafeEqual } from "node:crypto";
import { sendAutopilotDigests } from "@/server/autopilot-digest";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { runRecurring } from "@/server/recurring";
import { runAutoReminders } from "@/server/reminders";
import { sendWithDefaults } from "@/server/send";
import { deliverPending } from "@/server/webhooks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorized(request: Request): boolean {
  const secret = env().CRON_SECRET;
  if (!secret) return false;
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** Tâche quotidienne (Vercel Cron) : factures récurrentes échues, puis relances automatiques. */
export async function GET(request: Request) {
  if (!authorized(request)) return new Response("unauthorized", { status: 401 });
  const today = new Date().toISOString().slice(0, 10);
  const recurring = await runRecurring(db(), today, async (who, id) => {
    return (await sendWithDefaults(db(), who, id)) === "sent";
  });
  const reminders = await runAutoReminders(db(), today);
  // Événements des factures récurrentes, et reprise des envois de webhooks en échec.
  const webhooks = await deliverPending(db(), { limit: 500 });
  // Le lundi : récapitulatif du pilote automatique aux administrateurs.
  const digests =
    new Date(`${today}T00:00:00Z`).getUTCDay() === 1 ? await sendAutopilotDigests(db(), today) : 0;
  return Response.json({ today, recurring, reminders, webhooks, digests });
}
