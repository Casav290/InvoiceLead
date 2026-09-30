import {
  type AccountRole,
  type AccountType,
  type ChartTemplate,
  type TemplateAccount,
  TYPES_BY_CLASS,
  templateAccounts,
} from "./ch/chart-of-accounts";
import { CHART_ACCOUNTS_DE, TYPES_BY_CLASS_DE } from "./de/chart-of-accounts";
import { CHART_ACCOUNTS_FR, TYPES_BY_CLASS_FR } from "./fr/chart-of-accounts";
import { CHART_ACCOUNTS_GB, TYPES_BY_CLASS_GB } from "./gb/chart-of-accounts";

/** Plan comptable d'un pays : modèles, classes, et règles qui dépendent des numéros de compte. */
export type ChartPack = {
  templateAccounts: (template: ChartTemplate) => TemplateAccount[];
  typesByClass: Record<string, readonly AccountType[]>;
  /** Clé des libellés de classes (messages app.accounts.*). */
  classLabels: "classes" | "classesDe" | "classesFr" | "classesGb";
  /** Numéro de compte admis (quatre chiffres en Suisse et en Allemagne, trois à huit en France). */
  numberPattern: RegExp;
  /** Produit qui compte dans le chiffre d'affaires du décompte TVA. */
  isTurnover: (account: { number: string; type: string }) => boolean;
  /** Compte d'impôt préalable pour une charge ou un investissement. */
  inputVatRole: (account: { number: string; type: string }) => AccountRole;
};

const CH: ChartPack = {
  templateAccounts,
  typesByClass: TYPES_BY_CLASS,
  classLabels: "classes",
  numberPattern: /^[1-9]\d{3}$/,
  // Produits d'exploitation (classe 3) et activités annexes (classe 7).
  isTurnover: (a) => a.type === "revenue" && /^[37]/.test(a.number),
  // Chiffre 400 pour le matériel et les prestations (classe 4), 405 pour le reste.
  inputVatRole: (a) => (a.number.startsWith("4") ? "vat_input_material" : "vat_input_invest"),
};

const DE: ChartPack = {
  templateAccounts: (template) =>
    CHART_ACCOUNTS_DE.filter((x) => !x.only || x.only === template).sort((x, y) =>
      x.number.localeCompare(y.number),
    ),
  typesByClass: TYPES_BY_CLASS_DE,
  classLabels: "classesDe",
  numberPattern: /^\d{4}$/,
  // Erlöse (classe 4) et produits de la classe 7, sauf intérêts.
  isTurnover: (a) => a.type === "revenue" && /^4/.test(a.number),
  // Une seule Vorsteuer, quel que soit l'achat (Kennzahl 66).
  inputVatRole: () => "vat_input_material",
};

const FR: ChartPack = {
  templateAccounts: (template) =>
    CHART_ACCOUNTS_FR.filter((x) => !x.only || x.only === template).sort((x, y) =>
      x.number.localeCompare(y.number),
    ),
  typesByClass: TYPES_BY_CLASS_FR,
  classLabels: "classesFr",
  numberPattern: /^[1-8]\d{2,7}$/,
  // Chiffre d'affaires : comptes 70 (ventes et prestations, rabais compris).
  isTurnover: (a) => a.type === "revenue" && /^70/.test(a.number),
  // Ligne 19 pour les immobilisations (classe 2), ligne 20 pour le reste.
  inputVatRole: (a) => (a.number.startsWith("2") ? "vat_input_invest" : "vat_input_material"),
};

const GB: ChartPack = {
  templateAccounts: (template) =>
    CHART_ACCOUNTS_GB.filter((x) => !x.only || x.only === template).sort((x, y) =>
      x.number.localeCompare(y.number),
    ),
  typesByClass: TYPES_BY_CLASS_GB,
  classLabels: "classesGb",
  numberPattern: /^\d{4}$/,
  // Ventes (classe 4) : case 6 de la déclaration.
  isTurnover: (a) => a.type === "revenue" && /^4/.test(a.number),
  // Un seul compte de TVA déductible (case 4).
  inputVatRole: () => "vat_input_material",
};

export function chartPack(country: string | null | undefined): ChartPack {
  return country === "DE" ? DE : country === "FR" ? FR : country === "GB" ? GB : CH;
}
