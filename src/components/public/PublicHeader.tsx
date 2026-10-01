import { useLocale, useTranslations } from "next-intl";
import { AppMark } from "@/components/brand/AppMark";
import { Link } from "@/i18n/navigation";
import { leadLoginHref } from "@/lib/lead-login";
import { LanguageSwitcher } from "./LanguageSwitcher";

/**
 * En-tête public en cellules, commun aux pages publiques (même dessin que Scanlead). Sur l'écran
 * d'erreur de la connexion : `back` (page demandée ou invitation) suit « Connexion » et « Créer un
 * compte », et `langQuery` garde l'écran, sa page et son invitation dans l'autre langue. Sans eux,
 * des liens simples, comme sur toutes les autres pages.
 */
export function PublicHeader({
  back = {},
  langQuery,
}: {
  back?: Record<string, string>;
  langQuery?: Partial<Record<string, Record<string, string>>>;
} = {}) {
  const t = useTranslations("nav");
  const locale = useLocale();
  const links = [
    { href: `/${locale}#fonctions`, label: t("features") },
    { href: `/${locale}/pricing`, label: t("pricing") },
    { href: `/${locale}/faq`, label: t("faq") },
  ];
  return (
    <header className="border-b border-line-strong bg-app">
      <div className="mx-auto flex min-h-[64px] max-w-6xl flex-wrap items-stretch px-4 sm:flex-nowrap sm:px-8">
        <Link
          href="/"
          className="flex min-h-12 w-full shrink-0 items-center gap-2.5 border-b border-line sm:min-h-0 sm:w-auto sm:border-r sm:border-b-0 sm:border-line-strong sm:pr-5"
        >
          <AppMark label="IL" />
          <span className="text-[16px] font-extrabold tracking-[-0.025em] text-accent-dark">
            InvoiceLead
          </span>
        </Link>
        <nav className="hidden items-stretch sm:flex">
          {links.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="flex items-center border-r border-line-strong px-3 text-[13px] font-semibold text-ink-muted hover:text-ink lg:px-4"
            >
              {link.label}
            </a>
          ))}
        </nav>
        <div className="flex w-full flex-wrap items-center justify-between gap-y-2 py-2 sm:ml-auto sm:w-auto sm:flex-nowrap sm:justify-start sm:py-0">
          <LanguageSwitcher
            className="border-r border-line-strong pr-1 sm:self-stretch sm:px-2"
            query={langQuery}
          />
          <a
            href={leadLoginHref(locale, false, back)}
            className="border-r border-line-strong px-3 text-center text-[12px] font-semibold text-ink-muted hover:text-ink sm:px-4 sm:py-2 sm:text-[13px]"
          >
            {t("login")}
          </a>
          <a
            href={leadLoginHref(locale, true, back)}
            className="ml-2 bg-accent px-3 py-2 text-center text-[12px] font-bold text-white hover:bg-accent-dark sm:ml-3 sm:px-4 sm:text-[13px] sm:whitespace-nowrap"
          >
            {t("cta")}
          </a>
        </div>
        <nav className="flex w-full border-t border-line sm:hidden">
          {links.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="flex min-w-0 flex-1 items-center justify-center border-r border-line px-1 py-2 text-center text-[11px] font-semibold text-ink-muted last:border-r-0"
            >
              {link.label}
            </a>
          ))}
        </nav>
      </div>
    </header>
  );
}
