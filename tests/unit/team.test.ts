import { and, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { attachLeadIdentity } from "@/server/auth/attach";
import { createSession, findSession } from "@/server/auth/session";
import { canEditSettings, canSetUpAccounting } from "@/server/company";
import { importHandoff } from "@/server/crmlead";
import { memberships, organizations, users } from "@/server/db/schema";
import { can } from "@/server/roles";
import {
  acceptInvitation,
  documentOrganization,
  hasSeat,
  inviteFiduciary,
  listTeam,
  listUserOrganizations,
  organizationForPage,
  removeFiduciary,
  resumeOrganization,
  seated,
  setAppRole,
  switchOrganization,
} from "@/server/team";
import { claims } from "../support/claims";
import { testDb } from "../support/db";
import { setTestEnv } from "../support/env";

const t = testDb();
const db = t.database;
setTestEnv();
beforeEach(() => t.reset());
afterAll(() => t.close());

const base = claims().lead;
if (!base) throw new Error("droits absents");
const pro = { ...base, plan: { code: "pro", name: "Pro", rank: 1, seats: 2 } };

describe("droits", () => {
  it("responsables : tout ; utilisateurs selon leur rôle ; fiduciaire : comptabilité", () => {
    expect(can({ role: "admin", appRole: "readonly" }, "company")).toBe(true);
    expect(can({ role: "user", appRole: null }, "billing")).toBe(true);
    expect(can({ role: "user", appRole: null }, "accounting")).toBe(true);
    expect(can({ role: "user", appRole: null }, "setup")).toBe(false);
    expect(can({ role: "user", appRole: "billing" }, "accounting")).toBe(false);
    expect(can({ role: "user", appRole: "accounting" }, "billing")).toBe(false);
    expect(can({ role: "user", appRole: "readonly" }, "billing")).toBe(false);
    expect(can({ role: "fiduciary", appRole: null }, "accounting")).toBe(true);
    expect(can({ role: "fiduciary", appRole: null }, "setup")).toBe(true);
    expect(can({ role: "fiduciary", appRole: null }, "billing")).toBe(false);
    expect(can({ role: "fiduciary", appRole: null }, "company")).toBe(false);
  });

  it("places : responsables d'abord, puis par arrivée ; bloqués et fiduciaires hors compte", () => {
    const at = (n: number) => new Date(2026, 0, n);
    const members = [
      { userId: "u1", role: "user", appRole: null, createdAt: at(1) },
      { userId: "u2", role: "user", appRole: "none", createdAt: at(2) },
      { userId: "a", role: "admin", appRole: null, createdAt: at(3) },
      { userId: "f", role: "fiduciary", appRole: null, createdAt: at(4) },
      { userId: "u3", role: "user", appRole: null, createdAt: at(5) },
    ];
    expect([...seated(members, 2)]).toEqual(["a", "u1"]);
  });
});

describe("équipe", () => {
  it("rôle choisi par un responsable, place selon la formule du Compte Lead", async () => {
    const admin = await attachLeadIdentity(db, claims({ lead: pro }));
    const bob = await attachLeadIdentity(
      db,
      claims({ sub: "sub-bob", email: "bob@atelier.test", org_role: "user", lead: pro }),
    );
    const eve = await attachLeadIdentity(
      db,
      claims({ sub: "sub-eve", email: "eve@atelier.test", org_role: "user", lead: pro }),
    );
    const org = admin.organization;
    const who = (u: { user: { id: string } }) => ({ organizationId: org.id, userId: u.user.id });
    const [fresh] = await db.select().from(organizations).where(eq(organizations.id, org.id));
    if (!fresh) throw new Error("organisation absente");

    // Deux places : l'administratrice et Bob, arrivé avant Eve.
    expect(await hasSeat(db, fresh, admin.user.id)).toBe(true);
    expect(await hasSeat(db, fresh, bob.user.id)).toBe(true);
    expect(await hasSeat(db, fresh, eve.user.id)).toBe(false);

    expect(await setAppRole(db, who(bob), eve.user.id, "billing")).toBe("forbidden");
    expect(await setAppRole(db, who(admin), admin.user.id, "none")).toBe("invalid");
    expect(await setAppRole(db, who(admin), bob.user.id, "patron")).toBe("invalid");
    expect(await setAppRole(db, who(admin), bob.user.id, "none")).toBe("saved");
    // Bob bloqué libère sa place pour Eve.
    expect(await hasSeat(db, fresh, eve.user.id)).toBe(true);
    expect(await hasSeat(db, fresh, bob.user.id)).toBe(false);

    // Une nouvelle connexion relit le rôle Lead sans toucher au rôle InvoiceLead.
    await attachLeadIdentity(
      db,
      claims({ sub: "sub-bob", email: "bob@atelier.test", org_role: "user", lead: pro }),
    );
    const [row] = await db
      .select()
      .from(memberships)
      .where(and(eq(memberships.organizationId, org.id), eq(memberships.userId, bob.user.id)));
    expect(row?.appRole).toBe("none");
    expect((await listUserOrganizations(db, bob.user.id)).length).toBe(0);
  });
});

describe("fiduciaire", () => {
  it("invitation, acceptation avec la bonne adresse, changement d'entreprise, retrait", async () => {
    const client = await attachLeadIdentity(db, claims({ lead: pro }));
    const fid = await attachLeadIdentity(
      db,
      claims({
        sub: "sub-fid",
        email: "compta@fidu.test",
        org: "org-fidu",
        org_name: "Fidu SA",
      }),
    );
    const clientWho = { organizationId: client.organization.id, userId: client.user.id };

    expect(
      await inviteFiduciary(
        db,
        { organizationId: client.organization.id, userId: fid.user.id },
        "x@y.ch",
      ),
    ).toBe("forbidden");
    expect(await inviteFiduciary(db, clientWho, "pas une adresse")).toBe("invalid");
    const inv = await inviteFiduciary(db, clientWho, " Compta@Fidu.test ");
    if (typeof inv === "string") throw new Error(inv);
    expect(inv.email).toBe("compta@fidu.test");
    expect((await listTeam(db, client.organization.id)).invitations).toHaveLength(1);

    // Mauvaise personne, mauvais jeton.
    expect(
      (await acceptInvitation(db, { id: client.user.id, email: "autre@x.ch" }, inv.token)).status,
    ).toBe("wrongEmail");
    expect((await acceptInvitation(db, fid.user, "jeton-inconnu-0123456789")).status).toBe(
      "invalid",
    );

    const ok = await acceptInvitation(db, fid.user, inv.token);
    expect(ok).toMatchObject({ status: "accepted", organizationId: client.organization.id });
    expect((await acceptInvitation(db, fid.user, inv.token)).status).toBe("invalid");

    const team = await listTeam(db, client.organization.id);
    expect(team.fiduciaries.map((f) => f.email)).toEqual(["compta@fidu.test"]);
    expect(team.invitations).toHaveLength(0);
    expect(await canSetUpAccounting(db, client.organization.id, fid.user.id)).toBe(true);
    expect(await canEditSettings(db, client.organization.id, fid.user.id)).toBe(false);
    const orgs = await listUserOrganizations(db, fid.user.id);
    expect(orgs.map((o) => o.name)).toEqual(["Fidu SA", "Atelier Muster GmbH"]);

    // La fiduciaire passe sur son client ; le retrait fait tomber la session.
    const { token } = await createSession(db, {
      userId: fid.user.id,
      organizationId: fid.organization.id,
      idToken: null,
    });
    const own = await findSession(db, token);
    if (!own) throw new Error("session absente");
    expect(await switchOrganization(db, own.session.id, fid.user.id, client.organization.id)).toBe(
      true,
    );
    const onClient = await findSession(db, token);
    expect(onClient?.organization.id).toBe(client.organization.id);
    expect(onClient?.membership.role).toBe("fiduciary");

    expect(await removeFiduciary(db, clientWho, client.user.id)).toBe("invalid");
    expect(await removeFiduciary(db, clientWho, fid.user.id)).toBe("removed");
    expect(await findSession(db, token)).toBeNull();
    expect(await switchOrganization(db, own.session.id, fid.user.id, client.organization.id)).toBe(
      false,
    );
  });

  it("reconnexion : retour chez le client choisi tant que l'accès y tient", async () => {
    const client = await attachLeadIdentity(db, claims({ lead: pro }));
    const login = () =>
      attachLeadIdentity(
        db,
        claims({ sub: "sub-fid", email: "compta@fidu.test", org: "org-fidu", org_name: "Fidu SA" }),
      );
    const fid = await login();
    const own = fid.organization.id;
    const resume = async () => {
      const again = await login();
      return resumeOrganization(db, again.user, again.organization.id);
    };
    const lastOf = async () =>
      (
        await db
          .select({ last: users.lastOrganizationId })
          .from(users)
          .where(eq(users.id, fid.user.id))
      )[0]?.last ?? null;

    // Jamais passée ailleurs : son entreprise.
    expect(fid.user.lastOrganizationId).toBeNull();
    expect(await resume()).toBe(own);

    const inv = await inviteFiduciary(
      db,
      { organizationId: client.organization.id, userId: client.user.id },
      "compta@fidu.test",
    );
    if (typeof inv === "string") throw new Error(inv);
    await acceptInvitation(db, fid.user, inv.token);
    const { token } = await createSession(db, {
      userId: fid.user.id,
      organizationId: own,
      idToken: null,
    });
    const session = await findSession(db, token);
    if (!session) throw new Error("session absente");
    await switchOrganization(db, session.session.id, fid.user.id, client.organization.id);
    expect(await lastOf()).toBe(client.organization.id);
    // Session échue, nouvelle connexion : chez le client.
    expect(await resume()).toBe(client.organization.id);

    // Client revenu en formule gratuite : accès suspendu. La connexion s'ouvre chez elle, jamais sur
    // l'écran « accès suspendu » ; son choix reste et resservira au retour de Pro.
    await attachLeadIdentity(db, claims());
    expect(await resume()).toBe(own);
    expect(await lastOf()).toBe(client.organization.id);
    await attachLeadIdentity(db, claims({ lead: pro }));
    expect(await resume()).toBe(client.organization.id);

    // Revenue d'elle-même dans sa propre entreprise : elle y reste.
    await switchOrganization(db, session.session.id, fid.user.id, own);
    expect(await resume()).toBe(own);
    await switchOrganization(db, session.session.id, fid.user.id, client.organization.id);

    // Le client retire la fiduciaire : sa propre entreprise, et le choix est oublié.
    expect(
      await removeFiduciary(
        db,
        { organizationId: client.organization.id, userId: client.user.id },
        fid.user.id,
      ),
    ).toBe("removed");
    expect(await resume()).toBe(own);
    expect(await lastOf()).toBeNull();
  });

  it("reconnexion : la page demandée choisit l'entreprise (lien de CRMlead, pièce)", async () => {
    const client = await attachLeadIdentity(db, claims({ lead: pro }));
    const login = () =>
      attachLeadIdentity(
        db,
        claims({ sub: "sub-fid", email: "compta@fidu.test", org: "org-fidu", org_name: "Fidu SA" }),
      );
    const fid = await login();
    const own = fid.organization.id;
    const stranger = await attachLeadIdentity(
      db,
      claims({ sub: "sub-x", email: "x@autre.test", org: "org-x", org_name: "Autre SA" }),
    );
    const inv = await inviteFiduciary(
      db,
      { organizationId: client.organization.id, userId: client.user.id },
      "compta@fidu.test",
    );
    if (typeof inv === "string") throw new Error(inv);
    await acceptInvitation(db, fid.user, inv.token);
    const { token } = await createSession(db, {
      userId: fid.user.id,
      organizationId: own,
      idToken: null,
    });
    const session = await findSession(db, token);
    if (!session) throw new Error("session absente");
    const toClient = () =>
      switchOrganization(db, session.session.id, fid.user.id, client.organization.id);
    const quote = async (who: { organizationId: string; userId: string }, lead: string) => {
      const made = await importHandoff(
        db,
        who,
        {
          v: 1,
          kind: "quote",
          currency: "CHF",
          lead: { id: lead },
          contact: { kind: "company", name: `Client ${lead}`, country: "CH" },
          lines: [
            {
              description: "Conseil",
              quantity: 1,
              unit: "flat",
              unitPriceCents: 10000,
              vatCode: "normal",
            },
          ],
        },
        { language: "fr", today: "2026-09-30", canCreateContact: true },
      );
      if (!("id" in made)) throw new Error("devis");
      return made.id;
    };
    const ownQuote = await quote({ organizationId: own, userId: fid.user.id }, "l-own");
    const clientQuote = await quote(
      { organizationId: client.organization.id, userId: client.user.id },
      "l-client",
    );
    const strangerQuote = await quote(
      { organizationId: stranger.organization.id, userId: stranger.user.id },
      "l-x",
    );
    const page = async (wanted?: string) => {
      const again = await login();
      return organizationForPage(db, again.user, again.organization.id, wanted);
    };

    // Chez le client : un lien d'import de son propre CRMlead ramène dans son entreprise, et y reste.
    await toClient();
    expect(await page("/fr/app/import/crmlead?d=abc")).toBe(own);
    expect(await page("/fr/app/invoices")).toBe(own);
    // Une pièce du client ramène chez le client ; sa propre pièce, chez elle.
    expect(await page(`/fr/app/quotes/${clientQuote}`)).toBe(client.organization.id);
    expect(await page("/fr/app/contacts")).toBe(client.organization.id);
    expect(await page(`/fr/app/quotes/${ownQuote}?saved=1`)).toBe(own);
    // Pièce d'une entreprise où elle n'est rien, ou inconnue : la règle d'avant, rien d'autre.
    await toClient();
    expect(await page(`/fr/app/quotes/${strangerQuote}`)).toBe(client.organization.id);
    expect(await page("/fr/app/quotes/00000000-0000-4000-8000-000000000000")).toBe(
      client.organization.id,
    );
    expect(await page()).toBe(client.organization.id);
    // Ce que la personne peut ouvrir d'une pièce, et rien de plus.
    expect(await documentOrganization(db, fid.user.id, clientQuote)).toMatchObject({
      id: client.organization.id,
      fiduciary: true,
      suspended: false,
    });
    expect(await documentOrganization(db, fid.user.id, ownQuote)).toMatchObject({
      id: own,
      fiduciary: false,
      suspended: false,
    });
    expect(await documentOrganization(db, fid.user.id, strangerQuote)).toBeUndefined();
    expect(await documentOrganization(db, fid.user.id, "pas-un-uuid")).toBeUndefined();

    // Client revenu en formule gratuite (accès fiduciaire suspendu) : sa pièce n'ouvre plus la session
    // chez lui, ni ne la garde comme la dernière choisie ; sa propre pièce s'ouvre toujours chez elle.
    const lastOf = async () =>
      (
        await db
          .select({ last: users.lastOrganizationId })
          .from(users)
          .where(eq(users.id, fid.user.id))
      )[0]?.last ?? null;
    await attachLeadIdentity(db, claims());
    expect(await documentOrganization(db, fid.user.id, clientQuote)).toMatchObject({
      id: client.organization.id,
      fiduciary: true,
      suspended: true,
    });
    expect(await page(`/fr/app/quotes/${ownQuote}`)).toBe(own);
    expect(await page(`/fr/app/quotes/${clientQuote}`)).toBe(own);
    expect(await lastOf()).toBe(own);
    // Revenue chez le client avant sa résiliation : ni la pièce ni la reprise ne l'y ramènent.
    await toClient();
    expect(await page(`/fr/app/quotes/${clientQuote}`)).toBe(own);
    expect(await page()).toBe(own);
    expect(await lastOf()).toBe(client.organization.id);
    // Revenu à Pro : la pièce rouvre la session chez le client.
    await attachLeadIdentity(db, claims({ lead: pro }));
    expect(await page(`/fr/app/quotes/${clientQuote}`)).toBe(client.organization.id);
  });

  it("reconnexion : une entreprise qui n'est pas celle d'une fiduciaire n'est jamais reprise", async () => {
    const other = await attachLeadIdentity(
      db,
      claims({ org: "org-ancienne", org_name: "Ancienne" }),
    );
    // Même personne, passée dans un autre compte du Compte Lead : l'ancienne entreprise reste membre.
    const now = await attachLeadIdentity(db, claims({ org: "org-nouvelle", org_name: "Nouvelle" }));
    expect(now.user.id).toBe(other.user.id);
    await db
      .update(users)
      .set({ lastOrganizationId: other.organization.id })
      .where(eq(users.id, now.user.id));
    const again = await attachLeadIdentity(
      db,
      claims({ org: "org-nouvelle", org_name: "Nouvelle" }),
    );
    expect(await resumeOrganization(db, again.user, again.organization.id)).toBe(
      again.organization.id,
    );
  });
});
