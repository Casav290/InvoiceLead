import { useTranslations } from "next-intl";
import { PublicFooter } from "@/components/public/PublicFooter";
import { PublicHeader } from "@/components/public/PublicHeader";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";

export default function NotFound() {
  const t = useTranslations("notFound");
  return (
    <div className="flex min-h-screen flex-col">
      <meta name="robots" content="noindex" />
      <title>{`${t("title")} · InvoiceLead`}</title>
      <PublicHeader />
      <main className="flex flex-1 items-start px-4 py-14 sm:py-20">
        <div className="mx-auto w-full max-w-[440px] border border-line-strong bg-panel px-6 py-6">
          <p className="text-[11px] font-extrabold tracking-[0.08em] text-ink-muted uppercase">
            404
          </p>
          <h1 className="mt-2 text-[24px] leading-tight">{t("title")}</h1>
          <p className="mt-2 text-[14px] leading-relaxed text-ink-muted">{t("body")}</p>
          <Button asChild className="mt-5">
            <Link href="/">{t("home")}</Link>
          </Button>
        </div>
      </main>
      <PublicFooter />
    </div>
  );
}
