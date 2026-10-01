import { notFound } from "next/navigation";
import { requireAppSession } from "@/server/auth/guard";
import { db } from "@/server/db";
import { buildDocumentPdf, documentVariant, pdfResponse } from "@/server/document-pdf";
import { getInvoice } from "@/server/invoices";

export const runtime = "nodejs";

/** PDF d'une pièce émise de l'organisation de la session (factures, devis et avoirs). */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ locale: string; id: string }> },
) {
  const { locale, id } = await params;
  const { organization } = await requireAppSession(locale);
  const found = await getInvoice(db(), organization.id, id);
  // La même route sert les devis et les avoirs : le type demandé doit correspondre à la pièce.
  const url = new URL(request.url);
  const path = url.pathname;
  const kind = path.includes("/app/quotes/")
    ? "quote"
    : path.includes("/app/credit-notes/")
      ? "credit_note"
      : "invoice";
  if (!found || found.invoice.kind !== kind || found.invoice.status === "draft") notFound();
  // ?as=order (confirmation de commande d'un devis) ou ?as=delivery (bon de livraison).
  const as = url.searchParams.get("as");
  const variant = documentVariant(as, kind);
  if (as && !variant) notFound();
  return pdfResponse(await buildDocumentPdf(found.invoice, found.lines, found.related, variant));
}
