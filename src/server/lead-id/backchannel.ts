import { and, eq, isNull, ne, or, sql } from "drizzle-orm";
import type { Db } from "../db";
import { auditLog, memberships, organizations, sessions, users } from "../db/schema";

/**
 * OpenID Connect Back-Channel Logout (`/auth/lead/backchannel-logout`) : ERPlead poste un `logout_token`
 * signé.
 * - `lead_status: "disabled"` (départ d'une personne, 12.10.2026 : retirée de son organisation, elle gardait
 *   sa session et sa place) : TOUTES ses sessions tombent, dans toutes les entreprises et sur tous ses
 *   appareils ; elle quitte aussi l'entreprise de l'organisation annoncée (place libérée), sauf si elle en est
 *   le dernier administrateur : on ne verrouille pas l'entreprise dehors.
 * - `lead_status: "logout"` avec `sid` (décision d'Ève du 13.10.2026) : « Se déconnecter » dans une application
 *   Lead ferme le Compte Lead et les applications DE CE NAVIGATEUR seulement. Tombent les sessions ouvertes
 *   depuis cette session du Compte Lead (`lead_sid`), et celles d'avant le 13.10.2026 qui n'en ont pas
 *   (fermées par personne, comme avant). Ses autres appareils restent connectés.
 * - sans `sid` : toutes ses sessions, comme avant.
 */
export const BACKCHANNEL_EVENT = "http://schemas.openid.net/event/backchannel-logout";

export type LogoutClaims = {
  sub: string;
  org?: string | null;
  lead_status?: string | null;
  /** Session du Compte Lead (un navigateur) qui se ferme ; absente pour un départ. */
  sid?: string | null;
};

export async function backchannelLogout(
  database: Db,
  c: LogoutClaims,
): Promise<{ sessions: number; left: boolean }> {
  const [user] = await database
    .select({ id: users.id })
    .from(users)
    .where(eq(users.leadSub, c.sub));
  if (!user) return { sessions: 0, left: false };
  const [org] = c.org
    ? await database
        .select({ id: organizations.id })
        .from(organizations)
        .where(eq(organizations.leadOrg, c.org))
    : [];
  // Départ : toutes ses sessions, quelle que soit l'entreprise ouverte (fiduciaire comprise). Déconnexion
  // d'un navigateur (`sid`) : ses sessions venues de ce navigateur, et les anciennes sans `sid`, quelle que
  // soit l'entreprise ouverte ; jamais celles de ses autres appareils.
  const disabled = c.lead_status === "disabled";
  const sid = !disabled && typeof c.sid === "string" && c.sid.length > 0 ? c.sid : null;
  const closed = await database
    .delete(sessions)
    .where(
      sid
        ? and(eq(sessions.userId, user.id), or(eq(sessions.leadSid, sid), isNull(sessions.leadSid)))
        : eq(sessions.userId, user.id),
    )
    .returning({ id: sessions.id });
  let left = false;
  if (c.lead_status === "disabled" && org) {
    const [admins] = await database
      .select({ n: sql<number>`count(*)::int` })
      .from(memberships)
      .where(
        and(
          eq(memberships.organizationId, org.id),
          eq(memberships.role, "admin"),
          ne(memberships.userId, user.id),
        ),
      );
    const [mine] = await database
      .select({ role: memberships.role })
      .from(memberships)
      .where(and(eq(memberships.organizationId, org.id), eq(memberships.userId, user.id)));
    if (mine && (mine.role !== "admin" || (admins?.n ?? 0) > 0)) {
      await database
        .delete(memberships)
        .where(and(eq(memberships.organizationId, org.id), eq(memberships.userId, user.id)));
      left = true;
    }
  }
  if (org)
    await database.insert(auditLog).values({
      organizationId: org.id,
      userId: user.id,
      action: left ? "team.member.left_lead" : "team.member.logout_lead",
    });
  return { sessions: closed.length, left };
}
