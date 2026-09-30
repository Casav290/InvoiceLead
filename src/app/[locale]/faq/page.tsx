import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { PublicFooter } from "@/components/public/PublicFooter";
import { PublicHeader } from "@/components/public/PublicHeader";

type Params = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "faq" });
  return { title: t("title") };
}

export default async function FaqPage({ params }: Params) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "faq" });
  const items = t.raw("items") as { q: string; a: string }[];
  return (
    <div className="flex min-h-screen flex-col">
      <PublicHeader />
      <main className="mx-auto w-full max-w-[820px] flex-1 px-4 py-12 sm:px-8">
        <h1 className="text-[30px] leading-tight sm:text-[38px]">{t("title")}</h1>
        <div className="mt-8 border-t border-line-strong">
          {items.map((item) => (
            <details key={item.q} className="group border-b border-line-strong bg-panel">
              <summary className="flex cursor-pointer list-none items-start justify-between gap-4 px-5 py-4 text-[15px] font-semibold">
                <span>{item.q}</span>
                <span aria-hidden="true" className="text-accent-dark group-open:rotate-45">
                  +
                </span>
              </summary>
              <p className="px-5 pb-5 text-[14px] leading-relaxed text-ink-2">{item.a}</p>
            </details>
          ))}
        </div>
      </main>
      <PublicFooter />
    </div>
  );
}
