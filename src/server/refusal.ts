import { LEAD_FAMILY } from "@/lib/lead-apps";
import { PLANS, type Tier } from "./plans";

/**
 * Page de refus « places » (billing-followups-design.md, § 4.1 et 6a ; même modèle que Greetlead
 * `/fr/no-access?raison=places&formule=…`) : l'arrivée refusée faute de place mène à une adresse qui
 * dit la formule de l'entreprise, et la page s'affiche aussi sans session (formule lue dans l'adresse ;
 * avec une session, celle de la session prime). Elle offre toujours « Changer de compte » (nouvelle
 * identification au Compte Lead, jamais la même session reprise), le Compte ERPlead, et le conseil
 * juste selon la formule. Fonctions pures : testées sans page.
 */
export type Formule = Tier;

/** Places de chaque formule, quand seule l'adresse les dit (page sans session). */
export const FORMULE_SEATS: Record<Formule, number> = {
  free: PLANS.free.seats,
  pro: PLANS.pro.seats,
  proplus: PLANS.proplus.seats,
};

/** Formule lue dans l'adresse (« proplus », ou « pro_plus » comme le Compte Lead l'écrit), sinon null. */
export function formuleOf(value: unknown): Formule | null {
  if (value === "free" || value === "pro" || value === "proplus") return value;
  return value === "pro_plus" ? "proplus" : null;
}

/** Adresse du refus « places », avec la page demandée (une page de l'application) pour y revenir. */
export function seatRefusalPath(locale: string, formule: Formule, next?: string): string {
  const q = new URLSearchParams({ raison: "places", formule, ...(next ? { next } : {}) });
  return `/${locale}/no-access?${q}`;
}

/**
 * « Changer de compte » : un lien, pas un formulaire. Le départ vers le Compte Lead avec `switch=1`
 * redemande l'identifiant (prompt=login), même quand une session est ouverte ici ou là-bas ; sur un
 * refus, l'application n'a souvent pas de session, donc pas de jeton pour une déconnexion.
 */
export function switchAccountPath(locale: string): string {
  return `/auth/lead/start?${new URLSearchParams({ switch: "1", locale })}`;
}

/** Le Compte ERPlead : l'adresse d'entrée d'ERPlead dans la liste de famille (lanceur). */
export const LEAD_ACCOUNT_URL =
  LEAD_FAMILY.apps.find((app) => app.code === "erplead")?.entry ?? "https://erplead.io/account";

/** Page publique des tarifs (« Voir les formules »). */
export function plansPath(locale: string): string {
  return `/${locale}/pricing`;
}

export type SeatAdvice = {
  /** Texte du conseil : passer à Pro+ (administrateur, ou le demander), libérer une place. */
  advice: "upgradeAdmin" | "upgradeAsk" | "freeUp" | "freeUpAdmin";
  /** Lien de mise à niveau : Pro+ ici même, le portail, la page des tarifs, ou rien. */
  offer: "checkout" | "portal" | "plans" | null;
};

/**
 * Conseil selon la formule : Pro+ plein, aucune formule ne donne plus de places, donc aucune offre et
 * « libérer une place » ; Gratuit ou Pro, passer à Pro+ (cinq places) : l'administrateur le prend ici
 * (Checkout, ou le portail s'il est déjà abonné), une autre personne voit les formules et le demande.
 */
export function seatAdvice(input: {
  formule: Formule;
  admin: boolean;
  canCheckout: boolean;
  canPortal: boolean;
}): SeatAdvice {
  if (input.formule === "proplus")
    return { advice: input.admin ? "freeUpAdmin" : "freeUp", offer: null };
  if (!input.admin) return { advice: "upgradeAsk", offer: "plans" };
  return {
    advice: "upgradeAdmin",
    offer: input.canCheckout ? "checkout" : input.canPortal ? "portal" : "plans",
  };
}
