import type { AccountType, TemplateAccount } from "../ch/chart-of-accounts";

/**
 * Plan de comptes américain courant d'une petite entreprise (pas de plan imposé aux États-Unis) :
 * 1 actifs, 2 dettes, 3 capitaux propres, 4 produits, 5 coût des ventes, 6 charges, 7 autres
 * produits et charges, 8 impôts, 9 comptes de clôture. À faire relire par un CPA.
 */
export const TYPES_BY_CLASS_US: Record<string, readonly AccountType[]> = {
  "1": ["asset"],
  "2": ["liability"],
  "3": ["equity"],
  "4": ["revenue"],
  "5": ["expense"],
  "6": ["expense"],
  "7": ["revenue", "expense"],
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

export const CHART_ACCOUNTS_US: readonly TemplateAccount[] = [
  a("1000", "Checking account", "Compte courant", "Bankkonto", "asset", { role: "bank" }),
  a("1010", "Petty cash", "Caisse", "Kasse", "asset", { role: "cash" }),
  a("1200", "Accounts receivable", "Clients", "Debitoren", "asset", { role: "receivable" }),
  a("1500", "Equipment", "Équipement", "Ausstattung", "asset"),
  a("1510", "Computers and software", "Informatique et logiciels", "EDV und Software", "asset"),
  a(
    "1590",
    "Accumulated depreciation",
    "Amortissements cumulés",
    "Kumulierte Abschreibungen",
    "asset",
  ),
  a("2000", "Accounts payable", "Fournisseurs", "Kreditoren", "liability", { role: "payable" }),
  a("2100", "Customer deposits", "Acomptes clients", "Kundenanzahlungen", "liability", {
    role: "customer_prepayments",
  }),
  a("2200", "Sales tax payable", "Sales tax collectée", "Geschuldete Sales Tax", "liability", {
    role: "vat_output",
  }),
  a(
    "2210",
    "Sales tax due to state",
    "Sales tax à reverser",
    "Sales Tax an den Bundesstaat",
    "liability",
    { role: "vat_settlement" },
  ),
  a("2300", "Payroll liabilities", "Dettes salariales", "Lohnverbindlichkeiten", "liability"),
  a("2400", "Loans payable", "Emprunts", "Darlehen", "liability"),
  a("3000", "Owner's equity", "Capital de l'exploitant", "Eigenkapital", "equity", {
    role: "equity",
    only: SP,
  }),
  a("3100", "Owner's draw", "Prélèvements", "Privatentnahmen", "equity", {
    role: "private",
    only: SP,
  }),
  a("3000", "Common stock", "Capital social", "Aktienkapital", "equity", {
    role: "equity",
    only: CO,
  }),
  a("3200", "Retained earnings", "Bénéfices non distribués", "Gewinnvortrag", "equity", {
    role: "retained_earnings",
  }),
  a("3300", "Current year earnings", "Résultat de l'exercice", "Jahresergebnis", "equity", {
    role: "annual_result",
  }),
  a("4000", "Service revenue", "Prestations de services", "Dienstleistungserlöse", "revenue", {
    role: "revenue_default",
    vatCode: "normal",
  }),
  a("4100", "Product sales", "Ventes de produits", "Warenverkäufe", "revenue"),
  a("4900", "Sales discounts", "Remises accordées", "Gewährte Rabatte", "revenue", {
    role: "sales_deductions",
  }),
  a("5000", "Cost of goods sold", "Coût des ventes", "Warenaufwand", "expense"),
  a("5100", "Contract labor", "Sous-traitance", "Fremdleistungen", "expense"),
  a("6000", "Advertising and marketing", "Publicité", "Werbung", "expense"),
  a("6100", "Bank fees", "Frais bancaires", "Bankspesen", "expense", { role: "bank_fees" }),
  a("6200", "Insurance", "Assurances", "Versicherungen", "expense"),
  a("6300", "Legal and professional fees", "Honoraires", "Rechts- und Beratungskosten", "expense"),
  a("6400", "Office supplies", "Fournitures de bureau", "Büromaterial", "expense"),
  a("6500", "Rent", "Loyer", "Miete", "expense"),
  a(
    "6600",
    "Software and subscriptions",
    "Logiciels et abonnements",
    "Software und Abonnemente",
    "expense",
  ),
  a("6700", "Telephone and internet", "Téléphone et internet", "Telefon und Internet", "expense"),
  a("6800", "Travel", "Voyages", "Reisekosten", "expense"),
  a("6850", "Meals", "Repas d'affaires", "Bewirtung", "expense"),
  a("6900", "Utilities", "Énergie", "Energie", "expense"),
  a("6950", "Bad debt", "Pertes sur créances", "Forderungsverluste", "expense", {
    role: "bad_debt",
  }),
  a("6960", "Rounding differences", "Différences d'arrondi", "Rundungsdifferenzen", "expense", {
    role: "rounding",
  }),
  a("6970", "Foreign exchange loss", "Pertes de change", "Kursverluste", "expense", {
    role: "exchange_difference",
  }),
  a("6980", "Depreciation", "Amortissements", "Abschreibungen", "expense"),
  a("7000", "Interest income", "Produits d'intérêts", "Zinserträge", "revenue"),
  a("7100", "Interest expense", "Charges d'intérêts", "Zinsaufwand", "expense"),
  a("8000", "Income tax", "Impôt sur le revenu", "Einkommenssteuer", "expense", { only: CO }),
  a("9000", "Opening balance equity", "Bilan d'ouverture", "Eröffnungsbilanz", "closing", {
    role: "opening_balance",
  }),
  a(
    "9990",
    "Income summary",
    "Compte de résultat (clôture)",
    "Erfolgsrechnung (Abschluss)",
    "closing",
    { role: "income_statement" },
  ),
];
