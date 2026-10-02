import { and, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { attachLeadIdentity } from "@/server/auth/attach";
import { appPage } from "@/server/auth/guard";
import { createSession, findSession } from "@/server/auth/session";
import { canEditSettings, canSetUpAccounting } from "@/server/company";
import { importHandoff } from "@/server/crmlead";
import {
  accounts,
  contacts,
  memberships,
  organizations,
  products,
  projects,
  sessions,
  supplierBills,
  users,
} from "@/server/db/schema";
import { can } from "@/server/roles";
import {
  acceptInvitation,
  detourOrganization,
  documentOrganization,
  hasSeat,
  inviteFiduciary,
  leadOrganizationOf,
  listTeam,
  listUserOrganizations,
  organizationAccess,
  organizationForPage,
  pageOrganization,
  recordOfPage,
  recordOrganization,
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

  it("reconnexion : une fiche ou l'entreprise nommée par le lien choisit l'entreprise", async () => {
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
    // Dernière entreprise : la sienne (passée chez elle au sélecteur).
    await db.update(users).set({ lastOrganizationId: own }).where(eq(users.id, fid.user.id));

    /** Une fiche de chaque sorte dans l'entreprise `organizationId`. */
    const records = async (organizationId: string, tag: string) => {
      const [contact] = await db
        .insert(contacts)
        .values({ organizationId, name: `Fournisseur ${tag}`, isSupplier: true })
        .returning();
      if (!contact) throw new Error("contact");
      const [bill] = await db
        .insert(supplierBills)
        .values({
          organizationId,
          supplierName: `Fournisseur ${tag}`,
          issueDate: "2026-09-01",
          dueDate: "2026-09-30",
          totalCents: 12000,
        })
        .returning();
      const [product] = await db
        .insert(products)
        .values({ organizationId, name: `Article ${tag}`, unitPriceCents: 1000 })
        .returning();
      const [project] = await db
        .insert(projects)
        .values({ organizationId, contactId: contact.id, name: `Projet ${tag}` })
        .returning();
      const [account] = await db
        .insert(accounts)
        .values({
          organizationId,
          number: "6500",
          nameDe: "Büro",
          nameFr: "Bureau",
          type: "expense",
        })
        .returning();
      if (!bill || !product || !project || !account) throw new Error("fiches");
      return [
        `/fr/app/contacts/${contact.id}`,
        `/de/app/accounting/bills/${bill.id}?saved=1`,
        `/en/app/products/${product.id}`,
        `/fr/app/time/projects/${project.id}`,
        `/fr/app/settings/accounts/${account.id}`,
        `/fr/app/accounting/ledger/${account.id}?year=00000000-0000-4000-8000-000000000000`,
      ];
    };
    const clientPages = await records(client.organization.id, "client");
    const ownPages = await records(own, "own");
    const strangerPages = await records(stranger.organization.id, "x");
    const page = async (wanted?: string) => {
      const again = await login();
      return organizationForPage(db, again.user, again.organization.id, wanted);
    };
    const lastOf = async () =>
      (
        await db
          .select({ last: users.lastOrganizationId })
          .from(users)
          .where(eq(users.id, fid.user.id))
      )[0]?.last ?? null;

    // Ce que l'adresse désigne, et rien d'autre.
    expect(recordOfPage(clientPages[0] ?? "")).toMatchObject({ kind: "contact" });
    expect(recordOfPage(clientPages[1] ?? "")).toMatchObject({ kind: "bill" });
    expect(recordOfPage(clientPages[5] ?? "")).toMatchObject({ kind: "account" });
    expect(recordOfPage("/fr/app/contacts/new")).toBeUndefined();
    expect(recordOfPage("/fr/app/accounting/bills/export")).toBeUndefined();
    expect(recordOfPage("/fr/app/contacts")).toBeUndefined();

    // Session échue, dernière entreprise la sienne : la fiche du client ouvre la session chez lui, et
    // y reste comme la dernière choisie ; sa propre fiche, chez elle.
    for (const wanted of clientPages) {
      await db.update(users).set({ lastOrganizationId: own }).where(eq(users.id, fid.user.id));
      expect(await page(wanted)).toBe(client.organization.id);
      expect(await lastOf()).toBe(client.organization.id);
      expect(await page(ownPages[clientPages.indexOf(wanted)])).toBe(own);
    }
    // Fiche d'une entreprise où elle n'est rien, ou inconnue : la règle d'avant (sa dernière).
    for (const wanted of [
      ...strangerPages,
      "/fr/app/contacts/00000000-0000-4000-8000-000000000000",
    ])
      expect(await page(wanted)).toBe(own);
    expect(
      await recordOrganization(
        db,
        fid.user.id,
        "contact",
        strangerPages[0]?.split("/").pop() ?? "",
      ),
    ).toBeUndefined();
    expect(await recordOrganization(db, fid.user.id, "contact", "pas-un-uuid")).toBeUndefined();

    // Lien qui nomme son entreprise (récapitulatif du lundi), dernière entreprise le client : la sienne.
    await page(clientPages[0]);
    expect(await lastOf()).toBe(client.organization.id);
    expect(await page(`/fr/app/accounting/review?org=${own}`)).toBe(own);
    expect(await page(`/fr/app/accounting/review?org=${client.organization.id}`)).toBe(
      client.organization.id,
    );
    // Une entreprise où elle n'entre pas, ou un identifiant fabriqué : rien n'est accordé.
    expect(await page(`/fr/app/accounting/review?org=${stranger.organization.id}`)).toBe(
      client.organization.id,
    );
    expect(await page("/fr/app/accounting/review?org=x")).toBe(client.organization.id);
    expect(await organizationAccess(db, fid.user.id, stranger.organization.id)).toBeUndefined();
    expect(await organizationAccess(db, fid.user.id, own)).toMatchObject({
      id: own,
      fiduciary: false,
      suspended: false,
    });

    // Client revenu en formule gratuite : ni sa fiche ni son nom dans le lien n'ouvrent la session chez
    // lui (accès suspendu) ; la fiche, elle, dira pourquoi.
    await attachLeadIdentity(db, claims());
    expect(await page(clientPages[0])).toBe(own);
    expect(await page(`/fr/app/accounting/review?org=${client.organization.id}`)).toBe(own);
    expect(
      await recordOrganization(
        db,
        fid.user.id,
        "bill",
        clientPages[1]?.split("/")[5]?.split("?")[0] ?? "",
      ),
    ).toMatchObject({ id: client.organization.id, fiduciary: true, suspended: true });
    expect(await pageOrganization(db, fid.user.id, own, `/fr/app/import/crmlead?d=abc`)).toBe(own);
    expect(await pageOrganization(db, fid.user.id, own, "/fr/app/invoices")).toBeUndefined();
  });

  it("entreprise du Compte Lead d'une session : celle de son jeton d'identité", async () => {
    const first = await attachLeadIdentity(
      db,
      claims({ org: "org-ancienne", org_name: "Ancienne" }),
    );
    const now = await attachLeadIdentity(db, claims({ org: "org-nouvelle", org_name: "Nouvelle" }));
    const client = await attachLeadIdentity(
      db,
      claims({
        sub: "sub-cli",
        email: "c@client.test",
        org: "org-cli",
        org_name: "Client",
        lead: pro,
      }),
    );
    await db
      .insert(memberships)
      .values({ organizationId: client.organization.id, userId: now.user.id, role: "fiduciary" });
    const token = (org: string) =>
      `x.${Buffer.from(JSON.stringify({ sub: "sub-ada", org })).toString("base64url")}.y`;
    expect(await leadOrganizationOf(db, now.user.id, token("org-ancienne"))).toBe(
      first.organization.id,
    );
    expect(await leadOrganizationOf(db, now.user.id, token("org-nouvelle"))).toBe(
      now.organization.id,
    );
    // Jamais une entreprise où elle est fiduciaire, même nommée par le jeton.
    expect(await leadOrganizationOf(db, now.user.id, token("org-cli"))).toBe(now.organization.id);
    // Sans jeton lisible : la plus récente où elle n'est pas fiduciaire.
    expect(await leadOrganizationOf(db, now.user.id, null)).toBe(now.organization.id);
    expect(await leadOrganizationOf(db, now.user.id, "pas-un-jeton")).toBe(now.organization.id);
  });

  it("session chez un client revenu en gratuit : ses propres liens changent d'entreprise, rien d'autre", async () => {
    const client = await attachLeadIdentity(db, claims({ lead: pro }));
    const other = await attachLeadIdentity(
      db,
      claims({
        sub: "sub-o",
        email: "o@autre-client.test",
        org: "org-o",
        org_name: "Autre client",
        lead: pro,
      }),
    );
    const stranger = await attachLeadIdentity(
      db,
      claims({ sub: "sub-x", email: "x@autre.test", org: "org-x", org_name: "Autre SA" }),
    );
    const fid = await attachLeadIdentity(
      db,
      claims({ sub: "sub-fid", email: "compta@fidu.test", org: "org-fidu", org_name: "Fidu SA" }),
    );
    const own = fid.organization.id;
    for (const c of [client, other]) {
      const inv = await inviteFiduciary(
        db,
        { organizationId: c.organization.id, userId: c.user.id },
        "compta@fidu.test",
      );
      if (typeof inv === "string") throw new Error(inv);
      await acceptInvitation(db, fid.user, inv.token);
    }
    const idToken = `x.${Buffer.from(JSON.stringify({ sub: "sub-fid", org: "org-fidu" })).toString("base64url")}.y`;
    const made = await createSession(db, {
      userId: fid.user.id,
      organizationId: client.organization.id,
      idToken,
    });
    const contact = async (organizationId: string) => {
      const [row] = await db
        .insert(contacts)
        .values({ organizationId, name: "Fournisseur", isSupplier: true })
        .returning();
      if (!row) throw new Error("contact");
      return `/fr/app/contacts/${row.id}`;
    };
    const ownCard = await contact(own);
    const clientCard = await contact(client.organization.id);
    const otherCard = await contact(other.organization.id);
    const strangerCard = await contact(stranger.organization.id);
    // Le client repasse en formule gratuite pendant la session : accès fiduciaire suspendu.
    await attachLeadIdentity(db, claims());
    const sessionOrg = async () => (await findSession(db, made.token))?.organization.id;
    const detour = (wanted: string) =>
      detourOrganization(
        db,
        { id: made.id, userId: fid.user.id, organizationId: client.organization.id, idToken },
        wanted,
      );
    // Une page qui ne désigne rien, une fiche du client suspendu, une fiche d'une entreprise où elle
    // n'est rien : la session ne bouge pas (l'écran « accès suspendu » le dira, avec la page).
    for (const wanted of [
      "/fr/app/contacts",
      clientCard,
      strangerCard,
      "/fr/app/accounting/review?org=x",
    ]) {
      expect(await detour(wanted)).toBeUndefined();
      expect(await sessionOrg()).toBe(client.organization.id);
    }
    // Sa propre fiche, un lien d'import de son CRMlead : chez elle, gardée comme la dernière choisie.
    for (const wanted of [ownCard, "/fr/app/import/crmlead?d=abc"]) {
      await db
        .update(sessions)
        .set({ organizationId: client.organization.id })
        .where(eq(sessions.id, made.id));
      expect(await detour(wanted)).toBe(own);
      expect(await sessionOrg()).toBe(own);
      const [u] = await db.select().from(users).where(eq(users.id, fid.user.id));
      expect(u?.lastOrganizationId).toBe(own);
    }
    // La fiche d'un autre client, ouvert (formule Pro) : chez lui.
    await db
      .update(sessions)
      .set({ organizationId: client.organization.id })
      .where(eq(sessions.id, made.id));
    expect(await detour(otherCard)).toBe(other.organization.id);
    expect(await sessionOrg()).toBe(other.organization.id);
  });

  it("page gardée par l'écran « sans accès » : une page de l'application, dans sa langue", () => {
    expect(appPage("fr", "/fr/app/contacts/x?y=1")).toBe("/fr/app/contacts/x?y=1");
    expect(appPage("fr", "/fr/app")).toBe("/fr/app");
    expect(appPage("fr", "/fr/app?welcome=1")).toBe("/fr/app?welcome=1");
    for (const bad of [
      "/de/app/contacts",
      "/fr/application",
      "/fr/no-access",
      "//evil.test/fr/app",
      "https://evil.test/fr/app",
      "/fr/app/../../x",
      "",
      null,
      undefined,
    ])
      expect(appPage("fr", bad)).toBeUndefined();
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
