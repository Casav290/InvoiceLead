import type { TemplateAccount } from "./ch/chart-of-accounts";

/**
 * Compte des frais de rappel et intérêts moratoires facturés aux clients : un produit financier, hors
 * chiffre d'affaires (ni TVA ni case de ventes), dans chaque plan. Le compte existe déjà dans les
 * plans suisse, allemand, français et américain ; au Royaume-Uni il est ajouté à part.
 */
const LATE: Record<string, Omit<TemplateAccount, "role" | "type">> = {
  CH: { number: "6950", de: "Finanzertrag", fr: "Produits financiers", en: "Financial income" },
  DE: { number: "7100", de: "Zinserträge", fr: "Produits d'intérêts", en: "Interest income" },
  FR: {
    number: "768000",
    de: "Übrige Finanzerträge",
    fr: "Autres produits financiers",
    en: "Other financial income",
  },
  GB: {
    number: "4950",
    de: "Mahngebühren und Verzugszinsen",
    fr: "Frais de rappel et intérêts de retard",
    en: "Late payment charges and interest",
  },
  US: { number: "7000", de: "Zinserträge", fr: "Produits d'intérêts", en: "Interest income" },
};

export function lateChargesAccount(country: string | null | undefined): TemplateAccount {
  const a = LATE[country ?? "CH"] ?? (LATE.CH as Omit<TemplateAccount, "role" | "type">);
  return { ...a, type: "revenue", role: "late_charges" };
}
