import type { AccountType, TemplateAccount } from "../ch/chart-of-accounts";

/**
 * Plan de comptes britannique (nominal ledger), sur la numérotation courante des logiciels du
 * Royaume-Uni : 0 immobilisations, 1 actifs circulants, 2 dettes, 3 capitaux, 4 ventes, 5 achats,
 * 6 charges directes, 7 et 8 frais généraux, 9 comptes de contrôle. Le Royaume-Uni n'impose pas de
 * plan : celui-ci est une base, à faire relire par un accountant avant l'ouverture.
 */
export const TYPES_BY_CLASS_GB: Record<string, readonly AccountType[]> = {
  "0": ["asset"],
  "1": ["asset"],
  "2": ["liability"],
  "3": ["equity"],
  "4": ["revenue"],
  "5": ["expense"],
  "6": ["expense"],
  "7": ["expense"],
  "8": ["expense"],
  "9": ["closing"],
};

const SP = "sole_proprietorship" as const;
const CO = "corporation" as const;

const a = (
  number: string,
  en: string,
  fr: string,
  de: string,
  type: AccountType,
  extra: Partial<TemplateAccount> = {},
): TemplateAccount => ({ number, en, fr, de, type, ...extra });

export const CHART_ACCOUNTS_GB: readonly TemplateAccount[] = [
  a(
    "0030",
    "Office equipment and IT",
    "Matériel de bureau et informatique",
    "Büro- und EDV-Ausstattung",
    "asset",
  ),
  a("0050", "Motor vehicles", "Véhicules", "Fahrzeuge", "asset"),
  a("0080", "Software", "Logiciels", "Software", "asset"),
  a("1100", "Trade debtors", "Clients", "Forderungen aus Lieferungen und Leistungen", "asset", {
    role: "receivable",
  }),
  a("1200", "Bank current account", "Banque", "Bank", "asset", { role: "bank" }),
  a("1230", "Petty cash", "Caisse", "Kasse", "asset", { role: "cash" }),
  a(
    "2100",
    "Trade creditors",
    "Fournisseurs",
    "Verbindlichkeiten aus Lieferungen und Leistungen",
    "liability",
    { role: "payable" },
  ),
  a("2110", "Customer deposits", "Acomptes clients", "Kundenanzahlungen", "liability", {
    role: "customer_prepayments",
  }),
  a("2200", "Sales tax control (output VAT)", "TVA collectée", "Umsatzsteuer", "liability", {
    role: "vat_output",
  }),
  a("2201", "Purchase tax control (input VAT)", "TVA déductible", "Vorsteuer", "liability", {
    role: "vat_input_material",
  }),
  a("2202", "VAT liability", "TVA à payer", "MWST-Zahllast", "liability", {
    role: "vat_settlement",
  }),
  a(
    "2210",
    "PAYE and National Insurance",
    "Charges sociales",
    "Lohnsteuer und Sozialversicherung",
    "liability",
  ),
  a("2300", "Loans", "Emprunts", "Darlehen", "liability"),
  a("3000", "Capital introduced", "Apport de l'exploitant", "Eigenkapital", "equity", {
    role: "equity",
    only: SP,
  }),
  a("3050", "Drawings", "Prélèvements", "Privatentnahmen", "equity", { role: "private", only: SP }),
  a("3000", "Ordinary shares", "Capital social", "Stammkapital", "equity", {
    role: "equity",
    only: CO,
  }),
  a("3200", "Profit and loss reserve", "Report à nouveau", "Gewinnvortrag", "equity", {
    role: "retained_earnings",
  }),
  a("3260", "Current year profit", "Résultat de l'exercice", "Jahresergebnis", "equity", {
    role: "annual_result",
  }),
  a("4000", "Sales", "Ventes et prestations", "Umsatzerlöse", "revenue", {
    role: "revenue_default",
    vatCode: "normal",
  }),
  a("4009", "Discounts allowed", "Remises accordées", "Gewährte Rabatte", "revenue", {
    role: "sales_deductions",
  }),
  a("4900", "Other income", "Autres produits", "Übrige Erträge", "revenue"),
  a("5000", "Materials purchased", "Achats de marchandises", "Wareneinkauf", "expense"),
  a("6100", "Subcontractors", "Sous-traitance", "Fremdleistungen", "expense"),
  a("7000", "Gross wages", "Salaires", "Löhne und Gehälter", "expense"),
  a("7100", "Rent", "Loyer", "Miete", "expense"),
  a("7200", "Utilities", "Énergie", "Energie", "expense"),
  a("7300", "Motor expenses", "Frais de véhicules", "Fahrzeugkosten", "expense"),
  a("7400", "Travel and subsistence", "Voyages et déplacements", "Reisekosten", "expense"),
  a("7500", "Office stationery", "Fournitures de bureau", "Büromaterial", "expense"),
  a("7502", "Telephone and internet", "Téléphone et internet", "Telefon und Internet", "expense"),
  a("7600", "Legal and professional fees", "Honoraires", "Rechts- und Beratungskosten", "expense"),
  a("7610", "Accountancy fees", "Honoraires comptables", "Buchhaltungskosten", "expense"),
  a("7700", "Software subscriptions", "Abonnements logiciels", "Software-Abonnemente", "expense"),
  a("7800", "Insurance", "Assurances", "Versicherungen", "expense"),
  a("7900", "Bank charges", "Frais bancaires", "Bankspesen", "expense", { role: "bank_fees" }),
  a("7906", "Exchange rate differences", "Différences de change", "Kursdifferenzen", "expense", {
    role: "exchange_difference",
  }),
  a("7910", "Rounding differences", "Différences d'arrondi", "Rundungsdifferenzen", "expense", {
    role: "rounding",
  }),
  a("8000", "Depreciation", "Amortissements", "Abschreibungen", "expense"),
  a("8100", "Bad debt write-off", "Pertes sur créances", "Forderungsverluste", "expense", {
    role: "bad_debt",
  }),
  a("8200", "Advertising and marketing", "Publicité", "Werbung", "expense"),
  a("8300", "Corporation tax", "Impôt sur les sociétés", "Körperschaftsteuer", "expense", {
    only: CO,
  }),
  a("9000", "Opening balances control", "Bilan d'ouverture", "Eröffnungsbilanz", "closing", {
    role: "opening_balance",
  }),
  a(
    "9990",
    "Profit and loss summary",
    "Compte de résultat (clôture)",
    "Erfolgsrechnung (Abschluss)",
    "closing",
    { role: "income_statement" },
  ),
];
