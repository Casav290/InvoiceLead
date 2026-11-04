import { GUIDES_DE } from "./de";
import { GUIDES_EN } from "./en";
import { GUIDES_FR } from "./fr";
import type { Guide } from "./types";

export type { Guide, GuideSection, GuideShot } from "./types";

/** Toutes les pages mots-clés, dans l'ordre de leur langue. */
export const GUIDES: Guide[] = [...GUIDES_FR, ...GUIDES_EN, ...GUIDES_DE];

/** Pages mots-clés d'une langue (aucune en italien ni en espagnol). */
export function guidesFor(locale: string): Guide[] {
  return GUIDES.filter((g) => g.lang === locale);
}

export function findGuide(locale: string, slug: string): Guide | undefined {
  return GUIDES.find((g) => g.lang === locale && g.slug === slug);
}

/** Versions de la même page dans les autres langues (hreflang), la page comprise : langue → chemin. */
export function guideLanguages(guide: Guide): Record<string, string> {
  const same = guide.group ? GUIDES.filter((g) => g.group === guide.group) : [guide];
  return Object.fromEntries(same.map((g) => [g.lang, `/${g.lang}/${g.slug}`]));
}

/** Titres des rubriques de guides, par langue. */
type GuideLabels = {
  heading: string;
  homeTitle: string;
  homeBody: string;
  related: string;
  faq: string;
  cta: string;
  ctaBody: string;
  pricing: string;
  fine: string;
  home: string;
  suite: string;
};

const GUIDE_LABELS: Record<"fr" | "en" | "de", GuideLabels> = {
  fr: {
    heading: "Guides",
    homeTitle: "Selon ce que vous cherchez.",
    homeBody:
      "Des pages courtes sur les besoins les plus fréquents : facturer gratuitement, relancer, lire ses tickets, passer à la facture électronique.",
    related: "À lire aussi",
    faq: "Questions fréquentes",
    cta: "Commencer gratuitement",
    ctaBody:
      "Votre compte est prêt en une minute. Sans carte bancaire, formule gratuite sans limite de durée.",
    pricing: "Voir les tarifs",
    fine: "Sans carte bancaire. Formule gratuite sans limite de durée.",
    home: "Accueil",
    suite: "La suite Lead",
  },
  en: {
    heading: "Guides",
    homeTitle: "Start from what you need.",
    homeBody:
      "Short pages on the most common needs: free invoicing, payment reminders, receipts read from a photo, quotes that turn into invoices.",
    related: "Read next",
    faq: "Frequently asked questions",
    cta: "Start for free",
    ctaBody:
      "Your account is ready in a minute. No credit card, and the free plan has no time limit.",
    pricing: "See pricing",
    fine: "No credit card. The free plan has no time limit.",
    home: "Home",
    suite: "The Lead suite",
  },
  de: {
    heading: "Ratgeber",
    homeTitle: "Je nachdem, was Sie suchen.",
    homeBody:
      "Kurze Seiten zu den häufigsten Fragen: kostenlos Rechnungen schreiben, mahnen, Belege per Foto erfassen, XRechnung erstellen.",
    related: "Weiterlesen",
    faq: "Häufige Fragen",
    cta: "Kostenlos starten",
    ctaBody:
      "Ihr Konto ist in einer Minute bereit. Ohne Kreditkarte, der kostenlose Tarif hat keine Laufzeitgrenze.",
    pricing: "Preise ansehen",
    fine: "Ohne Kreditkarte. Der kostenlose Tarif hat keine Laufzeitgrenze.",
    home: "Startseite",
    suite: "Die Lead-Suite",
  },
};

/** Libellés des guides dans cette langue (anglais pour l'italien et l'espagnol). */
export function guideLabels(locale: string): GuideLabels {
  return locale === "fr" || locale === "de" ? GUIDE_LABELS[locale] : GUIDE_LABELS.en;
}
