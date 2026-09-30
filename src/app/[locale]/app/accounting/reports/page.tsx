import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { AccountingNav } from "@/components/accounting/AccountingNav";
import { YearPicker } from "@/components/accounting/YearPicker";
import { countryPack } from "@/countries";
import { chartPack } from "@/countries/charts";
import { Link } from "@/i18n/navigation";
import { accountName } from "@/lib/account-name";
import { formatDate } from "@/lib/fiscal-year";
import { formatAmount } from "@/lib/money";
import { listFiscalYears } from "@/server/accounting";
import { requireAppSession } from "@/server/auth/guard";
import { db } from "@/server/db";
import {
  type AccountBalance,
  accountBalances,
  balanceSheet,
  type Group,
  incomeStatement,
} from "@/server/reports";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ year?: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "app.reports" });
  return { title: t("title"), robots: { index: false } };
}

const th =
  "border-b border-line-strong bg-head px-3 py-2 text-[10.5px] font-extrabold tracking-[0.09em] text-ink-muted uppercase";

export default async function ReportsPage({ params, searchParams }: Props) {
  const { locale } = await params;
  const { organization } = await requireAppSession(locale);
  const style = countryPack(organization.country).amounts;
  const q = await searchParams;
  const t = await getTranslations({ locale, namespace: "app.reports" });
  const tc = await getTranslations({
    locale,
    namespace: `app.accounts.${chartPack(organization.country).classLabels}`,
  });
  const years = await listFiscalYears(db(), organization.id);
  const year = years.find((y) => y.id === q.year) ?? years[0];
  const balances = year ? await accountBalances(db(), organization.id, year.id) : [];
  const income = incomeStatement(balances);
  const sheet = balanceSheet(balances, income.resultCents);
  const name = (b: AccountBalance) => accountName(b.account, locale);
  const ledgerHref = (b: AccountBalance) =>
    `/app/accounting/ledger/${b.account.id}${year ? `?year=${year.id}` : ""}`;

  const accountRow = (b: AccountBalance, amount = b.balanceCents) => (
    <tr key={b.account.id} className="border-b border-line-soft last:border-b-0">
      <td className="px-3 py-1.5 [overflow-wrap:anywhere]">
        <Link href={ledgerHref(b)} className="text-accent-dark hover:underline">
          <span className="font-semibold tabular-nums">{b.account.number}</span> {name(b)}
        </Link>
      </td>
      <td className="px-3 py-1.5 text-right tabular-nums whitespace-nowrap">
        {formatAmount(amount, style)}
      </td>
    </tr>
  );
  const groupBlock = (g: Group, label: string) => (
    <tbody key={g.key} className="border-b border-line-strong last:border-b-0">
      <tr className="bg-strip">
        <td className="px-3 py-2 font-semibold">{label}</td>
        <td className="px-3 py-2 text-right font-semibold tabular-nums">
          {formatAmount(g.totalCents, style)}
        </td>
      </tr>
      {g.rows.map((b) => accountRow(b))}
    </tbody>
  );

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-8">
      <AccountingNav />
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[28px] leading-tight">{t("title")}</h1>
          {year ? (
            <p className="mt-1 text-[14px] text-ink-muted">
              {t("period", { start: formatDate(year.startDate), end: formatDate(year.endDate) })}
            </p>
          ) : null}
        </div>
        <YearPicker locale={locale} years={years} selected={year?.id} />
      </div>
      <p className="mt-2 text-[13px] text-ink-muted">{t("provisional")}</p>

      {balances.length === 0 ? (
        <p className="mt-8 border border-line-strong bg-panel px-5 py-8 text-center text-[14px] text-ink-muted">
          {t("empty")}
        </p>
      ) : (
        <>
          <section className="mt-8" data-testid="income-statement">
            <h2 className="text-[20px]">{t("income")}</h2>
            <div className="mt-3 overflow-x-auto border border-line-strong bg-panel">
              <table className="w-full text-left text-[13px]">
                <thead>
                  <tr>
                    <th className={th}>{t("account")}</th>
                    <th className={`${th} text-right`}>{t("amount")}</th>
                  </tr>
                </thead>
                {income.groups.map((g) => groupBlock(g, tc(g.key)))}
                <tfoot>
                  <tr className="border-t-2 border-ink">
                    <td className="px-3 py-2.5 font-extrabold">
                      {income.resultCents >= 0 ? t("profit") : t("loss")}
                    </td>
                    <td
                      className="px-3 py-2.5 text-right font-extrabold tabular-nums"
                      data-testid="result"
                    >
                      {formatAmount(income.resultCents, style)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </section>

          <section className="mt-10" data-testid="balance-sheet">
            <h2 className="text-[20px]">{t("balanceSheet")}</h2>
            <div className="mt-3 grid gap-4 lg:grid-cols-2">
              <div className="overflow-x-auto border border-line-strong bg-panel">
                <table className="w-full text-left text-[13px]">
                  <thead>
                    <tr>
                      <th className={th}>{t("assets")}</th>
                      <th className={`${th} text-right`}>{t("amount")}</th>
                    </tr>
                  </thead>
                  {sheet.assets.map((g) => groupBlock(g, g.key))}
                  <tfoot>
                    <tr className="border-t-2 border-ink">
                      <td className="px-3 py-2.5 font-extrabold">{t("totalAssets")}</td>
                      <td className="px-3 py-2.5 text-right font-extrabold tabular-nums">
                        {formatAmount(sheet.assetsCents, style)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              <div className="overflow-x-auto border border-line-strong bg-panel">
                <table className="w-full text-left text-[13px]">
                  <thead>
                    <tr>
                      <th className={th}>{t("liabilitiesEquity")}</th>
                      <th className={`${th} text-right`}>{t("amount")}</th>
                    </tr>
                  </thead>
                  {sheet.liabilities.map((g) => groupBlock(g, g.key))}
                  <tbody>
                    <tr className="bg-strip">
                      <td className="px-3 py-2 font-semibold">{t("equity")}</td>
                      <td className="px-3 py-2 text-right font-semibold tabular-nums">
                        {formatAmount(sheet.equityCents, style)}
                      </td>
                    </tr>
                    {sheet.equity.map((b) => accountRow(b))}
                    <tr className="border-b border-line-soft">
                      <td className="px-3 py-1.5 italic">{t("currentResult")}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">
                        {formatAmount(sheet.resultCents, style)}
                      </td>
                    </tr>
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-ink">
                      <td className="px-3 py-2.5 font-extrabold">{t("totalLiabilities")}</td>
                      <td className="px-3 py-2.5 text-right font-extrabold tabular-nums">
                        {formatAmount(sheet.liabilitiesCents + sheet.equityCents, style)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
            <p
              className={`mt-2 text-[12px] ${sheet.balanced ? "text-ink-muted" : "font-semibold text-hot-fg"}`}
              data-testid="balance-check"
            >
              {sheet.balanced ? t("balanced") : t("unbalanced")}
            </p>
          </section>

          <section className="mt-10" data-testid="trial-balance">
            <h2 className="text-[20px]">{t("trial")}</h2>
            <div className="mt-3 overflow-x-auto border border-line-strong bg-panel">
              <table className="w-full text-left text-[13px]">
                <thead>
                  <tr>
                    <th className={th}>{t("account")}</th>
                    <th className={`${th} text-right`}>{t("debit")}</th>
                    <th className={`${th} text-right`}>{t("credit")}</th>
                  </tr>
                </thead>
                <tbody>
                  {balances.map((b) => (
                    <tr key={b.account.id} className="border-b border-line-soft">
                      <td className="px-3 py-1.5 [overflow-wrap:anywhere]">
                        <Link href={ledgerHref(b)} className="text-accent-dark hover:underline">
                          <span className="font-semibold tabular-nums">{b.account.number}</span>{" "}
                          {name(b)}
                        </Link>
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums">
                        {formatAmount(b.debitCents, style)}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums">
                        {formatAmount(b.creditCents, style)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-ink font-extrabold">
                    <td className="px-3 py-2.5">{t("total")}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      {formatAmount(
                        balances.reduce((s, b) => s + b.debitCents, 0),
                        style,
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      {formatAmount(
                        balances.reduce((s, b) => s + b.creditCents, 0),
                        style,
                      )}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
