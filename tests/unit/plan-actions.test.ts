import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { reviewVatAction, validateVatAction } from "@/app/[locale]/app/accounting/actions";
import { saveBillAction } from "@/app/[locale]/app/accounting/bills/actions";
import { saveReminderSettingsAction } from "@/app/[locale]/app/invoices/reminders/actions";
import { createApiKeyAction, createWebhookAction } from "@/app/[locale]/app/settings/api/actions";
import { inviteFiduciaryAction } from "@/app/[locale]/app/settings/team/actions";
import { GET as dailyCron } from "@/app/api/cron/daily/route";
import { createFirstFiscalYear, installChart } from "@/server/accounting";
import { attachLeadIdentity } from "@/server/auth/attach";
import type { Db } from "@/server/db";
import {
  apiKeys,
  fiduciaryInvitations,
  organizations,
  supplierBills,
  vatReturns,
  webhookEndpoints,
} from "@/server/db/schema";
import { claims } from "../support/claims";
import { testDb } from "../support/db";
import { setTestEnv } from "../support/env";

/**
 * Les actions serveur elles-mêmes, appelées comme le ferait un formulaire réactivé à la main dans
 * la page : en formule gratuite (ou Pro pour ce qui est Pro+), chacune refuse et n'écrit rien ; la
 * même demande passe avec la formule qui ouvre la fonction. Retirer un seul contrôle de formule
 * dans une action fait échouer ce fichier.
 */
const ctx = vi.hoisted(() => {
  class Redirect extends Error {
    constructor(readonly url: string) {
      super(`NEXT_REDIRECT ${url}`);
    }
  }
  return { database: null as unknown, userId: "", organizationId: "", Redirect };
});

vi.mock("@/server/db", () => ({ db: () => ctx.database }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new ctx.Redirect(url);
  },
  notFound: () => {
    throw new ctx.Redirect("404");
  },
}));
vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl");
  const all: Record<string, unknown> = {
    de: (await import("../../messages/de.json")).default,
    fr: (await import("../../messages/fr.json")).default,
    en: (await import("../../messages/en.json")).default,
  };
  return {
    getTranslations: async ({ locale, namespace }: { locale: string; namespace?: string }) =>
      createTranslator({ locale, messages: all[locale] as never, namespace: namespace as never }),
  };
});
// Session de la personne connectée, relue en base à chaque action (formule à jour).
vi.mock("@/server/auth/guard", async () => {
  const { and: both, eq: same } = await import("drizzle-orm");
  const schema = await import("@/server/db/schema");
  const session = async () => {
    const database = ctx.database as Db;
    const [row] = await database
      .select({
        user: schema.users,
        organization: schema.organizations,
        membership: { role: schema.memberships.role, appRole: schema.memberships.appRole },
      })
      .from(schema.memberships)
      .innerJoin(schema.users, same(schema.users.id, schema.memberships.userId))
      .innerJoin(
        schema.organizations,
        same(schema.organizations.id, schema.memberships.organizationId),
      )
      .where(
        both(
          same(schema.memberships.userId, ctx.userId),
          same(schema.memberships.organizationId, ctx.organizationId),
        ),
      );
    if (!row) throw new Error("session");
    return row;
  };
  return { requirePermission: session, requireAppSession: session, requireSession: session };
});

const t = testDb();
const db = t.database;
beforeAll(() => setTestEnv({ WEBHOOK_ALLOW_LOCAL: "1", CRON_SECRET: "cron-secret-unit" }));
beforeEach(async () => {
  await t.reset();
  ctx.database = db;
});
afterAll(() => t.close());

function form(values: Record<string, string | string[]>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(values))
    for (const x of Array.isArray(v) ? v : [v]) f.append(k, x);
  return f;
}

/** Entreprise suisse assujettie, plan comptable et exercice 2026, connectée avec la formule donnée. */
async function signedIn(rank: number) {
  const a = await attachLeadIdentity(db, claims());
  const who = { organizationId: a.organization.id, userId: a.user.id };
  await db
    .update(organizations)
    .set({
      entitlements: { plan: { rank } },
      vatRegistered: true,
      vatMethod: "effective",
      vatSettlement: "agreed",
      uid: "CHE116281710",
      legalName: "Atelier Muster GmbH",
      street: "Bahnhofstrasse",
      postalCode: "8001",
      town: "Zürich",
      iban: "CH9300762011623852957",
      settingsCompletedAt: new Date(),
    })
    .where(eq(organizations.id, who.organizationId));
  await installChart(db, who, "corporation");
  await createFirstFiscalYear(db, who, { start: "2026-01-01", extended: false });
  ctx.userId = who.userId;
  ctx.organizationId = who.organizationId;
  return who;
}

async function setRank(organizationId: string, rank: number) {
  await db
    .update(organizations)
    .set({ entitlements: { plan: { rank } } })
    .where(eq(organizations.id, organizationId));
}

/** URL de redirection d'une action (Next interrompt l'action par une exception). */
async function redirected(run: Promise<unknown>): Promise<string> {
  try {
    await run;
  } catch (e) {
    if (e instanceof ctx.Redirect) return e.url;
    throw e;
  }
  throw new Error("aucune redirection");
}

describe("décompte TVA (Pro)", () => {
  it("la validation forgée est refusée en formule gratuite, sans rien figer ; elle passe en Pro", async () => {
    const who = await signedIn(0);
    const vat = form({ locale: "fr", start: "2026-01-01", end: "2026-03-31" });
    expect(await redirected(validateVatAction(vat))).toBe(
      "/fr/app/accounting/vat?period=2026-01-01&error=plan",
    );
    expect(
      await db.select().from(vatReturns).where(eq(vatReturns.organizationId, who.organizationId)),
    ).toHaveLength(0);
    await setRank(who.organizationId, 1);
    expect(await redirected(validateVatAction(vat))).toBe(
      "/fr/app/accounting/vat?period=2026-01-01&validated=1",
    );
    expect(
      await db.select().from(vatReturns).where(eq(vatReturns.organizationId, who.organizationId)),
    ).toHaveLength(1);
  });

  it("la relecture par l'IA forgée est refusée en formule gratuite, sans appeler l'IA", async () => {
    const who = await signedIn(0);
    const ai = vi.fn(async () => Response.json({ choices: [{ message: { content: "{}" } }] }));
    vi.stubGlobal("fetch", ai);
    try {
      const vat = form({ locale: "fr", start: "2026-01-01", end: "2026-03-31" });
      expect(await reviewVatAction({ round: 0 }, vat)).toEqual({ plan: true, round: 1 });
      expect(ai).not.toHaveBeenCalled();
      await setRank(who.organizationId, 1);
      expect(await reviewVatAction({ round: 1 }, vat)).not.toHaveProperty("plan");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("multidevise (Pro)", () => {
  it("une facture fournisseur saisie en EUR est refusée en formule gratuite ; elle passe en Pro", async () => {
    const who = await signedIn(0);
    const bill = form({
      locale: "fr",
      supplierName: "Fournisseur GmbH",
      issueDate: "2026-03-10",
      total: "120.00",
      currency: "EUR",
    });
    expect(await saveBillAction({ status: "idle", round: 0 }, bill)).toMatchObject({
      status: "invalid",
      errors: { currency: "plan" },
    });
    expect(
      await db
        .select()
        .from(supplierBills)
        .where(eq(supplierBills.organizationId, who.organizationId)),
    ).toHaveLength(0);
    await setRank(who.organizationId, 1);
    expect(await redirected(saveBillAction({ status: "idle", round: 1 }, bill))).toMatch(
      /^\/fr\/app\/accounting\/bills\/[0-9a-f-]{36}\?saved=1$/,
    );
    const [saved] = await db
      .select()
      .from(supplierBills)
      .where(eq(supplierBills.organizationId, who.organizationId));
    expect(saved?.currency).toBe("EUR");
  });
});

describe("accès fiduciaire (Pro)", () => {
  it("l'invitation forgée est refusée en formule gratuite ; elle part en Pro", async () => {
    const who = await signedIn(0);
    const invite = form({ locale: "fr", email: "fidu@treuhand.test" });
    expect(await inviteFiduciaryAction({ round: 0 }, invite)).toEqual({ round: 1, error: "plan" });
    const invitations = () =>
      db
        .select()
        .from(fiduciaryInvitations)
        .where(eq(fiduciaryInvitations.organizationId, who.organizationId));
    expect(await invitations()).toHaveLength(0);
    await setRank(who.organizationId, 1);
    expect(await inviteFiduciaryAction({ round: 1 }, invite)).toMatchObject({
      round: 2,
      email: "fidu@treuhand.test",
    });
    expect(await invitations()).toHaveLength(1);
  });
});

describe("API et webhooks (Pro+)", () => {
  it("clé d'API et adresse de webhook forgées sont refusées en Gratuit et en Pro ; elles passent en Pro+", async () => {
    const who = await signedIn(0);
    const key = form({ locale: "fr", name: "Compta" });
    const hook = form({
      locale: "fr",
      url: "https://hooks.example.test/il",
      events: ["invoice.issued"],
    });
    const keys = () =>
      db.select().from(apiKeys).where(eq(apiKeys.organizationId, who.organizationId));
    const hooks = () =>
      db
        .select()
        .from(webhookEndpoints)
        .where(eq(webhookEndpoints.organizationId, who.organizationId));
    for (const rank of [0, 1]) {
      await setRank(who.organizationId, rank);
      expect(await createApiKeyAction({ round: 0 }, key)).toEqual({ round: 1, error: "plan" });
      expect(await createWebhookAction({ round: 0 }, hook)).toEqual({ round: 1, error: "plan" });
    }
    expect(await keys()).toHaveLength(0);
    expect(await hooks()).toHaveLength(0);
    await setRank(who.organizationId, 2);
    expect(await createApiKeyAction({ round: 0 }, key)).toMatchObject({
      secret: expect.stringMatching(/^il_live_/),
    });
    expect(await createWebhookAction({ round: 0 }, hook)).toMatchObject({
      secret: expect.any(String),
    });
    expect(await keys()).toHaveLength(1);
    expect(await hooks()).toHaveLength(1);
  });
});

describe("réglages des relances (Pro)", () => {
  it("envoi automatique, frais et intérêts forgés sont refusés en formule gratuite ; ils passent en Pro", async () => {
    const who = await signedIn(0);
    const settings = form({ locale: "fr", auto: "on", fee: "20", interest: "5" });
    expect(await redirected(saveReminderSettingsAction(settings))).toBe(
      "/fr/app/invoices/reminders?settings=plan",
    );
    const read = async () => {
      const [org] = await db
        .select({
          auto: organizations.reminderAuto,
          fee: organizations.reminderFeeCents,
          interest: organizations.lateInterestBp,
        })
        .from(organizations)
        .where(and(eq(organizations.id, who.organizationId)));
      return org;
    };
    expect(await read()).toEqual({ auto: false, fee: 0, interest: null });
    await setRank(who.organizationId, 1);
    expect(await redirected(saveReminderSettingsAction(settings))).toBe(
      "/fr/app/invoices/reminders?settings=saved",
    );
    expect(await read()).toEqual({ auto: true, fee: 2_000, interest: 500 });
  });
});

describe("tâche quotidienne", () => {
  it("relit d'abord au Compte Lead une formule payante de plus de 12 h", async () => {
    const who = await signedIn(1);
    await db
      .update(organizations)
      .set({ entitlementsAt: new Date(Date.now() - 13 * 3_600_000) })
      .where(eq(organizations.id, who.organizationId));
    // Le Compte Lead dit : formule gratuite (abonnement résilié sans nouvelle connexion).
    const lead = vi.fn(async (input: string | URL | Request) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.endsWith("/oauth/token"))
        return Response.json({ access_token: "app", token_type: "Bearer", expires_in: 300 });
      if (url.includes("/api/lead-id/v1/entitlements"))
        return Response.json({
          org: "org-atelier",
          plan: { code: "free", name: "Gratuit", rank: 0, seats: 1 },
          apps: { invoicelead: { access: true, status: "live", upgrade_url: null } },
          subscriptions: [],
        });
      return new Response("inattendu", { status: 500 });
    });
    vi.stubGlobal("fetch", lead);
    try {
      const res = await dailyCron(
        new Request("https://invoicelead.io/api/cron/daily", {
          headers: { authorization: "Bearer cron-secret-unit" },
        }),
      );
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ plans: { refreshed: 1, stale: 0 } });
      const [org] = await db
        .select({ leadPlan: organizations.leadPlan, entitlements: organizations.entitlements })
        .from(organizations)
        .where(eq(organizations.id, who.organizationId));
      expect(org).toMatchObject({ leadPlan: "free", entitlements: { plan: { rank: 0 } } });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
