import "server-only";
import { eq } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { buildCii } from "@/countries/de/cii";
import { db } from "./db";
import { type Invoice, type InvoiceLine, organizations } from "./db/schema";
import { type DocumentVariant, documentLabels, kindNamespace } from "./document-labels";
import { renderInvoicePdf } from "./invoice-pdf";
import { organizationLogo } from "./logo";
import { planColumns, poweredBy } from "./plans";

export { type DocumentVariant, kindNamespace } from "./document-labels";

export function documentVariant(value: string | null, kind: string): DocumentVariant | null {
  if (value === "order" && kind === "quote") return "order";
  if (value === "delivery" && (kind === "quote" || kind === "invoice")) return "delivery";
  return null;
}

/** PDF d'une pièce émise dans sa langue, avec le nom de fichier proposé (« Facture-2026-0001.pdf »). */
export async function buildDocumentPdf(
  source: Invoice,
  lines: InvoiceLine[],
  related: { number: string | null } | null,
  variant: DocumentVariant | null = null,
): Promise<{ pdf: Buffer; filename: string }> {
  const lang = source.language;
  const t = await getTranslations({ locale: lang, namespace: "app.invoices.document" });
  const tk = await getTranslations({ locale: lang, namespace: kindNamespace(source.kind) });
  const tu = await getTranslations({ locale: lang, namespace: "app.invoices.units" });
  const [org] = await db()
    .select({
      ...planColumns,
    })
    .from(organizations)
    .where(eq(organizations.id, source.organizationId));
  const { invoice, title, labels } = documentLabels({
    source,
    lines,
    related,
    variant,
    t,
    tk,
    tu,
    poweredBy: !!org && poweredBy(org),
  });
  const country = invoice.sender?.country;
  // Allemagne et France : facture et avoir en ZUGFeRD / Factur-X (PDF/A-3 avec le XML EN 16931).
  const einvoicing = country === "DE" || country === "FR";
  const cii =
    einvoicing && invoice.kind !== "quote" ? buildCii(invoice, lines, "zugferd", related) : null;
  const einvoice = cii && "xml" in cii ? { xml: cii.xml } : undefined;
  const pdf = await renderInvoicePdf(
    invoice,
    lines,
    labels,
    einvoice,
    (await organizationLogo(db(), invoice.organizationId))?.bytes,
  );
  const safe = (invoice.number ?? "").replace(/[^0-9A-Za-z-]/g, "");
  return { pdf, filename: `${title}-${safe}.pdf` };
}

export function pdfResponse({ pdf, filename }: { pdf: Buffer; filename: string }) {
  const ascii = filename.normalize("NFD").replace(/[^\x20-\x7e]/g, "");
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Cache-Control": "private, no-store",
    },
  });
}
