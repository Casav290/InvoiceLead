import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { formatDate } from "@/lib/fiscal-year";
import { formatAmount } from "@/lib/money";
import { listAccounts, listFiscalYears } from "@/server/accounting";
import { requireAppSession } from "@/server/auth/guard";
import { db } from "@/server/db";
import { countUnposted, listJournal, verifyChain } from "@/server/ledger";
import { postPendingAction } from "./actions";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ year?: string; posted?: string; reason?: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "app.accountingHome" });
  return { title: t("title"), robots: { index: false } };
}

export default async function AccountingPage({ params, searchParams }: Props) {
  const { locale } = await params;
  const { organization } = await requireAppSession(locale);
  const query = await searchParams;
  const t = await getTranslations({ locale, namespace: "app.accountingHome" });
  const [years, chart, unposted, chain] = await Promise.all([
    listFiscalYears(db(), organization.id),
    listAccounts(db(), organization.id),
    countUnposted(db(), organization.id),
    verifyChain(db(), organization.id),
  ]);
  const year = years.find((y) => y.id === query.year) ?? years[0];
  const journal = year ? await listJournal(db(), organization.id, year.id) : [];

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-8">
      <h1 className="text-[28px] leading-tight">{t("title")}</h1>
      <p className="mt-2 text-[15px] text-ink-muted">{t("subtitle")}</p>

      {query.posted !== undefined ? (
        <p
          role="status"
          className="mt-6 border border-ok-fg bg-ok-bg px-4 py-3 text-[13px] text-ok-fg"
        >
          {t("postedCount", { count: Number(query.posted) || 0 })}
        </p>
      ) : null}

      {chart.length === 0 || years.length === 0 ? (
        <div
          className="mt-6 border border-line-strong bg-panel px-5 py-4 text-[14px]"
          data-testid="accounting-setup"
        >
          <p className="font-semibold">{t("setupTitle")}</p>
          <ul className="mt-2 space-y-1 text-ink-2">
            {chart.length === 0 ? (
              <li>
                <Link
                  href="/app/settings/accounts"
                  className="font-semibold text-accent-dark underline"
                >
                  {t("setupChart")}
                </Link>
              </li>
            ) : null}
            {years.length === 0 ? (
              <li>
                <Link
                  href="/app/settings/fiscal-years"
                  className="font-semibold text-accent-dark underline"
                >
                  {t("setupYear")}
                </Link>
              </li>
            ) : null}
          </ul>
        </div>
      ) : null}

      {unposted > 0 ? (
        <form
          action={postPendingAction}
          className="mt-6 flex flex-wrap items-center gap-3 border border-line-strong bg-panel px-5 py-4"
        >
          <input type="hidden" name="locale" value={locale} />
          <p className="flex-1 text-[14px]" data-testid="unposted">
            {t("unposted", { count: unposted })}
            {query.reason ? (
              <span className="mt-1 block text-[12px] text-hot-fg">
                {t(`reasons.${query.reason}`)}
              </span>
            ) : null}
          </p>
          <Button type="submit" data-testid="post-pending">
            {t("postNow")}
          </Button>
        </form>
      ) : null}

      <div className="mt-8 flex flex-wrap items-end justify-between gap-4">
        <h2 className="text-[20px]">{t("journal")}</h2>
        {years.length > 1 ? (
          <form className="flex items-center gap-2">
            <label htmlFor="journal-year" className="text-[13px] font-semibold">
              {t("year")}
            </label>
            <select
              id="journal-year"
              name="year"
              defaultValue={year?.id}
              className="h-9 border border-line-strong bg-panel px-2 text-[13px]"
            >
              {years.map((y) => (
                <option key={y.id} value={y.id}>
                  {formatDate(y.startDate)} – {formatDate(y.endDate)}
                </option>
              ))}
            </select>
            <Button type="submit" variant="secondary" size="sm">
              {t("show")}
            </Button>
          </form>
        ) : null}
      </div>
      <p className="mt-2 text-[12px] text-ink-muted" data-testid="chain-status">
        {chain.ok ? t("chainOk", { count: chain.count }) : t("chainBroken", { seq: chain.seq })}
      </p>

      {journal.length === 0 ? (
        <p className="mt-4 border border-line-strong bg-panel px-5 py-8 text-center text-[14px] text-ink-muted">
          {t("empty")}
        </p>
      ) : (
        <div
          className="mt-4 overflow-x-auto border border-line-strong bg-panel"
          data-testid="journal"
        >
          <table className="w-full text-left text-[13px]">
            <thead>
              <tr className="border-b border-line-strong bg-head text-[10.5px] font-extrabold tracking-[0.09em] text-ink-muted uppercase">
                <th className="px-3 py-2.5">{t("columns.number")}</th>
                <th className="px-3 py-2.5">{t("columns.date")}</th>
                <th className="px-3 py-2.5">{t("columns.account")}</th>
                <th className="px-3 py-2.5 text-right">{t("columns.debit")}</th>
                <th className="px-3 py-2.5 text-right">{t("columns.credit")}</th>
              </tr>
            </thead>
            {journal.map((e) => (
              <tbody key={e.id} className="border-b border-line-strong last:border-b-0">
                <tr className="bg-strip">
                  <td className="px-3 py-2 font-semibold tabular-nums">{e.number}</td>
                  <td className="px-3 py-2 tabular-nums whitespace-nowrap">
                    {formatDate(e.entryDate)}
                  </td>
                  <td colSpan={3} className="px-3 py-2 font-semibold [overflow-wrap:anywhere]">
                    {e.description}
                  </td>
                </tr>
                {e.lines.map((l, i) => (
                  <tr key={`${e.id}-${i}`} className="border-t border-line-soft">
                    <td />
                    <td />
                    <td className="px-3 py-1.5 [overflow-wrap:anywhere]">
                      <span className="font-semibold tabular-nums">{l.accountNumber}</span>{" "}
                      <span className="text-ink-2">{locale === "fr" ? l.nameFr : l.nameDe}</span>
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      {l.debitCents ? formatAmount(l.debitCents) : ""}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      {l.creditCents ? formatAmount(l.creditCents) : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
        </div>
      )}
    </div>
  );
}
