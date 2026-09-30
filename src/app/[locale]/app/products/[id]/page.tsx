import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ProductForm } from "@/components/products/ProductForm";
import { Button } from "@/components/ui/button";
import { formatAmount } from "@/lib/money";
import { requireAppSession } from "@/server/auth/guard";
import { db } from "@/server/db";
import { getProduct } from "@/server/products";
import { archiveProductAction } from "../actions";

type Props = { params: Promise<{ locale: string; id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "app.products" });
  return { title: t("edit"), robots: { index: false } };
}

export default async function ProductPage({ params }: Props) {
  const { locale, id } = await params;
  const { organization } = await requireAppSession(locale);
  const product = await getProduct(db(), organization.id, id);
  if (!product || product.archivedAt) notFound();
  const t = await getTranslations({ locale, namespace: "app.products" });
  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-8">
      <h1 className="text-[28px] leading-tight">{product.name}</h1>
      <ProductForm
        currency={organization.currency}
        locale={locale}
        id={product.id}
        initial={{
          name: product.name,
          sku: product.sku ?? "",
          unit: product.unit,
          description: product.description ?? "",
          unitPrice: formatAmount(product.unitPriceCents),
          vatCode: product.vatCode,
        }}
      />
      <form action={archiveProductAction} className="mt-6">
        <input type="hidden" name="locale" value={locale} />
        <input type="hidden" name="id" value={product.id} />
        <Button type="submit" variant="ghost" data-testid="product-archive">
          {t("archive")}
        </Button>
      </form>
    </div>
  );
}
