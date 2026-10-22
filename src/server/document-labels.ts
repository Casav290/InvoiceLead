import { countryPack } from "@/countries";
import { EU_COUNTRIES } from "@/countries/eu";
import { forCountry, type Translator as T } from "@/i18n/country";
import { formatFxRate, toHome } from "@/lib/currencies";
import { formatAmount } from "@/lib/money";
import type { Invoice, InvoiceLine } from "./db/schema";
import type { InvoicePdfLabels } from "./invoice-pdf";

/**
 * Variantes tirées d'une pièce émise : confirmation de commande (d'un devis) et bon de livraison
 * (d'un devis ou d'une facture). Elles reprennent le numéro de la pièce avec leur propre préfixe.
 */
export type DocumentVariant = "order" | "delivery";

export const kindNamespace = (kind: string) =>
  kind === "quote" ? "app.quotes" : kind === "credit_note" ? "app.creditNotes" : "app.invoices";

/**
 * Libellés du PDF d'une pièce, dans sa langue, avec le vocabulaire du pays de l'expéditeur
 * (src/i18n/country.ts) : MWST et Offerte en Suisse, USt et Angebot en Allemagne, sales tax aux
 * États-Unis. Sans base de données : `t` (app.invoices.document), `tk` (espace du type de pièce)
 * et `tu` (app.invoices.units) sont fournis par l'appelant.
 */
export function documentLabels({
  source,
  lines,
  related,
  variant,
  t: tBase,
  tk: tkBase,
  tu: tuBase,
  poweredBy,
}: {
  source: Invoice;
  lines: InvoiceLine[];
  related: { number: string | null } | null;
  variant: DocumentVariant | null;
  t: T;
  tk: T;
  tu: T;
  /** Formule gratuite : la mention « Créé avec InvoiceLead ». */
  poweredBy: boolean;
}): { invoice: Invoice; title: string; labels: InvoicePdfLabels } {
  const country = source.sender?.country;
  const t = forCountry(tBase, country);
  const tk = forCountry(tkBase, country);
  const tu = forCountry(tuBase, country);
  let invoice = source;
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
  return {
    invoice,
    title,
    labels: {
      invoice: title,
      issueDate: t("issueDate"),
      serviceDate: t("serviceDate"),
      dueDate: tk("docDue"),
      description: t("description"),
      quantity: t("quantity"),
      unitPrice: t("unitPrice"),
      // forCountry lit vatUs, vatDe, vatIntl… : la clé de base suffit.
      vat: t("vat"),
      amount: t("amount"),
      net: t("net"),
      total: t("total"),
      vatLine: (rate, base) => t("vatLine", { rate, base }),
      payTo: (iban) => t("payTo", { iban }),
      referenceLine: (reference) => t("referenceLine", { reference }),
      units,
      relatedLine,
      hideDueDate: !!variant,
      deliveryNote: variant === "delivery" ? { received: t("deliveryReceived") } : undefined,
      poweredBy: poweredBy ? t("poweredBy") : undefined,
      taxNote,
      scanToPay: t("scanToPay"),
      fxLine,
    },
  };
}
