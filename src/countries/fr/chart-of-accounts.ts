import type { AccountType, TemplateAccount } from "../ch/chart-of-accounts";

/**
 * Plan comptable général français (PCG, règlement ANC 2014-03), réduit aux comptes d'une petite
 * entreprise, numéros à six chiffres. Mêmes rôles système que les plans suisse et allemand.
 * À faire relire par un expert-comptable avant l'ouverture en France.
 */

/** Types admis selon la classe du PCG. */
export const TYPES_BY_CLASS_FR: Record<string, readonly AccountType[]> = {
  "1": ["equity", "liability"],
  "2": ["asset"],
  "3": ["asset"],
  "4": ["asset", "liability"],
  "5": ["asset", "liability"],
  "6": ["expense"],
  "7": ["revenue"],
  "8": ["closing"],
};

const SP = "sole_proprietorship" as const;
const CO = "corporation" as const;

const a = (
  number: string,
  fr: string,
  de: string,
  type: AccountType,
  extra: Partial<TemplateAccount> = {},
): TemplateAccount => ({ number, fr, de, type, ...extra });

export const CHART_ACCOUNTS_FR: readonly TemplateAccount[] = [
  // 1 Capitaux
  a("101000", "Capital individuel", "Eigenkapital", "equity", { role: "equity", only: SP }),
  a("101300", "Capital souscrit, appelé, versé", "Gezeichnetes Kapital", "equity", {
    role: "equity",
    only: CO,
  }),
  a("108000", "Compte de l'exploitant", "Privatkonto", "equity", { role: "private", only: SP }),
  a("110000", "Report à nouveau", "Gewinnvortrag", "equity", { role: "retained_earnings" }),
  a("120000", "Résultat de l'exercice", "Jahresergebnis", "equity", { role: "annual_result" }),
  a("164000", "Emprunts auprès des établissements de crédit", "Bankdarlehen", "liability"),
  // 2 Immobilisations
  a("205000", "Logiciels", "Software", "asset"),
  a("218200", "Matériel de transport", "Fahrzeuge", "asset"),
  a("218300", "Matériel de bureau et informatique", "Büro- und EDV-Ausstattung", "asset"),
  a(
    "281800",
    "Amortissements des autres immobilisations corporelles",
    "Abschreibungen auf Sachanlagen",
    "asset",
  ),
  // 4 Tiers
  a("401000", "Fournisseurs", "Lieferanten", "liability", { role: "payable" }),
  a("411000", "Clients", "Kunden", "asset", { role: "receivable" }),
  a("419100", "Avances et acomptes reçus des clients", "Kundenanzahlungen", "liability", {
    role: "customer_prepayments",
  }),
  a(
    "421000",
    "Personnel, rémunérations dues",
    "Löhne und Gehälter (Verbindlichkeiten)",
    "liability",
  ),
  a("431000", "Sécurité sociale", "Sozialversicherungen", "liability"),
  a("444000", "État, impôts sur les bénéfices", "Gewinnsteuern", "liability", { only: CO }),
  a("445510", "TVA à décaisser", "MWST-Zahllast", "liability", { role: "vat_settlement" }),
  a("445620", "TVA déductible sur immobilisations", "Vorsteuer auf Anlagen", "asset", {
    role: "vat_input_invest",
  }),
  a(
    "445660",
    "TVA déductible sur autres biens et services",
    "Vorsteuer auf Waren und Leistungen",
    "asset",
    {
      role: "vat_input_material",
    },
  ),
  a("445710", "TVA collectée", "Geschuldete MWST", "liability", { role: "vat_output" }),
  a("455000", "Associés, comptes courants", "Gesellschafterkonten", "liability", { only: CO }),
  a(
    "467000",
    "Autres comptes débiteurs ou créditeurs",
    "Übrige Forderungen und Verbindlichkeiten",
    "liability",
  ),
  // 5 Financiers
  a("512000", "Banque", "Bank", "asset", { role: "bank" }),
  a("530000", "Caisse", "Kasse", "asset", { role: "cash" }),
  // 6 Charges
  a("604000", "Achats d'études et prestations de services", "Fremdleistungen", "expense"),
  a("606100", "Fournitures non stockables (eau, énergie)", "Energie", "expense"),
  a("606400", "Fournitures administratives", "Büromaterial", "expense"),
  a("607000", "Achats de marchandises", "Wareneinkauf", "expense"),
  a("613200", "Locations immobilières", "Miete", "expense"),
  a("615000", "Entretien et réparations", "Unterhalt und Reparaturen", "expense"),
  a("616000", "Primes d'assurance", "Versicherungen", "expense"),
  a("618000", "Documentation et formation", "Fachliteratur und Weiterbildung", "expense"),
  a("622600", "Honoraires", "Honorare", "expense"),
  a("623000", "Publicité", "Werbung", "expense"),
  a("625100", "Voyages et déplacements", "Reisekosten", "expense"),
  a("625700", "Réceptions", "Bewirtung", "expense"),
  a("626000", "Frais postaux et de télécommunications", "Porto und Telekommunikation", "expense"),
  a("627000", "Services bancaires", "Bankspesen", "expense", { role: "bank_fees" }),
  a("635100", "Impôts directs (CFE)", "Direkte Steuern (CFE)", "expense"),
  a("641000", "Rémunérations du personnel", "Löhne und Gehälter", "expense"),
  a("645000", "Charges de sécurité sociale", "Sozialabgaben", "expense"),
  a("651000", "Redevances pour logiciels et licences", "Lizenzen und Software", "expense"),
  a("654000", "Pertes sur créances irrécouvrables", "Forderungsverluste", "expense", {
    role: "bad_debt",
  }),
  a(
    "658000",
    "Charges diverses de gestion courante",
    "Rundungsdifferenzen und Übriges",
    "expense",
    {
      role: "rounding",
    },
  ),
  a("661000", "Charges d'intérêts", "Zinsaufwand", "expense"),
  a("666000", "Pertes de change", "Kursverluste", "expense", { role: "exchange_difference" }),
  a("681100", "Dotations aux amortissements", "Abschreibungen", "expense"),
  a("695000", "Impôts sur les bénéfices", "Gewinnsteuern", "expense", { only: CO }),
  // 7 Produits
  a("706000", "Prestations de services", "Dienstleistungserlöse", "revenue", {
    role: "revenue_default",
    vatCode: "normal",
  }),
  a("707000", "Ventes de marchandises", "Warenverkäufe", "revenue"),
  a("709000", "Rabais, remises et ristournes accordés", "Erlösminderungen", "revenue", {
    role: "sales_deductions",
  }),
  a("758000", "Produits divers de gestion courante", "Übrige betriebliche Erträge", "revenue"),
  a("766000", "Gains de change", "Kursgewinne", "revenue", { role: "exchange_gain" }),
  a("768000", "Autres produits financiers", "Übrige Finanzerträge", "revenue"),
  // 8 Comptes spéciaux
  a("890000", "Bilan d'ouverture", "Eröffnungsbilanz", "closing", { role: "opening_balance" }),
  a("891000", "Bilan de clôture", "Schlussbilanz", "closing", { role: "income_statement" }),
];
