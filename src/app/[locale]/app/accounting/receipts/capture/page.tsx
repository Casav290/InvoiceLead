import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { PlanNotice } from "@/components/app/PlanNotice";
import { CaptureButton } from "@/components/receipts/CaptureButton";
import { countryPack } from "@/countries";
import { Link } from "@/i18n/navigation";
import { formatDate } from "@/lib/fiscal-year";
import { formatAmount } from "@/lib/money";
import { requireAppSession } from "@/server/auth/guard";
import { db } from "@/server/db";
import { hasFeature, upgradeUrl } from "@/server/plans";
import { listReceipts } from "@/server/receipts";
import { uploadReceiptsAction } from "../../actions";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ added?: string; rejected?: string; last?: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "app.capture" });
  return { title: t("title"), robots: { index: false } };
}

/**
 * Capture depuis le téléphone (raccourci de l'application installée) : une photo, lue par l'IA,
 * rattachée au paiement quand il arrive dans le relevé.
 */
export default async function CapturePage({ params, searchParams }: Props) {
  const { locale } = await params;
  const { organization } = await requireAppSession(locale);
  const q = await searchParams;
  const t = await getTranslations({ locale, namespace: "app.capture" });
  const style = countryPack(organization.country).amounts;
  const recent = (await listReceipts(db(), organization.id)).slice(0, 5);
  const last = q.last ? recent.find((r) => r.id === q.last) : undefined;

  return (
    <div className="mx-auto max-w-md px-4 py-8">
      <h1 className="text-[24px] leading-tight">{t("title")}</h1>
      <p className="mt-2 text-[14px] text-ink-muted">{t("subtitle")}</p>
      {hasFeature(organization, "receipts") ? (
        <form action={uploadReceiptsAction} className="mt-6">
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="from" value="capture" />
          <CaptureButton label={t("take")} sending={t("sending")} />
        </form>
      ) : (
        <PlanNotice locale={locale} message={t("planOnly")} href={upgradeUrl(organization)} />
      )}

      {q.added !== undefined ? (
        <div
          role="status"
          className={`mt-6 border px-4 py-3 text-[14px] ${Number(q.added) > 0 ? "border-ok-fg bg-ok-bg text-ok-fg" : "border-hot-fg bg-hot-bg text-hot-fg"}`}
          data-testid="capture-result"
        >
          {Number(q.added) > 0 ? (
            last?.extraction?.totalCents ? (
              <>
                <span className="block font-semibold">{t("read")}</span>
                <span className="block">
                  {last.extraction.supplier ?? last.filename} ·{" "}
                  {last.extraction.currency ?? organization.currency}{" "}
                  {formatAmount(last.extraction.totalCents, style)}
                  {last.extraction.date ? ` · ${formatDate(last.extraction.date)}` : ""}
                </span>
              </>
            ) : (
              t("saved")
            )
          ) : (
            t("rejected")
          )}
        </div>
      ) : null}

      {recent.length > 0 ? (
        <section className="mt-8">
          <h2 className="text-[10.5px] font-extrabold tracking-[0.09em] text-ink-muted uppercase">
            {t("recent")}
          </h2>
          <ul className="mt-2 border border-line-strong bg-panel">
            {recent.map((r) => (
              <li
                key={r.id}
                className="flex items-baseline gap-3 border-b border-line-soft px-4 py-2.5 text-[13px] last:border-b-0"
              >
                <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
                  {r.extraction?.supplier ?? r.filename}
                </span>
                {r.extraction?.totalCents ? (
                  <span className="font-semibold tabular-nums">
                    {formatAmount(r.extraction.totalCents, style)}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <p className="mt-6 text-[13px]">
        <Link
          href="/app/accounting/receipts"
          className="font-semibold text-accent-dark hover:underline"
        >
          {t("all")}
        </Link>
      </p>
    </div>
  );
}
