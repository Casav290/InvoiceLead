import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { CompanyForm } from "@/components/settings/CompanyForm";
import { SettingsNav } from "@/components/settings/SettingsNav";
import { Button } from "@/components/ui/button";
import { formatIban, formatUid } from "@/lib/swiss-ids";
import { requireAppSession } from "@/server/auth/guard";
import { canEditSettings } from "@/server/company";
import { db } from "@/server/db";
import { removeLogoAction, uploadLogoAction } from "./actions";

type Params = {
  params: Promise<{ locale: string }>;
  searchParams?: Promise<{ logo?: string }>;
};

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "app.company" });
  return { title: t("title"), robots: { index: false } };
}

export default async function CompanySettingsPage({ params, searchParams }: Params) {
  const { locale } = await params;
  const logoResult = (await searchParams)?.logo;
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
    country: o.country,
    taxNumber: o.taxNumber ?? "",
    uid: o.uid ? (o.uid.startsWith("CHE") ? formatUid(o.uid) : o.uid) : "",
    vatRegistered: o.vatRegistered ? "on" : "",
    vatMethod: o.vatMethod ?? "",
    vatSettlement: o.vatSettlement ?? "",
    netTaxRate: o.netTaxRateBp ? String(o.netTaxRateBp / 100) : "",
    region: o.region ?? "",
    salesTaxRate: o.salesTaxRateBp ? String(o.salesTaxRateBp / 100) : "",
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
      <section className="mt-8 border border-line-strong bg-panel" data-testid="company-logo">
        <h2 className="border-b border-line bg-head px-5 py-3 text-[10.5px] font-extrabold tracking-[0.09em] text-ink-muted uppercase">
          {t("logo.title")}
        </h2>
        <div className="flex flex-wrap items-center gap-5 p-5">
          {o.logoKey ? (
            // biome-ignore lint/performance/noImgElement: logo servi tel quel, taille inconnue
            <img
              src={`/api/logo/${o.id}?v=${encodeURIComponent(o.logoKey.split("/").pop() ?? "")}`}
              alt={t("logo.current")}
              className="max-h-16 max-w-[200px] border border-line object-contain p-2"
            />
          ) : (
            <p className="text-[13px] text-ink-muted">{t("logo.none")}</p>
          )}
          {editable ? (
            <div className="flex flex-wrap items-center gap-3">
              <form action={uploadLogoAction} className="flex flex-wrap items-center gap-3">
                <input type="hidden" name="locale" value={locale} />
                <input
                  type="file"
                  name="logo"
                  accept="image/png,image/jpeg"
                  required
                  aria-label={t("logo.file")}
                  className="block max-w-full text-[13px]"
                />
                <Button type="submit" variant="secondary" size="sm" data-testid="logo-upload">
                  {t("logo.upload")}
                </Button>
              </form>
              {o.logoKey ? (
                <form action={removeLogoAction}>
                  <input type="hidden" name="locale" value={locale} />
                  <Button type="submit" variant="ghost" size="sm">
                    {t("logo.remove")}
                  </Button>
                </form>
              ) : null}
            </div>
          ) : null}
          <p className="w-full text-[12px] text-ink-muted">{t("logo.hint")}</p>
          {logoResult && ["saved", "removed", "type", "size"].includes(logoResult) ? (
            <p
              role={logoResult === "saved" || logoResult === "removed" ? "status" : "alert"}
              className="w-full text-[13px]"
            >
              {t(`logo.results.${logoResult}`)}
            </p>
          ) : null}
        </div>
      </section>
      <CompanyForm locale={locale} initial={initial} editable={editable} />
    </div>
  );
}
