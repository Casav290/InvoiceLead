import { and, eq, ne, sql } from "drizzle-orm";
import type { Db } from "../db";
import { auditLog, memberships, organizations, sessions, users } from "../db/schema";

/**
 * Départ d'une personne (12.10.2026). Retirée de son organisation dans ERPlead, elle gardait sa session
 * InvoiceLead ouverte et sa place occupée (constaté en production). ERPlead envoie désormais un `logout_token`
 * signé (OpenID Connect Back-Channel Logout, `/auth/lead/backchannel-logout`) : toutes ses sessions tombent ;
 * avec `lead_status: "disabled"`, elle quitte aussi l'entreprise de l'organisation annoncée (place libérée),
 * sauf si elle en est le dernier administrateur : on ne verrouille pas l'entreprise dehors.
 */
export const BACKCHANNEL_EVENT = "http://schemas.openid.net/event/backchannel-logout";

export type LogoutClaims = { sub: string; org?: string | null; lead_status?: string | null };

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
  // « logout » (elle s'est déconnectée dans ERPlead ou dans une autre app Lead) : se déconnecter ferme
  // la session partout, donc TOUTES ses sessions, quelle que soit l'entreprise ouverte (fiduciaire
  // comprise). Un départ (« disabled ») ne touche que l'entreprise de l'organisation annoncée.
  const everywhere = c.lead_status === "logout";
  if (c.org && !org && !everywhere) return { sessions: 0, left: false };
  const closed = await database
    .delete(sessions)
    .where(
      org && !everywhere
        ? and(eq(sessions.userId, user.id), eq(sessions.organizationId, org.id))
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
