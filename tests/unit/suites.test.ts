import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { and, eq, sql } from "drizzle-orm";
import { NextRequest, type NextResponse } from "next/server";
import { createTranslator } from "next-intl";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LeadClaims } from "@/server/lead-id/leadId";
import de from "../../messages/de.json";
import en from "../../messages/en.json";
import fr from "../../messages/fr.json";
import { claims } from "../support/claims";
import { testDb } from "../support/db";
import { setTestEnv } from "../support/env";
import { leadPlan } from "../support/lead-plan";

/**
 * Suites de l'abonnement par application (billing-followups-design.md, points 1, 2, 4 et 6a) pour
 * InvoiceLead :
 * - 1. jamais une offre égale ou inférieure à la formule acquise (formule propre du Compte Lead
 *   comprise), ni à l'écran ni au serveur (Checkout refusé sans aucun appel à Stripe) ;
 * - 2. « Retirer » réservé aux responsables, jamais sur soi, retrait gardé à la reconnexion,
 *   dernière venue sur l'adhésion ;
 * - 4 et 6a. page de refus « places » servie aussi sans session, « Changer de compte »
 *   (/auth/lead/start?switch=1 → prompt=login), lien Compte ERPlead, conseil selon la formule,
 *   « Voir les formules » pour une personne qui n'administre pas.
 * Les routes sont appelées telles quelles ; Stripe et le Compte Lead sont de faux services (fetch).
 */
const ctx = vi.hoisted(() => ({
  database: null as unknown,
  jar: new Map<string, string>(),
  claims: null as unknown,
}));

vi.mock("@/server/db", () => ({ db: () => ctx.database }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (ctx.jar.has(name) ? { name, value: ctx.jar.get(name) } : undefined),
    getAll: () => [...ctx.jar].map(([name, value]) => ({ name, value })),
    has: (name: string) => ctx.jar.has(name),
  }),
  headers: async () => new Headers(),
}));
vi.mock("@/server/lead-id/leadId", async (original) => ({
  ...(await original<typeof import("@/server/lead-id/leadId")>()),
  finishLogin: async (
    query: { code?: string; state?: string; error?: string },
    saved: { state: string },
  ) => {
    if (query.error) throw new Error(`lead_id:${query.error}`);
    if (!query.code || query.state !== saved.state) throw new Error("lead_id:state_mismatch");
    return { claims: ctx.claims as LeadClaims, tokens: { id_token: "id-token", expires_in: 600 } };
  },
}));

const STRIPE = "https://stripe.billing.test";
setTestEnv({
  STRIPE_BILLING_SECRET_KEY: "sk_test_billing",
  STRIPE_BILLING_WEBHOOK_SECRET: "whsec_billing_test",
  STRIPE_BILLING_PRICE_PRO_MONTHLY: "price_il_pro_m",
  STRIPE_BILLING_PRICE_PRO_YEARLY: "price_il_pro_y",
  STRIPE_BILLING_PRICE_PROPLUS_MONTHLY: "price_il_plus_m",
  STRIPE_BILLING_PRICE_PROPLUS_YEARLY: "price_il_plus_y",
  STRIPE_BILLING_PORTAL_CONFIGURATION: "bpc_invoicelead_test",
  STRIPE_BILLING_API_URL: STRIPE,
});

const t = testDb();
const db = t.database;
ctx.database = db;

type Call = { method: string; url: string };
let calls: Call[] = [];
beforeEach(async () => {
  await t.reset();
  ctx.jar = new Map();
  ctx.claims = claims();
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      calls.push({ method: init?.method ?? "GET", url });
      if (url === `${STRIPE}/v1/customers`) return Response.json({ id: `cus_${calls.length}` });
      if (url === `${STRIPE}/v1/checkout/sessions`)
        return Response.json({ id: "cs_test_x", url: "https://checkout.stripe.test/cs_test_x" });
      return new Response("{}", { status: 404 });
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());
afterAll(() => t.close());

const APP = "https://invoicelead.io";
const DAY = 86_400_000;
const base = claims().lead;
if (!base) throw new Error("droits absents");
/** Droits du Compte Lead : formule (0, 1, 2), d'où elle vient, jusqu'à quand. */
function lead(tier: number, source?: "own" | "family" | "free", until?: Date | null) {
  return {
    ...base,
    plan: {
      ...leadPlan(tier),
      ...(source ? { source } : {}),
      ...(until !== undefined ? { valid_until: until ? until.toISOString() : null } : {}),
    },
  } as LeadClaims["lead"];
}
const orgPlan = (entitlements: unknown, billing?: { plan: string; until?: Date }) => ({
  leadPlan: "free",
  entitlements,
  entitlementsAt: new Date(),
  billingPlan: billing?.plan ?? null,
  billingPlanUntil: billing?.until ?? null,
});

function request(
  pathname: string,
  {
    cookies = {},
    method = "GET",
    body,
  }: { cookies?: Record<string, string>; method?: string; body?: FormData } = {},
) {
  ctx.jar = new Map(Object.entries(cookies));
  const cookie = Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
  return new NextRequest(`${APP}${pathname}`, {
    method,
    headers: {
      "user-agent": "Mozilla/5.0 Chrome/141",
      "sec-fetch-mode": "navigate",
      "sec-fetch-dest": "document",
      ...(method === "POST" ? { origin: APP } : {}),
      ...(cookie ? { cookie } : {}),
    },
    ...(body ? { body } : {}),
  });
}
const where = (response: Response) => response.headers.get("location") ?? "";
function setCookies(response: NextResponse): Record<string, string> {
  return Object.fromEntries(
    response.cookies
      .getAll()
      .filter((c) => c.value !== "")
      .map((c) => [c.name, c.value]),
  );
}

async function person(over: Partial<LeadClaims> = {}) {
  const { attachLeadIdentity } = await import("@/server/auth/attach");
  return attachLeadIdentity(db, claims(over));
}
async function orgRow(id: string) {
  const { organizations } = await import("@/server/db/schema");
  const [row] = await db.select().from(organizations).where(eq(organizations.id, id));
  if (!row) throw new Error("organisation absente");
  return row;
}

describe("1. offres : jamais une formule égale ou inférieure à la formule acquise", () => {
  it("formule acquise = abonnement local et formule propre du Compte Lead, jamais l'héritage", async () => {
    const { acquiredTier, leadOwnPlan, planOffers, tierOf } = await import("@/server/plans");
    // TEST 08 en production : Pro+ propre lu au Compte Lead, aucun abonnement InvoiceLead.
    const plus = orgPlan(lead(2));
    expect(tierOf(plus)).toBe("proplus");
    expect(acquiredTier(plus)).toBe("proplus");
    expect(planOffers(plus)).toEqual([]);
    expect(planOffers(orgPlan(lead(2, "own")))).toEqual([]);
    // Pro propre : seul Pro+ est proposé.
    expect(acquiredTier(orgPlan(lead(1, "own")))).toBe("pro");
    expect(planOffers(orgPlan(lead(1, "own")))).toEqual(["pro_plus"]);
    // Héritage de la transition (Pro+ payé dans une autre app jusqu'au …) : s'abonner reste possible.
    const family = orgPlan(lead(2, "family", new Date(Date.now() + 9 * DAY)));
    expect(tierOf(family)).toBe("proplus");
    expect(acquiredTier(family)).toBe("free");
    expect(planOffers(family)).toEqual(["pro", "pro_plus"]);
    // Abonnement InvoiceLead Pro, Compte Lead en Gratuit : Pro+ seulement.
    const local = orgPlan(lead(0), { plan: "pro", until: new Date(Date.now() + 9 * DAY) });
    expect(acquiredTier(local)).toBe("pro");
    expect(planOffers(local)).toEqual(["pro_plus"]);
    // Rien d'acquis : Pro et Pro+.
    expect(planOffers(orgPlan(lead(0)))).toEqual(["pro", "pro_plus"]);
    // Formule propre échue (valid_until passée) : elle ne compte plus, ni appliquée ni acquise.
    const ended = orgPlan(lead(2, "own", new Date(Date.now() - DAY)));
    expect(tierOf(ended)).toBe("free");
    expect(acquiredTier(ended)).toBe("free");
    // Origine et date dites sur la page Formule.
    const until = new Date(Date.now() + 30 * DAY);
    expect(leadOwnPlan(orgPlan(lead(2, "own", until)))).toEqual({ tier: "proplus", until });
    expect(leadOwnPlan(orgPlan(lead(2)))).toEqual({ tier: "proplus", until: null });
    expect(leadOwnPlan(family)).toBeNull();
    expect(leadOwnPlan(orgPlan(lead(0)))).toBeNull();
  });

  it("formule du Compte Lead échue (valid_until passée) : Gratuit aussi pour les places et sans texte d'héritage", async () => {
    const { leadInherited, leadPlanEnded, seatsOf, tierOf } = await import("@/server/plans");
    // Droits lus il y a 2 h (relecture à 12 h) : héritage de Pro+ payé dans CRMlead.
    const heir = (until: Date) => ({
      ...orgPlan({
        ...lead(2, "family", until),
        subscriptions: [{ app: "crmlead", inherited: true, family_until: until.toISOString() }],
      }),
      entitlementsAt: new Date(Date.now() - 2 * 3_600_000),
    });
    const soon = new Date(Date.now() + 9 * DAY);
    const running = heir(soon);
    expect(leadPlanEnded(running)).toBe(false);
    expect(tierOf(running)).toBe("proplus");
    expect(seatsOf(running)).toBe(5);
    expect(leadInherited(running)).toEqual({ app: "CRMlead", until: soon.toISOString() });
    // Échu il y a une heure : Gratuit partout, plus de places de Pro+ ni de « Jusqu'au … ».
    const ended = heir(new Date(Date.now() - 3_600_000));
    expect(leadPlanEnded(ended)).toBe(true);
    expect(tierOf(ended)).toBe("free");
    expect(seatsOf(ended)).toBe(1);
    expect(leadInherited(ended)).toBeNull();
    // Formule propre échue : de même pour les places.
    const own = orgPlan(lead(2, "own", new Date(Date.now() - 3_600_000)));
    expect(seatsOf(own)).toBe(1);
    // Formule trop ancienne pour être crue : pas de texte d'héritage non plus.
    expect(
      leadInherited({ ...running, entitlementsAt: new Date(Date.now() - 80 * 3_600_000) }),
    ).toBe(null);
  });

  it("createCheckout refuse une formule non supérieure, sans aucun appel à Stripe", async () => {
    const { createCheckout } = await import("@/server/billing/subscriptions");
    const { BillingError } = await import("@/server/billing/stripe");
    const plus = await person({ lead: lead(2) });
    for (const plan of ["pro", "pro_plus"] as const) {
      const attempt = createCheckout(db, {
        org: await orgRow(plus.organization.id),
        email: "ada@atelier.test",
        plan,
        interval: "month",
        locale: "fr",
      });
      await expect(attempt).rejects.toBeInstanceOf(BillingError);
      await expect(attempt).rejects.toMatchObject({ status: 409, code: "plan_not_above" });
    }
    expect(calls).toEqual([]);
    expect((await orgRow(plus.organization.id)).billingCustomerId).toBeNull();

    // Pro propre : Pro refusé, Pro+ accepté (client puis session Stripe).
    await t.reset();
    const pro = await person({ lead: lead(1, "own") });
    await expect(
      createCheckout(db, {
        org: await orgRow(pro.organization.id),
        email: "ada@atelier.test",
        plan: "pro",
        interval: "year",
        locale: "fr",
      }),
    ).rejects.toMatchObject({ code: "plan_not_above" });
    expect(calls).toEqual([]);
    expect(
      await createCheckout(db, {
        org: await orgRow(pro.organization.id),
        email: "ada@atelier.test",
        plan: "pro_plus",
        interval: "year",
        locale: "fr",
      }),
    ).toBe("https://checkout.stripe.test/cs_test_x");
    expect(calls.map((c) => c.url)).toEqual([
      `${STRIPE}/v1/customers`,
      `${STRIPE}/v1/checkout/sessions`,
    ]);

    // Héritage Pro+ : Pro et Pro+ acceptés.
    await t.reset();
    calls = [];
    const family = await person({
      lead: lead(2, "family", new Date(Date.now() + 9 * DAY)),
    });
    for (const plan of ["pro", "pro_plus"] as const)
      expect(
        await createCheckout(db, {
          org: await orgRow(family.organization.id),
          email: "ada@atelier.test",
          plan,
          interval: "month",
          locale: "de",
        }),
      ).toBe("https://checkout.stripe.test/cs_test_x");
  });

  it("POST /api/billing/checkout : retour « ?error=already » sans appel à Stripe", async () => {
    const { createSession } = await import("@/server/auth/session");
    const plus = await person({ lead: lead(2) });
    const { token } = await createSession(db, {
      userId: plus.user.id,
      organizationId: plus.organization.id,
      idToken: null,
    });
    const { POST } = await import("@/app/api/billing/checkout/route");
    for (const plan of ["pro", "pro_plus"]) {
      const form = new FormData();
      form.set("locale", "fr");
      form.set("plan", plan);
      form.set("interval", "month");
      const res = await POST(
        request("/api/billing/checkout", {
          method: "POST",
          body: form,
          cookies: { il_session: token },
        }),
      );
      expect([res.status, where(res)]).toEqual([303, `${APP}/fr/app/settings/plan?error=already`]);
    }
    expect(calls).toEqual([]);
  });
});

describe("2. places : « Retirer », dernière venue", () => {
  async function team() {
    const plus = lead(2);
    const ada = await person({ lead: plus });
    const bob = await person({
      sub: "sub-bob",
      email: "bob@atelier.test",
      name: "Bob",
      org_role: "user",
      lead: plus,
    });
    const max = await person({
      sub: "sub-max",
      email: "max@atelier.test",
      name: "Max",
      org_role: "manager",
      lead: plus,
    });
    const org = ada.organization.id;
    const who = (u: { user: { id: string } }) => ({ organizationId: org, userId: u.user.id });
    return { ada, bob, max, org, who };
  }

  it("réservé aux responsables, jamais sur soi ; un responsable ne retire pas l'administrateur", async () => {
    const { removeMember, canRemove } = await import("@/server/team");
    const { ada, bob, max, who } = await team();
    expect(await removeMember(db, who(bob), max.user.id)).toBe("forbidden");
    expect(await removeMember(db, who(ada), ada.user.id)).toBe("self");
    expect(await removeMember(db, who(max), max.user.id)).toBe("self");
    expect(await removeMember(db, who(max), ada.user.id)).toBe("forbidden");
    expect(await removeMember(db, who(ada), "00000000-0000-4000-8000-000000000000")).toBe(
      "invalid",
    );
    // Règle d'affichage, la même que celle du serveur.
    const m = (userId: string, role: string) => ({ userId, role, appRole: null });
    expect(canRemove(m("a", "admin"), m("a", "admin"))).toBe(false);
    expect(canRemove(m("a", "admin"), m("b", "user"))).toBe(true);
    expect(canRemove(m("a", "admin"), m("c", "manager"))).toBe(true);
    expect(canRemove(m("c", "manager"), m("b", "user"))).toBe(true);
    expect(canRemove(m("c", "manager"), m("a", "admin"))).toBe(false);
    expect(canRemove(m("b", "user"), m("c", "manager"))).toBe(false);
    expect(canRemove(m("a", "admin"), m("f", "fiduciary"))).toBe(false);
  });

  it("le retrait libère la place, ferme ses sessions et reste gardé à la reconnexion", async () => {
    const { removeMember, restoreMember, listTeam, seated, hasSeat } = await import(
      "@/server/team"
    );
    const { createSession, findSession } = await import("@/server/auth/session");
    const { accessProblem } = await import("@/server/auth/guard");
    const { attachLeadIdentity } = await import("@/server/auth/attach");
    const { auditLog, sessions } = await import("@/server/db/schema");
    const { ada, bob, max, org, who } = await team();
    const { token } = await createSession(db, {
      userId: bob.user.id,
      organizationId: org,
      idToken: null,
    });
    expect(await removeMember(db, who(ada), bob.user.id)).toBe("removed");
    // Ses sessions dans l'entreprise tombent aussitôt.
    expect(await db.select().from(sessions).where(eq(sessions.userId, bob.user.id))).toEqual([]);
    expect(await findSession(db, token)).toBeNull();
    // Hors des places, à part dans la liste.
    const listed = await listTeam(db, org);
    expect(listed.members.map((m) => m.email)).toEqual(["ada@atelier.test", "max@atelier.test"]);
    expect(listed.removed.map((m) => m.email)).toEqual(["bob@atelier.test"]);
    expect([...seated(listed.members, 5)]).toEqual([ada.user.id, max.user.id]);
    // Il reste une place (Pro+ : 5) : elle n'entre pas pour autant à sa reconnexion.
    await attachLeadIdentity(
      db,
      claims({ sub: "sub-bob", email: "bob@atelier.test", org_role: "user", lead: lead(2) }),
    );
    const row = await orgRow(org);
    expect(await hasSeat(db, row, bob.user.id)).toBe(false);
    const again = await createSession(db, {
      userId: bob.user.id,
      organizationId: org,
      idToken: null,
    });
    const found = await findSession(db, again.token);
    if (!found) throw new Error("session absente");
    expect(await accessProblem(found)).toBe("blocked");
    // Un responsable (pas l'administratrice) la rétablit : elle retrouve sa place.
    expect(await restoreMember(db, who(bob), bob.user.id)).toBe("forbidden");
    expect(await restoreMember(db, who(max), bob.user.id)).toBe("restored");
    expect(await hasSeat(db, row, bob.user.id)).toBe(true);
    const actions = await db
      .select({ action: auditLog.action })
      .from(auditLog)
      .where(and(eq(auditLog.organizationId, org), eq(auditLog.entityId, bob.user.id)));
    expect(actions.map((a) => a.action).sort()).toEqual([
      "team.member.remove",
      "team.member.restore",
    ]);
  });

  it("« Rétablir » ne prend la place de personne : Pro à 2 places, la nouvelle venue garde la sienne", async () => {
    const { removeMember, restoreMember, listTeam, seated, hasSeat, setAppRole } = await import(
      "@/server/team"
    );
    const { seatsOf } = await import("@/server/plans");
    const { auditLog, memberships } = await import("@/server/db/schema");
    const two = { ...lead(1), plan: { ...leadPlan(1), seats: 2 } } as LeadClaims["lead"];
    const member = (name: string) =>
      person({
        sub: `sub-${name}`,
        email: `${name}@atelier.test`,
        name,
        org_role: "user",
        lead: two,
      });
    const ada = await person({ lead: two });
    const bob = await member("bob");
    const org = ada.organization.id;
    const who = (u: { user: { id: string } }) => ({ organizationId: org, userId: u.user.id });
    const joined = (userId: string, at: string) =>
      db
        .update(memberships)
        .set({ createdAt: new Date(at) })
        .where(and(eq(memberships.organizationId, org), eq(memberships.userId, userId)));
    await joined(ada.user.id, "2026-01-01T08:00:00Z");
    await joined(bob.user.id, "2026-02-01T08:00:00Z");
    // On retire Bob pour faire entrer Dan, qui arrive sur la place libérée.
    expect(await removeMember(db, who(ada), bob.user.id)).toBe("removed");
    const dan = await member("dan");
    const row = await orgRow(org);
    expect(seatsOf(row)).toBe(2);
    expect(await hasSeat(db, row, dan.user.id)).toBe(true);
    // Plus de place libre : Bob, arrivé avant Dan, ne lui prend pas la sienne.
    expect(await restoreMember(db, who(ada), bob.user.id)).toBe("full");
    expect(await hasSeat(db, row, dan.user.id)).toBe(true);
    expect(await hasSeat(db, row, bob.user.id)).toBe(false);
    const listed = await listTeam(db, org);
    expect(listed.removed.map((m) => m.email)).toEqual(["bob@atelier.test"]);
    expect([...seated(listed.members, 2)]).toEqual([ada.user.id, dan.user.id]);
    const restores = () =>
      db
        .select({ entityId: auditLog.entityId })
        .from(auditLog)
        .where(and(eq(auditLog.organizationId, org), eq(auditLog.action, "team.member.restore")));
    expect(await restores()).toEqual([]);
    // Une personne sans accès (« aucun ») n'occupe pas de place : elle se rétablit même ici.
    const cleo = await member("cleo");
    expect(await setAppRole(db, who(ada), cleo.user.id, "none")).toBe("saved");
    expect(await removeMember(db, who(ada), cleo.user.id)).toBe("removed");
    expect(await restoreMember(db, who(ada), cleo.user.id)).toBe("restored");
    expect(await hasSeat(db, row, dan.user.id)).toBe(true);
    // Dan retiré à son tour, une place se libère : un seul des deux rétablissements simultanés passe.
    expect(await setAppRole(db, who(ada), cleo.user.id, "all")).toBe("saved");
    expect(await removeMember(db, who(ada), cleo.user.id)).toBe("removed");
    expect(await removeMember(db, who(ada), dan.user.id)).toBe("removed");
    const both = await Promise.all([
      restoreMember(db, who(ada), bob.user.id),
      restoreMember(db, who(ada), cleo.user.id),
    ]);
    expect([...both].sort()).toEqual(["full", "restored"]);
    const back = (await listTeam(db, org)).members;
    expect(back).toHaveLength(2);
    expect(seated(back, 2).size).toBe(2);
    // Le refus dit quoi faire (fr, de, en) : Pro+ seulement en dessous de Pro+.
    for (const messages of [fr, de, en]) {
      const tr = createTranslator({ locale: "fr", messages, namespace: "app.team" });
      const below = tr("removeErrors.full", { next: "proplus", plus: 5 });
      const top = tr("removeErrors.full", { next: "none", plus: 5 });
      expect(below).toContain("Pro+");
      expect(below).toContain("5");
      expect(top).not.toContain("Pro+");
      expect(top.length).toBeGreaterThan(20);
    }
    expect(
      createTranslator({ locale: "fr", messages: fr, namespace: "app.team" })("removeErrors.full", {
        next: "proplus",
        plus: 5,
      }),
    ).toBe(
      "Plus de place libre pour rétablir cette personne\u202f: retirez d'abord quelqu'un ou passez à Pro+, qui compte 5 places.",
    );
  });

  it("deux retraits en même temps : deux administrateurs ne se retirent pas l'un l'autre, un seul retrait par personne", async () => {
    const { removeMember, listTeam } = await import("@/server/team");
    const { auditLog } = await import("@/server/db/schema");
    const { ada, bob, max, org, who } = await team();
    const zoe = await person({
      sub: "sub-zoe",
      email: "zoe@atelier.test",
      name: "Zoe",
      org_role: "admin",
      lead: lead(2),
    });
    // Deux connexions ouvertes d'avance : les deux retraits partent vraiment en même temps.
    await Promise.all([1, 2].map(() => db.execute(sql`select pg_sleep(0.05)`)));
    const crossed = await Promise.all([
      removeMember(db, who(ada), zoe.user.id),
      removeMember(db, who(zoe), ada.user.id),
    ]);
    expect([...crossed].sort()).toEqual(["forbidden", "removed"]);
    const admins = (await listTeam(db, org)).members.filter((m) => m.role === "admin");
    expect(admins).toHaveLength(1);
    const left = { user: { id: admins[0]?.userId ?? "" } };
    // La même personne retirée deux fois en même temps : un seul retrait, une seule ligne au journal.
    const twice = await Promise.all([
      removeMember(db, who(left), bob.user.id),
      removeMember(db, who(max), bob.user.id),
    ]);
    expect([...twice].sort()).toEqual(["invalid", "removed"]);
    const journal = await db
      .select({ by: auditLog.userId })
      .from(auditLog)
      .where(
        and(
          eq(auditLog.organizationId, org),
          eq(auditLog.action, "team.member.remove"),
          eq(auditLog.entityId, bob.user.id),
        ),
      );
    expect(journal).toHaveLength(1);
  });

  it("un responsable retiré n'a plus aucun droit, ni entreprise où passer", async () => {
    const { removeMember, listUserOrganizations, leadOrganizationOf } = await import(
      "@/server/team"
    );
    const { canEditSettings } = await import("@/server/company");
    const { ada, max, org, who } = await team();
    expect(await canEditSettings(db, org, max.user.id)).toBe(true);
    expect(await removeMember(db, who(ada), max.user.id)).toBe("removed");
    expect(await canEditSettings(db, org, max.user.id)).toBe(false);
    expect(await listUserOrganizations(db, max.user.id)).toEqual([]);
    expect(await leadOrganizationOf(db, max.user.id, null)).toBeUndefined();
  });

  it("un administrateur retiré par un autre ne prend plus d'abonnement (?error=admin, sans Stripe)", async () => {
    const { removeMember } = await import("@/server/team");
    const { createSession } = await import("@/server/auth/session");
    const { ada, org, who } = await team();
    const zoe = await person({
      sub: "sub-zoe",
      email: "zoe@atelier.test",
      org_role: "admin",
      lead: lead(0),
    });
    expect(await removeMember(db, who(ada), zoe.user.id)).toBe("removed");
    // Elle revient par le Compte Lead (nouvelle session) : la formule Gratuite permettrait Pro+.
    const { token } = await createSession(db, {
      userId: zoe.user.id,
      organizationId: org,
      idToken: null,
    });
    const { POST } = await import("@/app/api/billing/checkout/route");
    const form = new FormData();
    form.set("locale", "fr");
    form.set("plan", "pro_plus");
    form.set("interval", "month");
    const res = await POST(
      request("/api/billing/checkout", {
        method: "POST",
        body: form,
        cookies: { il_session: token },
      }),
    );
    expect(where(res)).toBe(`${APP}/fr/app/settings/plan?error=admin`);
    expect(calls).toEqual([]);
  });

  it("dernière venue : écrite sur l'adhésion à chaque arrivée, gardée après la session", async () => {
    const { listTeam } = await import("@/server/team");
    const { memberships, sessions } = await import("@/server/db/schema");
    const { GET: start } = await import("@/app/auth/lead/start/route");
    const { GET: callback } = await import("@/app/auth/lead/callback/route");
    const before = Date.now();
    ctx.claims = claims({ locale: "fr" });
    const go = await start(request("/auth/lead/start?locale=fr"));
    const state = new URL(where(go)).searchParams.get("state") ?? "";
    const back = await callback(
      request(`/auth/lead/callback?code=abc&state=${state}`, { cookies: setCookies(go) }),
    );
    expect(where(back)).toBe(`${APP}/fr/app`);
    const [m] = await db.select().from(memberships);
    expect(m?.lastSeenAt?.getTime()).toBeGreaterThanOrEqual(before - 1000);
    // La session disparaît (déconnexion) : la dernière venue reste.
    await db.delete(sessions);
    const listed = await listTeam(db, m?.organizationId ?? "");
    expect(listed.members[0]?.lastSeenAt?.getTime()).toBe(m?.lastSeenAt?.getTime());
  });

  it("migration 0044 rejouable : la dernière venue des adhésions d'avant reprend la dernière connexion", async () => {
    const { auditLog, memberships } = await import("@/server/db/schema");
    const { ada, org } = await team();
    await db.update(memberships).set({ lastSeenAt: null });
    await db.delete(auditLog);
    const old = new Date("2026-10-01T08:00:00Z");
    const last = new Date("2026-10-12T17:30:00Z");
    for (const at of [old, last])
      await db
        .insert(auditLog)
        .values({ organizationId: org, userId: ada.user.id, action: "auth.login", createdAt: at });
    const root = fileURLToPath(new URL("../..", import.meta.url));
    const file = readFileSync(path.join(root, "drizzle/0044_member_seats.sql"), "utf8");
    expect(file.startsWith("-- Rejouable")).toBe(true);
    for (let run = 0; run < 2; run++)
      for (const statement of file.split("--> statement-breakpoint"))
        if (statement.replace(/--[^\n]*\n?/g, "").trim()) await db.execute(sql.raw(statement));
    const rows = await db.select().from(memberships).where(eq(memberships.organizationId, org));
    const byUser = new Map(rows.map((r) => [r.userId, r.lastSeenAt?.toISOString() ?? null]));
    expect(byUser.get(ada.user.id)).toBe(last.toISOString());
    expect([...byUser.values()].filter((v) => v === null)).toHaveLength(2);
  });
});

describe("4 et 6a. refus « places » : servi sans session, Changer de compte, conseil selon la formule", () => {
  it("/xx/no-access n'exige plus de session ; l'application, si", async () => {
    const { default: proxy } = await import("@/proxy");
    const open = (await proxy(
      request("/fr/no-access?raison=places&formule=proplus"),
    )) as NextResponse;
    expect(where(open)).not.toContain("/login");
    expect(open.status).toBe(200);
    const app = (await proxy(request("/fr/app"))) as NextResponse;
    expect(where(app)).toContain("/fr/login");
  });

  it("« Changer de compte » : /auth/lead/start?switch=1 redemande l'identifiant (prompt=login), même avec une session", async () => {
    const { createSession } = await import("@/server/auth/session");
    const { switchAccountPath } = await import("@/server/refusal");
    expect(switchAccountPath("fr")).toBe("/auth/lead/start?switch=1&locale=fr");
    const { GET: start } = await import("@/app/auth/lead/start/route");
    const fresh = await start(request(switchAccountPath("fr")));
    const authorize = new URL(where(fresh));
    expect(authorize.pathname).toBe("/oauth/authorize");
    expect(authorize.searchParams.get("prompt")).toBe("login");
    // Avec la session InvoiceLead de la personne refusée : pas de retour dans l'application.
    const ada = await person();
    const { token } = await createSession(db, {
      userId: ada.user.id,
      organizationId: ada.organization.id,
      idToken: null,
    });
    const switching = await start(
      request(switchAccountPath("de"), { cookies: { il_session: token } }),
    );
    const next = new URL(where(switching));
    expect(next.pathname).toBe("/oauth/authorize");
    expect(next.searchParams.get("prompt")).toBe("login");
    // Sans switch : la session ouverte mène dans l'application, comme avant.
    const plain = await start(
      request("/auth/lead/start?locale=fr", { cookies: { il_session: token } }),
    );
    expect(where(plain)).toBe(`${APP}/fr/app`);
  });

  it("adresse du refus : raison=places et la formule de l'entreprise ; formule lue dans l'adresse", async () => {
    const { formuleOf, seatRefusalPath, LEAD_ACCOUNT_URL, plansPath } = await import(
      "@/server/refusal"
    );
    expect(seatRefusalPath("fr", "proplus")).toBe("/fr/no-access?raison=places&formule=proplus");
    expect(seatRefusalPath("de", "free", "/de/app/invoices")).toBe(
      "/de/no-access?raison=places&formule=free&next=%2Fde%2Fapp%2Finvoices",
    );
    expect(formuleOf("proplus")).toBe("proplus");
    expect(formuleOf("pro_plus")).toBe("proplus");
    expect(formuleOf("pro")).toBe("pro");
    expect(formuleOf("free")).toBe("free");
    for (const bad of ["", "team", "<x>", undefined, ["pro"]]) expect(formuleOf(bad)).toBeNull();
    expect(LEAD_ACCOUNT_URL).toBe("https://erplead.io/account");
    expect(plansPath("en")).toBe("/en/pricing");
  });

  it("conseil : Pro+ plein, libérer une place sans offre ; Gratuit ou Pro, Pro+ par l'administrateur, « Voir les formules » sinon", async () => {
    const { seatAdvice } = await import("@/server/refusal");
    const any = { canCheckout: true, canPortal: true };
    expect(seatAdvice({ formule: "proplus", admin: true, ...any })).toEqual({
      advice: "freeUpAdmin",
      offer: null,
    });
    expect(seatAdvice({ formule: "proplus", admin: false, ...any })).toEqual({
      advice: "freeUp",
      offer: null,
    });
    for (const formule of ["free", "pro"] as const) {
      expect(seatAdvice({ formule, admin: false, ...any })).toEqual({
        advice: "upgradeAsk",
        offer: "plans",
      });
      expect(seatAdvice({ formule, admin: true, ...any })).toEqual({
        advice: "upgradeAdmin",
        offer: "checkout",
      });
      expect(seatAdvice({ formule, admin: true, canCheckout: false, canPortal: true })).toEqual({
        advice: "upgradeAdmin",
        offer: "portal",
      });
      expect(seatAdvice({ formule, admin: true, canCheckout: false, canPortal: false })).toEqual({
        advice: "upgradeAdmin",
        offer: "plans",
      });
    }
  });

  it("textes (fr, de, en) : la formule dite, Pro+ conseillé seulement en dessous de Pro+", () => {
    const seats = { free: 1, pro: 1, proplus: 5 } as const;
    const bodyKey = { free: "seatBodyFree", pro: "seatBodyPro", proplus: "seatBodyPlus" } as const;
    for (const [locale, messages] of [
      ["fr", fr],
      ["de", de],
      ["en", en],
    ] as const) {
      const tr = createTranslator({ locale, messages, namespace: "app.noAccess" });
      const org = tr("yourCompany");
      for (const formule of ["free", "pro", "proplus"] as const) {
        const body = tr(bodyKey[formule], { org, seats: seats[formule] });
        const advice =
          formule === "proplus"
            ? [tr("freeUp", { org }), tr("freeUpAdmin")]
            : [tr("upgradeAsk", { org, plus: 5 }), tr("upgradeAdmin", { plus: 5 })];
        for (const line of advice) {
          const text = `${tr("seatTitle")} ${body} ${line}`;
          if (formule === "proplus") {
            // Règle du banc (check-no-access.mjs) : aucun conseil de passer à Pro+, libérer une place.
            expect(text, `${locale} ${formule}`).not.toMatch(
              /(passe[rz]?|prendre) (à |une formule )?(Pro\+|avec plus de places)|Upgrade to Pro\+|auf Pro\+ wechseln/i,
            );
            expect(text, `${locale} ${formule}`).toMatch(/libér|frei|free up/i);
          } else {
            expect(text, `${locale} ${formule}`).toContain("Pro+");
          }
          if (formule === "free")
            expect(text, `${locale} ${formule}`).toMatch(/Gratuit|Gratis|Free/);
        }
      }
      expect(tr("switchAccount")).toBeTruthy();
      expect(tr("leadAccount")).toContain("ERPlead");
      expect(tr("seePlans")).toBeTruthy();
    }
    expect(
      createTranslator({ locale: "fr", messages: fr, namespace: "app.noAccess" })("switchAccount"),
    ).toBe("Changer de compte");
    expect(
      createTranslator({ locale: "fr", messages: fr, namespace: "app.noAccess" })("seePlans"),
    ).toBe("Voir les formules");
  });
});
