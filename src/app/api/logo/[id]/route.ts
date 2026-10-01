import { db } from "@/server/db";
import { organizationLogo } from "@/server/logo";

export const runtime = "nodejs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Logo d'une entreprise : il figure sur ses factures, y compris la consultation en ligne sans
 * compte, d'où une lecture publique. L'adresse change avec le logo (`?v=`), le cache peut durer.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return new Response(null, { status: 404 });
  const logo = await organizationLogo(db(), id);
  if (!logo) return new Response(null, { status: 404 });
  return new Response(new Uint8Array(logo.bytes), {
    headers: {
      "Content-Type": logo.contentType,
      "Cache-Control": "public, max-age=86400",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
