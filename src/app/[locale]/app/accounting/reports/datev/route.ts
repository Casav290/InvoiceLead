import { notFound } from "next/navigation";
import { buildDatev } from "@/lib/ledger-export";
import { returnPage } from "@/lib/return-page";
import { listFiscalYears } from "@/server/accounting";
import { requirePermission } from "@/server/auth/guard";
import { db } from "@/server/db";
import { exportEntries } from "@/server/ledger-export";

export const runtime = "nodejs";

/** Buchungsstapel DATEV d'un exercice (entreprises allemandes), pour le Steuerberater. */
export async function GET(request: Request, { params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const url = new URL(request.url);
  // Session expirée : retour sur la page des rapports, jamais sur ce fichier (return-page.ts).
  const { organization } = await requirePermission(locale, "accounting", {
    next: returnPage(url.pathname, url.search),
  });
  if (organization.country !== "DE") notFound();
  const q = url.searchParams;
  const years = await listFiscalYears(db(), organization.id);
  const year = years.find((y) => y.id === q.get("year")) ?? years[0];
  if (!year) notFound();
  const consultant = Number(q.get("consultant"));
  const client = Number(q.get("client"));
  if (
    !Number.isInteger(consultant) ||
    consultant < 1001 ||
    consultant > 9_999_999 ||
    !Number.isInteger(client) ||
    client < 1 ||
    client > 99_999
  )
    return new Response("invalid consultant or client number", { status: 422 });
  const file = buildDatev(await exportEntries(db(), organization.id, year.id), {
    consultant,
    client,
    fiscalYearStart: year.startDate,
    from: year.startDate,
    to: year.endDate,
    createdAt: new Date(),
  });
  const name = `EXTF_Buchungsstapel_${year.startDate.slice(0, 4)}.csv`;
  return new Response(new Uint8Array(file), {
    headers: {
      "Content-Type": "text/csv; charset=windows-1252",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
