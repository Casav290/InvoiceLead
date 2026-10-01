import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { LockNote, ProBadge } from "@/components/app/ProLock";
import { Button } from "@/components/ui/button";
import { countryPack } from "@/countries";
import { Link } from "@/i18n/navigation";
import { formatDate } from "@/lib/fiscal-year";
import { formatAmount } from "@/lib/money";
import { requireAppSession } from "@/server/auth/guard";
import { db } from "@/server/db";
import { lockFor } from "@/server/plan-lock";
import { quotaAccess } from "@/server/plans";
import { listRecurring, runningRecurring } from "@/server/recurring";
import { updateRecurringAction } from "./actions";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ created?: string; error?: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "app.recurring" });
  return { title: t("title"), robots: { index: false } };
}

export default async function RecurringPage({ params, searchParams }: Props) {
  const { locale } = await params;
  const { organization } = await requireAppSession(locale);
  const { created, error } = await searchParams;
  const t = await getTranslations({ locale, namespace: "app.recurring" });
  const tp = await getTranslations({ locale, namespace: "app.plan" });
  const rows = await listRecurring(db(), organization.id);
  // Formule gratuite : une récurrence active. Les autres attendent (reprise grisée, marque Pro).
  const slots = await quotaAccess(db(), organization, "recurring");
  const running = await runningRecurring(db(), organization);
  const usedUp = tp("used.recurring", { limit: slots.limit, plan: slots.tier });
  const lock = await lockFor(locale, organization, slots, usedUp);
  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-8">
      <p className="text-[13px]">
        <Link href="/app/invoices" className="font-semibold text-accent-dark hover:underline">
          {t("back")}
        </Link>
      </p>
      <h1 className="mt-2 text-[28px] leading-tight">{t("title")}</h1>
      <p className="mt-2 text-[15px] text-ink-muted">{t("subtitle")}</p>
      {created ? (
        <p
          role="status"
          className="mt-6 border border-ok-fg bg-ok-bg px-4 py-3 text-[13px] text-ok-fg"
        >
          {t("created")}
        </p>
      ) : null}
      {error === "recurringLimit" ? (
        <p
          role="alert"
          className="mt-6 border border-hot-fg bg-hot-bg px-4 py-3 text-[13px] text-hot-fg"
        >
          {usedUp}
        </p>
      ) : null}
      {Number.isFinite(slots.limit) ? (
        <p className="mt-4 text-[13px] text-ink-2" data-testid="recurring-quota">
          {tp("quota.recurring", { used: slots.used, limit: slots.limit })}
        </p>
      ) : null}
      {lock ? (
        <LockNote
          lock={lock}
          id="recurring-lock-reason"
          testId="recurring-lock"
          className="mt-3 border border-line-strong bg-muted px-4 py-3"
        />
      ) : null}
      {rows.length === 0 ? (
        <p className="mt-8 border border-line-strong bg-panel px-5 py-8 text-center text-[14px] text-ink-muted">
          {t("empty")}
        </p>
      ) : (
        <ul className="mt-6 space-y-3" data-testid="recurring-list">
          {rows.map(({ recurring: r, number, customer, total }) => (
            <li
              key={r.id}
              className="border border-line-strong bg-panel px-4 py-3"
              data-testid="recurring-row"
            >
              <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                <span className="min-w-0 flex-1 font-semibold [overflow-wrap:anywhere]">
                  {customer}
                </span>
                <span className="font-extrabold tabular-nums">
                  {formatAmount(total, countryPack(organization.country).amounts)}
                </span>
              </div>
              <p className="mt-1 text-[12px] text-ink-2">
                {t("line", {
                  interval: r.intervalMonths,
                  next: formatDate(r.nextDate),
                  model: number ?? t("draftModel"),
                })}
                {r.autoSend ? ` · ${t("autoSend")}` : ` · ${t("draftOnly")}`}
                {r.active ? "" : ` · ${t("paused")}`}
              </p>
              {r.active && running && !running.has(r.id) ? (
                <p
                  className="mt-1 flex flex-wrap items-center gap-2 text-[12px] text-ink-2"
                  data-testid="recurring-held"
                >
                  <ProBadge tier="pro" />
                  {t("held")}
                </p>
              ) : null}
              <div className="mt-2 flex flex-wrap gap-2">
                <Link
                  href={`/app/invoices/${r.sourceInvoiceId}`}
                  className="text-[12px] font-semibold text-accent-dark underline"
                >
                  {t("model")}
                </Link>
                <form action={updateRecurringAction} className="inline-flex items-center gap-2">
                  <input type="hidden" name="locale" value={locale} />
                  <input type="hidden" name="id" value={r.id} />
                  <input type="hidden" name="op" value={r.active ? "pause" : "resume"} />
                  <Button
                    type="submit"
                    variant="ghost"
                    size="sm"
                    disabled={!r.active && !!lock}
                    aria-disabled={!r.active && lock ? true : undefined}
                    aria-describedby={!r.active && lock ? "recurring-lock-reason" : undefined}
                    data-testid={r.active ? "recurring-pause" : "recurring-resume"}
                  >
                    {r.active ? t("pause") : t("resume")}
                  </Button>
                  {!r.active && lock?.tier ? <ProBadge tier={lock.tier} /> : null}
                </form>
                <form action={updateRecurringAction}>
                  <input type="hidden" name="locale" value={locale} />
                  <input type="hidden" name="id" value={r.id} />
                  <input type="hidden" name="op" value="delete" />
                  <Button type="submit" variant="ghost" size="sm">
                    {t("delete")}
                  </Button>
                </form>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
