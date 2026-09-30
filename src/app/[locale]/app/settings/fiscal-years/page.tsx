import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { fieldClass } from "@/components/forms/fields";
import { SettingsNav } from "@/components/settings/SettingsNav";
import { Button } from "@/components/ui/button";
import { fiscalYearContaining, formatDate, nextFiscalYear } from "@/lib/fiscal-year";
import { listFiscalYears } from "@/server/accounting";
import { requireAppSession } from "@/server/auth/guard";
import { closingChecks } from "@/server/closing";
import { canSetUpAccounting } from "@/server/company";
import { db } from "@/server/db";
import {
  closeFiscalYearAction,
  openFirstFiscalYearAction,
  openNextFiscalYearAction,
} from "./actions";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ opened?: string; error?: string; closed?: string; closeError?: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "app.fiscalYears" });
  return { title: t("title"), robots: { index: false } };
}

export default async function FiscalYearsPage({ params, searchParams }: Props) {
  const { locale } = await params;
  const { user, organization } = await requireAppSession(locale);
  const { opened, error, closed, closeError } = await searchParams;
  const editable = await canSetUpAccounting(db(), organization.id, user.id);
  const t = await getTranslations({ locale, namespace: "app.fiscalYears" });
  const years = await listFiscalYears(db(), organization.id);
  const latest = years[0];
  // Seul le plus ancien exercice ouvert peut être clôturé, et seulement une fois terminé.
  const toClose = [...years].reverse().find((y) => y.status === "open");
  const closable =
    toClose && toClose.endDate < new Date().toISOString().slice(0, 10) ? toClose : null;
  const checks =
    closable && editable ? await closingChecks(db(), organization.id, closable.id) : [];
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
          {closed ? (
            <p
              role="status"
              className="mt-6 border border-ok-fg bg-ok-bg px-4 py-3 text-[13px] text-ok-fg"
            >
              {t("closedNotice")}
            </p>
          ) : null}
          {closeError ? (
            <p
              role="alert"
              className="mt-6 border border-hot-fg bg-hot-bg px-4 py-3 text-[13px] text-hot-fg"
            >
              {t.has(`closeErrors.${closeError}`)
                ? t(`closeErrors.${closeError}`)
                : t("closeErrors.blocked")}
            </p>
          ) : null}
          {closable && editable ? (
            <form
              action={closeFiscalYearAction}
              className="mt-6 space-y-3 border border-line-strong bg-panel px-5 py-4"
              data-testid="close-year"
            >
              <input type="hidden" name="locale" value={locale} />
              <input type="hidden" name="id" value={closable.id} />
              <p className="text-[14px] font-semibold">
                {t("closeTitle", { period: period(closable.startDate, closable.endDate) })}
              </p>
              <p className="text-[13px] text-ink-2">{t("closeHint")}</p>
              {checks.length > 0 ? (
                <ul className="space-y-1 text-[13px] text-hot-fg">
                  {checks.map((c) => (
                    <li key={c.code}>{t(`closeErrors.${c.code}`, { count: c.count ?? 0 })}</li>
                  ))}
                </ul>
              ) : (
                <>
                  <label className="flex items-start gap-3 text-[13px]">
                    <input
                      type="checkbox"
                      name="confirm"
                      className="mt-0.5 h-4 w-4 shrink-0 accent-accent"
                    />
                    <span>{t("closeConfirm")}</span>
                  </label>
                  <Button type="submit" variant="secondary" data-testid="close-year-submit">
                    {t("close")}
                  </Button>
                </>
              )}
            </form>
          ) : (
            <p className="mt-6 text-[13px] text-ink-muted">{t("closingLater")}</p>
          )}
        </>
      )}
    </div>
  );
}
