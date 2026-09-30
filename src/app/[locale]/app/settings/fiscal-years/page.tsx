import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { fieldClass } from "@/components/forms/fields";
import { SettingsNav } from "@/components/settings/SettingsNav";
import { Button } from "@/components/ui/button";
import { fiscalYearContaining, formatDate, nextFiscalYear } from "@/lib/fiscal-year";
import { listFiscalYears } from "@/server/accounting";
import { requireAppSession } from "@/server/auth/guard";
import { canEditSettings } from "@/server/company";
import { db } from "@/server/db";
import { openFirstFiscalYearAction, openNextFiscalYearAction } from "./actions";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ opened?: string; error?: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "app.fiscalYears" });
  return { title: t("title"), robots: { index: false } };
}

export default async function FiscalYearsPage({ params, searchParams }: Props) {
  const { locale } = await params;
  const { user, organization } = await requireAppSession(locale);
  const { opened, error } = await searchParams;
  const editable = await canEditSettings(db(), organization.id, user.id);
  const t = await getTranslations({ locale, namespace: "app.fiscalYears" });
  const years = await listFiscalYears(db(), organization.id);
  const latest = years[0];
  const next = latest ? nextFiscalYear(latest.endDate) : null;
  const today = new Date().toISOString().slice(0, 10);
  const suggestedStart = fiscalYearContaining(today, organization.fiscalYearStartMonth).start;
  const period = (start: string, end: string) =>
    t("period", { start: formatDate(start), end: formatDate(end) });

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-8">
      <SettingsNav />
      <h1 className="text-[28px] leading-tight">{t("title")}</h1>
      <p className="mt-2 text-[15px] text-ink-muted">{t("subtitle")}</p>
      {opened ? (
        <p
          role="status"
          className="mt-6 border border-ok-fg bg-ok-bg px-4 py-3 text-[13px] text-ok-fg"
        >
          {t("opened")}
        </p>
      ) : null}
      {error ? (
        <p
          role="alert"
          className="mt-6 border border-hot-fg bg-hot-bg px-4 py-3 text-[13px] text-hot-fg"
        >
          {t("invalidDate")}
        </p>
      ) : null}
      {editable ? null : (
        <p className="mt-6 border border-line-strong bg-panel px-4 py-3 text-[13px] text-ink-2">
          {t("readOnly")}
        </p>
      )}

      {years.length === 0 ? (
        <div className="mt-8 border border-line-strong bg-panel px-5 py-6">
          <p className="text-[14px] text-ink-2">{t("empty")}</p>
          {editable ? (
            <form action={openFirstFiscalYearAction} className="mt-5 space-y-4">
              <input type="hidden" name="locale" value={locale} />
              <div className="max-w-xs">
                <label htmlFor="fy-start" className="mb-1 block text-[13px] font-semibold">
                  {t("start")}
                </label>
                <input
                  id="fy-start"
                  name="start"
                  type="date"
                  required
                  defaultValue={suggestedStart}
                  aria-describedby="fy-start-hint"
                  className={fieldClass}
                />
                <span id="fy-start-hint" className="mt-1 block text-[12px] text-ink-muted">
                  {t("startHint")}
                </span>
              </div>
              <div>
                <label className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    name="extended"
                    aria-describedby="fy-extended-hint"
                    className="mt-0.5 h-4 w-4 shrink-0 accent-accent"
                  />
                  <span className="text-[14px] font-semibold">{t("extended")}</span>
                </label>
                <span id="fy-extended-hint" className="mt-1 block pl-7 text-[12px] text-ink-muted">
                  {t("extendedHint")}
                </span>
              </div>
              <Button type="submit" data-testid="fiscal-year-first">
                {t("openFirst")}
              </Button>
            </form>
          ) : null}
        </div>
      ) : (
        <>
          <div className="mt-6 border border-line-strong bg-panel">
            <table className="w-full text-left text-[14px]">
              <thead>
                <tr className="border-b border-line-strong bg-head text-[10.5px] font-extrabold tracking-[0.09em] text-ink-muted uppercase">
                  <th className="px-4 py-2.5">{t("columns.period")}</th>
                  <th className="px-4 py-2.5">{t("columns.status")}</th>
                </tr>
              </thead>
              <tbody>
                {years.map((y) => (
                  <tr key={y.id} className="border-b border-line-soft last:border-b-0">
                    <td className="px-4 py-3 tabular-nums">{period(y.startDate, y.endDate)}</td>
                    <td className="px-4 py-3 text-ink-2">{t(`status.${y.status}`)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {editable && next ? (
            <form
              action={openNextFiscalYearAction}
              className="mt-6 flex flex-wrap items-center gap-4"
            >
              <input type="hidden" name="locale" value={locale} />
              <Button type="submit" variant="secondary" data-testid="fiscal-year-next">
                {t("openNext")}
              </Button>
              <span className="text-[13px] text-ink-muted">
                {t("nextPeriod", { start: formatDate(next.start), end: formatDate(next.end) })}
              </span>
            </form>
          ) : null}
          <p className="mt-6 text-[13px] text-ink-muted">{t("closingLater")}</p>
        </>
      )}
    </div>
  );
}
