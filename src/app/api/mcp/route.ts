import { NextResponse } from "next/server";
import { apiCaller } from "@/server/api-keys";
import { db } from "@/server/db";
import { postPending } from "@/server/ledger";
import { handleMcp } from "@/server/mcp";
import { flushWebhooks } from "@/server/webhooks";

export const dynamic = "force-dynamic";

/** Serveur MCP d'InvoiceLead (Pro+), authentifié par une clé d'API : https://invoicelead.io/api/mcp */
export async function POST(request: Request) {
  const caller = await apiCaller(db(), request.headers.get("authorization"));
  if (caller === "unauthorized")
    return NextResponse.json(
      { jsonrpc: "2.0", id: null, error: { code: -32001, message: "unauthorized" } },
      { status: 401, headers: { "WWW-Authenticate": 'Bearer realm="invoicelead"' } },
    );
  if (caller === "forbidden")
    return NextResponse.json(
      { jsonrpc: "2.0", id: null, error: { code: -32003, message: "forbidden" } },
      { status: 403 },
    );
  let message: unknown;
  try {
    message = await request.json();
  } catch {
    message = null;
  }
  const result = await handleMcp(caller, message);
  if (result.wrote) {
    try {
      await postPending(db(), { organizationId: caller.organization.id, userId: caller.userId });
    } catch (e) {
      console.error("[mcp] comptabilisation reportée", e instanceof Error ? e.message : "inconnu");
    }
    await flushWebhooks(db(), caller.organization.id);
  }
  if (result.body === null) return new Response(null, { status: result.status });
  return NextResponse.json(result.body, { status: result.status });
}

/** Pas de flux d'événements du serveur : tout passe par POST. */
export function GET() {
  return new Response(null, { status: 405, headers: { Allow: "POST" } });
}
