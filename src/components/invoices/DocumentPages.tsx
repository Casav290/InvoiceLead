import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import {
  convertQuoteAction,
  createCreditNoteAction,
  deleteDraftAction,
  deletePaymentAction,
  depositInvoiceAction,
  issueInvoiceAction,
  quoteOutcomeAction,
} from "@/app/[locale]/app/invoices/actions";
import { createRecurringAction } from "@/app/[locale]/app/invoices/recurring/actions";
import { waiveChargesAction } from "@/app/[locale]/app/invoices/reminders/actions";
import { type Lock, ProLock } from "@/components/app/ProLock";
import { fieldClass } from "@/components/forms/fields";
import { InvoiceDocument } from "@/components/invoices/InvoiceDocument";
import { InvoiceForm } from "@/components/invoices/InvoiceForm";
import { PaymentForm } from "@/components/invoices/PaymentForm";
import { SendPanel } from "@/components/invoices/SendPanel";
import { Button } from "@/components/ui/button";
import { countryPack } from "@/countries";
import { buildCii } from "@/countries/de/cii";
import { Link } from "@/i18n/navigation";
import { formatDate } from "@/lib/fiscal-year";
import { formatQuantity } from "@/lib/invoice-math";
import { formatAmount } from "@/lib/money";
import { requireAppSession } from "@/server/auth/guard";
import { db } from "@/server/db";
import { emailConfigured } from "@/server/email";
import { invoiceOptions } from "@/server/invoice-options";
import { type DocumentKind, depositInvoices, getInvoice, listInvoices } from "@/server/invoices";
import { invoiceBalance, listPayments, paymentState } from "@/server/payments";
import { lockFor } from "@/server/plan-lock";
import { featureAccess, type OrgPlan, quotaAccess } from "@/server/plans";
import { addMonths } from "@/server/recurring";
import { listReminders } from "@/server/reminders";

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
  "closed",
  "planLimit",
  "recurring",
  "recurringLimit",
  "percent",
  "tooHigh",
  "depositDraft",
];

/**
 * Devise étrangère en formule gratuite : les autres devises sont proposées, grisées, avec la marque
 * Pro ; le serveur refuse aussi une demande forgée.
 */
async function currencyLock(locale: string, organization: OrgPlan): Promise<Lock | null> {
  const t = await getTranslations({ locale, namespace: "app.invoices" });
  return lockFor(
    locale,
    organization,
    featureAccess(organization, "multiCurrency"),
    t("currencyPlan"),
  );
}

/** Objet et message proposés, dans la langue de la pièce. */
async function emailDefaults(
  invoice: import("@/server/db/schema").Invoice,
  to: string | null,
): Promise<{ to: string; subject: string; message: string }> {
  const te = await getTranslations({ locale: invoice.language, namespace: "app.invoices.email" });
  const values = {
    number: invoice.number ?? "",
    company: invoice.sender?.name ?? "",
    amount: formatAmount(invoice.totalCents, countryPack(invoice.sender?.country).amounts),
    currency: invoice.currency,
    due: formatDate(invoice.dueDate),
  };
  return {
    to: to ?? "",
    subject: te(`subjects.${invoice.kind}`, values),
    message: te(`bodies.${invoice.kind}`, values),
  };
}

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
              href="/app/invoices/reminders"
              className="text-[13px] font-semibold text-accent-dark hover:underline"
              data-testid="reminders-link"
            >
              {t("remindersLink")}
            </Link>
          ) : null}
          {kind === "invoice" ? (
            <Link
              href="/app/invoices/recurring"
              className="text-[13px] font-semibold text-accent-dark hover:underline"
            >
              {t("recurringLink")}
            </Link>
          ) : null}
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
                <th className="px-4 py-2.5 text-right">
                  {t("columns.total", { currency: organization.currency })}
                </th>
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
                              openCents:
                                r.totalCents - r.paidCents - r.creditedCents + r.chargesCents,
                            },
                            r.dueDate,
                            today,
                          )}`,
                        )
                      : tk(`status.${r.status}`)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {r.currency !== organization.currency ? `${r.currency} ` : null}
                    {formatAmount(r.totalCents, countryPack(organization.country).amounts)}
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
          country={organization.country}
          localRateBp={organization.salesTaxRateBp}
          currencyLock={await currencyLock(locale, organization)}
          initial={{
            contactId: chosen?.id ?? "",
            language:
              chosen && ["de", "fr", "en"].includes(chosen.language) ? chosen.language : locale,
            issueDate: today,
            serviceDate: today,
            currency: organization.currency,
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
  query: {
    saved?: string;
    issued?: string;
    error?: string;
    converted?: string;
    paid?: string;
    waived?: string;
    from?: string;
  };
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
  const reminders = billed ? await listReminders(db(), organization.id, invoice.id) : [];
  const section = sectionOf(kind);
  const deposits =
    kind === "quote" && !draft ? await depositInvoices(db(), organization.id, invoice.id) : [];
  const amounts = countryPack(organization.country).amounts;
  // Allemagne : XRechnung pour les factures et avoirs émis.
  const xrechnung =
    organization.country === "DE" && kind !== "quote" && !draft
      ? buildCii(invoice, lines, "xrechnung", related)
      : null;
  const hidden = (
    <>
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="id" value={invoice.id} />
      <input type="hidden" name="kind" value={kind} />
    </>
  );
  const tp = await getTranslations({ locale, namespace: "app.plan" });
  // Formule gratuite : 10 factures émises par mois ; au-delà, « Émettre » est grisé (le brouillon
  // reste modifiable).
  const issued =
    draft && kind === "invoice" ? await quotaAccess(db(), organization, "invoices") : null;
  const issueLock = issued
    ? await lockFor(
        locale,
        organization,
        issued,
        tp("used.invoices", { limit: issued.limit, plan: issued.tier }),
      )
    : null;
  const issueBox = (
    <div className="flex flex-wrap items-center gap-3 border border-line-strong bg-panel px-5 py-4">
      <form action={issueInvoiceAction}>
        {hidden}
        <Button type="submit" data-testid="document-issue">
          {tk("issue")}
        </Button>
      </form>
      <p className="flex-1 text-[13px] text-ink-muted">{tk("issueHint")}</p>
    </div>
  );
  // Factures récurrentes : formule gratuite, une active ; au-delà, le panneau reste là, grisé.
  const recurringSlots =
    kind === "invoice" && !draft ? await quotaAccess(db(), organization, "recurring") : null;
  const recurringLock = recurringSlots
    ? await lockFor(
        locale,
        organization,
        recurringSlots,
        tp("used.recurring", { limit: recurringSlots.limit, plan: recurringSlots.tier }),
      )
    : null;
  const recurringForm = (
    <form action={createRecurringAction} className="mt-3 grid gap-3 sm:grid-cols-3">
      {hidden}
      <label className="text-[12px] font-semibold">
        {t("recurring.interval")}
        <select name="intervalMonths" defaultValue="1" className={`${fieldClass} mt-1`}>
          {[1, 3, 6, 12].map((m) => (
            <option key={m} value={m}>
              {t("recurring.every", { months: m })}
            </option>
          ))}
        </select>
      </label>
      <label className="text-[12px] font-semibold">
        {t("recurring.next")}
        <input
          type="date"
          name="nextDate"
          required
          defaultValue={addMonths(invoice.issueDate, 1)}
          className={`${fieldClass} mt-1`}
        />
      </label>
      <label className="flex items-start gap-2 self-end pb-2 text-[12px]">
        <input type="checkbox" name="autoSend" className="mt-0.5 h-4 w-4 shrink-0 accent-accent" />
        <span>{t("recurring.autoSend")}</span>
      </label>
      <div className="sm:col-span-3">
        <Button type="submit" variant="secondary" size="sm" data-testid="recurring-create">
          {t("recurring.create")}
        </Button>
      </div>
    </form>
  );
  const tc = await getTranslations({ locale, namespace: "app.crmImport" });
  const notice = query.paid
    ? t("payments.saved")
    : query.waived
      ? t("payments.waived")
      : query.from === "crmlead" && draft
        ? tc("fromCrm")
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
          {issueLock ? (
            <ProLock lock={issueLock} testId="issue-lock" className="mt-6">
              {issueBox}
            </ProLock>
          ) : (
            <div className="mt-6">{issueBox}</div>
          )}
          <InvoiceForm
            locale={locale}
            kind={kind}
            id={invoice.id}
            vatRegistered={organization.vatRegistered}
            country={organization.country}
            localRateBp={organization.salesTaxRateBp}
            currencyLock={await currencyLock(locale, organization)}
            storedCurrency={invoice.currency}
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
              currency: invoice.currency,
              fxRate: invoice.fxRate ? String(invoice.fxRate) : "",
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
            {kind === "quote" && ["issued", "accepted", "invoiced"].includes(invoice.status) ? (
              <Button asChild variant="secondary">
                <a
                  href={`/${locale}/app/quotes/${invoice.id}/pdf?as=order`}
                  data-testid="document-order"
                >
                  {t("orderPdf")}
                </a>
              </Button>
            ) : null}
            {kind !== "credit_note" ? (
              <Button asChild variant="ghost">
                <a
                  href={`/${locale}/app/${section}/${invoice.id}/pdf?as=delivery`}
                  data-testid="document-delivery"
                >
                  {t("deliveryPdf")}
                </a>
              </Button>
            ) : null}
            {xrechnung ? (
              "xml" in xrechnung ? (
                <Button asChild variant="secondary">
                  <a
                    href={`/${locale}/app/${section}/${invoice.id}/xrechnung`}
                    data-testid="document-xrechnung"
                  >
                    {t("einvoice.download")}
                  </a>
                </Button>
              ) : (
                <p
                  className="self-center text-[13px] text-ink-muted"
                  data-testid="xrechnung-missing"
                >
                  {t("einvoice.missing", {
                    fields: xrechnung.missing.map((m) => t(`einvoice.fields.${m}`)).join(", "),
                  })}
                </p>
              )
            ) : null}
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
          {kind === "quote" &&
          (deposits.length > 0 || ["issued", "accepted"].includes(invoice.status)) ? (
            <section className="mb-4 border border-line-strong bg-panel" data-testid="deposits">
              <h2 className="border-b border-line bg-head px-5 py-3 text-[10.5px] font-extrabold tracking-[0.09em] text-ink-muted uppercase">
                {t("deposit.title")}
              </h2>
              {deposits.length > 0 ? (
                <ul className="px-5 pt-3 text-[13px]">
                  {deposits.map((d) => (
                    <li key={d.id} className="flex justify-between gap-4 py-1">
                      <Link
                        href={`/app/invoices/${d.id}`}
                        className="font-semibold text-accent-dark hover:underline"
                      >
                        {d.number ?? t("deposit.draft")}
                      </Link>
                      <span className="tabular-nums">
                        {invoice.currency} {formatAmount(d.totalCents, amounts)}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
              {["issued", "accepted"].includes(invoice.status) ? (
                <form action={depositInvoiceAction} className="flex flex-wrap items-end gap-3 p-5">
                  {hidden}
                  <label className="block">
                    <span className="mb-1 block text-[13px] font-semibold">
                      {t("deposit.percent")}
                    </span>
                    <input
                      name="percent"
                      defaultValue="30"
                      inputMode="decimal"
                      required
                      className="h-10 w-24 border border-line-strong bg-panel px-3 text-[14px]"
                    />
                  </label>
                  <Button type="submit" variant="secondary" data-testid="deposit-create">
                    {t("deposit.create")}
                  </Button>
                  <p className="w-full text-[12px] text-ink-muted">{t("deposit.hint")}</p>
                </form>
              ) : null}
            </section>
          ) : null}
          <SendPanel
            locale={locale}
            id={invoice.id}
            language={invoice.language}
            configured={emailConfigured()}
            sentInfo={
              invoice.sentAt
                ? t("email.sentInfo", {
                    to: invoice.sentTo ?? "",
                    date: formatDate(invoice.sentAt.toISOString().slice(0, 10)),
                  }) + (invoice.viewedAt ? ` ${t("email.viewed")}` : "")
                : null
            }
            defaults={await emailDefaults(invoice, found.contact.email)}
          />
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
                {(
                  [
                    "totalCents",
                    "creditedCents",
                    "paidCents",
                    ...(balance.chargesCents ? (["chargesCents"] as const) : []),
                    "openCents",
                  ] as const
                ).map((k) => (
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
                      {formatAmount(balance[k] ?? 0, countryPack(organization.country).amounts)}
                    </dd>
                  </div>
                ))}
              </dl>
              {balance.chargesCents ? (
                <form
                  action={waiveChargesAction}
                  className="flex flex-wrap items-center gap-3 border-t border-line px-5 py-3"
                >
                  {hidden}
                  <p className="flex-1 text-[12px] text-ink-muted">{t("payments.chargesHint")}</p>
                  <Button type="submit" variant="ghost" size="sm" data-testid="charges-waive">
                    {t("payments.waive")}
                  </Button>
                </form>
              ) : null}
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
                        {formatAmount(p.amountCents, countryPack(organization.country).amounts)}
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
              {reminders.length > 0 ? (
                <ul
                  className="border-t border-line px-5 py-2 text-[12px] text-ink-2"
                  data-testid="reminder-history"
                >
                  {reminders.map((r) => (
                    <li key={r.id}>
                      {t("reminderLine", {
                        level: r.level,
                        date: formatDate(r.sentAt.toISOString().slice(0, 10)),
                        channel: r.channel,
                      })}
                    </li>
                  ))}
                </ul>
              ) : null}
              {balance.openCents > 0 ? (
                <PaymentForm
                  currency={invoice.currency}
                  home={organization.currency}
                  locale={locale}
                  invoiceId={invoice.id}
                  initial={{ paidOn: today, amount: formatAmount(balance.openCents) }}
                />
              ) : null}
            </section>
          ) : null}
          {kind === "invoice" ? (
            <details
              className="mb-6 border border-line-strong bg-panel px-5 py-3"
              data-testid="recurring-panel"
              open={recurringLock ? true : undefined}
            >
              <summary className="cursor-pointer text-[13px] font-semibold text-accent-dark">
                {t("recurring.title")}
              </summary>
              {recurringLock ? (
                <ProLock lock={recurringLock} testId="recurring-panel-lock" className="mt-3">
                  <div className="px-3 pb-3">{recurringForm}</div>
                </ProLock>
              ) : (
                recurringForm
              )}
              {recurringSlots && Number.isFinite(recurringSlots.limit) ? (
                <p className="mt-2 text-[12px] text-ink-muted" data-testid="recurring-panel-quota">
                  {tp("quota.recurring", {
                    used: recurringSlots.used,
                    limit: recurringSlots.limit,
                  })}
                </p>
              ) : null}
            </details>
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
