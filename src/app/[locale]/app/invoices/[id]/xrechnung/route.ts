import { notFound } from "next/navigation";
import { buildCii } from "@/countries/de/cii";
import { requireAppSession } from "@/server/auth/guard";
import { db } from "@/server/db";
import { getInvoice } from "@/server/invoices";

export const runtime = "nodejs";

/** XRechnung (XML CII) d'une facture ou d'un avoir émis par une entreprise allemande. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ locale: string; id: string }> },
) {
  const { locale, id } = await params;
  const { organization } = await requireAppSession(locale);
  if (organization.country !== "DE") notFound();
  const found = await getInvoice(db(), organization.id, id);
  const kind = new URL(request.url).pathname.includes("/app/credit-notes/")
    ? "credit_note"
    : "invoice";
  if (!found || found.invoice.kind !== kind || found.invoice.status === "draft") notFound();
  const result = buildCii(found.invoice, found.lines, "xrechnung", found.related);
  if ("missing" in result)
    return new Response(`Fehlende Angaben / données manquantes : ${result.missing.join(", ")}`, {
      status: 422,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  const name = `XRechnung-${(found.invoice.number ?? "").replace(/[^0-9A-Za-z-]/g, "")}.xml`;
  return new Response(result.xml, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
