import type { Metadata } from "next";
import { ProductForm } from "@/components/products/ProductForm";
import { requireAppSession } from "@/server/auth/guard";
import { getSessionCountryTranslations } from "@/server/country-translations";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getSessionCountryTranslations({ locale, namespace: "app.products" });
  return { title: t("new"), robots: { index: false } };
}

export default async function NewProductPage({ params }: Props) {
  const { locale } = await params;
  const { organization } = await requireAppSession(locale);
  const t = await getSessionCountryTranslations({ locale, namespace: "app.products" });
  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-8">
      <h1 className="text-[28px] leading-tight">{t("new")}</h1>
      <ProductForm
        locale={locale}
        currency={organization.currency}
        initial={{ unit: "hour", vatCode: "normal" }}
      />
    </div>
  );
}
