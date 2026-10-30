import { APPLE_APP_SITE_ASSOCIATION, associationResponse } from "@/lib/app-links";

/**
 * https://invoicelead.io/.well-known/apple-app-site-association (Universal Links, retour https de la
 * session iOS) : lib/app-links.ts. Sans extension, JSON, sans redirection ; relu par le CDN d'Apple.
 */
export const dynamic = "force-static";

export function GET() {
  return associationResponse(APPLE_APP_SITE_ASSOCIATION);
}
