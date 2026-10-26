import { NextResponse } from "next/server";
import { jsonBody } from "@/server/api";
import { db } from "@/server/db";
import { receiveInvoice } from "@/server/lead-exchange";
import { incomingExchange } from "@/server/lead-id/leadId";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Boîte de réception des applications Lead (liaison sans clé) : jeton d'échange d'ERPlead, lié à
 * l'organisation. Seule enveloppe acceptée : 'invoice' de ProjectLead (src/server/lead-exchange.ts).
 * Jamais de 402 : relier les applications ne dépend d'aucune formule.
 */
export async function POST(request: Request) {
  const tok = await incomingExchange(request.headers.get("authorization"), "exchange");
  if (!tok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await jsonBody(request);
  if (!body) return NextResponse.json({ error: "invalid_envelope" }, { status: 400 });
  const out = await receiveInvoice(db(), tok, body);
  return NextResponse.json(out.body, { status: out.status });
}

// Un brouillon ne se comptabilise pas ; l'import garde la même signature que l'API pour la suite.
