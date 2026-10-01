import { useLocale, useTranslations } from "next-intl";
import { AppMark } from "@/components/brand/AppMark";
import { Link } from "@/i18n/navigation";
import { leadLoginHref } from "@/lib/lead-login";

export function PublicFooter() {
  const t = useTranslations("footer");
  const locale = useLocale();
  const columns = [
    {
      heading: t("product"),
      links: [
        { href: "/", label: t("home"), internal: true },
        { href: `/${locale}#fonctions`, label: t("features"), internal: false },
        { href: "/pricing", label: t("pricing"), internal: true },
        { href: "/faq", label: t("faq"), internal: true },
      ],
    },
    {
      heading: t("family"),
      links: [
        { href: `https://scanlead.io/?lang=${locale}`, label: t("scanlead"), internal: false },
        { href: `https://crmlead.io/?lang=${locale}`, label: t("crmlead"), internal: false },
      ],
    },
    {
      heading: t("legal"),
      links: [
        { href: "/legal/imprint", label: t("imprint"), internal: true },
        { href: "/legal/privacy", label: t("privacy"), internal: true },
        { href: "/legal/terms", label: t("terms"), internal: true },
        { href: "/legal/dpa", label: t("dpa"), internal: true },
      ],
    },
    {
      heading: t("account"),
      links: [
        { href: leadLoginHref(locale), label: t("login"), internal: false },
        { href: leadLoginHref(locale, true), label: t("signup"), internal: false },
      ],
    },
  ];
  return (
    <footer className="border-t border-line-strong bg-app">
      <div className="mx-auto max-w-6xl px-4 py-12 sm:px-8">
        <div className="flex flex-col gap-10 sm:flex-row sm:justify-between">
          <Link href="/" className="flex h-fit items-center gap-2.5">
            <AppMark label="IL" />
            <span className="text-[14px] font-extrabold tracking-[-0.025em] text-ink">
              InvoiceLead
            </span>
          </Link>
          <div className="grid grid-cols-2 gap-8 text-[13px] sm:gap-10 lg:grid-cols-4">
            {columns.map((column) => (
              <div key={column.heading}>
                <p className="mb-3 text-[10px] font-extrabold tracking-[.08em] text-ink-muted uppercase">
                  {column.heading}
                </p>
                <ul className="space-y-2">
                  {column.links.map((link) => (
                    <li key={link.href}>
                      {link.internal ? (
                        <Link href={link.href} className="text-ink-muted hover:text-accent">
                          {link.label}
                        </Link>
                      ) : (
                        <a href={link.href} className="text-ink-muted hover:text-accent">
                          {link.label}
                        </a>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
        <div className="mt-10 border-t border-line pt-5 text-[11px] text-ink-muted">
          © {new Date().getFullYear()} InvoiceLead, Quantum Liquid LLC
        </div>
      </div>
    </footer>
  );
}
