import { notFound } from "next/navigation";
import { requireAppSession } from "@/server/auth/guard";
import { db } from "@/server/db";
import { receiptFile } from "@/server/receipts";

export const runtime = "nodejs";

/** Fichier d'un justificatif de l'organisation de la session. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ locale: string; id: string }> },
) {
  const { locale, id } = await params;
  const { organization } = await requireAppSession(locale);
  const file = await receiptFile(db(), organization.id, id);
  if (!file) notFound();
  return new Response(new Uint8Array(file.bytes), {
    headers: {
      "Content-Type": file.contentType,
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
