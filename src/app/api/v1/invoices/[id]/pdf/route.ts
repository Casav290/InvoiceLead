import { apiError, withApi } from "@/server/api";
import { db } from "@/server/db";
import { buildDocumentPdf, pdfResponse } from "@/server/document-pdf";
import { getInvoice } from "@/server/invoices";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** PDF d'une pièce émise, comme celui envoyé au client (QR-facture, ZUGFeRD ou Factur-X compris). */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withApi(request, "invoices.pdf", async ({ organization }) => {
    const found = await getInvoice(db(), organization.id, (await params).id);
    if (!found || found.invoice.status === "draft") return apiError(404, "not_found");
    return pdfResponse(await buildDocumentPdf(found.invoice, found.lines, found.related));
  });
}
