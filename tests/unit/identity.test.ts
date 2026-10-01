import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { attachLeadIdentity, hasInvoiceLeadAccess } from "@/server/auth/attach";
import { createSession, destroySession, findSession } from "@/server/auth/session";
import { auditLog, memberships, organizations, sessions, users } from "@/server/db/schema";
import { claims } from "../support/claims";
import { testDb } from "../support/db";

const t = testDb();
const db = t.database;

beforeAll(() => {
  process.env.APP_URL = "http://localhost:3000";
});
beforeEach(() => t.reset());
afterAll(() => t.close());

describe("rattachement au Compte Lead", () => {
  it("crée la personne, l'organisation et l'appartenance à la première connexion", async () => {
    const { user, organization } = await attachLeadIdentity(db, claims());
    expect(user).toMatchObject({ leadSub: "sub-ada", email: "ada@atelier.test", locale: "fr" });
    expect(organization).toMatchObject({
      leadOrg: "org-atelier",
      name: "Atelier Muster GmbH",
      leadPlan: "free",
      hasAccess: true,
      defaultLocale: "fr",
    });
    const [m] = await db.select().from(memberships);
    expect(m).toMatchObject({ userId: user.id, organizationId: organization.id, role: "admin" });
    expect(await db.select().from(auditLog)).toHaveLength(1);
  });

  it("retrouve la même personne par `sub` et met à jour email, nom et droits", async () => {
    const first = await attachLeadIdentity(db, claims());
    const second = await attachLeadIdentity(
      db,
      claims({ email: "ada@neu.test", name: "Ada Neu", locale: "de-CH", access: false }),
    );
    expect(second.user.id).toBe(first.user.id);
    expect(second.user).toMatchObject({ email: "ada@neu.test", name: "Ada Neu", locale: "de" });
    expect(second.organization.id).toBe(first.organization.id);
    // Formule sans InvoiceLead : on entre quand même, en version gratuite.
    expect(second.organization.hasAccess).toBe(true);
    expect(await db.select().from(users)).toHaveLength(1);
  });

  it("rattache par email seulement s'il est vérifié", async () => {
    const [local] = await db
      .insert(users)
      .values({ email: "Ada@Atelier.test", name: "Ada" })
      .returning();
    const verified = await attachLeadIdentity(db, claims());
    expect(verified.user.id).toBe(local?.id);

    await t.reset();
    const [unlinked] = await db
      .insert(users)
      .values({ email: "ada@atelier.test", name: "Ada" })
      .returning();
    const unverified = await attachLeadIdentity(db, claims({ email_verified: false }));
    expect(unverified.user.id).not.toBe(unlinked?.id);
    const [still] = await db
      .select()
      .from(users)
      .where(eq(users.id, unlinked?.id ?? ""));
    expect(still?.leadSub).toBeNull();
  });

  it("une adresse non vérifiée ne bloque jamais son vrai propriétaire", async () => {
    const mallory = await attachLeadIdentity(
      db,
      claims({
        sub: "sub-mallory",
        email: "Target@Corp.test",
        email_verified: false,
        org: "org-m",
      }),
    );
    const target = await attachLeadIdentity(
      db,
      claims({ sub: "sub-target", email: "target@corp.test", org: "org-t", org_name: "Corp AG" }),
    );
    expect(target.user.id).not.toBe(mallory.user.id);
    expect(target.user.leadSub).toBe("sub-target");
    expect(target.organization.name).toBe("Corp AG");
  });

  it("un compte Lead recréé (nouveau sub, même adresse) garde l'accès à son organisation", async () => {
    const before = await attachLeadIdentity(db, claims());
    const after = await attachLeadIdentity(db, claims({ sub: "sub-ada-2" }));
    expect(after.user.id).not.toBe(before.user.id);
    expect(after.organization.id).toBe(before.organization.id);
  });

  it("partage l'organisation entre ses membres", async () => {
    await attachLeadIdentity(db, claims());
    const bob = await attachLeadIdentity(
      db,
      claims({ sub: "sub-bob", email: "bob@atelier.test", name: "Bob", org_role: "user" }),
    );
    expect(await db.select().from(organizations)).toHaveLength(1);
    const rows = await db.select().from(memberships).where(eq(memberships.userId, bob.user.id));
    expect(rows[0]?.role).toBe("user");
  });

  it("refuse des revendications incomplètes", async () => {
    await expect(attachLeadIdentity(db, claims({ sub: "" }))).rejects.toThrow("incomplete_claims");
    await expect(attachLeadIdentity(db, claims({ org: "" }))).rejects.toThrow("incomplete_claims");
  });

  it("ouvre InvoiceLead à tout Compte Lead, sauf application retirée", () => {
    expect(hasInvoiceLeadAccess(claims())).toBe(true);
    // Compte créé dans Scanlead ou CRMlead, formule gratuite sans InvoiceLead : version gratuite.
    expect(hasInvoiceLeadAccess(claims({ access: false }))).toBe(true);
    expect(
      hasInvoiceLeadAccess({
        lead: { plan: { code: "free", name: "", rank: 0, seats: 1 }, apps: {}, subscriptions: [] },
      }),
    ).toBe(true);
    const retired = claims();
    const apps = retired.lead.apps as Record<string, Record<string, unknown>>;
    apps.invoicelead = { ...apps.invoicelead, status: "retired" };
    expect(hasInvoiceLeadAccess(retired)).toBe(false);
  });
});

describe("sessions", () => {
  it("ouvre, retrouve puis ferme une session sans jamais stocker le jeton", async () => {
    const { user, organization } = await attachLeadIdentity(db, claims());
    const { token } = await createSession(db, {
      userId: user.id,
      organizationId: organization.id,
      idToken: "id.token.value",
    });
    const [row] = await db.select().from(sessions);
    expect(row?.id).not.toBe(token);
    expect(row?.id).toMatch(/^[0-9a-f]{64}$/);

    const found = await findSession(db, token);
    expect(found?.user.id).toBe(user.id);
    expect(found?.organization.id).toBe(organization.id);
    expect(await findSession(db, "jeton-inconnu")).toBeNull();

    expect(await destroySession(db, token)).toBe("id.token.value");
    expect(await findSession(db, token)).toBeNull();
  });

  it("ignore une session échue", async () => {
    const { user, organization } = await attachLeadIdentity(db, claims());
    const { token } = await createSession(db, {
      userId: user.id,
      organizationId: organization.id,
      idToken: null,
    });
    await db.update(sessions).set({ expiresAt: new Date(Date.now() - 1000) });
    expect(await findSession(db, token)).toBeNull();
  });
});
