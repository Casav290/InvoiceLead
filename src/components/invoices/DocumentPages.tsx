import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import {
  convertQuoteAction,
  createCreditNoteAction,
  deleteDraftAction,
  deletePaymentAction,
  issueInvoiceAction,
  quoteOutcomeAction,
} from "@/app/[locale]/app/invoices/actions";
import { InvoiceDocument } from "@/components/invoices/InvoiceDocument";
import { InvoiceForm } from "@/components/invoices/InvoiceForm";
import { PaymentForm } from "@/components/invoices/PaymentForm";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { formatDate } from "@/lib/fiscal-year";
import { formatQuantity } from "@/lib/invoice-math";
import { formatAmount } from "@/lib/money";
import { requireAppSession } from "@/server/auth/guard";
import { db } from "@/server/db";
import { invoiceOptions } from "@/server/invoice-options";
import { type DocumentKind, getInvoice, listInvoices } from "@/server/invoices";
import { invoiceBalance, listPayments, paymentState } from "@/server/payments";

/**
 * Pages partagées des factures et des devis : même liste, même formulaire, même aperçu. Seuls les
 * libellés (espace `app.invoices` ou `app.quotes`) et les actions propres au devis changent.
 */

const namespaceOf = (kind: DocumentKind) =>
  kind === "quote" ? "app.quotes" : kind === "credit_note" ? "app.creditNotes" : "app.invoices";
const sectionOf = (kind: DocumentKind) =>
  kind === "quote" ? "quotes" : kind === "credit_note" ? "credit-notes" : "invoices";
const ERRORS = [
  "companyIncomplete",
  "vatChanged",
  "notDraft",
  "notFound",
  "notConvertible",
  "contact",
  "creditTooHigh",
];

export async function documentMetadata(
  locale: string,
  kind: DocumentKind,
  key: "title" | "new" | "edit",
): Promise<Metadata> {
  const tk = await getTranslations({ locale, namespace: namespaceOf(kind) });
  return { title: tk(key), robots: { index: false } };
}

export async function DocumentListPage({
  locale,
  kind,
  deleted,
}: {
  locale: string;
  kind: DocumentKind;
  deleted?: string;
}) {
  const { organization } = await requireAppSession(locale);
  const t = await getTranslations({ locale, namespace: "app.invoices" });
  const tk = await getTranslations({ locale, namespace: namespaceOf(kind) });
  const rows = await listInvoices(db(), organization.id, kind);
  const section = sectionOf(kind);
  const today = new Date().toISOString().slice(0, 10);
  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="text-[28px] leading-tight">{tk("title")}</h1>
        <div className="flex flex-wrap items-center gap-4">
          {kind === "invoice" ? (
            <Link
              href="/app/credit-notes"
              className="text-[13px] font-semibold text-accent-dark hover:underline"
            >
              {t("creditNotesLink")}
            </Link>
          ) : null}
          {kind === "credit_note" ? null : (
            <Button asChild>
              <Link href={`/app/${section}/new`} data-testid={`${kind}-new`}>
                {tk("new")}
              </Link>
            </Button>
          )}
        </div>
      </div>
      {deleted ? (
        <p
          role="status"
          className="mt-6 border border-line-strong bg-panel px-4 py-3 text-[13px] text-ink-2"
        >
          {tk("deleted")}
        </p>
      ) : null}
      {rows.length === 0 ? (
        <p className="mt-8 border border-line-strong bg-panel px-5 py-8 text-center text-[14px] text-ink-muted">
          {tk("empty")}
        </p>
      ) : (
        <div className="mt-6 overflow-x-auto border border-line-strong bg-panel">
          <table className="w-full text-left text-[14px]">
            <thead>
              <tr className="border-b border-line-strong bg-head text-[10.5px] font-extrabold tracking-[0.09em] text-ink-muted uppercase">
                <th className="px-4 py-2.5">{t("columns.number")}</th>
                <th className="px-4 py-2.5">{t("columns.customer")}</th>
                <th className="hidden px-4 py-2.5 sm:table-cell">{t("columns.date")}</th>
                <th className="hidden px-4 py-2.5 md:table-cell">{t("columns.status")}</th>
                <th className="px-4 py-2.5 text-right">{t("columns.total")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.id}
                  className="border-b border-line-soft last:border-b-0 hover:bg-rowhover"
                >
                  <td className="px-4 py-3 whitespace-nowrap">
                    <Link
                      href={`/app/${section}/${r.id}`}
                      className="font-semibold text-accent-dark hover:underline"
                    >
                      {r.number ?? tk("status.draft")}
                    </Link>
                  </td>
                  <td className="px-4 py-3 [overflow-wrap:anywhere]">{r.contactName}</td>
                  <td className="hidden px-4 py-3 text-ink-2 tabular-nums sm:table-cell">
                    {formatDate(r.issueDate)}
                  </td>
                  <td className="hidden px-4 py-3 text-ink-2 md:table-cell">
                    {kind === "invoice" && r.status === "issued"
                      ? t(
                          `payments.states.${paymentState(
                            {
                              totalCents: r.totalCents,
                              paidCents: r.paidCents,
                              creditedCents: r.creditedCents,
                              openCents: r.totalCents - r.paidCents - r.creditedCents,
                            },
                            r.dueDate,
                            today,
                          )}`,
                        )
                      : tk(`status.${r.status}`)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {formatAmount(r.totalCents)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export async function NewDocumentPage({
  locale,
  kind,
  contact,
}: {
  locale: string;
  kind: DocumentKind;
  contact?: string;
}) {
  const { organization } = await requireAppSession(locale);
  const t = await getTranslations({ locale, namespace: "app.invoices" });
  const tk = await getTranslations({ locale, namespace: namespaceOf(kind) });
  const options = await invoiceOptions(db(), organization.id);
  const chosen = options.contacts.find((c) => c.id === contact);
  const today = new Date().toISOString().slice(0, 10);
  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-8">
      <h1 className="text-[28px] leading-tight">{tk("new")}</h1>
      {options.contacts.length === 0 ? (
        <p className="mt-8 border border-line-strong bg-panel px-5 py-6 text-[14px] text-ink-2">
          {t("noCustomers")}{" "}
          <Link href="/app/contacts/new" className="font-semibold text-accent-dark underline">
            {t("addCustomer")}
          </Link>
        </p>
      ) : (
        <InvoiceForm
          locale={locale}
          kind={kind}
          contacts={options.contacts}
          products={options.products}
          vatRegistered={organization.vatRegistered}
          initial={{
            contactId: chosen?.id ?? "",
            language:
              chosen && (chosen.language === "de" || chosen.language === "fr")
                ? chosen.language
                : locale,
            issueDate: today,
            serviceDate: today,
          }}
        />
      )}
    </div>
  );
}

export async function DocumentDetailPage({
  locale,
  kind,
  id,
  query,
}: {
  locale: string;
  kind: DocumentKind;
  id: string;
  query: { saved?: string; issued?: string; error?: string; converted?: string; paid?: string };
}) {
  const { organization } = await requireAppSession(locale);
  const found = await getInvoice(db(), organization.id, id);
  if (found?.invoice.kind !== kind) notFound();
  const { invoice, lines, related } = found;
  const t = await getTranslations({ locale, namespace: "app.invoices" });
  const tk = await getTranslations({ locale, namespace: namespaceOf(kind) });
  const draft = invoice.status === "draft";
  const today = new Date().toISOString().slice(0, 10);
  const billed = kind === "invoice" && invoice.status === "issued";
  const balance = billed ? await invoiceBalance(db(), invoice.id, invoice.totalCents) : null;
  const payments = billed ? await listPayments(db(), organization.id, invoice.id) : [];
  const section = sectionOf(kind);
  const hidden = (
    <>
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="id" value={invoice.id} />
      <input type="hidden" name="kind" value={kind} />
    </>
  );
  const notice = query.paid
    ? t("payments.saved")
    : query.converted
      ? tk("converted")
      : query.issued
        ? tk("issued")
        : query.saved
          ? tk("saved")
          : null;

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-8">
      <p className="text-[13px]">
        <Link href={`/app/${section}`} className="font-semibold text-accent-dark hover:underline">
          {tk("back")}
        </Link>
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <h1 className="text-[28px] leading-tight">
          {draft ? tk("draftTitle") : tk("issuedTitle", { number: invoice.number ?? "" })}
        </h1>
        <span
          data-testid="document-status"
          className="border border-line-strong px-2 py-0.5 text-[12px] font-semibold text-ink-2"
        >
          {tk(`status.${invoice.status}`)}
        </span>
      </div>
      {notice ? (
        <p
          role="status"
          className="mt-6 border border-ok-fg bg-ok-bg px-4 py-3 text-[13px] text-ok-fg"
        >
          {notice}
        </p>
      ) : null}
      {query.error && ERRORS.includes(query.error) ? (
        <p
          role="alert"
          className="mt-6 border border-hot-fg bg-hot-bg px-4 py-3 text-[13px] text-hot-fg"
        >
          {t(`issueErrors.${query.error}`)}
          {query.error === "companyIncomplete" ? (
            <>
              {" "}
              <Link href="/app/settings/company" className="font-semibold underline">
                {t("completeCompany")}
              </Link>
            </>
          ) : null}
        </p>
      ) : null}

      {related ? (
        <p className="mt-4 text-[13px] text-ink-2">
          <Link
            href={`/app/invoices/${related.id}`}
            className="font-semibold text-accent-dark underline"
          >
            {t("relatedInvoice", { number: related.number ?? "" })}
          </Link>
        </p>
      ) : null}
      {draft ? (
        <>
          <div className="mt-6 flex flex-wrap items-center gap-3 border border-line-strong bg-panel px-5 py-4">
            <form action={issueInvoiceAction}>
              {hidden}
              <Button type="submit" data-testid="document-issue">
                {tk("issue")}
              </Button>
            </form>
            <p className="flex-1 text-[13px] text-ink-muted">{tk("issueHint")}</p>
          </div>
          <InvoiceForm
            locale={locale}
            kind={kind}
            id={invoice.id}
            vatRegistered={organization.vatRegistered}
            {...(await invoiceOptions(db(), organization.id))}
            initial={{
              contactId: invoice.contactId,
              language: invoice.language,
              title: invoice.title ?? "",
              introText: invoice.introText ?? "",
              footerText: invoice.footerText ?? "",
              issueDate: invoice.issueDate,
              serviceDate: invoice.serviceDate,
              dueDate: invoice.dueDate,
              "line.productId": lines.map((l) => l.productId ?? ""),
              "line.description": lines.map((l) => l.description),
              "line.quantity": lines.map((l) => formatQuantity(l.quantityMilli)),
              "line.unit": lines.map((l) => l.unit),
              "line.unitPrice": lines.map((l) => formatAmount(l.unitPriceCents)),
              "line.vatCode": lines.map((l) => l.vatCode ?? "normal"),
            }}
          />
          <form action={deleteDraftAction} className="mt-6">
            {hidden}
            <Button type="submit" variant="ghost" data-testid="document-delete">
              {tk("deleteDraft")}
            </Button>
          </form>
        </>
      ) : (
        <div className="mt-6">
          <div className="mb-4 flex flex-wrap gap-3">
            <Button asChild variant={kind === "quote" ? "secondary" : "primary"}>
              <a href={`/${locale}/app/${section}/${invoice.id}/pdf`} data-testid="document-pdf">
                {t("download")}
              </a>
            </Button>
            {balance && balance.totalCents - balance.creditedCents > 0 ? (
              <form action={createCreditNoteAction}>
                {hidden}
                <Button type="submit" variant="ghost" data-testid="credit-note-create">
                  {t("createCreditNote")}
                </Button>
              </form>
            ) : null}
            {kind === "quote" && ["issued", "accepted"].includes(invoice.status) ? (
              <form action={convertQuoteAction}>
                {hidden}
                <Button type="submit" data-testid="quote-convert">
                  {tk("convert")}
                </Button>
              </form>
            ) : null}
            {kind === "quote" && ["issued", "declined"].includes(invoice.status) ? (
              <form action={quoteOutcomeAction}>
                {hidden}
                <input type="hidden" name="outcome" value="accepted" />
                <Button type="submit" variant="secondary" data-testid="quote-accept">
                  {tk("accept")}
                </Button>
              </form>
            ) : null}
            {kind === "quote" && ["issued", "accepted"].includes(invoice.status) ? (
              <form action={quoteOutcomeAction}>
                {hidden}
                <input type="hidden" name="outcome" value="declined" />
                <Button type="submit" variant="ghost" data-testid="quote-decline">
                  {tk("decline")}
                </Button>
              </form>
            ) : null}
          </div>
          {balance ? (
            <section
              className="mb-6 border border-line-strong bg-panel"
              data-testid="invoice-balance"
            >
              <h2 className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-head px-5 py-3 text-[10.5px] font-extrabold tracking-[0.09em] text-ink-muted uppercase">
                <span>{t("payments.title")}</span>
                <span data-testid="payment-state" className="text-ink-2">
                  {t(`payments.states.${paymentState(balance, invoice.dueDate, today)}`)}
                </span>
              </h2>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1 px-5 py-4 text-[14px] sm:grid-cols-4">
                {(["totalCents", "creditedCents", "paidCents", "openCents"] as const).map((k) => (
                  <div key={k}>
                    <dt className="text-[12px] text-ink-muted">{t(`payments.${k}`)}</dt>
                    <dd
                      className={
                        k === "openCents"
                          ? "font-extrabold tabular-nums"
                          : "tabular-nums text-ink-2"
                      }
                      data-testid={`balance-${k}`}
                    >
                      {formatAmount(balance[k])}
                    </dd>
                  </div>
                ))}
              </dl>
              {payments.length > 0 ? (
                <ul className="border-t border-line">
                  {payments.map((p) => (
                    <li
                      key={p.id}
                      className="flex flex-wrap items-center gap-3 border-b border-line-soft px-5 py-2 text-[13px] last:border-b-0"
                    >
                      <span className="tabular-nums">{formatDate(p.paidOn)}</span>
                      <span className="text-ink-2">{t(`payments.methods.${p.method}`)}</span>
                      {p.note ? (
                        <span className="text-ink-muted [overflow-wrap:anywhere]">{p.note}</span>
                      ) : null}
                      <span className="ml-auto font-semibold tabular-nums">
                        {formatAmount(p.amountCents)}
                      </span>
                      <form action={deletePaymentAction}>
                        {hidden}
                        <input type="hidden" name="paymentId" value={p.id} />
                        <Button type="submit" variant="ghost" size="sm">
                          {t("payments.delete")}
                        </Button>
                      </form>
                    </li>
                  ))}
                </ul>
              ) : null}
              {balance.openCents > 0 ? (
                <PaymentForm
                  locale={locale}
                  invoiceId={invoice.id}
                  initial={{ paidOn: today, amount: formatAmount(balance.openCents) }}
                />
              ) : null}
            </section>
          ) : null}
          {invoice.sourceQuoteId ? (
            <p className="mb-4 text-[13px] text-ink-2">
              <Link
                href={`/app/quotes/${invoice.sourceQuoteId}`}
                className="font-semibold text-accent-dark underline"
              >
                {t("fromQuote")}
              </Link>
            </p>
          ) : null}
          <InvoiceDocument invoice={invoice} lines={lines} relatedNumber={related?.number} />
        </div>
      )}
    </div>
  );
}
