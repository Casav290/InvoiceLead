import { ASSET_LINKS, associationResponse } from "@/lib/app-links";

/**
 * https://invoicelead.io/.well-known/assetlinks.json (App Links vérifiés d'Android) : lib/app-links.ts.
 * JSON, sans redirection ; lu par Android à l'installation de l'app.
 */
export const dynamic = "force-static";

export function GET() {
  return associationResponse(ASSET_LINKS);
}
