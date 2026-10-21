/**
 * L'app Android / iOS d'InvoiceLead (coque Capacitor) ouvre https://invoicelead.io : c'est ce même
 * site qui tourne dedans. On la reconnaît à son agent, posé par `appendUserAgent` des deux coques.
 *
 * Dans l'app, ni prix, ni formule à acheter, ni renvoi vers un paiement ailleurs : Apple (règle
 * 3.1.1) et Google Play exigent leurs propres achats intégrés pour un abonnement numérique.
 */
export const NATIVE_APP_AGENT = "InvoiceLeadApp";

export function isNativeAgent(userAgent: string | null | undefined): boolean {
  return !!userAgent && userAgent.includes(NATIVE_APP_AGENT);
}
