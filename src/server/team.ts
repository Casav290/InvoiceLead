import { and, asc, desc, eq, gt, isNull, ne, sql } from "drizzle-orm";
import { randomToken, sha256Hex } from "./auth/crypto";
import type { Db } from "./db";
import {
  accounts,
  auditLog,
  contacts,
  fiduciaryInvitations,
  invoices,
  memberships,
  organizations,
  products,
  projects,
  sessions,
  supplierBills,
  users,
} from "./db/schema";
import { featureAccess, seatsOf } from "./plans";
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

/**
 * La personne a-t-elle une place dans l'entreprise d'après sa formule ? Une fiduciaire n'occupe pas
 * de place, mais son accès fait partie de la formule Pro : il est suspendu tant que l'entreprise est
 * en formule gratuite (l'accès reste enregistré et revient avec Pro, comme les clés d'API en Pro+).
 */
export async function hasSeat(
  database: Db,
  org: { id: string; leadPlan: string; entitlements: unknown },
  userId: string,
): Promise<boolean> {
  const { members, fiduciaries } = await listTeam(database, org.id);
  if (fiduciaries.some((f) => f.userId === userId)) return featureAccess(org, "fiduciary").allowed;
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
  | { status: "invalid" | "expired" | "wrongEmail" | "plan" };

/**
 * Acceptation par la fiduciaire, connectée avec son propre Compte Lead : l'adresse de l'invitation doit
 * être la sienne. Une personne déjà membre de l'entreprise garde son rôle. L'accès fiduciaire fait
 * partie de la formule Pro : une invitation envoyée avant un retour à la formule gratuite attend.
 */
export async function acceptInvitation(
  database: Db,
  user: { id: string; email: string },
  token: string,
): Promise<AcceptResult> {
  return database.transaction(async (tx) => {
    const [inv] = await tx
      .select({
        invitation: fiduciaryInvitations,
        orgName: organizations.name,
        // Avec sa date de lecture : une formule Pro vieille de plus de 72 h vaut la formule gratuite.
        plan: {
          leadPlan: organizations.leadPlan,
          entitlements: organizations.entitlements,
          entitlementsAt: organizations.entitlementsAt,
        },
      })
      .from(fiduciaryInvitations)
      .innerJoin(organizations, eq(fiduciaryInvitations.organizationId, organizations.id))
      .where(eq(fiduciaryInvitations.tokenHash, sha256Hex(token)))
      .for("update")
      .limit(1);
    if (!inv || inv.invitation.acceptedAt) return { status: "invalid" };
    if (inv.invitation.expiresAt < new Date()) return { status: "expired" };
    if (inv.invitation.email !== user.email.trim().toLowerCase()) return { status: "wrongEmail" };
    if (!featureAccess(inv.plan, "fiduciary").allowed) return { status: "plan" };
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
    .select({
      id: organizations.id,
      name: organizations.name,
      role: memberships.role,
      appRole: memberships.appRole,
    })
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
 * L'accès fiduciaire est-il ouvert dans cette entreprise ? Il fait partie de la formule Pro : tant que
 * l'entreprise est en formule gratuite, il est suspendu (accessProblem, guard.ts) et la page n'affiche
 * que l'écran « accès suspendu ». Formule enregistrée, celle que lit la connexion ; une page la relit
 * au Compte Lead quand elle a plus de 12 h (requireAppSession).
 */
async function fiduciaryOpen(database: Db, organizationId: string): Promise<boolean> {
  const [org] = await database
    .select({
      leadPlan: organizations.leadPlan,
      entitlements: organizations.entitlements,
      entitlementsAt: organizations.entitlementsAt,
    })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);
  return org !== undefined && featureAccess(org, "fiduciary").allowed;
}

/**
 * Entreprise où ouvrir la session d'une connexion : la dernière choisie par la personne si elle y
 * travaille comme fiduciaire avec un accès à InvoiceLead, sinon celle de son Compte Lead. Le choix ne
 * vient que de la ligne de la personne, jamais de la requête, et l'appartenance est relue à chaque
 * connexion : une fiduciaire retirée (ou sans accès) revient dans sa propre entreprise, et son choix
 * est oublié. Chez un client revenu en formule gratuite (accès fiduciaire suspendu), elle revient aussi
 * dans sa propre entreprise, jamais sur l'écran « accès suspendu » ; son choix reste, il resservira au
 * retour de Pro. Une entreprise qui n'est pas une fiduciaire n'est jamais reprise : celle-là, c'est le
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
  if (!member || !hasAppAccess(member)) {
    await database
      .update(users)
      .set({ lastOrganizationId: null })
      .where(and(eq(users.id, user.id), eq(users.lastOrganizationId, last)));
    return leadOrganizationId;
  }
  if (isFiduciary(member) && (await fiduciaryOpen(database, last))) return last;
  return leadOrganizationId;
}

/** Lien d'import de CRMlead : il vient toujours du CRMlead de la personne, donc de son entreprise. */
const IMPORT_PAGE = /^\/(?:de|fr|en)\/app\/import\/crmlead(?:[/?]|$)/;
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const UUID_RE = new RegExp(`^${UUID}$`, "i");

/**
 * Fiches d'une entreprise ouvertes par leur identifiant : une pièce (devis, facture, note de crédit),
 * un contact, une facture fournisseur, un article, un projet, un compte (réglages ou grand livre).
 * Un lien vers l'une d'elles (CRMlead, email, historique du navigateur, lien envoyé par un client à sa
 * fiduciaire) dit à lui seul l'entreprise où l'ouvrir.
 */
export type RecordKind = "document" | "contact" | "bill" | "product" | "project" | "account";

const RECORD_PAGES: { kind: RecordKind; page: RegExp }[] = (
  [
    ["document", "(?:quotes|invoices|credit-notes)"],
    ["contact", "contacts"],
    ["bill", "accounting\\/bills"],
    ["product", "products"],
    ["project", "time\\/projects"],
    ["account", "(?:settings\\/accounts|accounting\\/ledger)"],
  ] as const
).map(([kind, section]) => ({
  kind,
  page: new RegExp(`^\\/(?:de|fr|en)\\/app\\/${section}\\/(${UUID})(?:[/?]|$)`, "i"),
}));

/** Fiche demandée par cette adresse (« /fr/app/contacts/<uuid>… »), ou undefined. */
export function recordOfPage(wanted: string): { kind: RecordKind; id: string } | undefined {
  for (const { kind, page } of RECORD_PAGES) {
    const id = page.exec(wanted)?.[1];
    if (id) return { kind, id };
  }
  return undefined;
}

/** Entreprise qui possède la fiche, d'après sa table ; undefined pour une fiche inconnue. */
async function recordOwner(database: Db, kind: RecordKind, id: string) {
  // Chaque table a un `id` et un `organization_id` : seules ces deux colonnes sont lues.
  const table = (
    {
      document: invoices,
      contact: contacts,
      bill: supplierBills,
      product: products,
      project: projects,
      account: accounts,
    } as const
  )[kind] as unknown as typeof contacts;
  const [row] = await database
    .select({ organizationId: table.organizationId })
    .from(table)
    .where(eq(table.id, id))
    .limit(1);
  return row?.organizationId;
}

export type OrganizationAccess = {
  id: string;
  name: string;
  fiduciary: boolean;
  suspended: boolean;
};

/**
 * L'entreprise, si la personne y est membre avec un accès à InvoiceLead (celles entre lesquelles elle
 * peut passer, switchOrganization), si elle y est fiduciaire, et si cet accès fiduciaire est suspendu
 * (client revenu en formule gratuite : y passer ne mènerait qu'à l'écran « accès suspendu »).
 * Undefined pour une entreprise inconnue ou où elle n'a rien à voir : rien n'est révélé, rien n'est
 * accordé. Un identifiant venu d'une adresse ne donne donc jamais rien de plus que le sélecteur.
 */
export async function organizationAccess(
  database: Db,
  userId: string,
  organizationId: string,
): Promise<OrganizationAccess | undefined> {
  if (!UUID_RE.test(organizationId)) return undefined;
  const [org] = await database
    .select({
      id: organizations.id,
      name: organizations.name,
      plan: {
        leadPlan: organizations.leadPlan,
        entitlements: organizations.entitlements,
        entitlementsAt: organizations.entitlementsAt,
      },
    })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);
  if (!org) return undefined;
  const member = await membershipOf(database, org.id, userId);
  if (!member || !hasAppAccess(member)) return undefined;
  const fiduciary = isFiduciary(member);
  return {
    id: org.id,
    name: org.name,
    fiduciary,
    suspended: fiduciary && !featureAccess(org.plan, "fiduciary").allowed,
  };
}

/**
 * Entreprise qui possède cette fiche, si la personne y a accès (organizationAccess). Undefined pour
 * une fiche inconnue ou d'une entreprise où elle n'a rien à voir.
 */
export async function recordOrganization(
  database: Db,
  userId: string,
  kind: RecordKind,
  id: string,
): Promise<OrganizationAccess | undefined> {
  if (!UUID_RE.test(id)) return undefined;
  const owner = await recordOwner(database, kind, id);
  return owner ? organizationAccess(database, userId, owner) : undefined;
}

/** Entreprise qui possède cette pièce (devis, facture, note de crédit) : recordOrganization. */
export function documentOrganization(database: Db, userId: string, documentId: string) {
  return recordOrganization(database, userId, "document", documentId);
}

/**
 * Entreprise nommée par l'adresse (« ?org=<uuid> », lien du récapitulatif du lundi, qui parle d'une
 * entreprise précise), ou undefined.
 */
export function organizationOfPage(wanted: string): string | undefined {
  const q = wanted.indexOf("?");
  if (q < 0) return undefined;
  const org = new URLSearchParams(wanted.slice(q + 1)).get("org") ?? "";
  return UUID_RE.test(org) ? org : undefined;
}

/**
 * Entreprise que la page demandée désigne d'elle-même, si la personne peut y travailler :
 * - un lien d'import de CRMlead : l'entreprise du Compte Lead (le lead vient de son CRMlead), même
 *   pour une fiduciaire qui travaillait chez un client ;
 * - une fiche (pièce, contact, facture fournisseur, article, projet, compte) : l'entreprise qui la
 *   possède ;
 * - une adresse qui nomme son entreprise (« ?org= ») : celle-là.
 * Une fiche ou une entreprise n'est retenue que si c'est celle du Compte Lead ou un client où la
 * personne travaille comme fiduciaire, avec un accès qui n'est pas suspendu (client revenu en formule
 * gratuite) : la même règle que resumeOrganization. Undefined sinon : la page ne dit rien, ou elle
 * désigne une entreprise où la personne n'entre pas (et rien n'en est révélé).
 */
export async function pageOrganization(
  database: Db,
  userId: string,
  leadOrganizationId: string,
  wanted: string | undefined,
): Promise<string | undefined> {
  if (!wanted) return undefined;
  if (IMPORT_PAGE.test(wanted)) return leadOrganizationId;
  const record = recordOfPage(wanted);
  const named = record ? undefined : organizationOfPage(wanted);
  const owner = record
    ? await recordOrganization(database, userId, record.kind, record.id)
    : named
      ? await organizationAccess(database, userId, named)
      : undefined;
  if (owner && !owner.suspended && (owner.id === leadOrganizationId || owner.fiduciary))
    return owner.id;
  return undefined;
}

/**
 * Entreprise où ouvrir la session d'une connexion, d'après la page demandée : celle que la page
 * désigne (pageOrganization : lien d'import, fiche, entreprise nommée), sinon resumeOrganization (la
 * fiduciaire revient chez le client où elle travaillait). Un lien « ouvrir dans InvoiceLead » de
 * CRMlead, ou la fiche d'un fournisseur envoyée par un client, arrive ainsi sur la fiche, pas sur une
 * page introuvable. Un client revenu en formule gratuite (accès fiduciaire suspendu) n'est ni ouvert ni
 * gardé : la fiche dit pourquoi. L'entreprise choisie par la page est gardée comme la dernière
 * choisie, comme un changement à la main.
 */
export async function organizationForPage(
  database: Db,
  user: { id: string; lastOrganizationId: string | null },
  leadOrganizationId: string,
  wanted?: string,
): Promise<string> {
  const page = await pageOrganization(database, user.id, leadOrganizationId, wanted);
  if (!page) return resumeOrganization(database, user, leadOrganizationId);
  if (user.lastOrganizationId === page) return page;
  if (page === leadOrganizationId && !user.lastOrganizationId) return page;
  await database.update(users).set({ lastOrganizationId: page }).where(eq(users.id, user.id));
  return page;
}

/**
 * Entreprise du Compte Lead de la session : celle de son jeton d'identité (`org`, vérifié à la
 * connexion et gardé côté serveur), sinon la plus récente où la personne n'est pas fiduciaire.
 * Undefined si elle n'en a aucune avec un accès.
 */
export async function leadOrganizationOf(
  database: Db,
  userId: string,
  idToken: string | null,
): Promise<string | undefined> {
  let leadOrg: unknown;
  try {
    leadOrg = idToken
      ? JSON.parse(Buffer.from(idToken.split(".")[1] ?? "", "base64url").toString("utf8")).org
      : undefined;
  } catch {
    leadOrg = undefined;
  }
  const own = await database
    .select({
      id: organizations.id,
      leadOrg: organizations.leadOrg,
      appRole: memberships.appRole,
      role: memberships.role,
    })
    .from(memberships)
    .innerJoin(organizations, eq(memberships.organizationId, organizations.id))
    .where(and(eq(memberships.userId, userId), ne(memberships.role, "fiduciary")))
    .orderBy(desc(memberships.createdAt));
  const usable = own.filter(hasAppAccess);
  return (usable.find((o) => typeof leadOrg === "string" && o.leadOrg === leadOrg) ?? usable[0])
    ?.id;
}

/**
 * Session d'une fiduciaire chez un client dont l'accès est suspendu (client revenu en formule
 * gratuite) : la page demandée qui désigne une autre de ses entreprises (lien d'import de son
 * CRMlead : la sienne ; sa pièce ou une fiche d'un autre client ouvert : celle qui la possède) y fait
 * passer la session, comme la connexion le fait (organizationForPage), au lieu de l'écran « accès
 * suspendu ». Mêmes règles que pageOrganization : une entreprise où elle n'entre pas, ou suspendue,
 * n'est jamais choisie. Rend l'entreprise où la session est passée, ou undefined (rien n'a changé).
 */
export async function detourOrganization(
  database: Db,
  session: { id: string; userId: string; organizationId: string; idToken: string | null },
  wanted: string,
): Promise<string | undefined> {
  const lead = await leadOrganizationOf(database, session.userId, session.idToken);
  const target = lead ? await pageOrganization(database, session.userId, lead, wanted) : undefined;
  if (!target || target === session.organizationId) return undefined;
  return (await switchOrganization(database, session.id, session.userId, target))
    ? target
    : undefined;
}
