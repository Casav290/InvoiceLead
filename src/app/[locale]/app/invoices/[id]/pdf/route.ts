import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireAppSession } from "@/server/auth/guard";
import { db } from "@/server/db";
import { renderInvoicePdf } from "@/server/invoice-pdf";
import { getInvoice } from "@/server/invoices";

export const runtime = "nodejs";

/** PDF d'une facture émise de l'organisation de la session, avec sa QR-facture. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ locale: string; id: string }> },
) {
  const { locale, id } = await params;
  const { organization } = await requireAppSession(locale);
  const found = await getInvoice(db(), organization.id, id);
  if (found?.invoice.status !== "issued") notFound();
  const { invoice, lines } = found;
  const lang = invoice.language;
  const t = await getTranslations({ locale: lang, namespace: "app.invoices.document" });
  const tu = await getTranslations({ locale: lang, namespace: "app.invoices.units" });
  const units = Object.fromEntries(
    ["hour", "day", "piece", "flat", "km", "month"].map((u) => [u, tu(u)]),
  );
  const pdf = await renderInvoicePdf(invoice, lines, {
    invoice: t("invoice"),
    issueDate: t("issueDate"),
    serviceDate: t("serviceDate"),
    dueDate: t("dueDate"),
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
  const filename = `${t("invoice")}-${invoice.number}.pdf`;
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
