import type { TemplateAccount } from "./ch/chart-of-accounts";

/**
 * Compte d'attente des paiements en ligne (Stripe) : le paiement du client y entre, le versement
 * de Stripe sur la banque l'en sort, et le solde restant correspond aux frais du prestataire.
 * Un numéro libre de chaque plan, dans la classe des liquidités.
 */
const CLEARING: Record<string, Omit<TemplateAccount, "role" | "type">> = {
  CH: {
    number: "1091",
    de: "Zahlungsdienstleister (Transfer)",
    fr: "Prestataire de paiement (transit)",
    it: "Fornitore di servizi di pagamento (transito)",
    es: "Proveedor de servicios de pago (tránsito)",
    en: "Payment provider clearing",
  },
  DE: {
    number: "1460",
    de: "Geldtransit Zahlungsdienstleister",
    fr: "Prestataire de paiement (transit)",
    it: "Transito fornitore di servizi di pagamento",
    es: "Tránsito del proveedor de servicios de pago",
    en: "Payment provider clearing",
  },
  FR: {
    number: "517000",
    de: "Zahlungsdienstleister (Transfer)",
    fr: "Prestataire de paiement (fonds en transit)",
    it: "Fornitore di servizi di pagamento (fondi in transito)",
    es: "Proveedor de servicios de pago (fondos en tránsito)",
    en: "Payment provider clearing",
  },
  GB: {
    number: "1250",
    de: "Zahlungsdienstleister (Transfer)",
    fr: "Prestataire de paiement (transit)",
    it: "Conto di transito del fornitore di pagamenti",
    es: "Cuenta puente del proveedor de pagos",
    en: "Payment provider clearing",
  },
  US: {
    number: "1020",
    de: "Zahlungsdienstleister (Transfer)",
    fr: "Prestataire de paiement (transit)",
    it: "Conto di transito dell'elaboratore di pagamenti",
    es: "Cuenta puente del procesador de pagos",
    en: "Payment processor clearing",
  },
};

export function clearingAccount(country: string | null | undefined): TemplateAccount {
  const a = CLEARING[country ?? "CH"] ?? (CLEARING.CH as Omit<TemplateAccount, "role" | "type">);
  return { ...a, type: "asset", role: "payment_clearing" };
}
