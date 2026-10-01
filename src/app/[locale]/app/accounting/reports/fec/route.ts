import { notFound } from "next/navigation";
import { buildFec, fecFilename } from "@/lib/ledger-export";
import { listFiscalYears } from "@/server/accounting";
import { requirePermission } from "@/server/auth/guard";
import { db } from "@/server/db";
import { exportEntries } from "@/server/ledger-export";

export const runtime = "nodejs";

/** Fichier des écritures comptables d'un exercice (entreprises françaises). */
export async function GET(request: Request, { params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const { organization } = await requirePermission(locale, "accounting");
  if (organization.country !== "FR") notFound();
  const years = await listFiscalYears(db(), organization.id);
  const id = new URL(request.url).searchParams.get("year");
  const year = years.find((y) => y.id === id) ?? years[0];
  if (!year) notFound();
  // SIREN : les neuf premiers chiffres du SIRET.
  const siren = (organization.taxNumber ?? "").replace(/\D/g, "").slice(0, 9) || "000000000";
  const text = buildFec(await exportEntries(db(), organization.id, year.id));
  return new Response(text, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": `attachment; filename="${fecFilename(siren, year.endDate)}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
