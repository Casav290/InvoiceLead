import type { AccountType, TemplateAccount } from "../ch/chart-of-accounts";

/**
 * Plan comptable allemand d'après le SKR04 (DATEV, classement selon le bilan), réduit aux comptes
 * d'une petite entreprise. Mêmes rôles système que le plan suisse, pour que les écritures
 * automatiques fonctionnent à l'identique. Une seule Umsatzsteuer et une seule Vorsteuer : le taux
 * est porté par chaque ligne d'écriture et la déclaration (UStVA) se calcule taux par taux.
 * À faire relire par un Steuerberater avant l'ouverture en Allemagne.
 */

/** Types admis selon la classe SKR04. */
export const TYPES_BY_CLASS_DE: Record<string, readonly AccountType[]> = {
  "0": ["asset"],
  "1": ["asset"],
  "2": ["equity"],
  "3": ["liability"],
  "4": ["revenue"],
  "5": ["expense"],
  "6": ["expense"],
  "7": ["revenue", "expense"],
  "9": ["closing"],
};

const SP = "sole_proprietorship" as const;
const CO = "corporation" as const;

const a = (
  number: string,
  de: string,
  fr: string,
  type: AccountType,
  extra: Partial<TemplateAccount> = {},
): TemplateAccount => ({ number, de, fr, type, ...extra });

export const CHART_ACCOUNTS_DE: readonly TemplateAccount[] = [
  // 0 Anlagevermögen
  a("0135", "EDV-Software", "Logiciels", "asset"),
  a("0520", "Pkw", "Voitures de tourisme", "asset"),
  a("0650", "Büroeinrichtung", "Mobilier de bureau", "asset"),
  a("0670", "Geringwertige Wirtschaftsgüter", "Biens de faible valeur", "asset"),
  // 1 Umlaufvermögen
  a("1200", "Forderungen aus Lieferungen und Leistungen", "Créances clients", "asset", {
    role: "receivable",
  }),
  a("1400", "Abziehbare Vorsteuer", "TVA déductible", "asset", { role: "vat_input_material" }),
  a("1600", "Kasse", "Caisse", "asset", { role: "cash" }),
  a("1800", "Bank", "Banque", "asset", { role: "bank" }),
  // 2 Eigenkapital
  a("2000", "Festkapital", "Capital", "equity", { role: "equity", only: SP }),
  a("2100", "Privatentnahmen allgemein", "Prélèvements privés", "equity", {
    role: "private",
    only: SP,
  }),
  a("2900", "Gezeichnetes Kapital", "Capital souscrit", "equity", { role: "equity", only: CO }),
  a("2970", "Gewinnvortrag vor Verwendung", "Bénéfice reporté", "equity", {
    role: "retained_earnings",
  }),
  a("2990", "Jahresüberschuss/Jahresfehlbetrag", "Résultat de l'exercice", "equity", {
    role: "annual_result",
  }),
  // 3 Fremdkapital
  a("3250", "Erhaltene Anzahlungen auf Bestellungen", "Acomptes reçus", "liability", {
    role: "customer_prepayments",
  }),
  a(
    "3300",
    "Verbindlichkeiten aus Lieferungen und Leistungen",
    "Dettes fournisseurs",
    "liability",
    {
      role: "payable",
    },
  ),
  a("3500", "Sonstige Verbindlichkeiten", "Autres dettes", "liability"),
  a("3800", "Umsatzsteuer", "TVA due", "liability", { role: "vat_output" }),
  a("3820", "Umsatzsteuer-Vorauszahlungen", "Acomptes de TVA (UStVA)", "liability", {
    role: "vat_settlement",
  }),
  // 4 Betriebliche Erträge
  a("4400", "Erlöse 19 % USt", "Produits soumis à 19 %", "revenue", {
    role: "revenue_default",
    vatCode: "normal",
  }),
  a("4300", "Erlöse 7 % USt", "Produits soumis à 7 %", "revenue"),
  a(
    "4125",
    "Steuerfreie innergemeinschaftliche Lieferungen",
    "Livraisons intracommunautaires exonérées",
    "revenue",
  ),
  a(
    "4336",
    "Erlöse aus im anderen EU-Land steuerpflichtigen sonstigen Leistungen",
    "Prestations imposables dans un autre pays de l'UE",
    "revenue",
  ),
  a("4700", "Erlösschmälerungen", "Déductions sur ventes", "revenue", { role: "sales_deductions" }),
  a("4830", "Sonstige betriebliche Erträge", "Autres produits d'exploitation", "revenue"),
  a("4840", "Erträge aus Kursdifferenzen", "Gains de change", "revenue"),
  // 5 Material und Fremdleistungen
  a("5200", "Wareneingang", "Achats de marchandises", "expense"),
  a("5900", "Fremdleistungen", "Prestations de tiers", "expense"),
  // 6 Betriebliche Aufwendungen
  a("6020", "Gehälter", "Salaires", "expense"),
  a("6220", "Abschreibungen auf Sachanlagen", "Amortissements", "expense"),
  a("6300", "Sonstige betriebliche Aufwendungen", "Autres charges d'exploitation", "expense"),
  a("6310", "Miete", "Loyer", "expense"),
  a("6400", "Versicherungen", "Assurances", "expense"),
  a("6520", "Kfz-Versicherungen", "Assurances véhicules", "expense"),
  a("6530", "Laufende Kfz-Betriebskosten", "Frais de véhicules", "expense"),
  a("6600", "Werbekosten", "Publicité", "expense"),
  a("6640", "Bewirtungskosten", "Frais de représentation", "expense"),
  a("6670", "Reisekosten Unternehmer", "Frais de voyage", "expense"),
  a("6800", "Porto", "Frais de port", "expense"),
  a("6805", "Telefon", "Téléphone", "expense"),
  a("6810", "Telefax und Internetkosten", "Internet", "expense"),
  a("6815", "Bürobedarf", "Fournitures de bureau", "expense"),
  a("6820", "Zeitschriften, Bücher", "Revues et livres", "expense"),
  a("6821", "Fortbildungskosten", "Formation", "expense"),
  a("6825", "Rechts- und Beratungskosten", "Frais juridiques et de conseil", "expense"),
  a("6830", "Buchführungskosten", "Frais de comptabilité", "expense"),
  a("6837", "Aufwendungen für Lizenzen und Software", "Licences et logiciels", "expense"),
  a("6855", "Nebenkosten des Geldverkehrs", "Frais bancaires", "expense", { role: "bank_fees" }),
  a("6880", "Aufwendungen aus Kursdifferenzen", "Pertes de change", "expense", {
    role: "exchange_difference",
  }),
  a("6930", "Forderungsverluste", "Pertes sur créances", "expense", { role: "bad_debt" }),
  a("6960", "Rundungsdifferenzen", "Différences d'arrondi", "expense", { role: "rounding" }),
  // 7 Weitere Erträge und Aufwendungen
  a("7100", "Zinserträge", "Produits d'intérêts", "revenue"),
  a("7300", "Zinsaufwendungen", "Charges d'intérêts", "expense"),
  a("7610", "Gewerbesteuer", "Taxe professionnelle", "expense", { only: CO }),
  a("7600", "Körperschaftsteuer", "Impôt sur les sociétés", "expense", { only: CO }),
  // 9 Vortrags- und Abschlusskonten
  a("9000", "Saldenvorträge Sachkonten", "Reports à nouveau", "closing", {
    role: "opening_balance",
  }),
  a("9990", "Gewinn- und Verlustrechnung", "Compte de résultat (clôture)", "closing", {
    role: "income_statement",
  }),
];
