import "server-only";
import { eq } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { countryPack } from "@/countries";
import { buildCii } from "@/countries/de/cii";
import { EU_COUNTRIES } from "@/countries/eu";
import { formatFxRate, toHome } from "@/lib/currencies";
import { formatAmount } from "@/lib/money";
import { db } from "./db";
import { type Invoice, type InvoiceLine, organizations } from "./db/schema";
import { renderInvoicePdf } from "./invoice-pdf";
import { organizationLogo } from "./logo";
import { poweredBy } from "./plans";

export const kindNamespace = (kind: string) =>
  kind === "quote" ? "app.quotes" : kind === "credit_note" ? "app.creditNotes" : "app.invoices";

/**
 * Variantes tirées d'une pièce émise : confirmation de commande (d'un devis) et bon de livraison
 * (d'un devis ou d'une facture). Elles reprennent le numéro de la pièce avec leur propre préfixe.
 */
export type DocumentVariant = "order" | "delivery";

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
  let invoice = source;
  const lang = invoice.language;
  const t = await getTranslations({ locale: lang, namespace: "app.invoices.document" });
  const tk = await getTranslations({ locale: lang, namespace: kindNamespace(invoice.kind) });
  const tu = await getTranslations({ locale: lang, namespace: "app.invoices.units" });
  let title = tk("docTitle");
  let relatedLine = related?.number ? t("relatedLine", { number: related.number }) : undefined;
  if (variant) {
    // Numéro de la variante : préfixe propre, numéro de la pièce sans son préfixe (« O- »).
    const base = (source.number ?? "").replace(/^[A-Z]+-/, "");
    title = t(`${variant}Title`);
    relatedLine = t(source.kind === "quote" ? "fromQuote" : "fromInvoice", {
      number: source.number ?? "",
    });
    // Ni QR-facture ni référence de paiement : la variante n'est pas une demande de paiement.
    invoice = {
      ...source,
      kind: "quote",
      number: `${t(`${variant}Prefix`)}-${base}`,
      paymentReference: null,
    };
  }
  const units = Object.fromEntries(
    ["hour", "day", "piece", "flat", "km", "month"].map((u) => [u, tu(u)]),
  );
  const [org] = await db()
    .select({ leadPlan: organizations.leadPlan, entitlements: organizations.entitlements })
    .from(organizations)
    .where(eq(organizations.id, invoice.organizationId));
  const mention = org && poweredBy(org) ? t("poweredBy") : undefined;
  const country = invoice.sender?.country;
  // États-Unis : sales tax, pas de TVA, dans les libellés.
  const us = country === "US";
  const germany = country === "DE";
  const exportLines = lines.some((l) => l.vatCode === "export");
  const toEu = EU_COUNTRIES.has(invoice.recipient?.country ?? "");
  const notes: string[] = [];
  if (germany && !variant) {
    if (!invoice.vatRegistered) notes.push(t("smallBusinessDe"));
    else if (exportLines) notes.push(t("reverseChargeDe"));
  }
  if (country === "FR" && !variant) {
    // Mentions obligatoires françaises : régime de TVA, puis pénalités de retard (art. L441-10 C. com.).
    if (!invoice.vatRegistered) notes.push(t("franchiseFr"));
    else if (exportLines) notes.push(t(toEu ? "reverseChargeFr" : "outsideEuFr"));
    if (invoice.kind === "invoice") notes.push(t("latePaymentFr"));
  }
  if (country === "GB" && !variant && invoice.vatRegistered && exportLines)
    notes.push(t("outsideScopeGb"));
  const taxNote = notes.length > 0 ? notes.join("\n") : undefined;
  const pack = countryPack(country);
  const fxLine =
    invoice.fxRate && variant !== "delivery"
      ? [
          t("fxLine", {
            currency: invoice.currency,
            rate: formatFxRate(invoice.fxRate),
            home: pack.currency,
            total: formatAmount(toHome(invoice.totalCents, invoice.fxRate), pack.amounts),
          }),
          invoice.vatRegistered && invoice.vatCents > 0
            ? t("fxVatLine", {
                home: pack.currency,
                vat: formatAmount(toHome(invoice.vatCents, invoice.fxRate), pack.amounts),
              })
            : null,
        ]
          .filter(Boolean)
          .join(", ")
      : undefined;
  // Allemagne et France : facture et avoir en ZUGFeRD / Factur-X (PDF/A-3 avec le XML EN 16931).
  const einvoicing = germany || country === "FR";
  const cii =
    einvoicing && invoice.kind !== "quote" ? buildCii(invoice, lines, "zugferd", related) : null;
  const einvoice = cii && "xml" in cii ? { xml: cii.xml } : undefined;
  const pdf = await renderInvoicePdf(
    invoice,
    lines,
    {
      invoice: title,
      issueDate: t("issueDate"),
      serviceDate: t("serviceDate"),
      dueDate: tk("docDue"),
      description: t("description"),
      quantity: t("quantity"),
      unitPrice: t("unitPrice"),
      vat: t(us ? "vatUs" : "vat"),
      amount: t("amount"),
      net: t(us ? "netUs" : "net"),
      total: t("total"),
      vatLine: (rate, base) => t(us ? "vatLineUs" : "vatLine", { rate, base }),
      payTo: (iban) => t("payTo", { iban }),
      referenceLine: (reference) => t("referenceLine", { reference }),
      units,
      relatedLine,
      hideDueDate: !!variant,
      deliveryNote: variant === "delivery" ? { received: t("deliveryReceived") } : undefined,
      poweredBy: mention,
      taxNote,
      scanToPay: t("scanToPay"),
      fxLine,
    },
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
