import "@/components/landing/landing.css";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Frame, Phone, Shot } from "@/components/landing/Shot";
import { PublicFooter } from "@/components/public/PublicFooter";
import { PublicHeader } from "@/components/public/PublicHeader";
import { Button } from "@/components/ui/button";
import { findGuide, GUIDES, type Guide, guideLabels, guideLanguages } from "@/lib/guides";
import { leadLoginHref } from "@/lib/lead-login";
import { faqLd, ldJson, publicMetadata, webPageLd } from "@/lib/seo";

type Params = { params: Promise<{ locale: string; rest: string[] }> };

/**
 * Toute adresse sans page propre : une page mots-clés (« guide », /fr/logiciel-facturation-gratuit)
 * si elle existe dans cette langue, sinon la page 404.
 */
export function generateStaticParams() {
  return GUIDES.map((g) => ({ locale: g.lang, rest: [g.slug] }));
}

function guideOf(locale: string, rest: string[]): Guide | undefined {
  const [slug] = rest;
  return rest.length === 1 && slug ? findGuide(locale, slug) : undefined;
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { locale, rest } = await params;
  const guide = guideOf(locale, rest);
  if (!guide) return {};
  return publicMetadata({
    locale,
    path: `/${locale}/${guide.slug}`,
    title: guide.title,
    description: guide.description,
    languages: guideLanguages(guide),
  });
}

export default async function CatchAll({ params }: Params) {
  const { locale, rest } = await params;
  const guide = guideOf(locale, rest);
  if (!guide) notFound();
  return <GuidePage guide={guide} />;
}

function GuidePage({ guide }: { guide: Guide }) {
  const locale = guide.lang;
  const L = guideLabels(locale);
  const path = `/${locale}/${guide.slug}`;
  const signup = leadLoginHref(locale, true);
  const related = guide.related
    .map((slug) => findGuide(locale, slug))
    .filter((g): g is Guide => Boolean(g));
  const jsonLd = [
    ...webPageLd({
      locale,
      path,
      name: guide.h1,
      description: guide.description,
      homeLabel: L.home,
    }),
    faqLd(guide.faq),
  ];
  const mobile = guide.shot === "capture-mobile";
  return (
    <div className="flex min-h-screen flex-col overflow-x-clip">
      <PublicHeader />
      <main className="flex-1">
        {/* En-tête de la page : fil d'Ariane, titre, chapeau, inscription gratuite. */}
        <section className="border-b border-line-strong">
          <div className="mx-auto grid max-w-6xl grid-cols-1 items-center gap-12 px-4 pt-10 pb-16 sm:px-8 md:pt-14 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] lg:gap-14">
            <div>
              <nav className="mb-6 flex items-center gap-2 text-[13px] text-ink-muted">
                <a href={`/${locale}`} className="hover:text-ink">
                  {L.home}
                </a>
                <span aria-hidden="true">›</span>
                <span className="text-ink-2">{guide.linkLabel}</span>
              </nav>
              <p className="text-[11px] font-extrabold tracking-[0.08em] text-accent-dark uppercase">
                {guide.eyebrow}
              </p>
              <h1 className="mt-3 text-[34px] leading-[1.02] font-black tracking-[-0.03em] text-ink sm:text-[46px]">
                {guide.h1}
              </h1>
              <p className="mt-5 max-w-[56ch] text-[17px] leading-relaxed text-ink-2">
                {guide.lede}
              </p>
              <div className="mt-7 flex flex-wrap gap-3">
                <Button asChild size="lg">
                  <a href={signup}>{L.cta}</a>
                </Button>
                <Button asChild size="lg" variant="secondary">
                  <a href={`/${locale}/pricing`}>{L.pricing}</a>
                </Button>
              </div>
              <p className="mt-5 text-[13px] text-ink-muted">{L.fine}</p>
            </div>
            <div className={mobile ? "mx-auto w-full max-w-[260px]" : "w-full"}>
              {mobile ? (
                <Phone>
                  <Shot locale={locale} name={guide.shot} alt={guide.shotAlt} sizes="260px" />
                </Phone>
              ) : (
                <Frame url={`invoicelead.io/${locale}/app`}>
                  <Shot
                    locale={locale}
                    name={guide.shot}
                    alt={guide.shotAlt}
                    sizes="(min-width: 1024px) 540px, 100vw"
                  />
                </Frame>
              )}
            </div>
          </div>
        </section>

        {/* Sections du guide, en lecture. */}
        <section className="border-b border-line-strong bg-panel">
          <div className="mx-auto max-w-[820px] px-4 py-14 sm:px-8 md:py-20">
            {guide.sections.map((section, i) => (
              <div key={section.h2} className={i === 0 ? "" : "mt-12 border-t border-line pt-10"}>
                <h2 className="text-[26px] leading-[1.1] font-extrabold text-ink sm:text-[32px]">
                  {section.h2}
                </h2>
                {section.paras.map((para) => (
                  <p key={para} className="mt-4 text-[16px] leading-relaxed text-ink-2">
                    {para}
                  </p>
                ))}
                {section.bullets?.length ? (
                  <ul data-cells className="mt-6 grid border border-line-strong bg-paper">
                    {section.bullets.map((item) => (
                      <li
                        key={item}
                        className="flex items-start gap-3 border-b border-line px-5 py-3 text-[15px] leading-relaxed text-ink-2 last:border-b-0"
                      >
                        <span
                          aria-hidden="true"
                          className="mt-2 h-2 w-2 shrink-0 border border-accent-dark bg-accent-pale"
                        />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ))}
          </div>
        </section>

        {/* Questions fréquentes de la page (données FAQPage). */}
        <section className="border-b border-line-strong">
          <div className="mx-auto grid max-w-6xl grid-cols-1 gap-8 px-4 py-16 sm:px-8 md:py-20 lg:grid-cols-[minmax(0,0.7fr)_minmax(0,1.3fr)]">
            <h2 className="text-[30px] leading-[1.05] font-extrabold text-ink sm:text-[40px]">
              {L.faq}
            </h2>
            <div className="border border-line-strong bg-panel">
              {guide.faq.map((item, i) => (
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

        {/* À lire aussi : les guides proches, puis l'accueil, les tarifs et la FAQ. */}
        {related.length ? (
          <section className="border-b border-line-strong bg-strip">
            <div className="mx-auto max-w-6xl px-4 py-14 sm:px-8">
              <h2 className="text-[24px] leading-tight font-extrabold text-ink sm:text-[30px]">
                {L.related}
              </h2>
              <ul
                data-cells
                className={`mt-8 grid grid-cols-1 border-t border-l border-line-strong sm:grid-cols-2 ${related.length >= 4 ? "lg:grid-cols-4" : "lg:grid-cols-3"}`}
              >
                {related.map((g) => (
                  <li key={g.slug} className="border-r border-b border-line-strong bg-paper">
                    <a
                      href={`/${locale}/${g.slug}`}
                      className="flex h-full flex-col gap-2 p-5 hover:bg-muted"
                    >
                      <span className="text-[10.5px] font-extrabold tracking-[0.08em] text-accent-dark uppercase">
                        {g.eyebrow}
                      </span>
                      <span className="text-[15px] leading-snug font-extrabold text-ink">
                        {g.linkLabel}
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          </section>
        ) : null}

        {/* Dernier appel, le même bloc prune que l'accueil. */}
        <section className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-8 md:py-20">
          <div className="flex flex-col gap-5 border border-accent-dark bg-accent p-7 text-white sm:p-10">
            <p className="text-[28px] leading-[1.05] font-black tracking-[-0.03em] sm:text-[38px]">
              {guide.linkLabel}
            </p>
            <p className="max-w-[60ch] text-[16px] leading-relaxed text-white/90">{L.ctaBody}</p>
            <div className="flex flex-wrap gap-3">
              <a
                href={signup}
                className="inline-flex h-12 items-center bg-white px-6 text-[15px] font-bold text-accent-dark hover:bg-accent-pale"
              >
                {L.cta}
              </a>
              <a
                href={`/${locale}`}
                className="inline-flex h-12 items-center border border-white/70 px-6 text-[15px] font-bold text-white hover:bg-accent-dark"
              >
                InvoiceLead
              </a>
            </div>
          </div>
        </section>
      </main>
      <PublicFooter />
      <script
        type="application/ld+json"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: données structurées écrites ici, « < » échappé
        dangerouslySetInnerHTML={{ __html: ldJson(jsonLd) }}
      />
    </div>
  );
}
