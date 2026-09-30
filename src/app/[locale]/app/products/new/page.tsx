import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ProductForm } from "@/components/products/ProductForm";
import { requireAppSession } from "@/server/auth/guard";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "app.products" });
  return { title: t("new"), robots: { index: false } };
}

export default async function NewProductPage({ params }: Props) {
  const { locale } = await params;
  await requireAppSession(locale);
  const t = await getTranslations({ locale, namespace: "app.products" });
  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-8">
      <h1 className="text-[28px] leading-tight">{t("new")}</h1>
      <ProductForm locale={locale} initial={{ unit: "hour", vatCode: "normal" }} />
    </div>
  );
}
