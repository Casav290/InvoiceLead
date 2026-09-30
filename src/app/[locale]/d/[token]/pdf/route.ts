import { notFound } from "next/navigation";
import { db } from "@/server/db";
import { buildDocumentPdf, pdfResponse } from "@/server/document-pdf";
import { findSharedDocument } from "@/server/sharing";

export const runtime = "nodejs";

/** PDF d'une pièce ouverte par son lien de consultation. */
export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const found = await findSharedDocument(db(), token);
  if (!found) notFound();
  return pdfResponse(await buildDocumentPdf(found.invoice, found.lines, found.related));
}
