import type { Metadata } from "next";
import { routing } from "@/i18n/routing";

/**
 * Balises de référencement communes aux pages publiques : canonical absolu, hreflang réciproques
 * avec x-default, Open Graph (image 1200 × 630 dessinée) et carte Twitter.
 */

export const SITE = "https://invoicelead.io";

export const OG_LOCALE: Record<string, string> = {
  de: "de_DE",
  fr: "fr_FR",
  en: "en_US",
  it: "it_IT",
  es: "es_ES",
};

/** Images de partage dessinées (public/landing/og-<langue>.jpg) ; l'italien et l'espagnol prennent l'anglaise. */
const OG_IMAGES = new Set(["de", "fr", "en"]);

export function ogImage(locale: string, alt: string) {
  return {
    url: `${SITE}/landing/og-${OG_IMAGES.has(locale) ? locale : "en"}.jpg`,
    width: 1200,
    height: 630,
    alt,
  };
}

/** Adresses de la même page dans les cinq langues : `/fr/pricing`, etc. */
export function allLocales(path: string): Record<string, string> {
  return Object.fromEntries(routing.locales.map((l) => [l, `/${l}${path}`]));
}

/**
 * Métadonnées d'une page publique. `languages` : langue → chemin de chaque version (la page
 * elle-même comprise) ; x-default va vers la version anglaise si elle existe, sinon vers celle-ci.
 * `absoluteTitle` : le titre est pris tel quel, sans la marque ajoutée par la mise en page.
 */
export function publicMetadata({
  locale,
  path,
  title,
  description,
  languages,
  absoluteTitle = false,
  xDefault,
}: {
  locale: string;
  /** Chemin de la page, langue comprise : « /fr/pricing ». */
  path: string;
  title: string;
  description: string;
  languages: Record<string, string>;
  absoluteTitle?: boolean;
  xDefault?: string;
}): Metadata {
  const url = `${SITE}${path}`;
  const fullTitle = absoluteTitle ? title : `${title} · InvoiceLead`;
  const image = ogImage(locale, fullTitle);
  const abs = (p: string) => `${SITE}${p}`;
  return {
    title: absoluteTitle ? { absolute: title } : title,
    description,
    alternates: {
      canonical: url,
      languages: {
        ...Object.fromEntries(Object.entries(languages).map(([l, p]) => [l, abs(p)])),
        "x-default": abs(xDefault ?? languages.en ?? path),
      },
    },
    openGraph: {
      type: "website",
      url,
      siteName: "InvoiceLead",
      title: fullTitle,
      description,
      locale: OG_LOCALE[locale],
      images: [image],
    },
    twitter: {
      card: "summary_large_image",
      title: fullTitle,
      description,
      images: [image.url],
    },
  };
}

/** Éditeur, repris dans les données structurées de chaque page. */
export const PUBLISHER = {
  "@type": "Organization",
  "@id": `${SITE}/#organization`,
  name: "Quantum Liquid LLC",
  url: SITE,
  address: {
    "@type": "PostalAddress",
    streetAddress: "30 N Gould St",
    addressLocality: "Sheridan",
    addressRegion: "WY",
    postalCode: "82801",
    addressCountry: "US",
  },
} as const;

/** WebPage + fil d'Ariane (accueil → page), pour toutes les pages publiques autres que l'accueil. */
export function webPageLd({
  locale,
  path,
  name,
  description,
  homeLabel,
}: {
  locale: string;
  path: string;
  name: string;
  description: string;
  homeLabel: string;
}) {
  const url = `${SITE}${path}`;
  return [
    {
      "@context": "https://schema.org",
      "@type": "WebPage",
      "@id": url,
      url,
      name,
      description,
      inLanguage: locale,
      isPartOf: { "@type": "WebSite", name: "InvoiceLead", url: SITE },
      publisher: PUBLISHER,
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: homeLabel, item: `${SITE}/${locale}` },
        { "@type": "ListItem", position: 2, name, item: url },
      ],
    },
  ];
}

export function faqLd(items: { q: string; a: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((item) => ({
      "@type": "Question",
      name: item.q,
      acceptedAnswer: { "@type": "Answer", text: item.a },
    })),
  };
}

/** Contenu d'une balise <script type="application/ld+json">, « < » échappé. */
export function ldJson(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}
