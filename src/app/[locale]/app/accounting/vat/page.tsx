import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { AccountingNav } from "@/components/accounting/AccountingNav";
import { VatReview } from "@/components/accounting/VatReview";
import { Button } from "@/components/ui/button";
import { FIGURE_ORDER, quartersBetween, vatDueDate } from "@/countries/ch/vat-return";
import { Link } from "@/i18n/navigation";
import { formatDate } from "@/lib/fiscal-year";
import { formatAmount } from "@/lib/money";
import { listFiscalYears } from "@/server/accounting";
import { aiConfigured } from "@/server/ai";
import { requireAppSession } from "@/server/auth/guard";
import { db } from "@/server/db";
import type { VatAnomaly, VatFigures } from "@/server/db/schema";
import { draftVatReturn, listVatReturns } from "@/server/vat-return";
import { validateVatAction } from "../actions";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ period?: string; validated?: string; error?: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "app.vat" });
  return { title: t("title"), robots: { index: false } };
}

const ERRORS = ["blocked", "noFiscalYear", "noChart"];

export default async function VatPage({ params, searchParams }: Props) {
  const { locale } = await params;
  const { organization } = await requireAppSession(locale);
  const q = await searchParams;
  const t = await getTranslations({ locale, namespace: "app.vat" });
  const today = new Date().toISOString().slice(0, 10);
  const years = await listFiscalYears(db(), organization.id);
  const firstStart = years.at(-1)?.startDate ?? `${today.slice(0, 4)}-01-01`;
  const quarters = quartersBetween(firstStart, today).reverse();
  const done = await listVatReturns(db(), organization.id);
  const doneByStart = new Map(done.map((r) => [r.periodStart, r]));
  const selected =
    quarters.find((p) => p.start === q.period) ??
    quarters.find((p) => p.end < today && !doneByStart.has(p.start)) ??
    quarters[0];
  const validated = selected ? doneByStart.get(selected.start) : undefined;
  const draft =
    selected && !validated
      ? await draftVatReturn(db(), organization.id, selected.start, selected.end)
      : null;
  const figures: VatFigures = validated?.figures ?? draft?.figures ?? {};
  const anomalies: VatAnomaly[] = validated?.anomalies ?? draft?.anomalies ?? [];
  const blocking = anomalies.some((a) => a.severity === "block");
  const shown = FIGURE_ORDER.filter(
    (code) =>
      code in figures && (figures[code] !== 0 || ["200", "299", "399", "479"].includes(code)),
  );

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-8">
      <AccountingNav />
      <h1 className="text-[28px] leading-tight">{t("title")}</h1>
      <p className="mt-2 text-[15px] text-ink-muted">{t("subtitle")}</p>

      {q.validated ? (
        <p
          role="status"
          className="mt-6 border border-ok-fg bg-ok-bg px-4 py-3 text-[13px] text-ok-fg"
        >
          {t("validatedNotice")}
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

      <nav aria-label={t("periods")} className="mt-6 flex flex-wrap gap-2">
        {quarters.slice(0, 8).map((p) => {
          const active = p.start === selected?.start;
          return (
            <Link
              key={p.start}
              href={`/app/accounting/vat?period=${p.start}`}
              aria-current={active ? "page" : undefined}
              className={`border px-3 py-1.5 text-[13px] font-semibold ${active ? "border-accent text-accent-dark" : "border-line-strong text-ink-2 hover:text-ink"}`}
            >
              {t("quarter", {
                q: Math.floor(Number(p.start.slice(5, 7)) / 3) + 1,
                year: p.start.slice(0, 4),
              })}
              {doneByStart.has(p.start) ? ` · ${t("done")}` : ""}
            </Link>
          );
        })}
      </nav>

      {selected ? (
        <>
          <div className="mt-6 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-[20px]">
              {t("period", { start: formatDate(selected.start), end: formatDate(selected.end) })}
            </h2>
            <span className="text-[13px] text-ink-muted" data-testid="vat-status">
              {validated
                ? t("validatedOn", {
                    date: formatDate(validated.validatedAt.toISOString().slice(0, 10)),
                  })
                : t("draft")}
            </span>
          </div>

          {anomalies.length > 0 ? (
            <ul className="mt-4 space-y-2" data-testid="vat-anomalies">
              {anomalies.map((a) => (
                <li
                  key={a.code}
                  className={`border px-4 py-2 text-[13px] ${a.severity === "block" ? "border-hot-fg bg-hot-bg text-hot-fg" : "border-line-strong bg-panel text-ink-2"}`}
                >
                  {t(`anomalies.${a.code}`, { count: a.count ?? 0 })}
                </li>
              ))}
            </ul>
          ) : null}

          <div
            className="mt-4 overflow-x-auto border border-line-strong bg-panel"
            data-testid="vat-figures"
          >
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr className="border-b border-line-strong bg-head text-[10.5px] font-extrabold tracking-[0.09em] text-ink-muted uppercase">
                  <th className="w-16 px-3 py-2">{t("figure")}</th>
                  <th className="px-3 py-2">{t("label")}</th>
                  <th className="px-3 py-2 text-right">{t("amount")}</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((code) => (
                  <tr
                    key={code}
                    className={`border-b border-line-soft last:border-b-0 ${["299", "399", "479", "500", "510"].includes(code) ? "font-extrabold" : ""}`}
                    data-testid={`figure-${code}`}
                  >
                    <td className="px-3 py-2 tabular-nums">{code}</td>
                    <td className="px-3 py-2 [overflow-wrap:anywhere]">{t(`figures.${code}`)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatAmount(figures[code] ?? 0)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {(figures["500"] ?? 0) > 0 ? (
            <p className="mt-3 text-[13px] text-ink-2">
              {t("payBy", { date: formatDate(vatDueDate(selected.end)) })}
            </p>
          ) : null}

          {draft && aiConfigured() ? (
            <VatReview locale={locale} start={selected.start} end={selected.end} />
          ) : null}

          {draft ? (
            <form
              action={validateVatAction}
              className="mt-6 flex flex-wrap items-center gap-3 border border-line-strong bg-panel px-5 py-4"
            >
              <input type="hidden" name="locale" value={locale} />
              <input type="hidden" name="start" value={selected.start} />
              <input type="hidden" name="end" value={selected.end} />
              <p className="min-w-0 flex-1 text-[13px] text-ink-2">
                {blocking ? t("cannotValidate") : t("validateHint")}
              </p>
              <Button type="submit" disabled={blocking} data-testid="vat-validate">
                {t("validate")}
              </Button>
            </form>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
