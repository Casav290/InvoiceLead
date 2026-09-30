/**
 * Droits dans InvoiceLead. Le rôle Lead (admin, manager, user) vient du Compte Lead ; l'administrateur
 * choisit en plus, pour chaque utilisateur, ce qu'il fait ici (appRole). Une fiduciaire invitée a le
 * rôle « fiduciary » : comptabilité et mise en place comptable, factures en lecture seule.
 */
export type AppRole = "all" | "billing" | "accounting" | "readonly" | "none";
export const APP_ROLES: AppRole[] = ["all", "billing", "accounting", "readonly", "none"];

/**
 * billing : devis, factures, contacts, articles, paiements ; accounting : banque, justificatifs,
 * journal, TVA ; setup : plan comptable, exercices, clôture ; company : réglages de l'entreprise et équipe.
 */
export type Permission = "billing" | "accounting" | "setup" | "company";

export type Member = { role: string; appRole: string | null };

export const isManager = (m: Member) => m.role === "admin" || m.role === "manager";
export const isFiduciary = (m: Member) => m.role === "fiduciary";

export function appRoleOf(m: Member): AppRole {
  if (isManager(m)) return "all";
  if (isFiduciary(m)) return "accounting";
  return (APP_ROLES as string[]).includes(m.appRole ?? "") ? (m.appRole as AppRole) : "all";
}

export function can(m: Member, permission: Permission): boolean {
  if (isManager(m)) return true;
  if (isFiduciary(m)) return permission === "accounting" || permission === "setup";
  const role = appRoleOf(m);
  if (permission === "billing") return role === "all" || role === "billing";
  if (permission === "accounting") return role === "all" || role === "accounting";
  return false;
}

/** Un membre bloqué (« none ») n'entre pas et n'occupe pas de place. */
export const hasAppAccess = (m: Member) => appRoleOf(m) !== "none";
