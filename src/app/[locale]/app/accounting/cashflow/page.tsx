import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { AccountingNav } from "@/components/accounting/AccountingNav";
import { countryPack } from "@/countries";
import { formatDate } from "@/lib/fiscal-year";
import { formatAmount } from "@/lib/money";
import { requirePermission } from "@/server/auth/guard";
import { cashForecast } from "@/server/cashflow";
import { db } from "@/server/db";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "app.cashflow" });
  return { title: t("title"), robots: { index: false } };
}

/** Trésorerie des treize prochaines semaines. */
export default async function CashflowPage({ params }: Props) {
  const { locale } = await params;
  const { organization } = await requirePermission(locale, "accounting");
  const t = await getTranslations({ locale, namespace: "app.cashflow" });
  const today = new Date().toISOString().slice(0, 10);
  const f = await cashForecast(db(), organization.id, today);
  const style = countryPack(organization.country).amounts;
  const money = (cents: number) => formatAmount(cents, style);
  const head =
    "px-3 py-2 text-right text-[10.5px] font-extrabold tracking-[0.09em] text-ink-muted uppercase";

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-8">
      <AccountingNav />
      <h1 className="text-[28px] leading-tight">{t("title")}</h1>
      <p className="mt-2 text-[15px] text-ink-muted">{t("subtitle")}</p>

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <div className="border border-line-strong bg-panel px-5 py-4">
          <p className="text-[12px] text-ink-muted">{t("opening")}</p>
          <p className="mt-1 text-[22px] font-extrabold tabular-nums" data-testid="cash-opening">
            {f.currency} {money(f.openingCents)}
          </p>
        </div>
        <div
          className={`border px-5 py-4 ${f.shortfall ? "border-hot-fg bg-hot-bg text-hot-fg" : "border-line-strong bg-panel"}`}
          data-testid="cash-verdict"
        >
          <p className="text-[12px]">{t("verdictLabel")}</p>
          <p className="mt-1 text-[15px] font-semibold">
            {f.shortfall
              ? t("shortfall", {
                  date: formatDate(f.shortfall.weekStart),
                  amount: `${f.currency} ${money(f.shortfall.closingCents)}`,
                })
              : t("noShortfall", {
                  amount: `${f.currency} ${money(f.weeks.at(-1)?.closingCents ?? f.openingCents)}`,
                })}
          </p>
        </div>
      </div>

      <div className="mt-8 overflow-x-auto border border-line-strong bg-panel">
        <table className="w-full min-w-[520px] text-[13px]" data-testid="cash-weeks">
          <thead className="border-b border-line bg-head">
            <tr>
              <th className={`${head} text-left`}>{t("week")}</th>
              <th className={head}>{t("in")}</th>
              <th className={head}>{t("out")}</th>
              <th className={head}>{t("closing")}</th>
            </tr>
          </thead>
          <tbody>
            {f.weeks.map((w) => (
              <tr key={w.weekStart} className="border-b border-line-soft last:border-b-0">
                <td className="px-3 py-2">{formatDate(w.weekStart)}</td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {w.inCents ? money(w.inCents) : ""}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {w.outCents ? money(w.outCents) : ""}
                </td>
                <td
                  className={`px-3 py-2 text-right font-semibold tabular-nums ${w.closingCents < 0 ? "text-hot-fg" : ""}`}
                >
                  {money(w.closingCents)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {f.laterInCents || f.laterOutCents ? (
        <p className="mt-3 text-[12px] text-ink-muted">
          {t("later", {
            in: `${f.currency} ${money(f.laterInCents)}`,
            out: `${f.currency} ${money(f.laterOutCents)}`,
          })}
        </p>
      ) : null}
      <p className="mt-3 text-[12px] text-ink-muted">{t("method")}</p>
    </div>
  );
}
