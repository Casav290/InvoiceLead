import { NextResponse } from "next/server";
import { db } from "@/server/db";
import { readForExchange } from "@/server/lead-exchange";
import { incomingExchange } from "@/server/lead-id/leadId";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Lecture par une application Lead sœur (ProjectLead, « Importer depuis InvoiceLead ») :
 * `?type=contact&q=<texte>`, 20 clients au plus, avec les droits de la personne du jeton
 * (jeton exchange_read d'ERPlead, personne obligatoire).
 */
export async function GET(request: Request) {
  const tok = await incomingExchange(request.headers.get("authorization"), "exchange_read");
  if (!tok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const out = await readForExchange(db(), tok, new URL(request.url).searchParams);
  return NextResponse.json(out.body, { status: out.status });
}
