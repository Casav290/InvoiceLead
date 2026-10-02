import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { AccountingNav } from "@/components/accounting/AccountingNav";
import { ProLock } from "@/components/app/ProLock";
import { recordElsewhere } from "@/components/app/RecordElsewhere";
import { BillForm } from "@/components/bills/BillForm";
import { Button } from "@/components/ui/button";
import { countryPack } from "@/countries";
import { Link } from "@/i18n/navigation";
import { accountName } from "@/lib/account-name";
import { formatDate } from "@/lib/fiscal-year";
import { formatAmount } from "@/lib/money";
import { listAccounts } from "@/server/accounting";
import { requireAppSession } from "@/server/auth/guard";
import { getBill } from "@/server/bills";
import { db } from "@/server/db";
import { lockFor } from "@/server/plan-lock";
import { featureAccess } from "@/server/plans";
import { approveBillAction, deleteBillAction, markBillPaidAction } from "../actions";

type Props = {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{
    saved?: string;
    approved?: string;
    firstApproval?: string;
    paid?: string;
    error?: string;
  }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "app.bills" });
  return { title: t("title"), robots: { index: false } };
}

const ERRORS = [
  "noAccount",
  "sameApprover",
  "fxRate",
  "noChart",
  "noFiscalYear",
  "vatPeriodClosed",
  "notFound",
  "plan",
];

export default async function BillPage({ params, searchParams }: Props) {
  const { locale, id } = await params;
  const { organization, user } = await requireAppSession(locale);
  const q = await searchParams;
  const bill = await getBill(db(), organization.id, id);
  if (!bill) {
    const elsewhere = await recordElsewhere({
      locale,
      userId: user.id,
      organizationId: organization.id,
      kind: "bill",
      id,
      next: `/${locale}/app/accounting/bills/${id}`,
    });
    if (elsewhere) return elsewhere;
    notFound();
  }
  const t = await getTranslations({ locale, namespace: "app.bills" });
  const style = countryPack(organization.country).amounts;
  const chart = await listAccounts(db(), organization.id);
  const account = chart.find((a) => a.id === bill.accountId);
  const hidden = (
    <>
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="id" value={bill.id} />
    </>
  );
  const notice = q.saved
    ? t("saved")
    : q.approved
      ? t("approvedNotice")
      : q.firstApproval
        ? t("firstApprovalNotice")
        : q.paid
          ? t("paidNotice")
          : null;
  const today = new Date().toISOString().slice(0, 10);
  const draft = bill.status === "draft";
  const multiCurrency = featureAccess(organization, "multiCurrency");
  // Facture en devise étrangère, formule gratuite : l'approbation reste visible, grisée (Pro).
  const approveLock =
    draft && bill.currency !== organization.currency
      ? await lockFor(
          locale,
          organization,
          multiCurrency,
          t("approveCurrencyPlan", { currency: bill.currency }),
        )
      : null;
  const approveBox = (
    <div className="flex flex-wrap items-center gap-3 border border-line-strong bg-panel px-5 py-4">
      <form action={approveBillAction}>
        {hidden}
        <Button type="submit" data-testid="bill-approve">
          {bill.firstApprovedBy ? t("approveSecond") : t("approve")}
        </Button>
      </form>
      <p className="min-w-[min(100%,14rem)] flex-1 text-[13px] text-ink-muted">
        {bill.firstApprovedBy
          ? bill.firstApprovedBy === user.id
            ? t("waitingSecond")
            : t("secondNeeded")
          : t("approveHint")}
      </p>
    </div>
  );

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-8">
      <AccountingNav />
      <p className="text-[13px]">
        <Link
          href="/app/accounting/bills"
          className="font-semibold text-accent-dark hover:underline"
        >
          {t("back")}
        </Link>
      </p>
      <h1 className="mt-2 text-[28px] leading-tight [overflow-wrap:anywhere]">
        {bill.supplierName}
        {bill.number ? ` · ${bill.number}` : ""}
      </h1>
      <p className="mt-2 text-[15px] text-ink-muted" data-testid="bill-status">
        {t(`status.${bill.status}`)} · {bill.currency} {formatAmount(bill.totalCents, style)} ·{" "}
        {t("due", { date: formatDate(bill.dueDate) })}
      </p>
      {notice ? (
        <p
          role="status"
          className="mt-6 border border-ok-fg bg-ok-bg px-4 py-3 text-[13px] text-ok-fg"
        >
          {notice}
        </p>
      ) : null}
      {q.error && ERRORS.includes(q.error) ? (
        <p
          role="alert"
          className="mt-6 border border-hot-fg bg-hot-bg px-4 py-3 text-[13px] text-hot-fg"
        >
          {q.error === "plan"
            ? t("approveCurrencyPlan", { currency: bill.currency })
            : t(`errors.${q.error}`)}
        </p>
      ) : null}
      {bill.receiptId ? (
        <p className="mt-4 text-[13px]">
          <a
            href={`/${locale}/app/accounting/receipts/${bill.receiptId}/file`}
            target="_blank"
            rel="noopener"
            className="font-semibold text-accent-dark underline"
          >
            {t(bill.source === "einvoice" ? "openEInvoice" : "openReceipt")}
          </a>
        </p>
      ) : null}

      {draft ? (
        <>
          {approveLock ? (
            <ProLock lock={approveLock} testId="bill-approve-lock" className="mt-6">
              {approveBox}
            </ProLock>
          ) : (
            <div className="mt-6">{approveBox}</div>
          )}
          <BillForm
            locale={locale}
            id={bill.id}
            vatRegistered={organization.vatRegistered}
            homeCurrency={organization.currency}
            currencyLock={await lockFor(locale, organization, multiCurrency, t("currencyPlan"))}
            accounts={chart
              .filter((a) => a.active && (a.type === "expense" || a.type === "asset") && !a.role)
              .map((a) => ({ id: a.id, label: `${a.number} ${accountName(a, locale)}` }))}
            initial={{
              supplierName: bill.supplierName,
              supplierStreet: bill.supplierStreet ?? "",
              supplierPostalCode: bill.supplierPostalCode ?? "",
              supplierTown: bill.supplierTown ?? "",
              supplierCountry: bill.supplierCountry ?? "",
              iban: bill.iban ?? "",
              bic: bill.bic ?? "",
              paymentReference: bill.paymentReference ?? "",
              number: bill.number ?? "",
              issueDate: bill.issueDate,
              dueDate: bill.dueDate,
              currency: bill.currency,
              total: formatAmount(bill.totalCents),
              vatCode: bill.vatCode ?? "",
              accountId: bill.accountId ?? "",
              description: bill.description ?? "",
            }}
          />
          <form action={deleteBillAction} className="mt-6">
            {hidden}
            <Button type="submit" variant="ghost">
              {t("delete")}
            </Button>
          </form>
        </>
      ) : (
        <>
          <dl className="mt-6 grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 border border-line-strong bg-panel px-5 py-4 text-[13px]">
            <dt className="text-ink-muted">{t("fields.issueDate")}</dt>
            <dd className="tabular-nums">{formatDate(bill.issueDate)}</dd>
            <dt className="text-ink-muted">{t("fields.account")}</dt>
            <dd>{account ? `${account.number} ${accountName(account, locale)}` : "–"}</dd>
            <dt className="text-ink-muted">{t("fields.iban")}</dt>
            <dd className="[overflow-wrap:anywhere]">{bill.iban ?? "–"}</dd>
            <dt className="text-ink-muted">{t("fields.paymentReference")}</dt>
            <dd className="[overflow-wrap:anywhere]">{bill.paymentReference ?? "–"}</dd>
            {bill.paidOn ? (
              <>
                <dt className="text-ink-muted">{t("paidOn")}</dt>
                <dd className="tabular-nums">{formatDate(bill.paidOn)}</dd>
              </>
            ) : null}
          </dl>
          {bill.status === "approved" || bill.status === "scheduled" ? (
            <form
              action={markBillPaidAction}
              className="mt-6 flex flex-wrap items-end gap-3 border border-line-strong bg-panel px-5 py-4"
            >
              {hidden}
              <label className="block">
                <span className="mb-1 block text-[13px] font-semibold">{t("paidOn")}</span>
                <input
                  type="date"
                  name="paidOn"
                  defaultValue={today}
                  className="h-10 border border-line-strong bg-panel px-3 text-[14px]"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-[13px] font-semibold">{t("money")}</span>
                <select
                  name="money"
                  className="h-10 border border-line-strong bg-panel px-3 text-[14px]"
                >
                  <option value="bank">{t("moneyBank")}</option>
                  <option value="cash">{t("moneyCash")}</option>
                </select>
              </label>
              <Button type="submit" variant="secondary" data-testid="bill-mark-paid">
                {t("markPaid")}
              </Button>
              <p className="w-full text-[12px] text-ink-muted">{t("markPaidHint")}</p>
            </form>
          ) : null}
        </>
      )}
    </div>
  );
}
