import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { AccountingNav } from "@/components/accounting/AccountingNav";
import { YearPicker } from "@/components/accounting/YearPicker";
import { recordElsewhere } from "@/components/app/RecordElsewhere";
import { countryPack } from "@/countries";
import { Link } from "@/i18n/navigation";
import { accountName } from "@/lib/account-name";
import { formatDate } from "@/lib/fiscal-year";
import { formatAmount } from "@/lib/money";
import { listFiscalYears } from "@/server/accounting";
import { requireAppSession } from "@/server/auth/guard";
import { db } from "@/server/db";
import { accountLedger } from "@/server/reports";

type Props = {
  params: Promise<{ locale: string; accountId: string }>;
  searchParams: Promise<{ year?: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "app.reports" });
  return { title: t("ledger"), robots: { index: false } };
}

export default async function LedgerPage({ params, searchParams }: Props) {
  const { locale, accountId } = await params;
  const { organization, user } = await requireAppSession(locale);
  const style = countryPack(organization.country).amounts;
  const q = await searchParams;
  const t = await getTranslations({ locale, namespace: "app.reports" });
  const years = await listFiscalYears(db(), organization.id);
  const year = years.find((y) => y.id === q.year) ?? years[0];
  const ledger = year ? await accountLedger(db(), organization.id, year.id, accountId) : null;
  if (!year || !ledger) {
    // Compte d'une autre entreprise de la personne : l'exercice de l'adresse est le sien, il ne suit pas.
    const elsewhere = await recordElsewhere({
      locale,
      userId: user.id,
      organizationId: organization.id,
      kind: "account",
      id: accountId,
      next: `/${locale}/app/accounting/ledger/${accountId}`,
    });
    if (elsewhere) return elsewhere;
    notFound();
  }
  const { account, lines } = ledger;
  const th =
    "border-b border-line-strong bg-head px-3 py-2 text-[10.5px] font-extrabold tracking-[0.09em] text-ink-muted uppercase";

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-8">
      <AccountingNav />
      <p className="text-[13px]">
        <Link
          href={`/app/accounting/reports?year=${year.id}`}
          className="font-semibold text-accent-dark hover:underline"
        >
          {t("back")}
        </Link>
      </p>
      <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
        <h1 className="text-[28px] leading-tight [overflow-wrap:anywhere]">
          {account.number} {accountName(account, locale)}
        </h1>
        <YearPicker locale={locale} years={years} selected={year.id} />
      </div>
      {lines.length === 0 ? (
        <p className="mt-8 border border-line-strong bg-panel px-5 py-8 text-center text-[14px] text-ink-muted">
          {t("noMovement")}
        </p>
      ) : (
        <div
          className="mt-6 overflow-x-auto border border-line-strong bg-panel"
          data-testid="ledger"
        >
          <table className="w-full text-left text-[13px]">
            <thead>
              <tr>
                <th className={th}>{t("date")}</th>
                <th className={th}>{t("entry")}</th>
                <th className={th}>{t("text")}</th>
                <th className={`${th} text-right`}>{t("debit")}</th>
                <th className={`${th} text-right`}>{t("credit")}</th>
                <th className={`${th} text-right`}>{t("balance")}</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={`${l.entryId}-${i}`} className="border-b border-line-soft last:border-b-0">
                  <td className="px-3 py-1.5 whitespace-nowrap tabular-nums">
                    {formatDate(l.entryDate)}
                  </td>
                  <td className="px-3 py-1.5 tabular-nums">{l.number}</td>
                  <td className="px-3 py-1.5 [overflow-wrap:anywhere]">{l.description}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">
                    {l.debitCents ? formatAmount(l.debitCents, style) : ""}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums">
                    {l.creditCents ? formatAmount(l.creditCents, style) : ""}
                  </td>
                  <td className="px-3 py-1.5 text-right font-semibold tabular-nums">
                    {formatAmount(l.runningCents, style)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
