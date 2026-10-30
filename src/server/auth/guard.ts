import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { countryPack } from "@/countries";
import { REQUESTED_PATH_HEADER } from "@/lib/cookies";
import { isAppAuthAgent } from "@/lib/native";
import { betaAllowed } from "../beta";
import { db } from "../db";
import { env } from "../env";
import { refreshPlan } from "../plan-refresh";
import { featureAccess, tierOf } from "../plans";
import { seatRefusalPath } from "../refusal";
import { can, hasAppAccess, isFiduciary, type Permission } from "../roles";
import { detourOrganization, hasSeat } from "../team";
import { pickLocale, safeInvite, safeNext } from "./login-cookie";
import { type CurrentSession, getSession } from "./session";

/**
 * Où revenir après une reconnexion quand ce n'est pas la page en cours : `next` pour une route qui
 * n'existe qu'en POST (la page de son formulaire), `invite` pour une invitation à accepter.
 */
export type ReturnTo = { next?: string; invite?: string };

/**
 * Session valide, accès InvoiceLead non exigé (écran « formule sans accès »). Sans session, retour par
 * le Compte Lead, sans écran si la personne y est encore connectée.
 */
export async function requireSession(locale: string, back?: ReturnTo): Promise<CurrentSession> {
  const session = await getSession();
  if (!session) {
    // Cookie de session expiré : la page demandée est redonnée au Compte Lead, on y revient ensuite.
    const h = await headers();
    const invite = safeInvite(back?.invite);
    const next = invite ? undefined : safeNext(back?.next ?? h.get(REQUESTED_PATH_HEADER));
    redirect(sessionLoginPath(locale, { invite, next }, h.get("user-agent")));
  }
  return session;
}

/**
 * Où mène une page qui exige une session quand il n'y en a pas : tout droit vers le Compte Lead
 * (`/auth/lead/start`). Dans l'app, pour les versions qui reviennent de Google (LeadAppAuth/2), par
 * l'écran de connexion de l'app (`/<langue>/login`) : relancée par son lien de retour (fermée pendant
 * la connexion Google) avec un cookie de session périmé, la vue web n'aurait affiché aucune page
 * d'InvoiceLead avant le Compte Lead, et le lien de lancement serait perdu ; l'écran de connexion le
 * lit d'abord (lib/lead-app-auth.ts), puis part vers `/auth/lead/start` avec la même demande.
 */
export function sessionLoginPath(
  locale: string,
  wanted: { invite?: string; next?: string },
  userAgent: string | null | undefined,
): string {
  const lang = pickLocale(locale);
  const ask: Record<string, string> = wanted.invite
    ? { invite: wanted.invite }
    : wanted.next
      ? { next: wanted.next }
      : {};
  if (isAppAuthAgent(userAgent)) {
    const q = new URLSearchParams(ask).toString();
    return `/${lang}/login${q ? `?${q}` : ""}`;
  }
  return `/auth/lead/start?${new URLSearchParams({ locale: lang, ...ask })}`;
}

/** Raison pour laquelle la personne n'entre pas dans l'application, ou null si elle entre. */
export const accessProblem = cache(
  async (
    session: CurrentSession,
  ): Promise<"plan" | "beta" | "blocked" | "fiduciary" | "seat" | null> => {
    if (!session.organization.hasAccess) return "plan";
    const beta = { leadOrg: session.organization.leadOrg ?? "", email: session.user.email };
    if (!betaAllowed(env().BETA_ALLOWLIST, beta)) return "beta";
    if (!hasAppAccess(session.membership)) return "blocked";
    // Fiduciaire d'une entreprise revenue en formule gratuite : accès suspendu (formule Pro).
    if (
      isFiduciary(session.membership) &&
      !featureAccess(session.organization, "fiduciary").allowed
    )
      return "fiduciary";
    if (!(await hasSeat(db(), session.organization, session.user.id))) return "seat";
    return null;
  },
);

/**
 * Session valide, formule qui inclut InvoiceLead et place dans l'équipe. À appeler en tête de CHAQUE
 * page, action serveur et lecture de données de l'application : la mise en page ne protège pas les
 * pages, que Next rend en parallèle d'elle.
 */
export async function requireAppSession(locale: string, back?: ReturnTo): Promise<CurrentSession> {
  const found = await requireSession(locale, back);
  // Formule de plus de 12 h (fiduciaire d'une entreprise dont personne ne se connecte) : relue au
  // Compte Lead avant de décider de l'accès et des fonctions.
  const organization = await refreshPlan(db(), found.organization);
  const session = organization === found.organization ? found : { ...found, organization };
  const problem = await accessProblem(session);
  if (problem) {
    const lang = pickLocale(locale);
    const h = await headers();
    const wanted = appPage(lang, h.get(REQUESTED_PATH_HEADER));
    // Fiduciaire dont la session est chez un client revenu en formule gratuite : un lien qui désigne
    // son entreprise (import de son CRMlead, sa pièce, une fiche d'un autre client ouvert) y mène,
    // comme à la connexion (organizationForPage). Seulement pour une page qu'on ouvre : jamais pour
    // une action serveur ni un préchargement, qui ne changent pas d'entreprise.
    if (
      problem === "fiduciary" &&
      wanted &&
      !h.has("next-action") &&
      !h.has("next-router-prefetch")
    ) {
      const moved = await detourOrganization(
        db(),
        {
          id: session.session.id,
          userId: session.user.id,
          organizationId: session.organization.id,
          idToken: session.session.idToken,
        },
        wanted,
      );
      if (moved) redirect(wanted);
    }
    // Places toutes prises : la page de refus adressable, qui dit la formule de l'entreprise
    // (raison=places&formule=…) et s'affiche aussi sans session (refusal.ts).
    if (problem === "seat") redirect(seatRefusalPath(lang, tierOf(session.organization), wanted));
    // L'écran « sans accès » garde la page demandée : changer d'entreprise depuis lui y ramène.
    const q = new URLSearchParams({
      ...(problem === "plan" ? {} : { reason: problem }),
      ...(wanted ? { next: wanted } : {}),
    }).toString();
    redirect(`/${lang}/no-access${q ? `?${q}` : ""}`);
  }
  return session;
}

/** Page de l'application dans cette langue (safeNext), ou undefined. */
export function appPage(locale: string, value: string | null | undefined): string | undefined {
  const page = safeNext(value);
  const base = `/${locale}/app`;
  return page && (page === base || page.startsWith(`${base}/`) || page.startsWith(`${base}?`))
    ? page
    : undefined;
}

/** Comme requireAppSession, et le rôle de la personne permet l'action (roles.ts). */
export async function requirePermission(
  locale: string,
  permission: Permission,
  back?: ReturnTo,
): Promise<CurrentSession> {
  const session = await requireAppSession(locale, back);
  if (!can(session.membership, permission)) redirect(`/${pickLocale(locale)}/app?forbidden=1`);
  // Pays sans comptabilité dans son pack : aucune action comptable, l'écran l'explique.
  const accountingOnly = permission === "accounting" || permission === "setup";
  if (accountingOnly && !countryPack(session.organization.country).accounting)
    redirect(`/${pickLocale(locale)}/app/accounting`);
  return session;
}
