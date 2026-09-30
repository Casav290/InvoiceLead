import { getTranslations } from "next-intl/server";
import { formatRate } from "@/countries/ch/vat";
import { formatDate } from "@/lib/fiscal-year";
import { computeTotals, formatQuantity } from "@/lib/invoice-math";
import { formatAmount } from "@/lib/money";
import type { Invoice, InvoiceLine, PartySnapshot } from "@/server/db/schema";

function Address({ party }: { party: PartySnapshot }) {
  return (
    <address className="text-[13px] leading-relaxed not-italic">
      <strong className="block">{party.name}</strong>
      {party.contactPerson ? <span className="block">{party.contactPerson}</span> : null}
      {party.street ? (
        <span className="block">
          {party.street} {party.buildingNumber ?? ""}
        </span>
      ) : null}
      {party.postalCode || party.town ? (
        <span className="block">
          {party.country !== "CH" ? `${party.country}-` : ""}
          {party.postalCode} {party.town}
        </span>
      ) : null}
    </address>
  );
}

/**
 * Facture telle qu'elle a été émise, dans sa langue, à partir des données figées. Sert d'aperçu à
 * l'écran ; le PDF avec QR-facture reprendra la même mise en page.
 */
export async function InvoiceDocument({
  invoice,
  lines,
  relatedNumber,
}: {
  invoice: Invoice;
  lines: InvoiceLine[];
  relatedNumber?: string | null;
}) {
  const lang = invoice.language;
  const t = await getTranslations({ locale: lang, namespace: "app.invoices.document" });
  const tk = await getTranslations({
    locale: lang,
    namespace:
      invoice.kind === "quote"
        ? "app.quotes"
        : invoice.kind === "credit_note"
          ? "app.creditNotes"
          : "app.invoices",
  });
  const tu = await getTranslations({ locale: lang, namespace: "app.invoices.units" });
  const sender = invoice.sender;
  const recipient = invoice.recipient;
  const totals = computeTotals(lines);
  return (
    <article
      lang={lang}
      data-testid="invoice-document"
      className="border border-line-strong bg-panel px-5 py-6 sm:px-10 sm:py-10"
    >
      <div className="grid gap-6 sm:grid-cols-2">
        {sender ? (
          <div>
            <Address party={sender} />
            {sender.vatNumber ? (
              <p className="mt-1 text-[12px] text-ink-2">{sender.vatNumber}</p>
            ) : null}
          </div>
        ) : null}
        {recipient ? (
          <div className="sm:pt-10">
            <Address party={recipient} />
          </div>
        ) : null}
      </div>
      <h2 className="mt-10 text-[22px] leading-tight">
        {invoice.title || tk("docTitle")} {invoice.number}
      </h2>
      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 text-[13px] text-ink-2">
        <dt>{t("issueDate")}</dt>
        <dd className="tabular-nums">{formatDate(invoice.issueDate)}</dd>
        <dt>{t("serviceDate")}</dt>
        <dd className="tabular-nums">{formatDate(invoice.serviceDate)}</dd>
        {invoice.kind === "credit_note" ? null : (
          <>
            <dt>{tk("docDue")}</dt>
            <dd className="tabular-nums">{formatDate(invoice.dueDate)}</dd>
          </>
        )}
      </dl>
      {relatedNumber ? (
        <p className="mt-3 text-[13px]">{t("relatedLine", { number: relatedNumber })}</p>
      ) : null}
      {invoice.introText ? (
        <p className="mt-6 text-[14px] whitespace-pre-line">{invoice.introText}</p>
      ) : null}
      <div className="mt-6 overflow-x-auto">
        <table className="w-full text-left text-[13px]">
          <thead>
            <tr className="border-b border-line-strong text-[10.5px] font-extrabold tracking-[0.09em] text-ink-muted uppercase">
              <th className="py-2 pr-3">{t("description")}</th>
              <th className="py-2 pr-3 text-right">{t("quantity")}</th>
              <th className="hidden py-2 pr-3 text-right sm:table-cell">{t("unitPrice")}</th>
              {invoice.vatRegistered ? (
                <th className="hidden py-2 pr-3 text-right sm:table-cell">{t("vat")}</th>
              ) : null}
              <th className="py-2 text-right">{t("amount")}</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.id} className="border-b border-line-soft align-top">
                <td className="py-2 pr-3 whitespace-pre-line [overflow-wrap:anywhere]">
                  {l.description}
                </td>
                <td className="py-2 pr-3 text-right whitespace-nowrap tabular-nums">
                  {formatQuantity(l.quantityMilli)} {tu(l.unit)}
                </td>
                <td className="hidden py-2 pr-3 text-right tabular-nums sm:table-cell">
                  {formatAmount(l.unitPriceCents)}
                </td>
                {invoice.vatRegistered ? (
                  <td className="hidden py-2 pr-3 text-right sm:table-cell">
                    {formatRate(l.vatRateBp, lang)}
                  </td>
                ) : null}
                <td className="py-2 text-right tabular-nums">{formatAmount(l.netCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <dl className="mt-4 ml-auto max-w-sm text-[13px]">
        {invoice.vatRegistered ? (
          <>
            <div className="flex justify-between gap-4">
              <dt>{t("net")}</dt>
              <dd className="tabular-nums">{formatAmount(invoice.netCents)}</dd>
            </div>
            {totals.vat
              .filter((v) => v.rateBp > 0)
              .map((v) => (
                <div key={v.rateBp} className="flex justify-between gap-4 text-ink-2">
                  <dt>
                    {t("vatLine", {
                      rate: formatRate(v.rateBp, lang),
                      base: formatAmount(v.netCents),
                    })}
                  </dt>
                  <dd className="tabular-nums">{formatAmount(v.vatCents)}</dd>
                </div>
              ))}
          </>
        ) : null}
        <div className="mt-2 flex justify-between gap-4 border-t border-line-strong pt-2 text-[15px] font-extrabold">
          <dt>{t("total")}</dt>
          <dd className="tabular-nums" data-testid="invoice-total">
            {invoice.currency} {formatAmount(invoice.totalCents)}
          </dd>
        </div>
      </dl>
      {invoice.footerText ? (
        <p className="mt-8 text-[13px] whitespace-pre-line text-ink-2">{invoice.footerText}</p>
      ) : null}
      {invoice.kind === "invoice" && (sender?.iban || sender?.qrIban) ? (
        <p className="mt-8 text-[12px] text-ink-muted">
          {t("payTo", { iban: sender.qrIban ?? sender.iban ?? "" })}
        </p>
      ) : null}
    </article>
  );
}
