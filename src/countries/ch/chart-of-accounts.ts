/**
 * Plan comptable PME suisse (Kontenrahmen KMU), réduit aux comptes dont une petite entreprise a
 * besoin. Deux modèles : entreprise individuelle ou société de personnes, et société de capitaux
 * (Sàrl, SA). Seuls les capitaux propres et les impôts de la société diffèrent.
 */

export const ACCOUNT_TYPES = [
  "asset",
  "liability",
  "equity",
  "revenue",
  "expense",
  "closing",
] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export const CHART_TEMPLATES = ["sole_proprietorship", "corporation"] as const;
export type ChartTemplate = (typeof CHART_TEMPLATES)[number];

/**
 * Rôles des comptes système, que les écritures automatiques (factures, paiements, TVA, clôture)
 * retrouvent quel que soit le numéro choisi par l'entreprise.
 */
export const ACCOUNT_ROLES = [
  "cash",
  "bank",
  "payment_clearing",
  "receivable",
  "vat_input_material",
  "vat_input_invest",
  "payable",
  "customer_prepayments",
  "vat_output",
  "vat_settlement",
  "equity",
  "private",
  "retained_earnings",
  "annual_result",
  "revenue_default",
  /** Produits au taux réduit, quand le plan les sépare (Allemagne : 4300, compte automatique 7 %). */
  "revenue_reduced",
  "sales_deductions",
  "rounding",
  "bad_debt",
  "bank_fees",
  "exchange_difference",
  "exchange_gain",
  "late_charges",
  "income_statement",
  "opening_balance",
] as const;
export type AccountRole = (typeof ACCOUNT_ROLES)[number];

export type TemplateAccount = {
  number: string;
  de: string;
  fr: string;
  en?: string;
  type: AccountType;
  role?: AccountRole;
  vatCode?: "normal";
  /** Absent : commun aux deux modèles. */
  only?: ChartTemplate;
};

/** Types admis selon la classe (premier chiffre du numéro). */
export const TYPES_BY_CLASS: Record<string, readonly AccountType[]> = {
  "1": ["asset"],
  "2": ["liability", "equity"],
  "3": ["revenue"],
  "4": ["expense", "revenue"],
  "5": ["expense"],
  "6": ["expense", "revenue"],
  "7": ["revenue", "expense"],
  "8": ["expense", "revenue"],
  "9": ["closing"],
};

const SP = "sole_proprietorship" as const;
const CO = "corporation" as const;

export const CHART_ACCOUNTS: readonly TemplateAccount[] = [
  // 1 Actifs
  { number: "1000", de: "Kasse", fr: "Caisse", type: "asset", role: "cash" },
  { number: "1020", de: "Bank", fr: "Banque", type: "asset", role: "bank" },
  { number: "1060", de: "Wertschriften", fr: "Titres", type: "asset" },
  {
    number: "1100",
    de: "Forderungen aus Lieferungen und Leistungen (Debitoren)",
    fr: "Créances résultant de livraisons et prestations (débiteurs)",
    type: "asset",
    role: "receivable",
  },
  { number: "1109", de: "Delkredere", fr: "Ducroire", type: "asset" },
  { number: "1140", de: "Vorschüsse und Darlehen", fr: "Avances et prêts", type: "asset" },
  {
    number: "1170",
    de: "Vorsteuer MWST Material, Waren, Dienstleistungen, Energie",
    fr: "Impôt préalable TVA sur matériel, marchandises, prestations et énergie",
    type: "asset",
    role: "vat_input_material",
  },
  {
    number: "1171",
    de: "Vorsteuer MWST Investitionen, übriger Betriebsaufwand",
    fr: "Impôt préalable TVA sur investissements et autres charges d'exploitation",
    type: "asset",
    role: "vat_input_invest",
  },
  { number: "1176", de: "Verrechnungssteuer", fr: "Impôt anticipé", type: "asset" },
  {
    number: "1190",
    de: "Sonstige kurzfristige Forderungen",
    fr: "Autres créances à court terme",
    type: "asset",
  },
  { number: "1200", de: "Handelswaren", fr: "Marchandises commerciales", type: "asset" },
  { number: "1210", de: "Rohstoffe", fr: "Matières premières", type: "asset" },
  { number: "1260", de: "Fertige Erzeugnisse", fr: "Produits finis", type: "asset" },
  {
    number: "1280",
    de: "Nicht fakturierte Dienstleistungen",
    fr: "Travaux en cours",
    type: "asset",
  },
  {
    number: "1300",
    de: "Bezahlter Aufwand des Folgejahres",
    fr: "Charges payées d'avance",
    type: "asset",
  },
  { number: "1301", de: "Noch nicht erhaltener Ertrag", fr: "Produits à recevoir", type: "asset" },
  { number: "1440", de: "Darlehen (Aktiven)", fr: "Prêts (actif)", type: "asset" },
  { number: "1500", de: "Maschinen und Apparate", fr: "Machines et appareils", type: "asset" },
  {
    number: "1510",
    de: "Mobiliar und Einrichtungen",
    fr: "Mobilier et installations",
    type: "asset",
  },
  {
    number: "1520",
    de: "Büromaschinen, Informatik, Kommunikationstechnologie",
    fr: "Machines de bureau, informatique, technologies de communication",
    type: "asset",
  },
  { number: "1530", de: "Fahrzeuge", fr: "Véhicules", type: "asset" },
  { number: "1540", de: "Werkzeuge und Geräte", fr: "Outillage et appareils", type: "asset" },
  { number: "1600", de: "Geschäftsliegenschaften", fr: "Immeubles d'exploitation", type: "asset" },
  {
    number: "1700",
    de: "Patente, Know-how, Lizenzen, Rechte",
    fr: "Brevets, savoir-faire, licences, droits",
    type: "asset",
  },
  { number: "1770", de: "Goodwill", fr: "Goodwill", type: "asset" },
  {
    number: "1850",
    de: "Nicht einbezahltes Kapital",
    fr: "Capital non libéré",
    type: "asset",
    only: CO,
  },

  // 2 Passifs
  {
    number: "2000",
    de: "Verbindlichkeiten aus Lieferungen und Leistungen (Kreditoren)",
    fr: "Dettes résultant d'achats et de prestations de services (créanciers)",
    type: "liability",
    role: "payable",
  },
  {
    number: "2030",
    de: "Erhaltene Anzahlungen",
    fr: "Acomptes reçus de clients",
    type: "liability",
    role: "customer_prepayments",
  },
  { number: "2100", de: "Bankverbindlichkeiten", fr: "Dettes bancaires", type: "liability" },
  {
    number: "2200",
    de: "Geschuldete MWST (Umsatzsteuer)",
    fr: "TVA due",
    type: "liability",
    role: "vat_output",
  },
  {
    number: "2201",
    de: "Abrechnungskonto MWST",
    fr: "Décompte TVA",
    type: "liability",
    role: "vat_settlement",
  },
  {
    number: "2206",
    de: "Geschuldete Verrechnungssteuer",
    fr: "Impôt anticipé dû",
    type: "liability",
    only: CO,
  },
  { number: "2208", de: "Direkte Steuern", fr: "Impôts directs", type: "liability", only: CO },
  {
    number: "2210",
    de: "Sonstige kurzfristige Verbindlichkeiten",
    fr: "Autres dettes à court terme",
    type: "liability",
  },
  {
    number: "2261",
    de: "Beschlossene Ausschüttungen",
    fr: "Dividendes décidés",
    type: "liability",
    only: CO,
  },
  {
    number: "2270",
    de: "Sozialversicherungen und Vorsorgeeinrichtungen",
    fr: "Assurances sociales et institutions de prévoyance",
    type: "liability",
  },
  { number: "2300", de: "Noch nicht bezahlter Aufwand", fr: "Charges à payer", type: "liability" },
  {
    number: "2301",
    de: "Erhaltener Ertrag des Folgejahres",
    fr: "Produits encaissés d'avance",
    type: "liability",
  },
  {
    number: "2330",
    de: "Kurzfristige Rückstellungen",
    fr: "Provisions à court terme",
    type: "liability",
  },
  {
    number: "2400",
    de: "Langfristige Bankverbindlichkeiten",
    fr: "Dettes bancaires à long terme",
    type: "liability",
  },
  { number: "2450", de: "Darlehen", fr: "Emprunts", type: "liability" },
  {
    number: "2600",
    de: "Langfristige Rückstellungen",
    fr: "Provisions à long terme",
    type: "liability",
  },
  {
    number: "2800",
    de: "Eigenkapital",
    fr: "Capital propre",
    type: "equity",
    role: "equity",
    only: SP,
  },
  { number: "2850", de: "Privat", fr: "Compte privé", type: "equity", role: "private", only: SP },
  {
    number: "2891",
    de: "Jahresgewinn oder Jahresverlust",
    fr: "Bénéfice ou perte de l'exercice",
    type: "equity",
    role: "annual_result",
    only: SP,
  },
  {
    number: "2800",
    de: "Aktien-, Stamm- oder Anteilscheinkapital",
    fr: "Capital-actions ou capital social",
    type: "equity",
    role: "equity",
    only: CO,
  },
  {
    number: "2900",
    de: "Gesetzliche Kapitalreserve",
    fr: "Réserve légale issue du capital",
    type: "equity",
    only: CO,
  },
  {
    number: "2950",
    de: "Gesetzliche Gewinnreserve",
    fr: "Réserve légale issue du bénéfice",
    type: "equity",
    only: CO,
  },
  {
    number: "2960",
    de: "Freiwillige Gewinnreserven",
    fr: "Réserves facultatives issues du bénéfice",
    type: "equity",
    only: CO,
  },
  {
    number: "2970",
    de: "Gewinnvortrag oder Verlustvortrag",
    fr: "Bénéfice ou perte reporté",
    type: "equity",
    role: "retained_earnings",
    only: CO,
  },
  {
    number: "2979",
    de: "Jahresgewinn oder Jahresverlust",
    fr: "Bénéfice ou perte de l'exercice",
    type: "equity",
    role: "annual_result",
    only: CO,
  },

  // 3 Produits d'exploitation
  {
    number: "3000",
    de: "Produktionserlöse",
    fr: "Ventes de produits fabriqués",
    type: "revenue",
    vatCode: "normal",
  },
  {
    number: "3200",
    de: "Handelserlöse",
    fr: "Ventes de marchandises",
    type: "revenue",
    vatCode: "normal",
  },
  {
    number: "3400",
    de: "Dienstleistungserlöse",
    fr: "Ventes de prestations de services",
    type: "revenue",
    role: "revenue_default",
    vatCode: "normal",
  },
  {
    number: "3600",
    de: "Übrige Erlöse aus Lieferungen und Leistungen",
    fr: "Autres ventes et prestations de services",
    type: "revenue",
    vatCode: "normal",
  },
  { number: "3700", de: "Eigenleistungen", fr: "Prestations propres", type: "revenue" },
  { number: "3710", de: "Eigenverbrauch", fr: "Consommations propres", type: "revenue" },
  {
    number: "3800",
    de: "Erlösminderungen",
    fr: "Déductions sur ventes",
    type: "revenue",
    role: "sales_deductions",
  },
  {
    number: "3804",
    de: "Rundungsdifferenzen",
    fr: "Différences d'arrondi",
    type: "revenue",
    role: "rounding",
  },
  {
    number: "3805",
    de: "Verluste aus Forderungen",
    fr: "Pertes sur créances",
    type: "revenue",
    role: "bad_debt",
  },

  // 4 Charges de matériel, marchandises et prestations
  {
    number: "4000",
    de: "Materialaufwand",
    fr: "Charges de matériel",
    type: "expense",
    vatCode: "normal",
  },
  {
    number: "4200",
    de: "Handelswarenaufwand",
    fr: "Achats de marchandises",
    type: "expense",
    vatCode: "normal",
  },
  {
    number: "4400",
    de: "Aufwand für bezogene Dienstleistungen",
    fr: "Prestations et travaux de tiers",
    type: "expense",
    vatCode: "normal",
  },
  {
    number: "4500",
    de: "Energieaufwand zur Leistungserstellung",
    fr: "Énergie pour la production",
    type: "expense",
    vatCode: "normal",
  },
  {
    number: "4900",
    de: "Aufwandminderungen",
    fr: "Déductions obtenues sur achats",
    type: "expense",
  },

  // 5 Charges de personnel
  { number: "5000", de: "Lohnaufwand", fr: "Salaires", type: "expense" },
  { number: "5700", de: "Sozialversicherungsaufwand", fr: "Charges sociales", type: "expense" },
  {
    number: "5720",
    de: "Vorsorgeaufwand",
    fr: "Prévoyance professionnelle",
    type: "expense",
  },
  { number: "5730", de: "Unfallversicherung", fr: "Assurance-accidents", type: "expense" },
  {
    number: "5800",
    de: "Übriger Personalaufwand",
    fr: "Autres charges de personnel",
    type: "expense",
  },
  { number: "5820", de: "Spesen", fr: "Frais de déplacement", type: "expense", vatCode: "normal" },

  // 6 Autres charges d'exploitation, amortissements et résultat financier
  { number: "6000", de: "Raumaufwand", fr: "Charges de locaux", type: "expense" },
  {
    number: "6100",
    de: "Unterhalt, Reparaturen, Ersatz",
    fr: "Entretien, réparations, remplacements",
    type: "expense",
    vatCode: "normal",
  },
  {
    number: "6200",
    de: "Fahrzeug- und Transportaufwand",
    fr: "Charges de véhicules et de transport",
    type: "expense",
    vatCode: "normal",
  },
  {
    number: "6260",
    de: "Fahrzeugleasing und -mieten",
    fr: "Leasing et location de véhicules",
    type: "expense",
    vatCode: "normal",
  },
  {
    number: "6300",
    de: "Sachversicherungen, Abgaben, Gebühren",
    fr: "Assurances-choses, droits, taxes",
    type: "expense",
  },
  {
    number: "6400",
    de: "Energie- und Entsorgungsaufwand",
    fr: "Énergie et évacuation des déchets",
    type: "expense",
    vatCode: "normal",
  },
  {
    number: "6500",
    de: "Verwaltungsaufwand",
    fr: "Charges d'administration",
    type: "expense",
    vatCode: "normal",
  },
  {
    number: "6510",
    de: "Telefon und Internet",
    fr: "Téléphone et internet",
    type: "expense",
    vatCode: "normal",
  },
  {
    number: "6530",
    de: "Buchführungs- und Beratungsaufwand",
    fr: "Comptabilité et conseil",
    type: "expense",
    vatCode: "normal",
  },
  {
    number: "6570",
    de: "Informatikaufwand inkl. Leasing",
    fr: "Informatique, leasing compris",
    type: "expense",
    vatCode: "normal",
  },
  { number: "6600", de: "Werbeaufwand", fr: "Publicité", type: "expense", vatCode: "normal" },
  {
    number: "6700",
    de: "Sonstiger betrieblicher Aufwand",
    fr: "Autres charges d'exploitation",
    type: "expense",
    vatCode: "normal",
  },
  {
    number: "6800",
    de: "Abschreibungen",
    fr: "Amortissements",
    type: "expense",
  },
  { number: "6900", de: "Finanzaufwand", fr: "Charges financières", type: "expense" },
  { number: "6940", de: "Bankspesen", fr: "Frais bancaires", type: "expense", role: "bank_fees" },
  {
    number: "6960",
    de: "Kursdifferenzen",
    fr: "Différences de change",
    type: "expense",
    role: "exchange_difference",
  },
  { number: "6950", de: "Finanzertrag", fr: "Produits financiers", type: "revenue" },

  // 7 Activités annexes
  {
    number: "7000",
    de: "Ertrag Nebenbetrieb",
    fr: "Produits des activités annexes",
    type: "revenue",
  },
  {
    number: "7010",
    de: "Aufwand Nebenbetrieb",
    fr: "Charges des activités annexes",
    type: "expense",
  },
  {
    number: "7500",
    de: "Ertrag betriebliche Liegenschaft",
    fr: "Produits des immeubles d'exploitation",
    type: "revenue",
  },
  {
    number: "7510",
    de: "Aufwand betriebliche Liegenschaft",
    fr: "Charges des immeubles d'exploitation",
    type: "expense",
  },

  // 8 Hors exploitation, exceptionnel et impôts
  {
    number: "8000",
    de: "Betriebsfremder Aufwand",
    fr: "Charges hors exploitation",
    type: "expense",
  },
  {
    number: "8100",
    de: "Betriebsfremder Ertrag",
    fr: "Produits hors exploitation",
    type: "revenue",
  },
  {
    number: "8500",
    de: "Ausserordentlicher oder periodenfremder Aufwand",
    fr: "Charges exceptionnelles ou hors période",
    type: "expense",
  },
  {
    number: "8510",
    de: "Ausserordentlicher oder periodenfremder Ertrag",
    fr: "Produits exceptionnels ou hors période",
    type: "revenue",
  },
  { number: "8900", de: "Direkte Steuern", fr: "Impôts directs", type: "expense", only: CO },

  // 9 Clôture
  {
    number: "9000",
    de: "Erfolgsrechnung",
    fr: "Compte de résultat",
    type: "closing",
    role: "income_statement",
  },
  {
    number: "9100",
    de: "Eröffnungsbilanz",
    fr: "Bilan d'ouverture",
    type: "closing",
    role: "opening_balance",
  },
];

/** Comptes d'un modèle, triés par numéro. */
export function templateAccounts(template: ChartTemplate): TemplateAccount[] {
  return CHART_ACCOUNTS.filter((a) => !a.only || a.only === template).sort((a, b) =>
    a.number.localeCompare(b.number),
  );
}

/** Modèle proposé selon la forme juridique saisie dans les réglages. */
export function templateForLegalForm(legalForm: string | null | undefined): ChartTemplate {
  return legalForm === "gmbh" || legalForm === "ag" ? "corporation" : "sole_proprietorship";
}

export function accountClass(number: string): string {
  return number.slice(0, 1);
}
