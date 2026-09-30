import "server-only";
import { redirect } from "next/navigation";
import { pickLocale } from "./login-cookie";
import { type CurrentSession, getSession } from "./session";

/**
 * Session valide, accès InvoiceLead non exigé (écran « formule sans accès »). Sans session, retour par
 * le Compte Lead, sans écran si la personne y est encore connectée.
 */
export async function requireSession(locale: string): Promise<CurrentSession> {
  const session = await getSession();
  if (!session) redirect(`/auth/lead/start?locale=${pickLocale(locale)}`);
  return session;
}

/**
 * Session valide ET formule qui inclut InvoiceLead. À appeler en tête de CHAQUE page, action serveur
 * et lecture de données de l'application : la mise en page ne protège pas les pages, que Next rend
 * en parallèle d'elle.
 */
export async function requireAppSession(locale: string): Promise<CurrentSession> {
  const session = await requireSession(locale);
  if (!session.organization.hasAccess) redirect(`/${pickLocale(locale)}/no-access`);
  return session;
}
