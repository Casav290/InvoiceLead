/**
 * La famille Lead, telle que la montre le lanceur à 9 points (« Applications Lead ») de chaque
 * application. Liste canonique commune aux six applications : champ « family » de la conception du
 * passage entre applications (passage-design.json), copié tel quel (même contenu, même ordre) dans les
 * six dépôts et dans ~/projets/lead-e2e/lead-family.json ; check-launchers.mjs compare les copies.
 * Ne pas modifier ici seulement : changer la liste commune, puis recopier partout.
 *
 * Statique : ni droits du Compte Lead (claims.lead.apps), ni formule, ni appel réseau. Le lanceur
 * s'affiche tout de suite et aucune application n'y est cachée, désactivée (« Bientôt ») ou détournée
 * vers une page de formule : une formule payante n'est jamais nécessaire pour en ouvrir une autre.
 */
export const LEAD_FAMILY = {
  version: 1,
  note: "Liste canonique de la famille Lead. Copiée telle quelle (même contenu, même ordre) dans les 6 dépôts et dans ~/projets/lead-e2e/lead-family.json ; check-launchers.mjs compare les copies.",
  title: {
    fr: "Applications Lead",
    de: "Lead-Apps",
    en: "Lead apps",
    it: "App Lead",
    es: "Apps Lead",
  },
  open: {
    fr: "Ouvrir",
    de: "Öffnen",
    en: "Open",
    it: "Apri",
    es: "Abrir",
  },
  here: {
    fr: "Vous êtes ici",
    de: "Sie sind hier",
    en: "You are here",
    it: "Sei qui",
    es: "Estás aquí",
  },
  apps: [
    {
      code: "erplead",
      name: "ERPlead",
      mark: "EL",
      color: "#4338ca",
      origin: "https://erplead.io",
      entry: "https://erplead.io/account",
      fresh: "https://erplead.io/account",
      do: {
        fr: "Gérer mon compte",
        de: "Mein Konto verwalten",
        en: "Manage my account",
        it: "Gestire il mio account",
        es: "Gestionar mi cuenta",
      },
    },
    {
      code: "scanlead",
      name: "Scanlead",
      mark: "SL",
      color: "#2563eb",
      origin: "https://scanlead.io",
      entry: "https://scanlead.io/login",
      fresh: "https://scanlead.io/auth/lead/start?locale={locale}&fresh=1",
      do: {
        fr: "Scanner des contacts",
        de: "Kontakte scannen",
        en: "Scan contacts",
        it: "Scansionare contatti",
        es: "Escanear contactos",
      },
    },
    {
      code: "crmlead",
      name: "CRMlead",
      mark: "CL",
      color: "#0f6e70",
      origin: "https://crmlead.io",
      entry: "https://crmlead.io/login",
      fresh: "https://crmlead.io/auth/lead/start?locale={locale}&fresh=1",
      do: {
        fr: "Suivre mes leads",
        de: "Meine Leads verfolgen",
        en: "Follow up my leads",
        it: "Seguire i miei lead",
        es: "Seguir mis leads",
      },
    },
    {
      code: "projectlead",
      name: "ProjectLead",
      mark: "PL",
      color: "#9a6a00",
      origin: "https://projectlead.io",
      entry: "https://projectlead.io/login",
      fresh: "https://projectlead.io/auth/lead/start?locale={locale}&fresh=1",
      do: {
        fr: "Gérer mes projets",
        de: "Meine Projekte verwalten",
        en: "Manage my projects",
        it: "Gestire i miei progetti",
        es: "Gestionar mis proyectos",
      },
    },
    {
      code: "invoicelead",
      name: "InvoiceLead",
      mark: "IL",
      color: "#7a2e67",
      origin: "https://invoicelead.io",
      entry: "https://invoicelead.io/login",
      fresh: "https://invoicelead.io/auth/lead/start?locale={locale}&fresh=1",
      do: {
        fr: "Faire une facture",
        de: "Rechnung erstellen",
        en: "Create an invoice",
        it: "Creare una fattura",
        es: "Crear una factura",
      },
    },
    {
      code: "greetlead",
      name: "Greetlead",
      mark: "GL",
      color: "#c2185b",
      origin: "https://greetlead.io",
      entry: "https://greetlead.io/login",
      fresh: "https://greetlead.io/auth/lead/start?locale={locale}&fresh=1",
      do: {
        fr: "Envoyer une carte",
        de: "Karte senden",
        en: "Send a card",
        it: "Inviare un biglietto",
        es: "Enviar una tarjeta",
      },
    },
  ],
  workspace_home: {
    erplead: "/account",
    scanlead: "/dashboard",
    crmlead: "/",
    projectlead: "/",
    invoicelead: "/{locale}/app",
    greetlead: "/{locale}/app",
  },
} as const;

export type LeadAppCode = (typeof LEAD_FAMILY.apps)[number]["code"];

/** Langues des textes de la famille ; le français par défaut. */
type FamilyLocale = keyof typeof LEAD_FAMILY.title;

function familyLocale(locale: string): FamilyLocale {
  const short = locale.slice(0, 2).toLowerCase();
  return short in LEAD_FAMILY.title ? (short as FamilyLocale) : "fr";
}

/** Une ligne du lanceur. */
export type LeadAppItem = {
  code: LeadAppCode;
  name: string;
  /** Marque à deux lettres, blanche sur la couleur de l'application. */
  mark: string;
  color: string;
  /** Ce qu'on y fait (« Faire une facture »), dans la langue de la page. */
  action: string;
  /**
   * Adresse d'entrée de l'application (`<app>/login`, ERPlead : `/account`), en lien simple dans le
   * même onglet : connectée au Compte Lead, la personne y arrive tout droit dans l'espace de son
   * entreprise. Null pour l'application courante, qui n'a pas de lien.
   */
  href: string | null;
  current: boolean;
};

/** Les six applications, dans l'ordre de la famille, l'application courante à sa place. */
export function leadAppItems(current: string, locale: string): LeadAppItem[] {
  const lang = familyLocale(locale);
  return LEAD_FAMILY.apps.map((app) => ({
    code: app.code,
    name: app.name,
    mark: app.mark,
    color: app.color,
    action: app.do[lang],
    href: app.code === current ? null : app.entry,
    current: app.code === current,
  }));
}

/** Titre du lanceur, « Ouvrir » et « Vous êtes ici », dans la langue de la page. */
export function leadFamilyTexts(locale: string): { title: string; open: string; here: string } {
  const lang = familyLocale(locale);
  return {
    title: LEAD_FAMILY.title[lang],
    open: LEAD_FAMILY.open[lang],
    here: LEAD_FAMILY.here[lang],
  };
}

/** Adresse de ProjectLead : page Temps, réglage de la liaison. */
export const PROJECTLEAD_URL: string = LEAD_FAMILY.apps[3].origin;
