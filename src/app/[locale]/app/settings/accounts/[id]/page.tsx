import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { AccountForm } from "@/components/accounting/AccountForm";
import { recordElsewhere } from "@/components/app/RecordElsewhere";
import { SettingsNav } from "@/components/settings/SettingsNav";
import { accountName } from "@/lib/account-name";
import { getAccount } from "@/server/accounting";
import { requireAppSession } from "@/server/auth/guard";
import { canSetUpAccounting } from "@/server/company";
import { db } from "@/server/db";

type Props = { params: Promise<{ locale: string; id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "app.accounts" });
  return { title: t("edit"), robots: { index: false } };
}

export default async function AccountPage({ params }: Props) {
  const { locale, id } = await params;
  const { user, organization } = await requireAppSession(locale);
  if (!(await canSetUpAccounting(db(), organization.id, user.id)))
    redirect(`/${locale}/app/settings/accounts`);
  const account = await getAccount(db(), organization.id, id);
  if (!account) {
    const elsewhere = await recordElsewhere({
      locale,
      userId: user.id,
      organizationId: organization.id,
      kind: "account",
      id,
      next: `/${locale}/app/settings/accounts/${id}`,
    });
    if (elsewhere) return elsewhere;
    notFound();
  }
  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-8">
      <SettingsNav />
      <h1 className="text-[28px] leading-tight [overflow-wrap:anywhere]">
        {account.number} {accountName(account, locale)}
      </h1>
      <AccountForm
        locale={locale}
        id={account.id}
        system={!!account.role}
        initial={{
          number: account.number,
          type: account.type,
          nameDe: account.nameDe,
          nameFr: account.nameFr,
          nameEn: account.nameEn ?? "",
          vatCode: account.vatCode ?? "",
          active: account.active ? "on" : "",
        }}
      />
    </div>
  );
}
