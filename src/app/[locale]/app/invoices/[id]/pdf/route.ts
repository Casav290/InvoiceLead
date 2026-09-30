import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireAppSession } from "@/server/auth/guard";
import { db } from "@/server/db";
import { renderInvoicePdf } from "@/server/invoice-pdf";
import { getInvoice } from "@/server/invoices";

export const runtime = "nodejs";

/** PDF d'une facture émise de l'organisation de la session, avec sa QR-facture. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ locale: string; id: string }> },
) {
  const { locale, id } = await params;
  const { organization } = await requireAppSession(locale);
  const found = await getInvoice(db(), organization.id, id);
  // La même route sert les devis (/quotes/…/pdf) : le type demandé doit correspondre à la pièce.
  const kind = new URL(request.url).pathname.includes("/app/quotes/") ? "quote" : "invoice";
  if (!found || found.invoice.kind !== kind || found.invoice.status === "draft") notFound();
  const { invoice, lines } = found;
  const lang = invoice.language;
  const t = await getTranslations({ locale: lang, namespace: "app.invoices.document" });
  const tk = await getTranslations({
    locale: lang,
    namespace: kind === "quote" ? "app.quotes" : "app.invoices",
  });
  const tu = await getTranslations({ locale: lang, namespace: "app.invoices.units" });
  const units = Object.fromEntries(
    ["hour", "day", "piece", "flat", "km", "month"].map((u) => [u, tu(u)]),
  );
  const pdf = await renderInvoicePdf(invoice, lines, {
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
  });
  const filename = `${tk("docTitle")}-${invoice.number}.pdf`;
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
