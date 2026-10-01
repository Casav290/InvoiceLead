import { and, asc, eq, gt, isNull, sql } from "drizzle-orm";
import { randomToken, sha256Hex } from "./auth/crypto";
import type { Db } from "./db";
import {
  auditLog,
  fiduciaryInvitations,
  memberships,
  organizations,
  sessions,
  users,
} from "./db/schema";
import { seatsOf } from "./plans";
import {
  APP_ROLES,
  type AppRole,
  hasAppAccess,
  isFiduciary,
  isManager,
  type Member,
} from "./roles";

type Who = { organizationId: string; userId: string };

export const INVITATION_DAYS = 14;

async function membershipOf(database: Db, organizationId: string, userId: string) {
  const [row] = await database
    .select({ role: memberships.role, appRole: memberships.appRole })
    .from(memberships)
    .where(and(eq(memberships.organizationId, organizationId), eq(memberships.userId, userId)))
    .limit(1);
  return row ?? null;
}

/** Membres de l'entreprise (fiduciaires à part) et invitations en attente. */
export async function listTeam(database: Db, organizationId: string) {
  const rows = await database
    .select({
      userId: users.id,
      name: users.name,
      email: users.email,
      role: memberships.role,
      appRole: memberships.appRole,
      createdAt: memberships.createdAt,
    })
    .from(memberships)
    .innerJoin(users, eq(memberships.userId, users.id))
    .where(eq(memberships.organizationId, organizationId))
    .orderBy(asc(memberships.createdAt));
  const invitations = await database
    .select()
    .from(fiduciaryInvitations)
    .where(
      and(
        eq(fiduciaryInvitations.organizationId, organizationId),
        isNull(fiduciaryInvitations.acceptedAt),
        gt(fiduciaryInvitations.expiresAt, new Date()),
      ),
    )
    .orderBy(asc(fiduciaryInvitations.createdAt));
  return {
    members: rows.filter((r) => !isFiduciary(r)),
    fiduciaries: rows.filter(isFiduciary),
    invitations,
  };
}

/**
 * Personnes qui occupent une place de la formule : membres non bloqués, responsables d'abord, puis
 * par ordre d'arrivée. Les fiduciaires invitées ne comptent pas.
 */
export function seated<T extends Member & { userId: string; createdAt: Date }>(
  members: T[],
  seats: number,
): Set<string> {
  const ordered = members
    .filter((m) => !isFiduciary(m) && hasAppAccess(m))
    .sort(
      (a, b) =>
        Number(isManager(b)) - Number(isManager(a)) ||
        a.createdAt.getTime() - b.createdAt.getTime(),
    );
  return new Set(ordered.slice(0, seats).map((m) => m.userId));
}

/** La personne a-t-elle une place dans l'entreprise d'après sa formule ? */
export async function hasSeat(
  database: Db,
  org: { id: string; leadPlan: string; entitlements: unknown },
  userId: string,
): Promise<boolean> {
  const { members, fiduciaries } = await listTeam(database, org.id);
  if (fiduciaries.some((f) => f.userId === userId)) return true;
  return seated(members, seatsOf(org)).has(userId);
}

/** Change ce qu'un utilisateur fait dans InvoiceLead. Les responsables Lead gardent tous les droits. */
export async function setAppRole(
  database: Db,
  who: Who,
  targetUserId: string,
  appRole: string,
): Promise<"saved" | "forbidden" | "invalid"> {
  const me = await membershipOf(database, who.organizationId, who.userId);
  if (!me || !isManager(me)) return "forbidden";
  if (!(APP_ROLES as string[]).includes(appRole)) return "invalid";
  const target = await membershipOf(database, who.organizationId, targetUserId);
  if (!target || isManager(target) || isFiduciary(target)) return "invalid";
  await database
    .update(memberships)
    .set({ appRole: appRole as AppRole })
    .where(
      and(eq(memberships.organizationId, who.organizationId), eq(memberships.userId, targetUserId)),
    );
  await database.insert(auditLog).values({
    organizationId: who.organizationId,
    userId: who.userId,
    action: "team.role",
    entity: "user",
    entityId: targetUserId,
    data: { appRole },
  });
  return "saved";
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Crée une invitation de fiduciaire. Rend le jeton en clair, à mettre dans le lien, une seule fois. */
export async function inviteFiduciary(
  database: Db,
  who: Who,
  rawEmail: string,
): Promise<{ token: string; email: string } | "forbidden" | "invalid"> {
  const me = await membershipOf(database, who.organizationId, who.userId);
  if (!me || !isManager(me)) return "forbidden";
  const email = rawEmail.trim().toLowerCase();
  if (!EMAIL_RE.test(email) || email.length > 254) return "invalid";
  const token = randomToken();
  await database.insert(fiduciaryInvitations).values({
    organizationId: who.organizationId,
    email,
    tokenHash: sha256Hex(token),
    invitedBy: who.userId,
    expiresAt: new Date(Date.now() + INVITATION_DAYS * 86_400_000),
  });
  await database.insert(auditLog).values({
    organizationId: who.organizationId,
    userId: who.userId,
    action: "team.fiduciary.invite",
    data: { email },
  });
  return { token, email };
}

export type AcceptResult =
  | { status: "accepted"; organizationId: string; organizationName: string }
  | { status: "invalid" | "expired" | "wrongEmail" };

/**
 * Acceptation par la fiduciaire, connectée avec son propre Compte Lead : l'adresse de l'invitation doit
 * être la sienne. Une personne déjà membre de l'entreprise garde son rôle.
 */
export async function acceptInvitation(
  database: Db,
  user: { id: string; email: string },
  token: string,
): Promise<AcceptResult> {
  return database.transaction(async (tx) => {
    const [inv] = await tx
      .select({ invitation: fiduciaryInvitations, orgName: organizations.name })
      .from(fiduciaryInvitations)
      .innerJoin(organizations, eq(fiduciaryInvitations.organizationId, organizations.id))
      .where(eq(fiduciaryInvitations.tokenHash, sha256Hex(token)))
      .for("update")
      .limit(1);
    if (!inv || inv.invitation.acceptedAt) return { status: "invalid" };
    if (inv.invitation.expiresAt < new Date()) return { status: "expired" };
    if (inv.invitation.email !== user.email.trim().toLowerCase()) return { status: "wrongEmail" };
    const organizationId = inv.invitation.organizationId;
    await tx
      .insert(memberships)
      .values({ organizationId, userId: user.id, role: "fiduciary" })
      .onConflictDoNothing();
    await tx
      .update(fiduciaryInvitations)
      .set({ acceptedAt: new Date(), acceptedBy: user.id })
      .where(eq(fiduciaryInvitations.id, inv.invitation.id));
    await tx.insert(auditLog).values({
      organizationId,
      userId: user.id,
      action: "team.fiduciary.accept",
    });
    return { status: "accepted", organizationId, organizationName: inv.orgName };
  });
}

/** Retire l'accès d'une fiduciaire ; ses sessions ouvertes sur l'entreprise tombent aussitôt. */
export async function removeFiduciary(
  database: Db,
  who: Who,
  targetUserId: string,
): Promise<"removed" | "forbidden" | "invalid"> {
  const me = await membershipOf(database, who.organizationId, who.userId);
  if (!me || !isManager(me)) return "forbidden";
  const deleted = await database
    .delete(memberships)
    .where(
      and(
        eq(memberships.organizationId, who.organizationId),
        eq(memberships.userId, targetUserId),
        eq(memberships.role, "fiduciary"),
      ),
    )
    .returning({ userId: memberships.userId });
  if (deleted.length === 0) return "invalid";
  await database
    .delete(sessions)
    .where(and(eq(sessions.organizationId, who.organizationId), eq(sessions.userId, targetUserId)));
  await database.insert(auditLog).values({
    organizationId: who.organizationId,
    userId: who.userId,
    action: "team.fiduciary.remove",
    entity: "user",
    entityId: targetUserId,
  });
  return "removed";
}

export async function cancelInvitation(
  database: Db,
  who: Who,
  invitationId: string,
): Promise<"cancelled" | "forbidden"> {
  const me = await membershipOf(database, who.organizationId, who.userId);
  if (!me || !isManager(me)) return "forbidden";
  await database
    .delete(fiduciaryInvitations)
    .where(
      and(
        eq(fiduciaryInvitations.id, invitationId),
        eq(fiduciaryInvitations.organizationId, who.organizationId),
        isNull(fiduciaryInvitations.acceptedAt),
      ),
    );
  return "cancelled";
}

/** Entreprises où la personne peut travailler : la sienne et celles de ses clients (fiduciaire). */
export async function listUserOrganizations(database: Db, userId: string) {
  return database
    .select({ id: organizations.id, name: organizations.name, role: memberships.role })
    .from(memberships)
    .innerJoin(organizations, eq(memberships.organizationId, organizations.id))
    .where(
      and(eq(memberships.userId, userId), sql`coalesce(${memberships.appRole}, 'all') <> 'none'`),
    )
    .orderBy(sql`${memberships.role} = 'fiduciary'`, asc(organizations.name));
}

/**
 * Passe la session sur une autre entreprise, si la personne en est membre. Le choix est gardé
 * (users.last_organization_id) : à la reconnexion, une fiduciaire revient chez le client où elle
 * travaillait (resumeOrganization), et non dans sa propre entreprise où la page demandée n'existe pas.
 */
export async function switchOrganization(
  database: Db,
  sessionId: string,
  userId: string,
  organizationId: string,
): Promise<boolean> {
  const member = await membershipOf(database, organizationId, userId);
  if (!member || !hasAppAccess(member)) return false;
  await database
    .update(sessions)
    .set({ organizationId })
    .where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId)));
  await database
    .update(users)
    .set({ lastOrganizationId: organizationId })
    .where(eq(users.id, userId));
  return true;
}

/**
 * Entreprise où ouvrir la session d'une connexion : la dernière choisie par la personne si elle y
 * travaille comme fiduciaire avec un accès à InvoiceLead, sinon celle de son Compte Lead. Le choix ne
 * vient que de la ligne de la personne, jamais de la requête, et l'appartenance est relue à chaque
 * connexion : une fiduciaire retirée (ou sans accès) revient dans sa propre entreprise, et son choix
 * est oublié. Une entreprise qui n'est pas une fiduciaire n'est jamais reprise : celle-là, c'est le
 * Compte Lead qui la donne.
 */
export async function resumeOrganization(
  database: Db,
  user: { id: string; lastOrganizationId: string | null },
  leadOrganizationId: string,
): Promise<string> {
  const last = user.lastOrganizationId;
  if (!last || last === leadOrganizationId) return leadOrganizationId;
  const member = await membershipOf(database, last, user.id);
  if (member && isFiduciary(member) && hasAppAccess(member)) return last;
  if (!member || !hasAppAccess(member))
    await database
      .update(users)
      .set({ lastOrganizationId: null })
      .where(and(eq(users.id, user.id), eq(users.lastOrganizationId, last)));
  return leadOrganizationId;
}
