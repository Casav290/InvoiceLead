import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { AccountingNav } from "@/components/accounting/AccountingNav";
import { ProBadge, ProLock } from "@/components/app/ProLock";
import { Button } from "@/components/ui/button";
import { countryPack } from "@/countries";
import { Link } from "@/i18n/navigation";
import { formatDate } from "@/lib/fiscal-year";
import { formatAmount } from "@/lib/money";
import { aiConfigured } from "@/server/ai";
import { requireAppSession } from "@/server/auth/guard";
import { db } from "@/server/db";
import { lockFor } from "@/server/plan-lock";
import { quotaAccess } from "@/server/plans";
import { listReceipts } from "@/server/receipts";
import { readReceiptAction, uploadReceiptsAction } from "../actions";
import { billFromReceiptAction } from "../bills/actions";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ added?: string; rejected?: string; error?: string; quota?: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "app.receipts" });
  return { title: t("title"), robots: { index: false } };
}

const ERRORS = ["unreadable", "failed", "notFound", "quota"];

export default async function ReceiptsPage({ params, searchParams }: Props) {
  const { locale } = await params;
  const { organization } = await requireAppSession(locale);
  const style = countryPack(organization.country).amounts;
  const q = await searchParams;
  const t = await getTranslations({ locale, namespace: "app.receipts" });
  const tp = await getTranslations({ locale, namespace: "app.plan" });
  const rows = await listReceipts(db(), organization.id);
  const hidden = <input type="hidden" name="locale" value={locale} />;
  // Lectures du mois (tickets, justificatifs, e-factures) : une fois utilisées, dépôt et relecture
  // restent visibles mais grisés.
  const reads = await quotaAccess(db(), organization, "aiReads");
  const usedUp = tp("used.aiReads", { limit: reads.limit, plan: reads.tier });
  const readLock = aiConfigured() ? await lockFor(locale, organization, reads, usedUp) : null;
  const uploadForm = (
    <form
      action={uploadReceiptsAction}
      className="flex flex-wrap items-end gap-3 border border-line-strong bg-panel px-5 py-4"
    >
      {hidden}
      <div className="min-w-0 flex-1">
        <label htmlFor="receipt-files" className="mb-1 block text-[13px] font-semibold">
          {t("files")}
        </label>
        <input
          id="receipt-files"
          name="files"
          type="file"
          multiple
          required
          accept="application/pdf,image/jpeg,image/png,image/webp"
          aria-describedby="receipt-files-hint"
          className="block w-full text-[13px]"
        />
        <span id="receipt-files-hint" className="mt-1 block text-[12px] text-ink-muted">
          {t("filesHint")}
        </span>
        <span className="mt-1 block text-[12px] text-ink-2" data-testid="receipts-quota">
          {tp("quota.aiReads", { used: reads.used, limit: reads.limit })}
        </span>
      </div>
      <Button type="submit" data-testid="receipts-upload">
        {t("upload")}
      </Button>
    </form>
  );

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-8">
      <AccountingNav />
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="text-[28px] leading-tight">{t("title")}</h1>
        <Link
          href="/app/accounting/receipts/capture"
          className="text-[13px] font-semibold text-accent-dark hover:underline"
          data-testid="receipts-capture-link"
        >
          {t("captureLink")}
        </Link>
      </div>
      <p className="mt-2 text-[15px] text-ink-muted">{t("subtitle")}</p>

      {q.added !== undefined ? (
        <p
          role="status"
          className="mt-6 border border-ok-fg bg-ok-bg px-4 py-3 text-[13px] text-ok-fg"
        >
          {t("added", { count: Number(q.added) || 0, rejected: Number(q.rejected) || 0 })}
        </p>
      ) : null}
      {q.error && ERRORS.includes(q.error) ? (
        <p
          role="alert"
          className="mt-6 border border-hot-fg bg-hot-bg px-4 py-3 text-[13px] text-hot-fg"
        >
          {q.error === "quota" ? usedUp : t(`errors.${q.error}`)}
        </p>
      ) : null}
      {aiConfigured() ? null : (
        <p className="mt-6 border border-line-strong bg-panel px-4 py-3 text-[13px] text-ink-2">
          {t("aiOff")}
        </p>
      )}

      {q.quota ? (
        <p
          role="alert"
          className="mt-6 border border-hot-fg bg-hot-bg px-4 py-3 text-[13px] text-hot-fg"
        >
          {usedUp}
        </p>
      ) : null}
      {readLock ? (
        <ProLock lock={readLock} testId="receipts-lock" className="mt-6">
          {uploadForm}
        </ProLock>
      ) : (
        <div className="mt-6">{uploadForm}</div>
      )}

      {rows.length === 0 ? (
        <p className="mt-8 border border-line-strong bg-panel px-5 py-8 text-center text-[14px] text-ink-muted">
          {t("empty")}
        </p>
      ) : (
        <ul className="mt-6 space-y-3" data-testid="receipts-list">
          {rows.map((r) => {
            const x = r.extraction;
            return (
              <li
                key={r.id}
                className="border border-line-strong bg-panel px-4 py-3"
                data-testid="receipt-row"
              >
                <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                  <span className="min-w-0 flex-1 font-semibold [overflow-wrap:anywhere]">
                    {x?.supplier ?? r.filename}
                  </span>
                  {x?.totalCents ? (
                    <span className="font-extrabold tabular-nums">
                      {x.currency ?? organization.currency} {formatAmount(x.totalCents, style)}
                    </span>
                  ) : null}
                  <span
                    className="border border-line-strong px-1.5 text-[11px] font-semibold text-ink-2"
                    data-testid="receipt-status"
                  >
                    {t(`status.${r.status}`)}
                  </span>
                </div>
                {x ? (
                  <p className="mt-1 text-[12px] text-ink-2 [overflow-wrap:anywhere]">
                    {[
                      x.date ? formatDate(x.date) : null,
                      x.invoiceNumber ? t("invoiceNumber", { number: x.invoiceNumber }) : null,
                      x.vatCents ? t("vat", { amount: formatAmount(x.vatCents, style) }) : null,
                      x.accountNumber ? t("account", { number: x.accountNumber }) : null,
                      x.description,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                ) : null}
                <div className="mt-2 flex flex-wrap items-center gap-3 text-[12px]">
                  <a
                    href={`/${locale}/app/accounting/receipts/${r.id}/file`}
                    className="font-semibold text-accent-dark underline"
                    target="_blank"
                    rel="noopener"
                  >
                    {r.filename}
                  </a>
                  {r.status === "matched" ? (
                    <span className="text-ok-fg">{t("matchedHint")}</span>
                  ) : null}
                  {(r.status === "read" || r.status === "matched") && x?.totalCents ? (
                    <form action={billFromReceiptAction}>
                      {hidden}
                      <input type="hidden" name="receiptId" value={r.id} />
                      <Button type="submit" variant="ghost" size="sm" data-testid="receipt-to-bill">
                        {t("toBill")}
                      </Button>
                    </form>
                  ) : null}
                  {(r.status === "new" || r.status === "error" || r.status === "read") &&
                  aiConfigured() ? (
                    <form action={readReceiptAction} className="inline-flex items-center gap-2">
                      {hidden}
                      <input type="hidden" name="id" value={r.id} />
                      <Button
                        type="submit"
                        variant="ghost"
                        size="sm"
                        disabled={!!readLock}
                        aria-disabled={readLock ? true : undefined}
                        aria-describedby={readLock ? "receipts-lock-reason" : undefined}
                        data-testid="receipt-read"
                      >
                        {r.status === "new" ? t("read") : t("reread")}
                      </Button>
                      {readLock?.tier ? <ProBadge tier={readLock.tier} /> : null}
                    </form>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
