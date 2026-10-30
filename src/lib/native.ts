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

/**
 * Jeton d'agent des versions de l'app qui savent revenir de Google (« InvoiceLeadApp LeadAppAuth/2 »,
 * `appendUserAgent`, lead-app-auth.ts) : le Compte Lead y montre « Continuer avec Google ». Même motif
 * qu'ERPlead (src/lib/appAuth.ts, AGENT_RE). `/2` : retour par le lien https vérifié
 * (https://invoicelead.io/lead-auth/return) ; `LeadAppAuth/1` (schéma propre, jamais publiée) compte comme
 * une ancienne version, comme chez ERPlead.
 */
const APP_AUTH_AGENT = /(?:^|\s)LeadAppAuth\/(\d{1,3})(?=[\s;)]|$)/;
/** Première version du protocole qui revient par le lien vérifié (ERPlead : AGENT_MIN). */
export const APP_AUTH_MIN = 2;

/** L'app, dans une version qui reçoit le lien de retour de Google (LeadAppAuth/2 ou plus) ? */
export function isAppAuthAgent(userAgent: string | null | undefined): boolean {
  if (!isNativeAgent(userAgent)) return false;
  const m = APP_AUTH_AGENT.exec(String(userAgent).slice(0, 1000));
  return !!m && Number(m[1]) >= APP_AUTH_MIN;
}
