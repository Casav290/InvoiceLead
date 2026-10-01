import { and, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { attachLeadIdentity } from "@/server/auth/attach";
import { createContact, parseContactForm } from "@/server/contacts";
import { organizations, planUsage } from "@/server/db/schema";
import {
  consumeQuota,
  type Feature,
  featureAccess,
  type MeteredQuota,
  PLANS,
  planUsageOf,
  poweredBy,
  quotaAccess,
  refundQuota,
  tierOf,
  upgradeUrl,
} from "@/server/plans";
import { claims } from "../support/claims";
import { testDb } from "../support/db";

const t = testDb();
const db = t.database;
beforeEach(() => t.reset());
afterAll(() => t.close());

const FREE = { leadPlan: "free", entitlements: { plan: { rank: 0 } } };
const PRO = { leadPlan: "pro", entitlements: { plan: { rank: 1 } } };
const PLUS = { leadPlan: "x", entitlements: { plan: { rank: 2 } } };

/** Entreprise du Compte Lead à la formule voulue (rang 0, 1 ou 2). */
async function company(rank: number, n = "a") {
  const a = await attachLeadIdentity(
    db,
    claims({ sub: `sub-${n}`, email: `${n}@atelier.test`, org: `org-${n}` }),
  );
  await db
    .update(organizations)
    .set({ entitlements: { plan: { rank } } })
    .where(eq(organizations.id, a.organization.id));
  return { ...a.organization, entitlements: { plan: { rank } } };
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
    expect(
      upgradeUrl({
        leadPlan: "free",
        entitlements: {
          apps: { invoicelead: { upgrade_url: "https://scanlead.io/billing?app=invoicelead" } },
        },
      }),
    ).toBe("https://scanlead.io/billing?app=invoicelead");
    expect(
      upgradeUrl({
        leadPlan: "free",
        entitlements: { apps: { invoicelead: { upgrade_url: "javascript:alert(1)" } } },
      }),
    ).toBe("https://scanlead.io/billing");
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

  it("donnent les petites allocations décidées le 1er octobre 2026", () => {
    expect(PLANS.free.quotas).toEqual({
      invoices: 10,
      contacts: 50,
      aiReads: 20,
      assistant: 10,
      reminders: 5,
      bankImports: 1,
      recurring: 1,
    });
    expect(PLANS.pro.quotas.aiReads).toBe(50);
    expect(PLANS.proplus.quotas.aiReads).toBe(300);
    for (const q of ["invoices", "contacts", "assistant", "reminders", "bankImports", "recurring"])
      expect(PLANS.pro.quotas[q as keyof typeof PLANS.pro.quotas]).toBe(Infinity);
  });
});

describe("allocations mensuelles", () => {
  it("lectures de pièces : 20 en Gratuit, 50 en Pro, 300 en Pro+, puis refusées", async () => {
    const free = await company(0, "free");
    const pro = await company(1, "pro");
    const plus = await company(2, "plus");
    expect(await consume(free, "aiReads", 21)).toBe(20);
    expect(await quotaAccess(db, free, "aiReads", "2026-10-15")).toMatchObject({
      allowed: false,
      used: 20,
      limit: 20,
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

  it("assistant 10, relances 5, relevé 1 en Gratuit ; sans limite en Pro", async () => {
    const free = await company(0, "free");
    const pro = await company(1, "pro");
    expect(await consume(free, "assistant", 11)).toBe(10);
    expect(await consume(free, "reminders", 6)).toBe(5);
    expect(await consume(free, "bankImports", 2)).toBe(1);
    expect(await consume(pro, "assistant", 25)).toBe(25);
    expect(await consume(pro, "reminders", 12)).toBe(12);
    expect(await consume(pro, "bankImports", 4)).toBe(4);
    // Les formules sans limite comptent quand même (usage affiché).
    expect((await quotaAccess(db, pro, "assistant", "2026-10-02")).used).toBe(25);
  });

  it("rendent l'unité quand l'action échoue, sans descendre sous zéro", async () => {
    const free = await company(0);
    expect(await consume(free, "aiReads", 20)).toBe(20);
    await refundQuota(db, free.id, "aiReads", "2026-10-01");
    expect((await quotaAccess(db, free, "aiReads", "2026-10-01")).used).toBe(19);
    expect(await consume(free, "aiReads", 2)).toBe(1);
    // Sans ligne du mois : rien à rendre, rien d'écrit.
    await refundQuota(db, free.id, "assistant", "2026-10-01");
    expect((await quotaAccess(db, free, "assistant", "2026-10-01")).used).toBe(0);
    // Une ligne à 1, rendue deux fois (panne de l'IA rejouée) : elle reste à 0, sans erreur, même
    // avec la contrainte « used >= 0 » de la table.
    expect(await consume(free, "assistant", 1)).toBe(1);
    await refundQuota(db, free.id, "assistant", "2026-10-01");
    await expect(refundQuota(db, free.id, "assistant", "2026-10-01")).resolves.toBeUndefined();
    const [row] = await db
      .select()
      .from(planUsage)
      .where(and(eq(planUsage.organizationId, free.id), eq(planUsage.key, "assistant")));
    expect(row?.used).toBe(0);
    expect(await consume(free, "assistant", 10)).toBe(10);
  });

  it("repartent à zéro le premier du mois (UTC) et restent propres à l'entreprise", async () => {
    const free = await company(0, "a");
    const other = await company(0, "b");
    expect(await consume(free, "aiReads", 20, "2026-10-31")).toBe(20);
    expect((await consumeQuota(db, free, "aiReads", "2026-10-31")).allowed).toBe(false);
    expect((await consumeQuota(db, free, "aiReads", "2026-11-01")).allowed).toBe(true);
    expect((await consumeQuota(db, other, "aiReads", "2026-10-31")).allowed).toBe(true);
    const rows = await db.select().from(planUsage).where(eq(planUsage.organizationId, free.id));
    expect(rows.map((r) => [r.period, r.used]).sort()).toEqual([
      ["2026-10", 20],
      ["2026-11", 1],
    ]);
  });

  it("ne dépassent pas la limite avec des demandes simultanées", async () => {
    const free = await company(0);
    const results = await Promise.all(
      Array.from({ length: 30 }, () => consumeQuota(db, free, "aiReads", "2026-10-01")),
    );
    expect(results.filter((r) => r.allowed)).toHaveLength(20);
    expect((await quotaAccess(db, free, "aiReads", "2026-10-01")).used).toBe(20);
    const imports = await Promise.all(
      Array.from({ length: 5 }, () => consumeQuota(db, free, "bankImports", "2026-10-01")),
    );
    expect(imports.filter((r) => r.allowed)).toHaveLength(1);
  });

  it("se lisent toutes ensemble pour le tableau de bord", async () => {
    const free = await company(0);
    await consume(free, "aiReads", 3);
    await consume(free, "assistant", 10);
    const usage = await planUsageOf(db, free, "2026-10-09");
    expect(usage.aiReads).toMatchObject({ allowed: true, used: 3, limit: 20 });
    expect(usage.assistant).toMatchObject({ allowed: false, used: 10, upgradeTo: "pro" });
    expect(usage.invoices).toMatchObject({ allowed: true, used: 0, limit: 10 });
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
          { ...a.organization, entitlements: { plan: { rank: 1 } } },
          "contacts",
        )
      ).allowed,
    ).toBe(true);
    expect((await quotaAccess(db, a.organization, "invoices")).allowed).toBe(true);
  });
});
