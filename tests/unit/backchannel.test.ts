import { and, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { attachLeadIdentity } from "@/server/auth/attach";
import { createSession } from "@/server/auth/session";
import { memberships, sessions } from "@/server/db/schema";
import { backchannelLogout } from "@/server/lead-id/backchannel";
import { claims } from "../support/claims";
import { testDb } from "../support/db";

const t = testDb();
const db = t.database;
beforeEach(() => t.reset());
afterAll(() => t.close());

const plus = {
  plan: { code: "pro_plus", name: "Pro+", rank: 20, seats: 5 },
  apps: claims().lead!.apps,
  subscriptions: [],
};

describe("départ d'une personne (OpenID Back-Channel Logout)", () => {
  it("ferme ses sessions et libère sa place ; le dernier administrateur garde l'entreprise", async () => {
    const admin = await attachLeadIdentity(db, claims({ lead: plus }));
    const bob = await attachLeadIdentity(
      db,
      claims({
        sub: "sub-bob",
        email: "bob@atelier.test",
        name: "Bob",
        org_role: "user",
        lead: plus,
      }),
    );
    const org = admin.organization.id;
    expect(bob.organization.id).toBe(org);
    await createSession(db, { userId: bob.user.id, organizationId: org, idToken: null });
    await createSession(db, { userId: bob.user.id, organizationId: org, idToken: null });
    await createSession(db, { userId: admin.user.id, organizationId: org, idToken: null });

    // Une organisation qui n'est pas la sienne : rien ne bouge.
    expect(
      await backchannelLogout(db, { sub: "sub-bob", org: "org-autre", lead_status: "disabled" }),
    ).toEqual({ sessions: 0, left: false });

    expect(
      await backchannelLogout(db, { sub: "sub-bob", org: "org-atelier", lead_status: "disabled" }),
    ).toEqual({ sessions: 2, left: true });
    expect(await db.select().from(sessions).where(eq(sessions.userId, bob.user.id))).toHaveLength(
      0,
    );
    expect(
      await db
        .select()
        .from(memberships)
        .where(and(eq(memberships.organizationId, org), eq(memberships.userId, bob.user.id))),
    ).toHaveLength(0);
    // Les sessions des autres restent.
    expect(await db.select().from(sessions).where(eq(sessions.userId, admin.user.id))).toHaveLength(
      1,
    );

    // Rejoué : sans effet, sans erreur.
    expect(
      await backchannelLogout(db, { sub: "sub-bob", org: "org-atelier", lead_status: "disabled" }),
    ).toEqual({ sessions: 0, left: false });

    // Le dernier administrateur : sessions fermées, mais il reste dans l'entreprise.
    expect(
      await backchannelLogout(db, { sub: "sub-ada", org: "org-atelier", lead_status: "disabled" }),
    ).toEqual({ sessions: 1, left: false });
    expect(
      await db.select().from(memberships).where(eq(memberships.userId, admin.user.id)),
    ).toHaveLength(1);

    // Personne inconnue : rien.
    expect(
      await backchannelLogout(db, {
        sub: "sub-inconnu",
        org: "org-atelier",
        lead_status: "disabled",
      }),
    ).toEqual({ sessions: 0, left: false });
  });
});
