import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { AccountingNav } from "@/components/accounting/AccountingNav";
import { PlanNotice } from "@/components/app/PlanNotice";
import { Button } from "@/components/ui/button";
import { countryPack } from "@/countries";
import { Link } from "@/i18n/navigation";
import { accountName } from "@/lib/account-name";
import { formatDate } from "@/lib/fiscal-year";
import { formatAmount } from "@/lib/money";
import { listAccounts } from "@/server/accounting";
import { requireAppSession } from "@/server/auth/guard";
import { findAnomalies, reviewQueue } from "@/server/autopilot";
import { db } from "@/server/db";
import { hasFeature, upgradeUrl } from "@/server/plans";
import { can } from "@/server/roles";
import { approveReviewAction, autopilotAction, undoAutoAction } from "../actions";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{
    enabled?: string;
    disabled?: string;
    auto?: string;
    approved?: string;
    undone?: string;
    error?: string;
  }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "app.review" });
  return { title: t("title"), robots: { index: false } };
}

/**
 * À vérifier : ce que le pilote automatique a comptabilisé seul, à approuver ou annuler, et les
 * anomalies relevées (doublons, justificatifs manquants, montants inhabituels).
 */
export default async function ReviewPage({ params, searchParams }: Props) {
  const { locale } = await params;
  const { organization, membership } = await requireAppSession(locale);
  const q = await searchParams;
  const t = await getTranslations({ locale, namespace: "app.review" });
  const style = countryPack(organization.country).amounts;
  const [queue, anomalies, chart] = await Promise.all([
    reviewQueue(db(), organization.id),
    findAnomalies(db(), organization.id),
    listAccounts(db(), organization.id),
  ]);
  const accountLabel = new Map(chart.map((a) => [a.id, `${a.number} ${accountName(a, locale)}`]));
  const allowed = hasFeature(organization, "bankImport");
  const canSetup = can(membership, "setup");
  const hidden = <input type="hidden" name="locale" value={locale} />;
  const notice = q.enabled
    ? t("enabled", { count: Number(q.auto) || 0 })
    : q.disabled
      ? t("disabled")
      : q.approved !== undefined
        ? t("approved", { count: Number(q.approved) || 0 })
        : q.undone
          ? t("undone")
          : null;
  const panel = "border border-line-strong bg-panel";
  const heading =
    "border-b border-line bg-head px-5 py-3 text-[10.5px] font-extrabold tracking-[0.09em] text-ink-muted uppercase";

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-8">
      <AccountingNav />
      <h1 className="text-[28px] leading-tight">{t("title")}</h1>
      <p className="mt-2 text-[15px] text-ink-muted">{t("subtitle")}</p>
      {notice ? (
        <p
          role="status"
          className="mt-6 border border-ok-fg bg-ok-bg px-4 py-3 text-[13px] text-ok-fg"
        >
          {notice}
        </p>
      ) : null}
      {q.error === "closed" || q.error === "notFound" || q.error === "plan" ? (
        <p
          role="alert"
          className="mt-6 border border-hot-fg bg-hot-bg px-4 py-3 text-[13px] text-hot-fg"
        >
          {t(`errors.${q.error}`)}
        </p>
      ) : null}

      {allowed ? (
        <form
          action={autopilotAction}
          className={`${panel} mt-6 flex flex-wrap items-center gap-4 px-5 py-4`}
          data-testid="autopilot-form"
        >
          {hidden}
          <label className="flex min-w-0 flex-1 items-start gap-3">
            <input
              type="checkbox"
              name="autopilot"
              defaultChecked={organization.autopilot}
              disabled={!canSetup}
              className="mt-1 h-4 w-4 accent-accent"
            />
            <span>
              <span className="block text-[14px] font-semibold">{t("autopilot")}</span>
              <span className="block text-[12px] text-ink-muted">{t("autopilotHint")}</span>
            </span>
          </label>
          {canSetup ? (
            <Button type="submit" variant="secondary" size="sm" data-testid="autopilot-save">
              {t("save")}
            </Button>
          ) : null}
        </form>
      ) : (
        <PlanNotice locale={locale} message={t("planOnly")} href={upgradeUrl(organization)} />
      )}

      <section className={`${panel} mt-6`} data-testid="review-queue">
        <h2 className={heading}>{t("queueTitle", { count: queue.length })}</h2>
        {queue.length === 0 ? (
          <p className="px-5 py-4 text-[13px] text-ink-muted">{t("queueEmpty")}</p>
        ) : (
          <>
            <ul>
              {queue.map((r) => (
                <li
                  key={r.id}
                  className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-line-soft px-5 py-3 text-[13px]"
                  data-testid="review-row"
                >
                  <span className="tabular-nums text-ink-2">{formatDate(r.bookingDate)}</span>
                  <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
                    <span className="font-semibold">{r.counterparty ?? r.text ?? "–"}</span>
                    <span className="block text-[12px] text-ink-muted">
                      {r.proposal?.kind === "account"
                        ? t("bookedTo", { account: accountLabel.get(r.proposal.accountId) ?? "" })
                        : t("bookedInvoice")}
                      {r.proposal?.explanation ? ` · ${r.proposal.explanation}` : ""}
                    </span>
                  </span>
                  <span className="font-semibold tabular-nums">
                    {formatAmount(r.amountCents, style)}
                  </span>
                  <form action={undoAutoAction}>
                    {hidden}
                    <input type="hidden" name="id" value={r.id} />
                    <Button type="submit" variant="ghost" size="sm" data-testid="review-undo">
                      {t("undo")}
                    </Button>
                  </form>
                </li>
              ))}
            </ul>
            <form action={approveReviewAction} className="px-5 py-4">
              {hidden}
              <Button type="submit" data-testid="review-approve">
                {t("approve", { count: queue.length })}
              </Button>
            </form>
          </>
        )}
      </section>

      <section className={`${panel} mt-6`} data-testid="anomalies">
        <h2 className={heading}>{t("anomaliesTitle", { count: anomalies.length })}</h2>
        {anomalies.length === 0 ? (
          <p className="px-5 py-4 text-[13px] text-ink-muted">{t("anomaliesEmpty")}</p>
        ) : (
          <ul>
            {anomalies.map((a) => (
              <li
                key={`${a.kind}-${a.transactionId}`}
                className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-line-soft px-5 py-3 text-[13px] last:border-b-0"
                data-testid="anomaly-row"
              >
                <span className="tabular-nums text-ink-2">{formatDate(a.date)}</span>
                <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
                  <span className="font-semibold">{a.counterparty ?? "–"}</span>
                  <span className="block text-[12px] text-ink-muted">
                    {a.kind === "unusualAmount"
                      ? t("kinds.unusualAmount", { usual: formatAmount(a.usualCents, style) })
                      : t(`kinds.${a.kind}`)}
                  </span>
                </span>
                <span className="font-semibold tabular-nums">
                  {formatAmount(a.amountCents, style)}
                </span>
                <Link
                  href={
                    a.kind === "missingReceipt"
                      ? "/app/accounting/receipts"
                      : "/app/accounting/bank"
                  }
                  className="text-[12px] font-semibold text-accent-dark hover:underline"
                >
                  {t(a.kind === "missingReceipt" ? "addReceipt" : "openBank")}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
