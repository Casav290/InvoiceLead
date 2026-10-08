import "@/components/landing/landing.css";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { AppMark } from "@/components/brand/AppMark";
import { type FeatureTab, FeatureTabs } from "@/components/landing/FeatureTabs";
import { HeroInvoice, type HeroInvoiceCopy } from "@/components/landing/HeroInvoice";
import { LandingMotion } from "@/components/landing/LandingMotion";
import { Frame, Phone, Shot } from "@/components/landing/Shot";
import { PublicFooter } from "@/components/public/PublicFooter";
import { PublicHeader } from "@/components/public/PublicHeader";
import { Button } from "@/components/ui/button";
import { routing } from "@/i18n/routing";
import { leadLoginHref } from "@/lib/lead-login";
import { PLANS } from "@/server/plans";

type Params = { params: Promise<{ locale: string }> };

const OG_LOCALE: Record<string, string> = { de: "de_CH", fr: "fr_CH", en: "en_GB" };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "meta" });
  const image = { url: `/landing/og-${locale}.jpg`, width: 1200, height: 630, alt: t("title") };
  return {
    alternates: {
      canonical: `/${locale}`,
      languages: {
        ...Object.fromEntries(routing.locales.map((l) => [l, `/${l}`])),
        "x-default": "/",
      },
    },
    openGraph: {
      type: "website",
      url: `/${locale}`,
      siteName: "InvoiceLead",
      title: t("title"),
      description: t("description"),
      locale: OG_LOCALE[locale],
      alternateLocale: routing.locales.filter((l) => l !== locale).map((l) => OG_LOCALE[l] ?? l),
      images: [image],
    },
    twitter: {
      card: "summary_large_image",
      title: t("title"),
      description: t("description"),
      images: [image.url],
    },
  };
}

/** Onglets des fonctions : clé des textes, capture, adresse montrée dans le cadre, formule. */
const TABS = [
  { key: "quotes", shot: "quote-desktop", path: "app/quotes", pro: false },
  { key: "qr", shot: "invoice-pdf", path: "app/invoices", pro: false },
  { key: "reminders", shot: "reminders-desktop", path: "app/invoices/reminders", pro: false },
  { key: "receipts", shot: "expenses-desktop", path: "app/expenses", pro: false },
  { key: "bills", shot: "bills-desktop", path: "app/accounting/bills", pro: false },
  { key: "bank", shot: "bank-desktop", path: "app/accounting/bank", pro: false },
  { key: "vat", shot: "vat-desktop", path: "app/accounting/vat", pro: true },
  { key: "time", shot: "time-desktop", path: "app/time", pro: false },
] as const;

/** Points forts suisses ; ceux de la formule Pro portent sa marque. */
const SWISS_PRO = [false, true, true, false, false, false, true, true];

const FAMILY = [
  { key: "scanlead", mark: "SL", color: "bg-scanlead", href: "https://scanlead.io/?lang=" },
  { key: "crmlead", mark: "CL", color: "bg-crmlead", href: "https://crmlead.io/?lang=" },
  { key: "projectlead", mark: "PL", color: "bg-projectlead", href: "https://projectlead.io" },
  { key: "invoicelead", mark: "IL", color: "bg-accent", href: null },
  { key: "greetlead", mark: "GL", color: "bg-[#c2185b]", href: "https://greetlead.io" },
] as const;

const NAMES: Record<(typeof FAMILY)[number]["key"], string> = {
  scanlead: "Scanlead",
  crmlead: "CRMlead",
  projectlead: "ProjectLead",
  invoicelead: "InvoiceLead",
  greetlead: "Greetlead",
};

/** Questions de la FAQ reprises sur l'accueil (index dans faq.items). */
const FAQ_ITEMS = [0, 7, 4, 6];

/** Taux normal de TVA écrit dans chaque langue. */
const VAT_RATE: Record<string, string> = { de: "8,1 %", fr: "8,1\u202f%", en: "8.1%" };

const free = PLANS.free;
const pro = PLANS.pro;

export default async function HomePage({ params }: Params) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "home" });
  const tFaq = await getTranslations({ locale, namespace: "faq" });
  const tMeta = await getTranslations({ locale, namespace: "meta" });
  const signup = leadLoginHref(locale, true);
  const host = `invoicelead.io/${locale}`;

  const doc = t.raw("doc") as Omit<HeroInvoiceCopy, "rows"> & {
    rows: HeroInvoiceCopy["rows"];
  };

  const tabs: FeatureTab[] = TABS.map((tab) => ({
    key: tab.key,
    label: t(`features.tabs.${tab.key}.label`),
    title: t(`features.tabs.${tab.key}.title`),
    points: (t.raw(`features.tabs.${tab.key}.points`) as string[]).map((p) =>
      p.replace("{n}", String(free.quotas.aiReads)),
    ),
    pro: tab.pro ? t("features.pro") : null,
    shot: (
      <Frame url={`${host}/${tab.path}`}>
        {tab.shot === "invoice-pdf" ? (
          <div className="flex aspect-[16/10] justify-center overflow-hidden bg-muted px-[8%] pt-[3%]">
            <Shot
              locale={locale}
              name={tab.shot}
              alt={t(`features.tabs.${tab.key}.alt`)}
              sizes="(min-width: 1200px) 760px, 84vw"
              className="h-full w-full max-w-[760px] border border-b-0 border-line-strong"
              imgClassName="lp-pan h-full"
            />
          </div>
        ) : (
          <Shot
            locale={locale}
            name={tab.shot}
            alt={t(`features.tabs.${tab.key}.alt`)}
            sizes="(min-width: 1200px) 1024px, 100vw"
          />
        )}
      </Frame>
    ),
  }));

  const faq = (tFaq.raw("items") as { q: string; a: string }[]).filter((_, i) =>
    FAQ_ITEMS.includes(i),
  );

  const pricingRows: { key: string; label: string; free: string; pro: string }[] = [
    {
      key: "invoices",
      label: t("pricing.rows.invoices.label"),
      free: t("pricing.rows.invoices.free", { n: free.quotas.invoices }),
      pro: t("pricing.unlimited"),
    },
    {
      key: "aiReads",
      label: t("pricing.rows.aiReads.label"),
      free: t("pricing.rows.aiReads.free", { n: free.quotas.aiReads }),
      pro: t("pricing.rows.aiReads.pro", { n: pro.quotas.aiReads }),
    },
    {
      key: "assistant",
      label: t("pricing.rows.assistant.label"),
      free: t("pricing.rows.assistant.free", { n: free.quotas.assistant }),
      pro: t("pricing.unlimited"),
    },
    {
      key: "reminders",
      label: t("pricing.rows.reminders.label"),
      free: t("pricing.rows.reminders.free", { n: free.quotas.reminders }),
      pro: t("pricing.rows.reminders.pro"),
    },
    {
      key: "bank",
      label: t("pricing.rows.bank.label"),
      free: t("pricing.rows.bank.free", { n: free.quotas.bankImports }),
      pro: t("pricing.unlimited"),
    },
    {
      key: "recurring",
      label: t("pricing.rows.recurring.label"),
      free: t("pricing.rows.recurring.free", { n: free.quotas.recurring }),
      pro: t("pricing.unlimited"),
    },
    {
      key: "vat",
      label: t("pricing.rows.vat.label"),
      free: t("pricing.rows.vat.free"),
      pro: t("pricing.rows.vat.pro"),
    },
    {
      key: "seats",
      label: t("pricing.rows.seats.label"),
      free: t("pricing.rows.seats.free", { n: free.seats }),
      pro: t("pricing.rows.seats.pro", { n: pro.seats }),
    },
  ];

  const jsonLd = [
    {
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      name: "InvoiceLead",
      url: `https://invoicelead.io/${locale}`,
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web",
      inLanguage: locale,
      description: tMeta("description"),
      offers: [
        { "@type": "Offer", name: t("pricing.free"), price: "0", priceCurrency: "EUR" },
        { "@type": "Offer", name: t("pricing.pro"), price: "19", priceCurrency: "EUR" },
      ],
      publisher: { "@type": "Organization", name: "Quantum Liquid LLC" },
    },
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: faq.map((item) => ({
        "@type": "Question",
        name: item.q,
        acceptedAnswer: { "@type": "Answer", text: item.a },
      })),
    },
  ];

  return (
    <div className="flex min-h-screen flex-col overflow-x-clip">
      <PublicHeader />
      <main className="flex-1">
        {/* Héros : le titre à gauche, la facture QR qui se construit à droite. */}
        <section className="border-b border-line-strong">
          <div className="mx-auto grid max-w-6xl grid-cols-1 items-center gap-12 px-4 pt-12 pb-16 sm:px-8 md:pt-16 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] lg:gap-14 lg:pb-20">
            <div>
              <a
                href="#tab-bills"
                className="mb-7 inline-flex max-w-full items-stretch border border-line-strong bg-panel text-[13px] hover:border-accent"
              >
                <span className="flex items-center bg-accent px-2.5 text-[11px] font-extrabold tracking-[0.05em] text-white uppercase">
                  {t("news")}
                </span>
                <span className="px-3 py-1.5 font-semibold text-ink-2">{t("newsText")}</span>
              </a>
              <h1 className="text-[clamp(31px,9.6vw,40px)] leading-[0.98] font-black tracking-[-0.035em] text-ink sm:text-[54px] lg:text-[56px] xl:text-[64px]">
                <span className="block">{t("title1")}</span>
                <span className="block text-accent-dark">{t("title2")}</span>
              </h1>
              <p className="mt-6 max-w-[58ch] text-[17px] leading-relaxed text-ink-2 sm:text-[18px]">
                {t("lede")}
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Button asChild size="lg">
                  <a href={signup}>{t("ctaPrimary")}</a>
                </Button>
                <Button asChild size="lg" variant="secondary">
                  <a href="#apercu">{t("ctaSecondary")}</a>
                </Button>
              </div>
              <p className="mt-5 max-w-[60ch] text-[13px] leading-relaxed text-ink-muted">
                {t("fine")}
              </p>
            </div>
            <div className="mx-auto w-full max-w-[540px] lg:mr-0">
              <HeroInvoice copy={doc} />
            </div>
          </div>
        </section>

        {/* La formule gratuite en quatre chiffres. */}
        <section aria-label={t("stats.label")} className="border-b border-line-strong bg-panel">
          <div
            data-cells
            className="mx-auto grid max-w-6xl grid-cols-2 border-line sm:px-8 lg:grid-cols-4"
          >
            {[
              { n: free.quotas.invoices, label: t("stats.invoices") },
              { n: free.quotas.aiReads, label: t("stats.aiReads") },
              { n: 3, label: t("stats.reminders") },
              { n: 4, label: t("stats.languages") },
            ].map((stat, i) => (
              <div
                key={stat.label}
                className={`flex flex-col gap-1.5 border-line px-4 py-6 sm:px-6 sm:py-8 ${
                  i % 2 === 0 ? "border-r" : "lg:border-r"
                } ${i < 2 ? "border-b lg:border-b-0" : ""} ${i === 3 ? "lg:border-r-0" : ""}`}
              >
                <span
                  data-count={stat.n}
                  className="text-[44px] leading-none font-black tracking-[-0.03em] text-ink tabular-nums sm:text-[56px]"
                >
                  {stat.n}
                </span>
                <span className="max-w-[26ch] text-[14px] leading-snug text-ink-3">
                  {stat.label}
                </span>
              </div>
            ))}
          </div>
        </section>

        {/* Aperçu : le tableau de bord se redresse en entrant à l'écran. */}
        <section id="apercu" className="scroll-mt-4 border-b border-line-strong">
          <div className="mx-auto max-w-6xl px-4 pt-16 pb-20 sm:px-8 md:pt-24">
            <div className="grid grid-cols-1 gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] md:items-end md:gap-12">
              <h2
                data-reveal
                className="text-[30px] leading-[1.05] font-extrabold text-ink sm:text-[40px] lg:text-[46px]"
              >
                {t("overview.title")}
              </h2>
              <p
                data-reveal
                data-reveal-delay="120"
                className="max-w-[56ch] text-[16px] leading-relaxed text-ink-2 sm:text-[17px]"
              >
                {t("overview.body")}
              </p>
            </div>
            <div className="relative mt-12">
              {/* Téléphone : la capture mobile, lisible ; dès la tablette, l'écran complet. */}
              <div className="mx-auto w-full max-w-[270px] md:hidden">
                <Phone>
                  <Shot
                    locale={locale}
                    name="dashboard-mobile"
                    alt={t("overview.mobileAlt")}
                    sizes="270px"
                  />
                </Phone>
              </div>
              <div className="lp-tilt hidden md:block">
                <Frame url={`${host}/app`}>
                  <Shot
                    locale={locale}
                    name="dashboard-desktop"
                    alt={t("overview.alt")}
                    sizes="(min-width: 1200px) 1090px, 100vw"
                  />
                </Frame>
              </div>
              <div className="lp-drift absolute -right-2 -bottom-20 hidden w-[190px] md:block lg:-right-16 lg:-bottom-24 lg:w-[230px]">
                <Phone>
                  <Shot
                    locale={locale}
                    name="dashboard-mobile"
                    alt={t("overview.mobileAlt")}
                    sizes="230px"
                  />
                </Phone>
              </div>
            </div>
            <ul
              data-cells
              className="mt-8 grid border border-line-strong bg-panel sm:grid-cols-3 md:mr-[200px] lg:mr-[180px]"
            >
              {(t.raw("overview.legend") as string[]).map((item, i) => (
                <li
                  key={item}
                  className="flex items-center gap-3 border-b border-line px-5 py-4 text-[14px] font-semibold text-ink-2 last:border-b-0 sm:border-r sm:border-b-0 sm:last:border-r-0"
                >
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center border border-accent text-[11px] font-extrabold text-accent-dark tabular-nums">
                    {i + 1}
                  </span>
                  {item}
                </li>
              ))}
            </ul>
            <p className="mt-3 text-[12px] text-ink-muted">{t("sample")}</p>
          </div>
        </section>

        {/* Fonctions : onglets qui avancent seuls, capture de l'écran correspondant. */}
        <section id="fonctions" className="scroll-mt-4 border-b border-line-strong bg-strip">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-8 md:py-24">
            <div className="mb-10 max-w-3xl">
              <h2
                data-reveal
                className="text-[30px] leading-[1.05] font-extrabold text-ink sm:text-[40px] lg:text-[46px]"
              >
                {t("features.title")}
              </h2>
              <p data-reveal data-reveal-delay="120" className="mt-4 text-[17px] text-ink-2">
                {t("features.body")}
              </p>
            </div>
            <div data-reveal>
              <FeatureTabs tabs={tabs} label={t("features.tablist")} />
            </div>
            <p className="mt-3 text-[12px] text-ink-muted">{t("sample")}</p>
          </div>
        </section>

        {/* Le ticket en photo : téléphone, ticket lu par l'IA, trois gestes. */}
        <section id="photo" className="scroll-mt-4 border-b border-line-strong">
          <div className="mx-auto grid max-w-6xl grid-cols-1 gap-12 px-4 py-16 sm:px-8 md:py-24 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:items-center lg:gap-16">
            <div>
              <h2
                data-reveal
                className="text-[30px] leading-[1.05] font-extrabold text-ink sm:text-[40px] lg:text-[46px]"
              >
                {t("photo.title")}
              </h2>
              <p
                data-reveal
                data-reveal-delay="120"
                className="mt-5 max-w-[56ch] text-[17px] leading-relaxed text-ink-2"
              >
                {t("photo.body")}
              </p>
              <ol data-cells className="mt-8 grid border border-line-strong bg-panel">
                {(t.raw("photo.steps") as { title: string; body: string }[]).map((step, i) => (
                  <li
                    key={step.title}
                    className="grid grid-cols-[auto_1fr] gap-x-4 border-b border-line px-5 py-4 last:border-b-0"
                  >
                    <span className="row-span-2 flex h-7 w-7 items-center justify-center bg-accent text-[12px] font-extrabold text-white tabular-nums">
                      {i + 1}
                    </span>
                    <span className="text-[16px] font-bold text-ink">{step.title}</span>
                    <span className="text-[14px] leading-relaxed text-ink-3">{step.body}</span>
                  </li>
                ))}
              </ol>
            </div>
            <div className="grid items-end gap-6 sm:grid-cols-[minmax(0,240px)_minmax(0,1fr)] sm:gap-8">
              <div data-reveal className="mx-auto w-full max-w-[240px]">
                <Phone>
                  <Shot locale={locale} name="capture-mobile" alt={t("photo.alt")} sizes="240px" />
                </Phone>
              </div>
              <ReadTicket
                items={t.raw("photo.ticket.items") as string[]}
                labels={{
                  total: t("photo.ticket.total"),
                  vatIncl: t("photo.ticket.vatIncl"),
                  card: t("photo.ticket.card"),
                  thanks: t("photo.ticket.thanks"),
                  title: t("photo.read.title"),
                }}
                read={[
                  { label: t("photo.read.supplier"), value: "Brico Seeland" },
                  { label: t("photo.read.date"), value: "06.10.2026" },
                  { label: t("photo.read.amount"), value: "CHF 86.35" },
                  { label: t("photo.read.vat"), value: `CHF 6.47 (${VAT_RATE[locale] ?? "8.1%"})` },
                  { label: t("photo.read.account"), value: t("photo.read.accountValue") },
                ]}
              />
            </div>
          </div>
        </section>

        {/* Points forts suisses, en cellules. */}
        <section className="border-b border-line-strong bg-panel">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-8 md:py-24">
            <h2
              data-reveal
              className="max-w-3xl text-[30px] leading-[1.05] font-extrabold text-ink sm:text-[40px] lg:text-[46px]"
            >
              {t("swiss.title")}
            </h2>
            <div
              data-cells
              className="mt-10 grid border-t border-l border-line-strong sm:grid-cols-2 lg:grid-cols-4"
            >
              {(t.raw("swiss.items") as { title: string; body: string }[]).map((item, i) => (
                <div
                  key={item.title}
                  className="flex flex-col gap-2 border-r border-b border-line-strong bg-paper p-5 sm:p-6"
                >
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="text-[16px] leading-snug font-extrabold text-ink">
                      {item.title}
                    </h3>
                    {SWISS_PRO[i] ? (
                      <span className="shrink-0 border-l-[3px] border-accent bg-accent-pale px-1.5 py-[2px] text-[10px] font-extrabold tracking-[0.05em] text-accent-dark uppercase">
                        Pro
                      </span>
                    ) : null}
                  </div>
                  <p className="text-[14px] leading-relaxed text-ink-3">{item.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Gratuit ou Pro : les allocations, tirées des formules. */}
        <section id="tarifs" className="scroll-mt-4 border-b border-line-strong">
          <div className="mx-auto grid max-w-6xl grid-cols-1 gap-10 px-4 py-16 sm:px-8 md:py-24 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:gap-14">
            <div>
              <h2
                data-reveal
                className="text-[30px] leading-[1.05] font-extrabold text-ink sm:text-[40px] lg:text-[46px]"
              >
                {t("pricing.title")}
              </h2>
              <p data-reveal className="mt-5 text-[17px] leading-relaxed text-ink-2">
                {t("pricing.body")}
              </p>
              <p className="mt-6 text-[13px] leading-relaxed text-ink-muted">{t("pricing.note")}</p>
              <a
                href={`/${locale}/pricing`}
                className="mt-5 inline-flex min-h-11 items-center border border-line-strong bg-panel px-4 text-[14px] font-bold text-ink hover:border-accent hover:bg-muted"
              >
                {t("pricing.more")}
              </a>
            </div>
            <div data-reveal className="border border-line-strong bg-panel">
              <table className="w-full table-fixed border-collapse text-[13px] [overflow-wrap:break-word] hyphens-auto sm:text-[14px]">
                <colgroup>
                  <col className="w-[38%]" />
                  <col className="w-[31%]" />
                  <col className="w-[31%]" />
                </colgroup>
                <thead>
                  <tr>
                    <th className="border-r border-b border-line-strong bg-head px-3 py-3 sm:px-4 text-left text-[10.5px] font-extrabold tracking-[0.09em] text-ink-muted uppercase">
                      {t("pricing.what")}
                    </th>
                    <th className="border-r border-b border-line-strong bg-head px-3 py-3 sm:px-4 text-left align-bottom">
                      <span className="block text-[15px] font-extrabold text-ink">
                        {t("pricing.free")}
                      </span>
                      <span className="text-[13px] font-semibold text-ink-muted">
                        {t("pricing.freePrice")}
                      </span>
                    </th>
                    <th className="border-b border-line-strong bg-accent-veil px-3 py-3 sm:px-4 text-left align-bottom">
                      <span className="block text-[15px] font-extrabold text-accent-dark">
                        {t("pricing.pro")}
                      </span>
                      <span className="text-[13px] font-semibold text-ink-3">
                        {t("pricing.proPrice")}
                      </span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {pricingRows.map((row) => (
                    <tr key={row.key}>
                      <th
                        scope="row"
                        className="border-r border-b border-line-soft px-3 py-3 sm:px-4 text-left font-bold text-ink"
                      >
                        {row.label}
                      </th>
                      <td className="border-r border-b border-line-soft px-3 py-3 sm:px-4 text-ink-2">
                        {row.free}
                      </td>
                      <td className="border-b border-line-soft bg-accent-veil px-3 py-3 sm:px-4 font-semibold text-ink">
                        {row.pro}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* Famille Lead : un compte ERPlead. */}
        <section id="famille" className="border-b border-line-strong bg-panel">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-8 md:py-20">
            <div className="grid grid-cols-1 gap-5 md:grid-cols-2 md:items-end md:gap-12">
              <h2
                data-reveal
                className="text-[30px] leading-[1.05] font-extrabold text-ink sm:text-[40px]"
              >
                {t("family.title")}
              </h2>
              <p data-reveal className="max-w-[56ch] text-[16px] leading-relaxed text-ink-2">
                {t("family.body")}
              </p>
            </div>
            <ul
              data-cells
              className="mt-10 grid grid-cols-1 border border-line-strong sm:grid-cols-5"
            >
              {FAMILY.map((app) => {
                const body = (
                  <>
                    <span className="flex items-center gap-2.5">
                      <AppMark label={app.mark} className={`h-8 w-8 text-[12px] ${app.color}`} />
                      <span className="text-[15px] font-extrabold text-ink">{NAMES[app.key]}</span>
                    </span>
                    <span className="text-[13px] leading-snug text-ink-3">
                      {t(`family.apps.${app.key}`)}
                    </span>
                    {app.href ? null : (
                      <span className="mt-auto w-fit border-l-[3px] border-accent bg-accent-pale px-2 py-[2px] text-[10.5px] font-extrabold tracking-[0.05em] text-accent-dark uppercase">
                        {t("family.here")}
                      </span>
                    )}
                  </>
                );
                return (
                  <li
                    key={app.key}
                    className="border-b border-line last:border-b-0 sm:border-r sm:border-b-0 sm:last:border-r-0"
                  >
                    {app.href ? (
                      <a
                        href={
                          app.key === "scanlead" || app.key === "crmlead"
                            ? `${app.href}${locale}`
                            : app.href
                        }
                        className="flex h-full flex-col gap-3 p-5 hover:bg-muted"
                      >
                        {body}
                      </a>
                    ) : (
                      <div className="flex h-full flex-col gap-3 bg-accent-veil p-5">{body}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        </section>

        {/* Quatre questions, les autres sur la page FAQ. */}
        <section className="border-b border-line-strong">
          <div className="mx-auto grid max-w-6xl grid-cols-1 gap-8 px-4 py-16 sm:px-8 md:py-20 lg:grid-cols-[minmax(0,0.7fr)_minmax(0,1.3fr)]">
            <div>
              <h2 className="text-[30px] leading-[1.05] font-extrabold text-ink sm:text-[40px]">
                {t("faq.title")}
              </h2>
              <a
                href={`/${locale}/faq`}
                className="mt-5 inline-flex min-h-11 items-center border border-line-strong bg-panel px-4 text-[14px] font-bold text-ink hover:border-accent hover:bg-muted"
              >
                {t("faq.more")}
              </a>
            </div>
            <div className="border border-line-strong bg-panel">
              {faq.map((item, i) => (
                <details
                  key={item.q}
                  open={i === 0}
                  className="group border-b border-line last:border-b-0"
                >
                  <summary className="flex cursor-pointer list-none items-start justify-between gap-4 px-5 py-4 text-[15px] font-bold text-ink hover:bg-muted [&::-webkit-details-marker]:hidden">
                    <span>{item.q}</span>
                    <span
                      aria-hidden="true"
                      className="text-[18px] leading-none text-accent-dark transition-transform group-open:rotate-45"
                    >
                      +
                    </span>
                  </summary>
                  <p className="max-w-[70ch] px-5 pb-5 text-[14px] leading-relaxed text-ink-2">
                    {item.a}
                  </p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* Dernier appel : un bloc prune plein, la seule surface de couleur de la page. */}
        <section className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-8 md:py-20">
          <div
            data-reveal
            className="grid border border-accent-dark bg-accent text-white md:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]"
          >
            <div className="flex flex-col gap-5 p-7 sm:p-10">
              <h2 className="text-[32px] leading-[1.02] font-black tracking-[-0.03em] sm:text-[44px]">
                {t("final.title")}
              </h2>
              <p className="max-w-[52ch] text-[16px] leading-relaxed text-white/90">
                {t("final.body")}
              </p>
              <div className="flex flex-wrap gap-3">
                <a
                  href={signup}
                  className="inline-flex h-12 items-center bg-white px-6 text-[15px] font-bold text-accent-dark hover:bg-accent-pale"
                >
                  {t("final.cta")}
                </a>
                <a
                  href={`/${locale}/pricing`}
                  className="inline-flex h-12 items-center border border-white/70 px-6 text-[15px] font-bold text-white hover:bg-accent-dark"
                >
                  {t("final.secondary")}
                </a>
              </div>
            </div>
            <div aria-hidden="true" className="hidden grid-cols-3 border-l border-white/25 md:grid">
              {["SL", "CL", "PL", "IL", "GL", "EL"].map((mark) => (
                <span
                  key={mark}
                  className={`flex items-center justify-center border-white/25 text-[26px] font-black tracking-[0.02em] ${
                    mark === "IL" ? "bg-white text-accent-dark" : "border-r border-b text-white/80"
                  }`}
                >
                  {mark}
                </span>
              ))}
            </div>
          </div>
        </section>
      </main>
      <PublicFooter />
      <LandingMotion />
      <script
        type="application/ld+json"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: données structurées écrites ici, « < » échappé
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }}
      />
    </div>
  );
}

/** Ticket de caisse fictif lu par l'IA : la barre de lecture passe, les champs se remplissent. */
function ReadTicket({
  items,
  labels,
  read,
}: {
  items: string[];
  labels: Record<"total" | "vatIncl" | "card" | "thanks" | "title", string>;
  read: { label: string; value: string }[];
}) {
  const amounts = ["18.90", "14.50", "9.80", "43.15"];
  const delay = (i: number) => ({ "--d": `${i * 0.25}s` }) as React.CSSProperties;
  return (
    <div aria-hidden="true" className="flex flex-col gap-4">
      <div
        data-ticket
        className="lp-ticket relative mx-auto w-full max-w-[280px] border border-line-strong bg-paper px-5 py-5 text-[12px] text-ink-2 tabular-nums"
      >
        <span className="lp-scan" />
        <p className="lp-field text-center text-[14px] font-extrabold text-ink" style={delay(0)}>
          Brico Seeland
        </p>
        <p className="text-center text-[11px] text-ink-muted">
          Rue de l'Atelier 3, 2502 Biel/Bienne
        </p>
        <p className="lp-field mt-1 text-center text-[11px] text-ink-muted" style={delay(1)}>
          06.10.2026 10:42
        </p>
        <div className="mt-3 border-t border-dashed border-ink-3 pt-2">
          {items.map((item, i) => (
            <p key={item} className="flex justify-between gap-3 py-0.5">
              <span className="min-w-0">{item}</span>
              <span>{amounts[i]}</span>
            </p>
          ))}
        </div>
        <p
          className="lp-field mt-2 flex justify-between border-t border-dashed border-ink-3 pt-2 text-[14px] font-extrabold text-ink"
          style={delay(2)}
        >
          <span>{labels.total}</span>
          <span>86.35</span>
        </p>
        <p className="lp-field flex justify-between text-ink-muted" style={delay(3)}>
          <span>{labels.vatIncl}</span>
          <span>6.47</span>
        </p>
        <p className="mt-2 text-ink-muted">{labels.card}</p>
        <p className="mt-2 text-center text-[11px] text-ink-muted">{labels.thanks}</p>
      </div>
      <div className="lp-read border border-line-strong bg-panel">
        <p className="border-b border-line bg-head px-4 py-2 text-[10.5px] font-extrabold tracking-[0.09em] text-accent-dark uppercase">
          {labels.title}
        </p>
        <dl className="text-[13px]">
          {read.map((row, i) => (
            <div
              key={row.label}
              className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] gap-3 border-b border-line-soft px-4 py-2 last:border-b-0"
            >
              <dt className="text-ink-muted">{row.label}</dt>
              <dd className="lp-value font-bold text-ink" style={delay(i)}>
                {row.value}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
