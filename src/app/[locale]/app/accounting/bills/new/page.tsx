import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { AccountingNav } from "@/components/accounting/AccountingNav";
import { BillForm } from "@/components/bills/BillForm";
import { accountName } from "@/lib/account-name";
import { listAccounts } from "@/server/accounting";
import { requireAppSession } from "@/server/auth/guard";
import { db } from "@/server/db";
import { lockFor } from "@/server/plan-lock";
import { featureAccess } from "@/server/plans";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "app.bills" });
  return { title: t("new"), robots: { index: false } };
}

export default async function NewBillPage({ params }: Props) {
  const { locale } = await params;
  const { organization } = await requireAppSession(locale);
  const t = await getTranslations({ locale, namespace: "app.bills" });
  const chart = await listAccounts(db(), organization.id);
  const today = new Date().toISOString().slice(0, 10);
  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-8">
      <AccountingNav />
      <h1 className="text-[28px] leading-tight">{t("new")}</h1>
      <BillForm
        locale={locale}
        vatRegistered={organization.vatRegistered}
        homeCurrency={organization.currency}
        currencyLock={
          await lockFor(
            locale,
            organization,
            featureAccess(organization, "multiCurrency"),
            t("currencyPlan"),
          )
        }
        accounts={chart
          .filter((a) => a.active && (a.type === "expense" || a.type === "asset") && !a.role)
          .map((a) => ({ id: a.id, label: `${a.number} ${accountName(a, locale)}` }))}
        initial={{ issueDate: today, currency: organization.currency }}
      />
    </div>
  );
}
