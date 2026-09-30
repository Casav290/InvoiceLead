import "server-only";
import { eq } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { buildCii } from "@/countries/de/cii";
import { db } from "./db";
import { type Invoice, type InvoiceLine, organizations } from "./db/schema";
import { renderInvoicePdf } from "./invoice-pdf";
import { LIMITS, tierOf } from "./plans";

export const kindNamespace = (kind: string) =>
  kind === "quote" ? "app.quotes" : kind === "credit_note" ? "app.creditNotes" : "app.invoices";

/** PDF d'une pièce émise dans sa langue, avec le nom de fichier proposé (« Facture-2026-0001.pdf »). */
export async function buildDocumentPdf(
  invoice: Invoice,
  lines: InvoiceLine[],
  related: { number: string | null } | null,
): Promise<{ pdf: Buffer; filename: string }> {
  const lang = invoice.language;
  const t = await getTranslations({ locale: lang, namespace: "app.invoices.document" });
  const tk = await getTranslations({ locale: lang, namespace: kindNamespace(invoice.kind) });
  const tu = await getTranslations({ locale: lang, namespace: "app.invoices.units" });
  const units = Object.fromEntries(
    ["hour", "day", "piece", "flat", "km", "month"].map((u) => [u, tu(u)]),
  );
  const [org] = await db()
    .select({ leadPlan: organizations.leadPlan, entitlements: organizations.entitlements })
    .from(organizations)
    .where(eq(organizations.id, invoice.organizationId));
  const poweredBy = org && LIMITS[tierOf(org)].poweredBy ? t("poweredBy") : undefined;
  const germany = invoice.sender?.country === "DE";
  const taxNote = !germany
    ? undefined
    : !invoice.vatRegistered
      ? t("smallBusinessDe")
      : lines.some((l) => l.vatCode === "export")
        ? t("reverseChargeDe")
        : undefined;
  // Allemagne : facture et avoir en ZUGFeRD (PDF/A-3 avec le XML EN 16931), si les données suffisent.
  const cii =
    germany && invoice.kind !== "quote" ? buildCii(invoice, lines, "zugferd", related) : null;
  const einvoice = cii && "xml" in cii ? { xml: cii.xml } : undefined;
  const pdf = await renderInvoicePdf(
    invoice,
    lines,
    {
      invoice: tk("docTitle"),
      issueDate: t("issueDate"),
      serviceDate: t("serviceDate"),
      dueDate: tk("docDue"),
      description: t("description"),
      quantity: t("quantity"),
      unitPrice: t("unitPrice"),
      vat: t("vat"),
      amount: t("amount"),
      net: t("net"),
      total: t("total"),
      vatLine: (rate, base) => t("vatLine", { rate, base }),
      payTo: (iban) => t("payTo", { iban }),
      referenceLine: (reference) => t("referenceLine", { reference }),
      units,
      relatedLine: related?.number ? t("relatedLine", { number: related.number }) : undefined,
      poweredBy,
      taxNote,
      scanToPay: t("scanToPay"),
    },
    einvoice,
  );
  const safe = (invoice.number ?? "").replace(/[^0-9A-Za-z-]/g, "");
  return { pdf, filename: `${tk("docTitle")}-${safe}.pdf` };
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
