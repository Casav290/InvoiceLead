import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { formatDate } from "@/lib/fiscal-year";
import { formatAmount } from "@/lib/money";
import { requireAppSession } from "@/server/auth/guard";
import { db } from "@/server/db";
import { listInvoices } from "@/server/invoices";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ deleted?: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "app.invoices" });
  return { title: t("title"), robots: { index: false } };
}

export default async function InvoicesPage({ params, searchParams }: Props) {
  const { locale } = await params;
  const { organization } = await requireAppSession(locale);
  const { deleted } = await searchParams;
  const t = await getTranslations({ locale, namespace: "app.invoices" });
  const rows = await listInvoices(db(), organization.id);
  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="text-[28px] leading-tight">{t("title")}</h1>
        <Button asChild>
          <Link href="/app/invoices/new" data-testid="invoice-new">
            {t("new")}
          </Link>
        </Button>
      </div>
      {deleted ? (
        <p
          role="status"
          className="mt-6 border border-line-strong bg-panel px-4 py-3 text-[13px] text-ink-2"
        >
          {t("deleted")}
        </p>
      ) : null}
      {rows.length === 0 ? (
        <p className="mt-8 border border-line-strong bg-panel px-5 py-8 text-center text-[14px] text-ink-muted">
          {t("empty")}
        </p>
      ) : (
        <div className="mt-6 overflow-x-auto border border-line-strong bg-panel">
          <table className="w-full text-left text-[14px]">
            <thead>
              <tr className="border-b border-line-strong bg-head text-[10.5px] font-extrabold tracking-[0.09em] text-ink-muted uppercase">
                <th className="px-4 py-2.5">{t("columns.number")}</th>
                <th className="px-4 py-2.5">{t("columns.customer")}</th>
                <th className="hidden px-4 py-2.5 sm:table-cell">{t("columns.date")}</th>
                <th className="px-4 py-2.5 text-right">{t("columns.total")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.id}
                  className="border-b border-line-soft last:border-b-0 hover:bg-rowhover"
                >
                  <td className="px-4 py-3 whitespace-nowrap">
                    <Link
                      href={`/app/invoices/${r.id}`}
                      className="font-semibold text-accent-dark hover:underline"
                    >
                      {r.number ?? t("draft")}
                    </Link>
                  </td>
                  <td className="px-4 py-3 [overflow-wrap:anywhere]">{r.contactName}</td>
                  <td className="hidden px-4 py-3 text-ink-2 tabular-nums sm:table-cell">
                    {formatDate(r.issueDate)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {formatAmount(r.totalCents)}
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
