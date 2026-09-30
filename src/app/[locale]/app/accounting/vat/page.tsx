import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { AccountingNav } from "@/components/accounting/AccountingNav";
import { VatReview } from "@/components/accounting/VatReview";
import { PlanNotice } from "@/components/app/PlanNotice";
import { Button } from "@/components/ui/button";
import { countryPack } from "@/countries";
import { FIGURE_ORDER, periodsBetween, TAXED_FIGURES, vatDueDate } from "@/countries/ch/vat-return";
import {
  DE_ALWAYS_SHOWN,
  DE_FIGURE_ORDER,
  DE_TAXED_FIGURES,
  ustvaDueDate,
} from "@/countries/de/vat-return";
import {
  ca3DueDate,
  FR_ALWAYS_SHOWN,
  FR_FIGURE_ORDER,
  FR_TAXED_FIGURES,
} from "@/countries/fr/vat-return";
import {
  GB_ALWAYS_SHOWN,
  GB_FIGURE_ORDER,
  GB_TAXED_FIGURES,
  mtdDueDate,
} from "@/countries/gb/vat-return";
import {
  salesTaxDueDate,
  US_ALWAYS_SHOWN,
  US_FIGURE_ORDER,
  US_TAXED_FIGURES,
} from "@/countries/us/sales-tax-report";
import { Link } from "@/i18n/navigation";
import { formatDate } from "@/lib/fiscal-year";
import { formatAmount } from "@/lib/money";
import { listFiscalYears } from "@/server/accounting";
import { aiConfigured } from "@/server/ai";
import { requireAppSession } from "@/server/auth/guard";
import { db } from "@/server/db";
import type { VatAnomaly, VatFigures } from "@/server/db/schema";
import { hasFeature, upgradeUrl } from "@/server/plans";
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

const ERRORS = ["blocked", "noFiscalYear", "noChart", "plan"];

export default async function VatPage({ params, searchParams }: Props) {
  const { locale } = await params;
  const { organization } = await requireAppSession(locale);
  const q = await searchParams;
  const t = await getTranslations({ locale, namespace: "app.vat" });
  const today = new Date().toISOString().slice(0, 10);
  const years = await listFiscalYears(db(), organization.id);
  const firstStart = years.at(-1)?.startDate ?? `${today.slice(0, 4)}-01-01`;
  // TDFN : décompte semestriel ; méthode effective : trimestriel.
  const germany = organization.country === "DE";
  const style = countryPack(organization.country).amounts;
  const france = organization.country === "FR";
  const uk = organization.country === "GB";
  const usa = organization.country === "US";
  const months = organization.country === "CH" && organization.vatMethod === "net_tax_rate" ? 6 : 3;
  // Formulaire du pays : décompte AFC ou Umsatzsteuer-Voranmeldung.
  const form = usa
    ? {
        order: US_FIGURE_ORDER as readonly string[],
        taxed: US_TAXED_FIGURES,
        always: US_ALWAYS_SHOWN,
        bold: ["S4"],
        labels: "figuresUs",
        due: salesTaxDueDate,
      }
    : uk
      ? {
          order: GB_FIGURE_ORDER as readonly string[],
          taxed: GB_TAXED_FIGURES,
          always: GB_ALWAYS_SHOWN,
          bold: ["3", "5"],
          labels: "figuresGb",
          due: mtdDueDate,
        }
      : france
        ? {
            order: FR_FIGURE_ORDER as readonly string[],
            taxed: FR_TAXED_FIGURES,
            always: FR_ALWAYS_SHOWN,
            bold: ["16", "23", "28", "25"],
            labels: "figuresFr",
            due: ca3DueDate,
          }
        : germany
          ? {
              order: DE_FIGURE_ORDER as readonly string[],
              taxed: DE_TAXED_FIGURES,
              always: DE_ALWAYS_SHOWN,
              bold: ["83"],
              labels: "figuresDe",
              due: ustvaDueDate,
            }
          : {
              order: FIGURE_ORDER as readonly string[],
              taxed: TAXED_FIGURES,
              always: ["200", "299", "399", "479"],
              bold: ["299", "399", "479", "500", "510"],
              labels: "figures",
              due: vatDueDate,
            };
  const quarters = periodsBetween(firstStart, today, months).reverse();
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
  const allowed = hasFeature(organization, "vatReturn");
  const blocking = !allowed || anomalies.some((a) => a.severity === "block");
  const shown = form.order.filter(
    (code) => code in figures && (figures[code] !== 0 || form.always.includes(code)),
  );

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-8">
      <AccountingNav />
      <h1 className="text-[28px] leading-tight">{t(usa ? "titleUs" : "title")}</h1>
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

      {allowed ? null : (
        <PlanNotice locale={locale} message={t("planOnly")} href={upgradeUrl(organization)} />
      )}
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
                  <th className="px-3 py-2 text-right">{t("tax")}</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((code) => (
                  <tr
                    key={code}
                    className={`border-b border-line-soft last:border-b-0 ${form.bold.includes(code) ? "font-extrabold" : ""}`}
                    data-testid={`figure-${code}`}
                  >
                    <td className="px-3 py-2 tabular-nums">{code}</td>
                    <td className="px-3 py-2 [overflow-wrap:anywhere]">
                      {t(`${form.labels}.${code}`)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatAmount(figures[code] ?? 0, style)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {form.taxed.includes(code)
                        ? formatAmount(figures[`${code}t`] ?? 0, style)
                        : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {validated && organization.country === "CH" ? (
            <p className="mt-3 text-[13px]">
              {organization.uid ? (
                <a
                  href={`/${locale}/app/accounting/vat/xml?period=${selected.start}`}
                  className="font-semibold text-accent-dark underline"
                  data-testid="vat-xml"
                >
                  {t("xmlDownload")}
                </a>
              ) : (
                <span className="text-ink-muted">{t("xmlNoUid")}</span>
              )}
            </p>
          ) : null}
          {(figures["500"] ?? 0) > 0 ? (
            <p className="mt-3 text-[13px] text-ink-2">
              {t("payBy", { date: formatDate(form.due(selected.end)) })}
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
