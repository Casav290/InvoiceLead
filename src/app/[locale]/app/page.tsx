import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { ProBadge } from "@/components/app/ProLock";
import { countryPack } from "@/countries";
import { Link } from "@/i18n/navigation";
import { formatDate } from "@/lib/fiscal-year";
import { formatAmount } from "@/lib/money";
import { requireAppSession } from "@/server/auth/guard";
import { currentPlanUsage, markOf } from "@/server/current-plan";
import { dashboardFigures } from "@/server/dashboard";
import { db } from "@/server/db";
import { type Quota, tierOf, upgradeUrl } from "@/server/plans";

const NEXT_STEPS = ["company", "contacts", "invoice"] as const;
/** Allocations montrées sous la ligne de la formule, quand elles ont une limite. */
const SHOWN_QUOTAS: Quota[] = ["aiReads", "assistant", "reminders", "bankImports", "recurring"];

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "app.nav" });
  return { title: t("dashboard"), robots: { index: false } };
}

export default async function DashboardPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ forbidden?: string }>;
}) {
  const { locale } = await params;
  const { forbidden } = await searchParams;
  const { user, organization } = await requireAppSession(locale);
  const t = await getTranslations({ locale, namespace: "app.dashboard" });
  const tp = await getTranslations({ locale, namespace: "app.plan" });
  const tier = tierOf(organization);
  const today = new Date().toISOString().slice(0, 10);
  const quotas = await currentPlanUsage(organization.id);
  const used = { invoices: quotas?.invoices.used ?? 0, contacts: quotas?.contacts.used ?? 0 };
  const shownQuotas = SHOWN_QUOTAS.filter((q) => quotas && Number.isFinite(quotas[q].limit));
  const assistantMark = markOf(quotas?.assistant);
  const f = await dashboardFigures(db(), organization.id, today);
  const pack = countryPack(organization.country);
  // Les cartes montrent des montants ronds ; les listes gardent les centimes.
  const whole = (cents: number) =>
    formatAmount(Math.round(cents / 100) * 100, pack.amounts).replace(/[.,]00$/, "");
  const money = (cents: number, currency = f.currency) =>
    `${currency} ${formatAmount(cents, pack.amounts)}`;
  const trend =
    f.revenuePrevMonthCents > 0
      ? Math.round(
          ((f.revenueMonthCents - f.revenuePrevMonthCents) / f.revenuePrevMonthCents) * 100,
        )
      : null;
  const peak = Math.max(1, ...f.months.map((m) => m.netCents));
  const monthLabel = (ym: string) =>
    new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1, 1)).toLocaleString(
      locale,
      {
        month: "short",
        timeZone: "UTC",
      },
    );
  // Les premiers pas ne restent qu'au démarrage.
  const starting =
    !organization.settingsCompletedAt ||
    (f.open.count === 0 && f.revenueYearCents === 0 && used.invoices === 0);
  const firstName = (user.name || user.email).split(/\s+/)[0] ?? "";
  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-8">
      <h1 className="text-[28px] leading-tight" data-testid="dashboard-title">
        {t("title", { name: firstName })}
      </h1>
      <p className="mt-2 text-[15px] text-ink-muted">{t("subtitle", { org: organization.name })}</p>
      <p className="mt-4">
        <Link
          href="/app/assistant"
          className={
            assistantMark
              ? "inline-flex items-center gap-2 border border-line-strong bg-muted px-3 py-2 text-[13px] font-semibold text-ink-muted"
              : "inline-block border border-accent px-3 py-2 text-[13px] font-semibold text-accent-dark hover:bg-accent-pale"
          }
          data-testid="dashboard-assistant"
        >
          {t("askBooks")}
          {assistantMark ? <ProBadge tier={assistantMark} /> : null}
        </Link>
      </p>
      {forbidden ? (
        <p
          role="alert"
          className="mt-6 border border-hot-fg bg-hot-bg px-4 py-3 text-[13px] text-hot-fg"
          data-testid="forbidden"
        >
          {t("forbidden")}
        </p>
      ) : null}
      <p className="mt-3 text-[13px] text-ink-2" data-testid="plan-usage">
        {tp("usage", {
          plan: tp(tier),
          hasLimit: tier === "free" ? "yes" : "no",
          invoices: used.invoices,
          invoiceLimit: quotas?.invoices.limit ?? 0,
          contacts: used.contacts,
          contactLimit: quotas?.contacts.limit ?? 0,
        })}{" "}
        {tier !== "proplus" ? (
          <a
            href={upgradeUrl(organization)}
            className="font-semibold text-accent-dark underline"
            rel="noopener"
          >
            {tp(tier === "pro" ? "upgradePlus" : "upgrade")}
          </a>
        ) : null}
      </p>
      {quotas && shownQuotas.length > 0 ? (
        <ul className="mt-2 flex flex-wrap gap-2" data-testid="plan-quotas">
          {shownQuotas.map((q) => {
            const mark = markOf(quotas[q]);
            return (
              <li
                key={q}
                className={`inline-flex items-center gap-2 border px-2 py-1 text-[12px] ${mark ? "border-line-strong bg-muted text-ink-2" : "border-line bg-panel text-ink-2"}`}
                data-testid={`quota-${q}`}
              >
                {tp(`quota.${q}`, { used: quotas[q].used, limit: quotas[q].limit })}
                {mark ? <ProBadge tier={mark} /> : null}
              </li>
            );
          })}
        </ul>
      ) : null}
      <div
        className="mt-8 grid grid-cols-2 border-t border-l border-line-strong lg:grid-cols-4"
        data-testid="dashboard-figures"
      >
        <Figure
          id="revenue-month"
          label={t("figures.revenueMonth")}
          value={`${f.currency} ${whole(f.revenueMonthCents)}`}
          note={
            trend === null
              ? t("figures.invoicesMonth", { n: f.invoicesMonth })
              : t("figures.trend", { pct: trend > 0 ? `+${trend}` : String(trend) })
          }
        />
        <Figure
          id="revenue-year"
          label={t("figures.revenueYear", { year: today.slice(0, 4) })}
          value={`${f.currency} ${whole(f.revenueYearCents)}`}
          note={t("figures.net")}
        />
        <Figure
          id="collected"
          label={t("figures.collected")}
          value={`${f.currency} ${whole(f.collectedMonthCents)}`}
          note={t("figures.invoicesMonth", { n: f.invoicesMonth })}
        />
        <Figure
          id="open"
          label={t("figures.open")}
          value={`${f.currency} ${whole(f.open.cents)}`}
          note={t("figures.invoices", { n: f.open.count })}
          href="/app/invoices"
        />
        <Figure
          id="overdue"
          label={t("figures.overdue")}
          value={`${f.currency} ${whole(f.overdue.cents)}`}
          note={t("figures.invoices", { n: f.overdue.count })}
          alert={f.overdue.count > 0}
          href="/app/invoices/reminders"
        />
        <Figure
          id="quotes-open"
          label={t("figures.quotesOpen")}
          value={`${f.currency} ${whole(f.quotesOpen.cents)}`}
          note={t("figures.quotes", { n: f.quotesOpen.count })}
          href="/app/quotes"
        />
        <Figure
          id="quotes-accepted"
          label={t("figures.quotesAccepted")}
          value={`${f.currency} ${whole(f.quotesAccepted.cents)}`}
          note={
            f.acceptanceRate === null
              ? t("figures.quotes", { n: f.quotesAccepted.count })
              : t("figures.acceptance", { pct: Math.round(f.acceptanceRate * 100) })
          }
          href="/app/quotes"
        />
        <Figure
          id="bills"
          label={t("figures.bills")}
          value={`${f.currency} ${whole(f.billsToPay.cents)}`}
          note={
            f.billsToPay.overdue > 0
              ? t("figures.billsLate", { n: f.billsToPay.count, late: f.billsToPay.overdue })
              : t("figures.billsCount", { n: f.billsToPay.count })
          }
          alert={f.billsToPay.overdue > 0}
          href="/app/expenses"
        />
      </div>
      {f.drafts > 0 ? (
        <p className="mt-3 text-[13px] text-ink-2" data-testid="dashboard-drafts">
          {t("figures.drafts", { n: f.drafts })}
        </p>
      ) : null}

      <section className="mt-8 border border-line-strong bg-panel" data-testid="dashboard-chart">
        <h2 className="border-b border-line bg-head px-5 py-3 text-[10.5px] font-extrabold tracking-[0.09em] text-ink-muted uppercase">
          {t("chartTitle", { currency: f.currency })}
        </h2>
        <ol className="flex h-48 items-end gap-1 px-5 pt-6 pb-2 sm:gap-2">
          {f.months.map((m) => (
            <li
              key={m.month}
              className="flex h-full min-w-0 flex-1 flex-col items-center justify-end"
            >
              <span
                className={
                  m.month === f.months[11]?.month
                    ? "w-full bg-accent"
                    : "w-full bg-accent-pale border border-accent"
                }
                style={{ height: `${Math.max(0, (m.netCents / peak) * 100)}%` }}
                title={`${monthLabel(m.month)} : ${money(m.netCents)}`}
              />
            </li>
          ))}
        </ol>
        <ol className="flex gap-1 px-5 pb-3 sm:gap-2" aria-hidden="true">
          {f.months.map((m) => (
            <li
              key={m.month}
              className="min-w-0 flex-1 truncate text-center text-[10.5px] text-ink-muted"
            >
              {monthLabel(m.month)}
            </li>
          ))}
        </ol>
      </section>

      <div className="mt-8 grid gap-8 lg:grid-cols-2">
        <section className="border border-line-strong bg-panel" data-testid="dashboard-overdue">
          <h2 className="border-b border-line bg-head px-5 py-3 text-[10.5px] font-extrabold tracking-[0.09em] text-ink-muted uppercase">
            {t("overdueTitle")}
          </h2>
          {f.overdueList.length === 0 ? (
            <p className="px-5 py-4 text-[13px] text-ink-muted">{t("overdueNone")}</p>
          ) : (
            <ul>
              {f.overdueList.map((i) => (
                <li key={i.id} className="border-b border-line-soft last:border-b-0">
                  <Link
                    href={`/app/invoices/${i.id}`}
                    className="flex items-baseline gap-3 px-5 py-3 hover:bg-head"
                  >
                    <span className="min-w-0 flex-1 truncate text-[14px]">
                      {i.number ? `${i.number} · ` : ""}
                      {i.contactName}
                    </span>
                    <span className="shrink-0 text-[12px] text-hot-fg">
                      {t("daysLate", { n: i.daysLate })}
                    </span>
                    <span className="shrink-0 text-[13px] font-semibold tabular-nums">
                      {money(i.openCents, i.currency)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="border border-line-strong bg-panel" data-testid="dashboard-quotes">
          <h2 className="border-b border-line bg-head px-5 py-3 text-[10.5px] font-extrabold tracking-[0.09em] text-ink-muted uppercase">
            {t("quotesTitle")}
          </h2>
          {f.quotesList.length === 0 ? (
            <p className="px-5 py-4 text-[13px] text-ink-muted">{t("quotesNone")}</p>
          ) : (
            <ul>
              {f.quotesList.map((q) => (
                <li key={q.id} className="border-b border-line-soft last:border-b-0">
                  <Link
                    href={`/app/quotes/${q.id}`}
                    className="flex items-baseline gap-3 px-5 py-3 hover:bg-head"
                  >
                    <span className="min-w-0 flex-1 truncate text-[14px]">
                      {q.number ? `${q.number} · ` : ""}
                      {q.contactName}
                    </span>
                    <span
                      className={
                        q.validUntil < today
                          ? "shrink-0 text-[12px] text-hot-fg"
                          : "shrink-0 text-[12px] text-ink-muted"
                      }
                    >
                      {t(q.validUntil < today ? "expired" : "validUntil", {
                        date: formatDate(q.validUntil, pack.dates),
                      })}
                    </span>
                    <span className="shrink-0 text-[13px] font-semibold tabular-nums">
                      {money(q.netCents, q.currency)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
      {starting ? (
        <section className="mt-8 border border-line-strong bg-panel">
          <h2 className="border-b border-line bg-head px-5 py-3 text-[10.5px] font-extrabold tracking-[0.09em] text-ink-muted uppercase">
            {t("nextTitle")}
          </h2>
          <ol>
            {NEXT_STEPS.map((step, i) => (
              <li
                key={step}
                className="flex items-center gap-4 border-b border-line-soft px-5 py-4 last:border-b-0"
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center border border-line-strong text-[12px] font-extrabold text-ink-3">
                  {i + 1}
                </span>
                <span className="flex-1 text-[14px]">{t(`next.${step}`)}</span>
                {step === "company" ? (
                  organization.settingsCompletedAt ? (
                    <span className="text-[12px] font-semibold text-ok-fg">{t("done")}</span>
                  ) : (
                    <Link
                      href="/app/settings/company"
                      className="text-[13px] font-semibold text-accent-dark underline"
                    >
                      {t("complete")}
                    </Link>
                  )
                ) : step === "invoice" ? (
                  <Link
                    href="/app/invoices/new"
                    className="text-[13px] font-semibold text-accent-dark underline"
                  >
                    {t("start")}
                  </Link>
                ) : null}
              </li>
            ))}
          </ol>
        </section>
      ) : null}
    </div>
  );
}

/** Une case du tableau de bord : libellé, chiffre, précision ; en rouge pour un retard. */
function Figure({
  id,
  label,
  value,
  note,
  alert = false,
  href,
}: {
  id: string;
  label: string;
  value: string;
  note: ReactNode;
  alert?: boolean;
  href?: string;
}) {
  const body = (
    <>
      <span className="block text-[10.5px] font-extrabold tracking-[0.09em] text-ink-muted uppercase">
        {label}
      </span>
      <span
        className={`mt-2 block text-[22px] leading-tight font-extrabold tabular-nums [overflow-wrap:anywhere] ${alert ? "text-hot-fg" : "text-ink"}`}
        data-testid={`figure-${id}`}
      >
        {value}
      </span>
      <span className="mt-1 block text-[12px] text-ink-2">{note}</span>
    </>
  );
  const box = "block min-w-0 border-r border-b border-line-strong bg-panel px-4 py-4";
  return href ? (
    <Link href={href} className={`${box} hover:bg-head`}>
      {body}
    </Link>
  ) : (
    <div className={box}>{body}</div>
  );
}
