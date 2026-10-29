import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { attachLeadIdentity } from "@/server/auth/attach";
import { createContact, parseContactForm } from "@/server/contacts";
import { assistantUsage, organizations, planUsage } from "@/server/db/schema";
import {
  ASSISTANT_TOKENS,
  consumeQuota,
  type Feature,
  featureAccess,
  type MeteredQuota,
  PLANS,
  planUsageOf,
  poweredBy,
  quotaAccess,
  refundQuota,
  seatsOf,
  tierOf,
  tierWithMoreSeats,
  upgradeUrl,
} from "@/server/plans";
import { claims } from "../support/claims";
import { testDb } from "../support/db";
import { leadPlan } from "../support/lead-plan";

const t = testDb();
const db = t.database;
beforeEach(() => t.reset());
afterAll(() => t.close());

const FREE = { leadPlan: "free", entitlements: { plan: leadPlan(0) } };
const PRO = { leadPlan: "pro", entitlements: { plan: leadPlan(1) } };
const PLUS = { leadPlan: "x", entitlements: { plan: leadPlan(2) } };

/** Entreprise du Compte Lead à la formule voulue (rang 0, 1 ou 2). */
async function company(rank: number, n = "a") {
  const a = await attachLeadIdentity(
    db,
    claims({ sub: `sub-${n}`, email: `${n}@atelier.test`, org: `org-${n}` }),
  );
  await db
    .update(organizations)
    .set({ entitlements: { plan: leadPlan(rank) } })
    .where(eq(organizations.id, a.organization.id));
  return { ...a.organization, entitlements: { plan: leadPlan(rank) } };
}

/** Jetons de l'assistant IA déjà consommés (journal assistant_usage), pondérés = `weighted`. */
async function spend(org: { id: string }, weighted: number, at = new Date("2026-10-01T12:00:00Z")) {
  await db
    .insert(assistantUsage)
    .values({ organizationId: org.id, inputTokens: weighted, createdAt: at });
}

/** Consomme `n` unités et rend le nombre accepté. */
async function consume(
  org: Awaited<ReturnType<typeof company>>,
  quota: MeteredQuota,
  n: number,
  today = "2026-10-01",
) {
  let ok = 0;
  for (let i = 0; i < n; i++) if ((await consumeQuota(db, org, quota, today)).allowed) ok += 1;
  return ok;
}

describe("formules", () => {
  it("se lisent dans les droits du Compte Lead", () => {
    expect([tierOf(FREE), tierOf(PRO), tierOf(PLUS)]).toEqual(["free", "pro", "proplus"]);
    expect(tierOf({ leadPlan: "pro", entitlements: null })).toBe("pro");
    expect(poweredBy(FREE)).toBe(true);
    expect(poweredBy(PRO)).toBe(false);
    // « Passer à Pro » mène à la page Formule d'InvoiceLead, jamais à une autre application.
    expect(upgradeUrl("fr")).toBe("/fr/app/settings/plan");
    expect(upgradeUrl("de", "pro")).toBe("/de/app/settings/plan?plan=pro");
    expect(upgradeUrl("en", "proplus")).toBe("/en/app/settings/plan?plan=pro_plus");
  });

  it("se lisent partout avec l'abonnement payé ici (planColumns, jamais trois colonnes à part)", () => {
    // Une sélection qui oublierait billing_plan traiterait en Gratuit une entreprise qui paie ici.
    const files = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory()
          ? files(join(dir, e.name))
          : /\.tsx?$/.test(e.name)
            ? [join(dir, e.name)]
            : [],
      );
    const offenders = files(fileURLToPath(new URL("../../src", import.meta.url))).filter(
      (f) =>
        !f.endsWith("/server/plans.ts") &&
        /entitlementsAt: organizations\.entitlementsAt/.test(readFileSync(f, "utf8")),
    );
    expect(offenders).toEqual([]);
  });

  it("valent dans InvoiceLead seulement : la formule d'InvoiceLead et l'abonnement payé ici", () => {
    const now = Date.parse("2026-10-13T12:00:00Z");
    const later = new Date(now + 86_400_000);
    const past = new Date(now - 1000);
    // Abonnement InvoiceLead payé ici : vaut tout de suite, même si le Compte Lead dit Gratuit.
    const paid = { ...FREE, billingPlan: "pro", billingPlanUntil: later };
    expect(tierOf(paid, now)).toBe("pro");
    expect(tierOf({ ...FREE, billingPlan: "pro_plus", billingPlanUntil: later }, now)).toBe(
      "proplus",
    );
    const tomorrow = new Date(Date.now() + 86_400_000);
    expect(seatsOf({ ...FREE, billingPlan: "pro_plus", billingPlanUntil: tomorrow })).toBe(5);
    // Échu (fin de période plus la grâce passée) : plus rien.
    expect(tierOf({ ...FREE, billingPlan: "pro", billingPlanUntil: past }, now)).toBe("free");
    // Valeur inconnue : rien.
    expect(tierOf({ ...FREE, billingPlan: "team", billingPlanUntil: later }, now)).toBe("free");
    // La meilleure des deux : Pro+ du Compte Lead (héritage) l'emporte sur Pro payé ici.
    expect(tierOf({ ...PLUS, billingPlan: "pro", billingPlanUntil: later }, now)).toBe("proplus");
    // Formule du Compte Lead trop ancienne (72 h sans nouvelle) : l'abonnement payé ici tient.
    const stale = new Date(now - 100 * 3_600_000);
    expect(tierOf({ ...PLUS, entitlementsAt: stale }, now)).toBe("free");
    expect(
      tierOf({ ...PLUS, entitlementsAt: stale, billingPlan: "pro", billingPlanUntil: later }, now),
    ).toBe("pro");
  });

  it("lisent le code de la formule d'ERPlead, le rang (0, 10, 20) n'étant qu'un repli", () => {
    const lead = (plan: Record<string, unknown>, leadPlan = "free") => ({
      leadPlan,
      entitlements: { plan },
    });
    // Un Pro d'ERPlead (rang 10) reste Pro : jusqu'au 13.10.2026, « rang >= 2 » en faisait un Pro+.
    expect(tierOf(lead({ code: "pro", rank: 10, seats: 1 }))).toBe("pro");
    expect(featureAccess(lead({ code: "pro", rank: 10 }), "api").allowed).toBe(false);
    expect(tierOf(lead({ code: "pro_plus", rank: 20, seats: 5 }))).toBe("proplus");
    expect(tierOf(lead({ code: "free", rank: 0 }))).toBe("free");
    // Le code l'emporte sur le rang, dans les deux sens ; un code inconnu vaut Gratuit.
    expect(tierOf(lead({ code: "pro", rank: 20 }))).toBe("pro");
    expect(tierOf(lead({ code: "free", rank: 20 }))).toBe("free");
    expect(tierOf(lead({ code: "team", rank: 20 }))).toBe("free");
    // Sans code : le rang d'ERPlead.
    expect(tierOf(lead({ rank: 10 }))).toBe("pro");
    expect(tierOf(lead({ rank: 20 }))).toBe("proplus");
    expect(tierOf(lead({ rank: 1 }))).toBe("free");
    expect(tierOf(lead({ rank: 2 }))).toBe("free");
    // Ni code ni rang : la formule enregistrée à la connexion.
    expect(tierOf(lead({}, "pro_plus"))).toBe("proplus");
    // Pro : une place, comme ERPlead ; Pro+ : cinq.
    expect([PLANS.free.seats, PLANS.pro.seats, PLANS.proplus.seats]).toEqual([1, 1, 5]);
    expect(seatsOf(lead({ code: "pro", rank: 10 }))).toBe(1);
    expect(seatsOf(lead({ code: "pro_plus", rank: 20 }))).toBe(5);
    expect(tierWithMoreSeats("free", 1)).toBe("proplus");
    expect(tierWithMoreSeats("pro", 1)).toBe("proplus");
    expect(tierWithMoreSeats("proplus", 5)).toBeNull();
  });

  it("réservent chaque fonction à sa formule, avec la formule qui l'ouvre", () => {
    const pro: Feature[] = [
      "vatReturn",
      "multiCurrency",
      "fiduciary",
      "reminderLevels",
      "reminderAuto",
      "reminderCharges",
      "autopilotDigest",
    ];
    for (const f of pro) {
      expect(featureAccess(FREE, f)).toMatchObject({ allowed: false, upgradeTo: "pro" });
      expect(featureAccess(PRO, f)).toMatchObject({ allowed: true, upgradeTo: null });
      expect(featureAccess(PLUS, f).allowed).toBe(true);
    }
    expect(featureAccess(FREE, "api")).toMatchObject({ allowed: false, upgradeTo: "proplus" });
    expect(featureAccess(PRO, "api")).toMatchObject({ allowed: false, upgradeTo: "proplus" });
    expect(featureAccess(PLUS, "api")).toMatchObject({ allowed: true, tier: "proplus" });
  });

  it("donnent les petites allocations du 1er octobre 2026, factures et lectures révisées le 29.10.2026, assistant IA en jetons", () => {
    // Demande d'Ève du 29.10.2026 : 5 factures émises et 10 lectures de pièces par mois en
    // Gratuit (auparavant 10 et 20) ; le même jour, l'assistant passe de 10 questions à un budget
    // de 200 000 jetons pondérés (l'équivalent de 10 demandes) ; rien d'autre ne change.
    expect(ASSISTANT_TOKENS).toEqual({
      weights: { input: 1, cacheWrite: 1.25, cacheRead: 0.1, output: 5 },
      perRequest: 20_000,
      free: 200_000,
    });
    expect(PLANS.free).toEqual({
      quotas: {
        invoices: 5,
        contacts: 50,
        aiReads: 10,
        assistant: 200_000,
        reminders: 5,
        bankImports: 1,
        recurring: 1,
      },
      seats: 1,
      poweredBy: true,
    });
    // Pro et Pro+ inchangés.
    const unlimited = {
      invoices: Infinity,
      contacts: Infinity,
      assistant: Infinity,
      reminders: Infinity,
      bankImports: Infinity,
      recurring: Infinity,
    };
    expect(PLANS.pro).toEqual({
      quotas: { ...unlimited, aiReads: 50 },
      seats: 1,
      poweredBy: false,
    });
    expect(PLANS.proplus).toEqual({
      quotas: { ...unlimited, aiReads: 300 },
      seats: 5,
      poweredBy: false,
    });
  });
});

describe("allocations mensuelles", () => {
  it("lectures de pièces : 10 en Gratuit (la 11e refusée), 50 en Pro, 300 en Pro+", async () => {
    const free = await company(0, "free");
    const pro = await company(1, "pro");
    const plus = await company(2, "plus");
    expect(await consume(free, "aiReads", 11)).toBe(10);
    expect(await quotaAccess(db, free, "aiReads", "2026-10-15")).toMatchObject({
      allowed: false,
      used: 10,
      limit: 10,
      upgradeTo: "pro",
    });
    expect(await consume(pro, "aiReads", 51)).toBe(50);
    expect((await quotaAccess(db, pro, "aiReads", "2026-10-15")).upgradeTo).toBe("proplus");
    expect(await consume(plus, "aiReads", 301)).toBe(300);
    expect(await quotaAccess(db, plus, "aiReads", "2026-10-15")).toMatchObject({
      allowed: false,
      upgradeTo: null,
    });
  });

  it("assistant IA en jetons, relances 5, relevé 1 en Gratuit ; sans limite en Pro", async () => {
    const free = await company(0, "free");
    const pro = await company(1, "pro");
    await spend(free, 199_999);
    expect(await quotaAccess(db, free, "assistant", "2026-10-15")).toMatchObject({
      allowed: true,
      used: 199_999,
      limit: 200_000,
    });
    await spend(free, 1);
    expect(await quotaAccess(db, free, "assistant", "2026-10-15")).toMatchObject({
      allowed: false,
      used: 200_000,
      upgradeTo: "pro",
    });
    expect(await consume(free, "reminders", 6)).toBe(5);
    expect(await consume(free, "bankImports", 2)).toBe(1);
    await spend(pro, 2_500_000);
    expect(await consume(pro, "reminders", 12)).toBe(12);
    expect(await consume(pro, "bankImports", 4)).toBe(4);
    // Les formules sans limite comptent quand même (usage affiché).
    expect(await quotaAccess(db, pro, "assistant", "2026-10-02")).toMatchObject({
      allowed: true,
      used: 2_500_000,
      limit: Infinity,
    });
    // L'assistant ne tient plus de compteur dans plan_usage (un seul compteur : son journal).
    expect(await db.select().from(planUsage).where(eq(planUsage.key, "assistant"))).toEqual([]);
  });

  it("rendent l'unité quand l'action échoue, sans descendre sous zéro", async () => {
    const free = await company(0);
    expect(await consume(free, "aiReads", 10)).toBe(10);
    await refundQuota(db, free.id, "aiReads", "2026-10-01");
    expect((await quotaAccess(db, free, "aiReads", "2026-10-01")).used).toBe(9);
    expect(await consume(free, "aiReads", 2)).toBe(1);
    // Sans ligne du mois : rien à rendre, rien d'écrit.
    await refundQuota(db, free.id, "reminders", "2026-10-01");
    expect((await quotaAccess(db, free, "reminders", "2026-10-01")).used).toBe(0);
    // Une ligne à 1, rendue deux fois (envoi échoué rejoué) : elle reste à 0, sans erreur, même
    // avec la contrainte « used >= 0 » de la table.
    expect(await consume(free, "reminders", 1)).toBe(1);
    await refundQuota(db, free.id, "reminders", "2026-10-01");
    await expect(refundQuota(db, free.id, "reminders", "2026-10-01")).resolves.toBeUndefined();
    const [row] = await db
      .select()
      .from(planUsage)
      .where(and(eq(planUsage.organizationId, free.id), eq(planUsage.key, "reminders")));
    expect(row?.used).toBe(0);
    expect(await consume(free, "reminders", 5)).toBe(5);
  });

  it("repartent à zéro le premier du mois (UTC) et restent propres à l'entreprise", async () => {
    const free = await company(0, "a");
    const other = await company(0, "b");
    expect(await consume(free, "aiReads", 10, "2026-10-31")).toBe(10);
    expect((await consumeQuota(db, free, "aiReads", "2026-10-31")).allowed).toBe(false);
    expect((await consumeQuota(db, free, "aiReads", "2026-11-01")).allowed).toBe(true);
    expect((await consumeQuota(db, other, "aiReads", "2026-10-31")).allowed).toBe(true);
    const rows = await db.select().from(planUsage).where(eq(planUsage.organizationId, free.id));
    expect(rows.map((r) => [r.period, r.used]).sort()).toEqual([
      ["2026-10", 10],
      ["2026-11", 1],
    ]);
  });

  it("ne dépassent pas la limite avec des demandes simultanées", async () => {
    const free = await company(0);
    const results = await Promise.all(
      Array.from({ length: 30 }, () => consumeQuota(db, free, "aiReads", "2026-10-01")),
    );
    expect(results.filter((r) => r.allowed)).toHaveLength(10);
    expect((await quotaAccess(db, free, "aiReads", "2026-10-01")).used).toBe(10);
    const imports = await Promise.all(
      Array.from({ length: 5 }, () => consumeQuota(db, free, "bankImports", "2026-10-01")),
    );
    expect(imports.filter((r) => r.allowed)).toHaveLength(1);
  });

  it("se lisent toutes ensemble pour le tableau de bord", async () => {
    const free = await company(0);
    await consume(free, "aiReads", 3);
    await spend(free, 200_000);
    const usage = await planUsageOf(db, free, "2026-10-09");
    expect(usage.aiReads).toMatchObject({ allowed: true, used: 3, limit: 10 });
    expect(usage.assistant).toMatchObject({
      allowed: false,
      used: 200_000,
      limit: 200_000,
      upgradeTo: "pro",
    });
    expect(usage.invoices).toMatchObject({ allowed: true, used: 0, limit: 5 });
    expect(usage.recurring).toMatchObject({ allowed: true, used: 0, limit: 1 });
    expect(usage.bankImports).toMatchObject({ allowed: true, used: 0, limit: 1 });
  });

  it("limitent les contacts de la formule gratuite", async () => {
    const a = await attachLeadIdentity(db, claims());
    const who = { organizationId: a.organization.id, userId: a.user.id };
    const f = new FormData();
    for (const [k, v] of Object.entries({
      kind: "company",
      isCustomer: "on",
      name: "X",
      language: "de",
      country: "CH",
      paymentTermDays: "30",
    }))
      f.set(k, v);
    const parsed = parseContactForm(f);
    if (!parsed.ok) throw new Error("contact");
    for (let i = 0; i < PLANS.free.quotas.contacts; i++)
      await createContact(db, who, { ...parsed.data, name: `C${i}` });
    expect(await quotaAccess(db, a.organization, "contacts")).toMatchObject({
      allowed: false,
      limit: 50,
      upgradeTo: "pro",
    });
    expect(
      (
        await quotaAccess(
          db,
          { ...a.organization, entitlements: { plan: leadPlan(1) } },
          "contacts",
        )
      ).allowed,
    ).toBe(true);
    expect((await quotaAccess(db, a.organization, "invoices")).allowed).toBe(true);
  });
});
