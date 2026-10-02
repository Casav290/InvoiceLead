import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { AccountingNav } from "@/components/accounting/AccountingNav";
import { Button } from "@/components/ui/button";
import { countryPack } from "@/countries";
import { Link } from "@/i18n/navigation";
import { formatDate } from "@/lib/fiscal-year";
import { formatAmount } from "@/lib/money";
import { requireAppSession } from "@/server/auth/guard";
import { listBills } from "@/server/bills";
import { db } from "@/server/db";
import { can } from "@/server/roles";
import { dualApprovalAction, importEInvoicesAction } from "./actions";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{
    imported?: string;
    rejected?: string;
    deleted?: string;
    dual?: string;
    error?: string;
  }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "app.bills" });
  return { title: t("title"), robots: { index: false } };
}

const GROUPS = ["draft", "approved", "scheduled", "paid"] as const;

/** Factures fournisseurs : à approuver, à payer (fichier pain.001), transmises, payées. */
export default async function BillsPage({ params, searchParams }: Props) {
  const { locale } = await params;
  const { organization, membership } = await requireAppSession(locale);
  const q = await searchParams;
  const t = await getTranslations({ locale, namespace: "app.bills" });
  const style = countryPack(organization.country).amounts;
  const today = new Date().toISOString().slice(0, 10);
  const bills = await listBills(db(), organization.id);
  const toPay = bills.filter((b) => b.status === "approved");
  const hidden = <input type="hidden" name="locale" value={locale} />;
  const notice =
    q.imported !== undefined
      ? t("imported", { count: Number(q.imported) || 0, rejected: Number(q.rejected) || 0 })
      : q.deleted
        ? t("deleted")
        : q.dual
          ? t(q.dual === "on" ? "dualOn" : "dualOff")
          : null;

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-8">
      <AccountingNav />
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="text-[28px] leading-tight">{t("title")}</h1>
        <Button asChild>
          <Link href="/app/accounting/bills/new" data-testid="bill-new">
            {t("new")}
          </Link>
        </Button>
      </div>
      <p className="mt-2 text-[15px] text-ink-muted">{t("subtitle")}</p>
      {notice ? (
        <p
          role="status"
          className="mt-6 border border-ok-fg bg-ok-bg px-4 py-3 text-[13px] text-ok-fg"
        >
          {notice}
        </p>
      ) : null}
      {q.error === "none" || q.error === "noIban" ? (
        <p
          role="alert"
          className="mt-6 border border-hot-fg bg-hot-bg px-4 py-3 text-[13px] text-hot-fg"
        >
          {t(`errors.${q.error}`)}
        </p>
      ) : null}

      {/* E-factures lues sans IA : ouvertes à toutes les formules, hors compteur. */}
      <form
        action={importEInvoicesAction}
        className="mt-6 flex flex-wrap items-end gap-3 border border-line-strong bg-panel px-5 py-4"
      >
        {hidden}
        <div className="min-w-0 flex-1">
          <label htmlFor="einvoice-files" className="mb-1 block text-[13px] font-semibold">
            {t("importLabel")}
          </label>
          <input
            id="einvoice-files"
            name="files"
            type="file"
            multiple
            required
            accept="application/xml,text/xml,.xml,application/pdf"
            aria-describedby="einvoice-hint"
            className="block w-full text-[13px]"
          />
          <span id="einvoice-hint" className="mt-1 block text-[12px] text-ink-muted">
            {t("importHint")}
          </span>
        </div>
        <Button type="submit" variant="secondary" data-testid="einvoice-import">
          {t("import")}
        </Button>
      </form>

      {toPay.length > 0 ? (
        <form
          method="post"
          action={`/${locale}/app/accounting/bills/export`}
          className="mt-6 flex flex-wrap items-center gap-3 border border-accent bg-panel px-5 py-4"
        >
          <p className="min-w-0 flex-1 text-[13px]">
            {t("exportHint", {
              count: toPay.length,
              total: formatAmount(
                toPay.reduce((s, b) => s + b.totalCents, 0),
                style,
              ),
            })}
          </p>
          <Button type="submit" data-testid="bills-export">
            {t("export")}
          </Button>
        </form>
      ) : null}

      {bills.length === 0 ? (
        <p className="mt-8 border border-line-strong bg-panel px-5 py-8 text-center text-[14px] text-ink-muted">
          {t("empty")}
        </p>
      ) : (
        GROUPS.map((g) => {
          const rows = bills.filter((b) => b.status === g);
          if (rows.length === 0) return null;
          return (
            <section
              key={g}
              className="mt-6 border border-line-strong bg-panel"
              data-testid={`bills-${g}`}
            >
              <h2 className="border-b border-line bg-head px-5 py-3 text-[10.5px] font-extrabold tracking-[0.09em] text-ink-muted uppercase">
                {t(`groups.${g}`)} ({rows.length})
              </h2>
              <ul>
                {rows.map((b) => (
                  <li
                    key={b.id}
                    className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-line-soft px-5 py-3 text-[13px] last:border-b-0"
                    data-testid="bill-row"
                  >
                    <Link
                      href={`/app/accounting/bills/${b.id}`}
                      className="min-w-0 flex-1 font-semibold text-accent-dark hover:underline [overflow-wrap:anywhere]"
                    >
                      {b.supplierName}
                      {b.number ? ` · ${b.number}` : ""}
                    </Link>
                    {b.source === "expense" || b.source === "mileage" ? (
                      <span className="border border-line-strong px-1.5 text-[11px] text-ink-2">
                        {t("claim")}
                      </span>
                    ) : null}
                    <span
                      className={`tabular-nums ${g !== "paid" && b.dueDate < today ? "font-semibold text-hot-fg" : "text-ink-2"}`}
                    >
                      {t("due", { date: formatDate(b.dueDate) })}
                    </span>
                    <span className="font-extrabold tabular-nums">
                      {b.currency !== organization.currency ? `${b.currency} ` : ""}
                      {formatAmount(b.totalCents, style)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          );
        })
      )}

      <form
        action={dualApprovalAction}
        className="mt-8 flex flex-wrap items-center gap-4 border border-line-strong bg-panel px-5 py-4"
      >
        {hidden}
        <label className="flex min-w-0 flex-1 items-start gap-3">
          <input
            type="checkbox"
            name="dualApproval"
            defaultChecked={organization.dualApproval}
            disabled={!can(membership, "company")}
            className="mt-1 h-4 w-4 accent-accent"
          />
          <span>
            <span className="block text-[14px] font-semibold">{t("dualApproval")}</span>
            <span className="block text-[12px] text-ink-muted">{t("dualApprovalHint")}</span>
          </span>
        </label>
        {can(membership, "company") ? (
          <Button type="submit" variant="secondary" size="sm">
            {t("saveSetting")}
          </Button>
        ) : null}
      </form>
    </div>
  );
}
