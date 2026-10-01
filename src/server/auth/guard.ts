import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { countryPack } from "@/countries";
import { REQUESTED_PATH_HEADER } from "@/lib/cookies";
import { betaAllowed } from "../beta";
import { db } from "../db";
import { env } from "../env";
import { can, hasAppAccess, type Permission } from "../roles";
import { hasSeat } from "../team";
import { pickLocale, safeNext } from "./login-cookie";
import { type CurrentSession, getSession } from "./session";

/**
 * Session valide, accès InvoiceLead non exigé (écran « formule sans accès »). Sans session, retour par
 * le Compte Lead, sans écran si la personne y est encore connectée.
 */
export async function requireSession(locale: string): Promise<CurrentSession> {
  const session = await getSession();
  if (!session) {
    // Cookie de session expiré : la page demandée est redonnée au Compte Lead, on y revient ensuite.
    const next = safeNext((await headers()).get(REQUESTED_PATH_HEADER));
    redirect(
      `/auth/lead/start?${new URLSearchParams({ locale: pickLocale(locale), ...(next ? { next } : {}) })}`,
    );
  }
  return session;
}

/** Raison pour laquelle la personne n'entre pas dans l'application, ou null si elle entre. */
export const accessProblem = cache(
  async (session: CurrentSession): Promise<"plan" | "beta" | "blocked" | "seat" | null> => {
    if (!session.organization.hasAccess) return "plan";
    const beta = { leadOrg: session.organization.leadOrg ?? "", email: session.user.email };
    if (!betaAllowed(env().BETA_ALLOWLIST, beta)) return "beta";
    if (!hasAppAccess(session.membership)) return "blocked";
    if (!(await hasSeat(db(), session.organization, session.user.id))) return "seat";
    return null;
  },
);

/**
 * Session valide, formule qui inclut InvoiceLead et place dans l'équipe. À appeler en tête de CHAQUE
 * page, action serveur et lecture de données de l'application : la mise en page ne protège pas les
 * pages, que Next rend en parallèle d'elle.
 */
export async function requireAppSession(locale: string): Promise<CurrentSession> {
  const session = await requireSession(locale);
  const problem = await accessProblem(session);
  if (problem) {
    const reason = problem === "plan" ? "" : `?reason=${problem}`;
    redirect(`/${pickLocale(locale)}/no-access${reason}`);
  }
  return session;
}

/** Comme requireAppSession, et le rôle de la personne permet l'action (roles.ts). */
export async function requirePermission(
  locale: string,
  permission: Permission,
): Promise<CurrentSession> {
  const session = await requireAppSession(locale);
  if (!can(session.membership, permission)) redirect(`/${pickLocale(locale)}/app?forbidden=1`);
  // Pays sans comptabilité dans son pack : aucune action comptable, l'écran l'explique.
  const accountingOnly = permission === "accounting" || permission === "setup";
  if (accountingOnly && !countryPack(session.organization.country).accounting)
    redirect(`/${pickLocale(locale)}/app/accounting`);
  return session;
}
