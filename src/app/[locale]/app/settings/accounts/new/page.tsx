import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { AccountForm } from "@/components/accounting/AccountForm";
import { SettingsNav } from "@/components/settings/SettingsNav";
import { requireAppSession } from "@/server/auth/guard";
import { canEditSettings } from "@/server/company";
import { db } from "@/server/db";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "app.accounts" });
  return { title: t("new"), robots: { index: false } };
}

export default async function NewAccountPage({ params }: Props) {
  const { locale } = await params;
  const { user, organization } = await requireAppSession(locale);
  if (!(await canEditSettings(db(), organization.id, user.id)))
    redirect(`/${locale}/app/settings/accounts`);
  const t = await getTranslations({ locale, namespace: "app.accounts" });
  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-8">
      <SettingsNav />
      <h1 className="text-[28px] leading-tight">{t("new")}</h1>
      <AccountForm locale={locale} initial={{ active: "on" }} />
    </div>
  );
}
