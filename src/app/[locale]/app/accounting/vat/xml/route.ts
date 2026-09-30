import { and, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import type { NextRequest } from "next/server";
import { buildEch0217 } from "@/countries/ch/ech0217";
import { requirePermission } from "@/server/auth/guard";
import { db } from "@/server/db";
import { vatReturns } from "@/server/db/schema";

export const runtime = "nodejs";

/** Décompte TVA validé au format eCH-0217, à déposer sur le portail de l'AFC (Suisse). */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ locale: string }> },
) {
  const { locale } = await params;
  const { organization } = await requirePermission(locale, "accounting");
  const start = request.nextUrl.searchParams.get("period") ?? "";
  if (organization.country !== "CH" || !/^\d{4}-\d{2}-\d{2}$/.test(start)) notFound();
  const [row] = await db()
    .select()
    .from(vatReturns)
    .where(and(eq(vatReturns.organizationId, organization.id), eq(vatReturns.periodStart, start)));
  if (!row) notFound();
  const xml = buildEch0217({
    uid: organization.uid ?? "",
    organisationName: organization.legalName ?? organization.name,
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    settlement: organization.vatSettlement === "received" ? "received" : "agreed",
    netTaxRateBp: organization.netTaxRateBp,
    figures: row.figures,
    businessReferenceId: row.id,
    generatedAt: new Date(),
    productVersion: "1.0",
  });
  if (!xml) notFound();
  return new Response(xml, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Content-Disposition": `attachment; filename="MWST-${row.periodStart}-${row.periodEnd}.xml"`,
      "Cache-Control": "private, no-store",
    },
  });
}
