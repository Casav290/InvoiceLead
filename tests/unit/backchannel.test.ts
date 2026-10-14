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
  apps: claims().lead?.apps,
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

    // Départ annoncé pour une organisation sans entreprise ici : ses sessions tombent quand même (un
    // départ ferme tout, partout), sa place dans l'atelier reste.
    expect(
      await backchannelLogout(db, { sub: "sub-bob", org: "org-autre", lead_status: "disabled" }),
    ).toEqual({ sessions: 2, left: false });
    await createSession(db, { userId: bob.user.id, organizationId: org, idToken: null });
    await createSession(db, { userId: bob.user.id, organizationId: org, idToken: null });

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

  it("déconnexion (logout) sans sid : toutes ses sessions tombent, quelle que soit l'entreprise, sans départ", async () => {
    const admin = await attachLeadIdentity(db, claims({ lead: plus }));
    const org = admin.organization.id;
    await createSession(db, { userId: admin.user.id, organizationId: org, idToken: null });
    await createSession(db, { userId: admin.user.id, organizationId: org, idToken: null });
    // Organisation annoncée sans entreprise InvoiceLead (ou celle d'une autre) : la session tombe quand même.
    expect(
      await backchannelLogout(db, { sub: "sub-ada", org: "org-autre", lead_status: "logout" }),
    ).toEqual({ sessions: 2, left: false });
    await createSession(db, { userId: admin.user.id, organizationId: org, idToken: null });
    expect(
      await backchannelLogout(db, { sub: "sub-ada", org: "org-atelier", lead_status: "logout" }),
    ).toEqual({ sessions: 1, left: false });
    expect(
      await db.select().from(memberships).where(eq(memberships.userId, admin.user.id)),
    ).toHaveLength(1);
  });
  it("déconnexion d'un navigateur (logout + sid) : ses sessions de ce navigateur et les anciennes, pas ses autres appareils", async () => {
    const admin = await attachLeadIdentity(db, claims({ lead: plus }));
    const org = admin.organization.id;
    const client = await attachLeadIdentity(
      db,
      claims({
        sub: "sub-cleo",
        email: "cleo@client.test",
        name: "Cléo",
        org: "org-client",
        org_name: "Client SA",
      }),
    );
    // Ada travaille aussi chez un client (fiduciaire) : une session dans une autre entreprise.
    await db
      .insert(memberships)
      .values({ organizationId: client.organization.id, userId: admin.user.id, role: "fiduciary" });
    const ids = async () =>
      (await db.select().from(sessions).where(eq(sessions.userId, admin.user.id)))
        .map((s) => s.leadSid ?? "aucun")
        .sort();
    // Navigateur A (bureau), navigateur B (téléphone), une session d'avant (sans sid), et une
    // session du navigateur A chez le client.
    await createSession(db, {
      userId: admin.user.id,
      organizationId: org,
      idToken: null,
      leadSid: "sid-a",
    });
    await createSession(db, {
      userId: admin.user.id,
      organizationId: org,
      idToken: null,
      leadSid: "sid-b",
    });
    await createSession(db, { userId: admin.user.id, organizationId: org, idToken: null });
    await createSession(db, {
      userId: admin.user.id,
      organizationId: client.organization.id,
      idToken: null,
      leadSid: "sid-a",
    });
    await createSession(db, {
      userId: client.user.id,
      organizationId: client.organization.id,
      idToken: null,
      leadSid: "sid-a",
    });
    expect(await ids()).toEqual(["aucun", "sid-a", "sid-a", "sid-b"]);

    // « Se déconnecter » dans le navigateur A : A (les deux entreprises) et l'ancienne tombent, B reste.
    expect(
      await backchannelLogout(db, {
        sub: "sub-ada",
        org: "org-atelier",
        lead_status: "logout",
        sid: "sid-a",
      }),
    ).toEqual({ sessions: 3, left: false });
    expect(await ids()).toEqual(["sid-b"]);
    // Le même sid chez une autre personne ne la concerne pas : sa session reste.
    expect(
      await db.select().from(sessions).where(eq(sessions.userId, client.user.id)),
    ).toHaveLength(1);
    // Rejoué, ou un sid inconnu : rien d'autre ne tombe.
    expect(
      await backchannelLogout(db, {
        sub: "sub-ada",
        org: "org-atelier",
        lead_status: "logout",
        sid: "sid-a",
      }),
    ).toEqual({ sessions: 0, left: false });
    expect(await ids()).toEqual(["sid-b"]);

    // Départ (disabled) : tout tombe, sid ou pas, dans toutes les entreprises.
    await createSession(db, {
      userId: admin.user.id,
      organizationId: client.organization.id,
      idToken: null,
      leadSid: "sid-c",
    });
    expect(
      await backchannelLogout(db, {
        sub: "sub-ada",
        org: "org-atelier",
        lead_status: "disabled",
        sid: "sid-b",
      }),
    ).toEqual({ sessions: 2, left: false });
    expect(await ids()).toEqual([]);
  });
});
