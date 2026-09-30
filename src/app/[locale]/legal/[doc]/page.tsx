import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { PublicFooter } from "@/components/public/PublicFooter";
import { PublicHeader } from "@/components/public/PublicHeader";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { isLegalDoc, LEGAL_DOCS, legalHtml } from "@/lib/legal";

type Params = { params: Promise<{ locale: string; doc: string }> };

export const dynamicParams = false;

export function generateStaticParams() {
  return routing.locales.flatMap((locale) => LEGAL_DOCS.map((doc) => ({ locale, doc })));
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { locale, doc } = await params;
  if (!isLegalDoc(doc)) return {};
  const t = await getTranslations({ locale, namespace: "legal.titles" });
  return { title: t(doc) };
}

export default async function LegalPage({ params }: Params) {
  const { locale, doc } = await params;
  if (!isLegalDoc(doc)) notFound();
  const t = await getTranslations({ locale, namespace: "legal" });
  return (
    <div className="flex min-h-screen flex-col">
      <PublicHeader />
      <main className="mx-auto w-full max-w-[820px] flex-1 px-4 py-10 sm:px-8">
        <nav className="mb-6 flex items-center gap-2 text-[13px] text-ink-muted">
          <Link href="/" className="hover:text-ink">
            {t("home")}
          </Link>
          <span aria-hidden="true">›</span>
          <span className="text-ink-2">{t(`titles.${doc}`)}</span>
        </nav>
        <article
          className="legal-prose border border-line-strong bg-panel px-5 py-7 sm:px-9"
          // biome-ignore lint/security/noDangerouslySetInnerHtml: texte interne du dépôt (content/legal), rendu au build
          dangerouslySetInnerHTML={{ __html: legalHtml(doc, locale) }}
        />
      </main>
      <PublicFooter />
    </div>
  );
}
