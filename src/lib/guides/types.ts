/**
 * Pages mots-clés (« guides ») du site public : une page par requête réelle, dans une seule langue.
 * Les textes sont dans fr.ts, en.ts et de.ts ; la page est rendue par [locale]/[...rest]/page.tsx.
 */

/** Captures d'écran disponibles (src/components/landing/shots.json). « bank-desktop » n'existe pas en anglais. */
export type GuideShot =
  | "invoice-pdf"
  | "quote-desktop"
  | "reminders-desktop"
  | "expenses-desktop"
  | "bills-desktop"
  | "bank-desktop"
  | "vat-desktop"
  | "time-desktop"
  | "dashboard-desktop"
  | "capture-mobile";

export type GuideSection = {
  /** Titre de la section (h2). */
  h2: string;
  /** Paragraphes, texte brut. */
  paras: string[];
  /** Liste à puces facultative, texte brut. */
  bullets?: string[];
};

export type Guide = {
  /** Segment d'adresse : /<lang>/<slug>. Minuscules ASCII et tirets. */
  slug: string;
  lang: "fr" | "en" | "de";
  /**
   * Sujet commun aux pages équivalentes des autres langues (hreflang). null : page sans équivalent.
   */
  group: string | null;
  /** Requête visée, présente dans title, h1 et description. */
  keyword: string;
  /** D'où vient la requête (Google Suggest, langue, pays, date). */
  source: string;
  /** Titre de l'onglet, sans la marque (ajoutée : « · InvoiceLead »). 52 signes au plus. */
  title: string;
  /** Meta description, 120 à 160 signes. */
  description: string;
  /** Petit libellé au-dessus du h1. */
  eyebrow: string;
  h1: string;
  /** Chapeau sous le h1. */
  lede: string;
  /** Libellé court du lien vers cette page (pied de page, liens « À lire aussi »). */
  linkLabel: string;
  shot: GuideShot;
  shotAlt: string;
  sections: GuideSection[];
  faq: { q: string; a: string }[];
  /** Autres guides de la même langue à proposer (slugs). */
  related: string[];
};
