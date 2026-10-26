import { NextResponse } from "next/server";
import { env } from "@/server/env";

export const dynamic = "force-dynamic";

/**
 * Carte de visite d'InvoiceLead pour les autres applications Lead : où envoyer, quoi, où lire.
 * Les adresses sont absolues, sur l'origine d'InvoiceLead (les expéditeurs refusent toute autre).
 */
export function GET() {
  const base = env().APP_URL;
  return NextResponse.json(
    {
      app: "invoicelead",
      exchange: {
        version: 1,
        inbox: `${base}/api/lead-exchange/v1/inbox`,
        accepts: ["invoice"],
        sends: ["document"],
        read: `${base}/api/lead-exchange/v1/read`,
        reads: ["contact"],
      },
    },
    { headers: { "cache-control": "public, max-age=300" } },
  );
}
