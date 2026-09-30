import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Button } from "@/components/ui/button";
import { countryPack } from "@/countries";
import { formatRate, type VatCode, vatRateBp } from "@/countries/ch/vat";
import { Link } from "@/i18n/navigation";
import { formatAmount } from "@/lib/money";
import { requireAppSession } from "@/server/auth/guard";
import { db } from "@/server/db";
import { listProducts } from "@/server/products";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ q?: string; saved?: string; archived?: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "app.products" });
  return { title: t("title"), robots: { index: false } };
}

export default async function ProductsPage({ params, searchParams }: Props) {
  const { locale } = await params;
  const { organization } = await requireAppSession(locale);
  const { q = "", saved, archived } = await searchParams;
  const t = await getTranslations({ locale, namespace: "app.products" });
  const rows = await listProducts(db(), organization.id, q.slice(0, 100));
  const today = new Date().toISOString().slice(0, 10);
  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="text-[28px] leading-tight">{t("title")}</h1>
        <Button asChild>
          <Link href="/app/products/new" data-testid="product-new">
            {t("new")}
          </Link>
        </Button>
      </div>
      {saved ? (
        <p
          role="status"
          className="mt-6 border border-ok-fg bg-ok-bg px-4 py-3 text-[13px] text-ok-fg"
        >
          {t("saved")}
        </p>
      ) : null}
      {archived ? (
        <p
          role="status"
          className="mt-6 border border-line-strong bg-panel px-4 py-3 text-[13px] text-ink-2"
        >
          {t("archived")}
        </p>
      ) : null}
      <form className="mt-6 flex gap-2" role="search">
        <label htmlFor="products-q" className="sr-only">
          {t("search")}
        </label>
        <input
          id="products-q"
          name="q"
          defaultValue={q}
          placeholder={t("search")}
          className="h-10 w-full max-w-sm border border-line-strong bg-panel px-3 text-[14px]"
        />
        <Button type="submit" variant="secondary">
          {t("searchButton")}
        </Button>
      </form>
      {rows.length === 0 ? (
        <p className="mt-8 border border-line-strong bg-panel px-5 py-8 text-center text-[14px] text-ink-muted">
          {q ? t("noResults") : t("empty")}
        </p>
      ) : (
        <div className="mt-6 overflow-x-auto border border-line-strong bg-panel">
          <table className="w-full text-left text-[14px]">
            <thead>
              <tr className="border-b border-line-strong bg-head text-[10.5px] font-extrabold tracking-[0.09em] text-ink-muted uppercase">
                <th className="px-4 py-2.5">{t("columns.name")}</th>
                <th className="hidden px-4 py-2.5 sm:table-cell">{t("columns.unit")}</th>
                <th className="px-4 py-2.5 text-right">
                  {t("columns.price", { currency: organization.currency })}
                </th>
                <th className="px-4 py-2.5 text-right">{t("columns.vat")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr
                  key={p.id}
                  className="border-b border-line-soft last:border-b-0 hover:bg-rowhover"
                >
                  <td className="px-4 py-3">
                    <Link
                      href={`/app/products/${p.id}`}
                      className="font-semibold text-accent-dark hover:underline"
                    >
                      {p.name}
                    </Link>
                    {p.sku ? (
                      <span className="ml-2 text-[12px] text-ink-muted">{p.sku}</span>
                    ) : null}
                  </td>
                  <td className="hidden px-4 py-3 text-ink-2 sm:table-cell">
                    {t(`units.${p.unit}`)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {formatAmount(p.unitPriceCents, countryPack(organization.country).amounts)}
                  </td>
                  <td className="px-4 py-3 text-right text-ink-2">
                    {formatRate(vatRateBp(p.vatCode as VatCode, today), locale)}
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
