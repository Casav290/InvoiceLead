import { requirePermission } from "@/server/auth/guard";
import { pickLocale } from "@/server/auth/login-cookie";
import { exportPayments } from "@/server/bills";
import { db } from "@/server/db";

export const dynamic = "force-dynamic";

/** Produit le fichier pain.001 des factures approuvées et le télécharge. */
export async function POST(request: Request, { params }: { params: Promise<{ locale: string }> }) {
  const locale = pickLocale((await params).locale);
  // Session expirée : retour, après la reconnexion, sur la page des factures d'où part l'export
  // (cette adresse n'existe qu'en POST).
  const session = await requirePermission(locale, "accounting", {
    next: `/${locale}/app/accounting/bills`,
  });
  const form = await request.formData();
  const ids = form.getAll("id").map(String);
  const result = await exportPayments(
    db(),
    { organizationId: session.organization.id, userId: session.user.id },
    ids.length > 0 ? ids : null,
  );
  const back = new URL(`/${locale}/app/accounting/bills`, request.url);
  if (typeof result === "string") {
    back.searchParams.set("error", result);
    return Response.redirect(back, 303);
  }
  const name = `pain001-${new Date().toISOString().slice(0, 10)}.xml`;
  return new Response(result.xml, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
