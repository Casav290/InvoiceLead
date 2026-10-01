import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { AccountingNav } from "@/components/accounting/AccountingNav";
import { PlanNotice } from "@/components/app/PlanNotice";
import { Button } from "@/components/ui/button";
import { countryPack } from "@/countries";
import { VAT_CODES } from "@/countries/ch/vat";
import { Link } from "@/i18n/navigation";
import { accountName } from "@/lib/account-name";
import { formatDate } from "@/lib/fiscal-year";
import { formatAmount } from "@/lib/money";
import { listAccounts } from "@/server/accounting";
import { aiConfigured } from "@/server/ai";
import { requireAppSession } from "@/server/auth/guard";
import { CONFIDENT, listBankTransactions } from "@/server/bank";
import { listRules } from "@/server/booking-rules";
import { db } from "@/server/db";
import { listInvoices } from "@/server/invoices";
import { hasFeature, upgradeUrl } from "@/server/plans";
import {
  deleteRuleAction,
  ignoreBankAction,
  importStatementAction,
  proposeAction,
  validateBankAction,
  validateConfidentAction,
} from "../actions";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{
    imported?: string;
    duplicates?: string;
    validated?: string;
    error?: string;
    ai?: string;
    auto?: string;
  }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "app.bank" });
  return { title: t("title"), robots: { index: false } };
}

const ERRORS = [
  "file",
  "format",
  "tooHigh",
  "noChart",
  "noFiscalYear",
  "noProposal",
  "notFound",
  "vatPeriodClosed",
  "plan",
];

export default async function BankPage({ params, searchParams }: Props) {
  const { locale } = await params;
  const { organization } = await requireAppSession(locale);
  const style = countryPack(organization.country).amounts;
  const q = await searchParams;
  const t = await getTranslations({ locale, namespace: "app.bank" });
  const [rows, chart, invoiceRows, rules] = await Promise.all([
    listBankTransactions(db(), organization.id),
    listAccounts(db(), organization.id),
    listInvoices(db(), organization.id, "invoice"),
    listRules(db(), organization.id),
  ]);
  const accountLabel = new Map(chart.map((a) => [a.id, `${a.number} ${accountName(a, locale)}`]));
  const invoiceName = new Map(
    invoiceRows.map((i) => [i.id, `${i.number ?? ""} · ${i.contactName}`]),
  );
  const choices = chart.filter((a) => a.active && !a.number.startsWith("9") && a.role !== "bank");
  const toReview = rows.filter((r) => r.status === "proposed" || r.status === "new");
  const confident = rows.filter(
    (r) => r.status === "proposed" && (r.proposal?.confidence ?? 0) >= CONFIDENT,
  ).length;
  const done = rows.filter((r) => r.status === "posted" || r.status === "ignored");
  const hidden = <input type="hidden" name="locale" value={locale} />;

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-8">
      <AccountingNav />
      <h1 className="text-[28px] leading-tight">{t("title")}</h1>
      <p className="mt-2 text-[15px] text-ink-muted">{t("subtitle")}</p>

      {q.imported !== undefined ? (
        <p
          role="status"
          className="mt-6 border border-ok-fg bg-ok-bg px-4 py-3 text-[13px] text-ok-fg"
        >
          {t("imported", { count: Number(q.imported) || 0, duplicates: Number(q.duplicates) || 0 })}
        </p>
      ) : null}
      {q.auto ? (
        <p
          role="status"
          className="mt-6 border border-ok-fg bg-ok-bg px-4 py-3 text-[13px] text-ok-fg"
          data-testid="autopilot-notice"
        >
          {t("autoPosted", { count: Number(q.auto) || 0 })}{" "}
          <Link href="/app/accounting/review" className="font-semibold underline">
            {t("autoReview")}
          </Link>
        </p>
      ) : null}
      {q.validated !== undefined ? (
        <p
          role="status"
          className="mt-6 border border-ok-fg bg-ok-bg px-4 py-3 text-[13px] text-ok-fg"
        >
          {t("validatedCount", { count: Number(q.validated) || 0 })}
        </p>
      ) : null}
      {q.error && ERRORS.includes(q.error) ? (
        <p
          role="alert"
          className="mt-6 border border-hot-fg bg-hot-bg px-4 py-3 text-[13px] text-hot-fg"
        >
          {t(`errors.${q.error}`)}
        </p>
      ) : null}
      {q.ai === "error" ? (
        <p
          role="alert"
          className="mt-6 border border-hot-fg bg-hot-bg px-4 py-3 text-[13px] text-hot-fg"
        >
          {t("aiError")}
        </p>
      ) : null}
      {aiConfigured() ? null : (
        <p className="mt-6 border border-line-strong bg-panel px-4 py-3 text-[13px] text-ink-2">
          {t("aiOff")}
        </p>
      )}

      {hasFeature(organization, "bankImport") ? null : (
        <PlanNotice locale={locale} message={t("planOnly")} href={upgradeUrl(organization)} />
      )}
      <form
        action={importStatementAction}
        className="mt-6 flex flex-wrap items-end gap-3 border border-line-strong bg-panel px-5 py-4"
      >
        {hidden}
        <div className="min-w-0 flex-1">
          <label htmlFor="statement" className="mb-1 block text-[13px] font-semibold">
            {t("file")}
          </label>
          <input
            id="statement"
            name="statement"
            type="file"
            accept=".xml,application/xml,text/xml"
            required
            aria-describedby="statement-hint"
            className="block w-full text-[13px]"
          />
          <span id="statement-hint" className="mt-1 block text-[12px] text-ink-muted">
            {t("fileHint")}
          </span>
        </div>
        <Button type="submit" data-testid="bank-import">
          {t("import")}
        </Button>
      </form>

      <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-[20px]">{t("toReview", { count: toReview.length })}</h2>
        <div className="flex flex-wrap gap-2">
          {rows.some((r) => r.status === "new") ? (
            <form action={proposeAction}>
              {hidden}
              <Button type="submit" variant="secondary" size="sm">
                {t("propose")}
              </Button>
            </form>
          ) : null}
          {confident > 0 ? (
            <form action={validateConfidentAction}>
              {hidden}
              <Button type="submit" size="sm" data-testid="bank-validate-confident">
                {t("validateConfident", { count: confident })}
              </Button>
            </form>
          ) : null}
        </div>
      </div>

      {toReview.length === 0 ? (
        <p className="mt-4 border border-line-strong bg-panel px-5 py-8 text-center text-[14px] text-ink-muted">
          {t("nothing")}
        </p>
      ) : (
        <ul className="mt-4 space-y-3" data-testid="bank-review">
          {toReview.map((r) => {
            const p = r.proposal;
            const label = !p
              ? t("noSuggestion")
              : p.kind === "invoice"
                ? t("paysInvoice", { invoice: invoiceName.get(p.invoiceId) ?? "" })
                : `${accountLabel.get(p.accountId) ?? ""}${p.vatCode ? ` · ${t(`vat.${p.vatCode}`)}` : ""}`;
            const sure = (p?.confidence ?? 0) >= CONFIDENT;
            return (
              <li key={r.id} className="border border-line-strong bg-panel" data-testid="bank-row">
                <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b border-line px-4 py-3">
                  <span className="text-[13px] tabular-nums text-ink-2">
                    {formatDate(r.bookingDate)}
                  </span>
                  <span className="min-w-0 flex-1 font-semibold [overflow-wrap:anywhere]">
                    {r.counterparty ?? t("unknownParty")}
                  </span>
                  <span className="font-extrabold tabular-nums">
                    {r.amountCents > 0 ? "+" : ""}
                    {formatAmount(r.amountCents, style)}
                  </span>
                </div>
                {r.text ? (
                  <p className="px-4 pt-2 text-[12px] text-ink-muted [overflow-wrap:anywhere]">
                    {r.text}
                  </p>
                ) : null}
                <div className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p
                      className="text-[14px] font-semibold [overflow-wrap:anywhere]"
                      data-testid="bank-proposal"
                    >
                      {label}
                    </p>
                    {p ? (
                      <p className="text-[12px] text-ink-2 [overflow-wrap:anywhere]">
                        <span
                          className={
                            sure ? "font-semibold text-ok-fg" : "font-semibold text-hot-fg"
                          }
                        >
                          {t("confidence", { value: Math.round(p.confidence * 100) })}
                        </span>
                        {p.explanation ? ` · ${p.explanation}` : ""}
                      </p>
                    ) : null}
                  </div>
                  {p ? (
                    <form action={validateBankAction}>
                      {hidden}
                      <input type="hidden" name="id" value={r.id} />
                      <Button type="submit" size="sm" data-testid="bank-validate">
                        {t("validate")}
                      </Button>
                    </form>
                  ) : null}
                  <form action={ignoreBankAction}>
                    {hidden}
                    <input type="hidden" name="id" value={r.id} />
                    <Button type="submit" variant="ghost" size="sm">
                      {t("ignore")}
                    </Button>
                  </form>
                </div>
                <details className="border-t border-line px-4 py-2">
                  <summary className="cursor-pointer text-[12px] font-semibold text-accent-dark">
                    {t("correct")}
                  </summary>
                  <form
                    action={validateBankAction}
                    className="mt-2 flex flex-wrap items-end gap-2 pb-2"
                  >
                    {hidden}
                    <input type="hidden" name="id" value={r.id} />
                    <label className="min-w-0 flex-1 text-[12px] font-semibold">
                      {t("account")}
                      <select
                        name="accountId"
                        required
                        defaultValue={p?.kind === "account" ? p.accountId : ""}
                        className="mt-1 block h-9 w-full border border-line-strong bg-panel px-2 text-[13px] font-normal"
                      >
                        <option value="">{t("choose")}</option>
                        {choices.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.number} {accountName(a, locale)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="text-[12px] font-semibold">
                      {t("vatLabel")}
                      <select
                        name="vatCode"
                        defaultValue={p?.kind === "account" ? (p.vatCode ?? "") : ""}
                        className="mt-1 block h-9 border border-line-strong bg-panel px-2 text-[13px] font-normal"
                      >
                        <option value="">{t("noVat")}</option>
                        {VAT_CODES.map((c) => (
                          <option key={c} value={c}>
                            {t(`vat.${c}`)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <Button type="submit" variant="secondary" size="sm">
                      {t("validateChoice")}
                    </Button>
                  </form>
                </details>
              </li>
            );
          })}
        </ul>
      )}

      {rules.length > 0 ? (
        <section className="mt-10" data-testid="bank-rules">
          <h2 className="text-[20px]">{t("rules.title")}</h2>
          <p className="mt-1 text-[13px] text-ink-muted">{t("rules.hint")}</p>
          <ul className="mt-4 border border-line-strong bg-panel">
            {rules.map(({ rule, number, nameDe, nameFr, nameEn }) => (
              <li
                key={rule.id}
                className="flex flex-wrap items-center gap-3 border-b border-line-soft px-4 py-2 text-[13px] last:border-b-0"
              >
                <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
                  <span className="font-semibold">{rule.counterpartyLabel}</span>{" "}
                  <span className="text-ink-muted">
                    {rule.direction === "in" ? t("rules.in") : t("rules.out")}
                  </span>
                </span>
                <span className="[overflow-wrap:anywhere]">
                  {number} {accountName({ nameDe, nameFr, nameEn }, locale)}
                  {rule.vatCode ? ` · ${t(`vat.${rule.vatCode}`)}` : ""}
                </span>
                <span className="text-ink-muted">{t("rules.hits", { count: rule.hits })}</span>
                <form action={deleteRuleAction}>
                  {hidden}
                  <input type="hidden" name="id" value={rule.id} />
                  <Button type="submit" variant="ghost" size="sm">
                    {t("rules.delete")}
                  </Button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {done.length > 0 ? (
        <>
          <h2 className="mt-10 text-[20px]">{t("done")}</h2>
          <div className="mt-4 overflow-x-auto border border-line-strong bg-panel">
            <table className="w-full text-left text-[13px]">
              <tbody>
                {done.slice(0, 100).map((r) => (
                  <tr key={r.id} className="border-b border-line-soft last:border-b-0">
                    <td className="px-3 py-2 whitespace-nowrap tabular-nums">
                      {formatDate(r.bookingDate)}
                    </td>
                    <td className="px-3 py-2 [overflow-wrap:anywhere]">{r.counterparty ?? ""}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatAmount(r.amountCents, style)}
                    </td>
                    <td className="px-3 py-2 text-ink-2">{t(`status.${r.status}`)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </div>
  );
}
