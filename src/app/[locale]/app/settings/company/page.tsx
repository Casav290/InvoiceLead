import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { CompanyForm } from "@/components/settings/CompanyForm";
import { SettingsNav } from "@/components/settings/SettingsNav";
import { formatIban, formatUid } from "@/lib/swiss-ids";
import { requireAppSession } from "@/server/auth/guard";
import { canEditSettings } from "@/server/company";
import { db } from "@/server/db";

type Params = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "app.company" });
  return { title: t("title"), robots: { index: false } };
}

export default async function CompanySettingsPage({ params }: Params) {
  const { locale } = await params;
  const { user, organization: o } = await requireAppSession(locale);
  const editable = await canEditSettings(db(), o.id, user.id);
  const t = await getTranslations({ locale, namespace: "app.company" });
  const initial: Record<string, string> = {
    legalName: o.legalName ?? o.name,
    legalForm: o.legalForm ?? "",
    street: o.street ?? "",
    buildingNumber: o.buildingNumber ?? "",
    postalCode: o.postalCode ?? "",
    town: o.town ?? "",
    email: o.email ?? "",
    phone: o.phone ?? "",
    website: o.website ?? "",
    uid: o.uid ? formatUid(o.uid) : "",
    vatRegistered: o.vatRegistered ? "on" : "",
    vatMethod: o.vatMethod ?? "",
    vatSettlement: o.vatSettlement ?? "",
    iban: o.iban ? formatIban(o.iban) : "",
    qrIban: o.qrIban ? formatIban(o.qrIban) : "",
    fiscalYearStartMonth: String(o.fiscalYearStartMonth),
  };
  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-8">
      <SettingsNav />
      <h1 className="text-[28px] leading-tight">{t("title")}</h1>
      <p className="mt-2 text-[15px] text-ink-muted">{t("subtitle")}</p>
      {editable ? null : (
        <p className="mt-6 border border-line-strong bg-panel px-4 py-3 text-[13px] text-ink-2">
          {t("readOnly")}
        </p>
      )}
      <CompanyForm locale={locale} initial={initial} editable={editable} />
    </div>
  );
}
