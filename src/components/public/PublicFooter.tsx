import { useLocale, useTranslations } from "next-intl";
import { AppMark } from "@/components/brand/AppMark";
import { Link } from "@/i18n/navigation";
import { guideLabels, guidesFor } from "@/lib/guides";
import { leadLoginHref } from "@/lib/lead-login";

/** Pied de page public. `back` : comme dans l'en-tête, la page ou l'invitation de l'écran d'erreur. */
export function PublicFooter({ back = {} }: { back?: Record<string, string> } = {}) {
  const t = useTranslations("footer");
  const apps = useTranslations("home.family.apps");
  const locale = useLocale();
  const guides = guidesFor(locale);
  /** La suite Lead : les sept sites, chacun avec sa ligne (liens simples, lus sans JavaScript). */
  const suite = [
    {
      name: "ERPlead",
      href: "https://erplead.io",
      mark: "EL",
      color: "bg-ink",
      line: t("suite.erplead"),
    },
    {
      name: "ScanLead",
      href: `https://scanlead.io/?lang=${locale}`,
      mark: "SL",
      color: "bg-scanlead",
      line: apps("scanlead"),
    },
    {
      name: "CRMlead",
      href: `https://crmlead.io/?lang=${locale}`,
      mark: "CL",
      color: "bg-crmlead",
      line: apps("crmlead"),
    },
    {
      name: "ProjectLead",
      href: "https://projectlead.io",
      mark: "PL",
      color: "bg-projectlead",
      line: apps("projectlead"),
    },
    {
      name: "InvoiceLead",
      href: `/${locale}`,
      mark: "IL",
      color: "bg-accent",
      line: apps("invoicelead"),
    },
    {
      name: "Greetlead",
      href: "https://greetlead.io",
      mark: "GL",
      color: "bg-[#c2185b]",
      line: apps("greetlead"),
    },
    {
      name: "VisitLead",
      href: "https://visitlead.io",
      mark: "VL",
      color: "bg-ink-2",
      line: t("suite.visitlead"),
    },
  ];
  const guideColumn = guides.length
    ? [
        {
          heading: guideLabels(locale).heading,
          links: guides.map((g) => ({
            href: `/${locale}/${g.slug}`,
            label: g.linkLabel,
            internal: false,
          })),
        },
      ]
    : [];
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
    ...guideColumn,
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
        { href: leadLoginHref(locale, false, back), label: t("login"), internal: false },
        { href: leadLoginHref(locale, true, back), label: t("signup"), internal: false },
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
          <div
            className={`grid grid-cols-2 gap-8 text-[13px] sm:gap-10 ${guides.length ? "lg:grid-cols-5" : "lg:grid-cols-4"}`}
          >
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
        <div className="mt-10 border-t border-line pt-6">
          <p className="mb-4 text-[10px] font-extrabold tracking-[.08em] text-ink-muted uppercase">
            {t("suite.title")}
          </p>
          <ul className="grid grid-cols-1 gap-x-6 gap-y-3 text-[13px] sm:grid-cols-2 lg:grid-cols-4">
            {suite.map((app) => (
              <li key={app.name}>
                <a href={app.href} className="group flex items-start gap-2.5">
                  <AppMark label={app.mark} className={`mt-0.5 h-6 w-6 text-[9px] ${app.color}`} />
                  <span>
                    <span className="block font-bold text-ink group-hover:text-accent">
                      {app.name}
                    </span>
                    <span className="block text-[12px] leading-snug text-ink-muted">
                      {app.line}
                    </span>
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </div>
        <div className="mt-8 border-t border-line pt-5 text-[11px] text-ink-muted">
          © {new Date().getFullYear()} InvoiceLead, Quantum Liquid LLC
        </div>
      </div>
    </footer>
  );
}
