import { useLocale, useTranslations } from "next-intl";
import { AppMark } from "@/components/brand/AppMark";
import { Link } from "@/i18n/navigation";
import { LanguageSwitcher } from "./LanguageSwitcher";

/** En-tête public en cellules, commun aux pages publiques (même dessin que Scanlead). */
export function PublicHeader() {
  const t = useTranslations("nav");
  const locale = useLocale();
  const links = [
    { href: `/${locale}#fonctions`, label: t("features") },
    { href: `/${locale}#famille`, label: t("family") },
  ];
  return (
    <header className="border-b border-line-strong bg-app">
      <div className="mx-auto flex min-h-[64px] max-w-6xl flex-wrap items-stretch px-4 sm:flex-nowrap sm:px-8">
        <Link
          href="/"
          className="flex min-h-12 w-full shrink-0 items-center gap-2.5 border-b border-line sm:min-h-0 sm:w-auto sm:border-r sm:border-b-0 sm:border-line-strong sm:pr-5"
        >
          <AppMark label="IL" />
          <span className="text-[16px] font-extrabold tracking-[-0.025em] text-accent">
            InvoiceLead
          </span>
        </Link>
        <nav className="hidden items-stretch sm:flex">
          {links.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="flex items-center border-r border-line-strong px-4 text-[13px] font-semibold text-ink-muted hover:text-ink"
            >
              {link.label}
            </a>
          ))}
        </nav>
        <div className="flex w-full items-center justify-between py-2 sm:ml-auto sm:w-auto sm:justify-start sm:py-0">
          <LanguageSwitcher className="border-r border-line-strong pr-1 sm:self-stretch sm:px-2" />
          <Link
            href="/login"
            className="border-r border-line-strong px-3 text-center text-[12px] font-semibold text-ink-muted hover:text-ink sm:px-4 sm:py-2 sm:text-[13px]"
          >
            {t("login")}
          </Link>
          <Link
            href="/signup"
            className="ml-2 whitespace-nowrap bg-accent px-3 py-2 text-[12px] font-bold text-white hover:bg-accent-dark sm:ml-3 sm:px-4 sm:text-[13px]"
          >
            {t("cta")}
          </Link>
        </div>
      </div>
    </header>
  );
}
