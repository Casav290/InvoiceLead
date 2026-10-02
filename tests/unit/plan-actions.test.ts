import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  reviewVatAction,
  uploadReceiptsAction,
  validateVatAction,
} from "@/app/[locale]/app/accounting/actions";
import { billFromPhotoAction, saveBillAction } from "@/app/[locale]/app/accounting/bills/actions";
import { scanTicketAction } from "@/app/[locale]/app/expenses/actions";
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
  planUsage,
  receipts,
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
beforeAll(() =>
  setTestEnv({
    WEBHOOK_ALLOW_LOCAL: "1",
    CRON_SECRET: "cron-secret-unit",
    AI_API_KEY: "test",
    AI_BASE_URL: "https://ai.test/v4",
  }),
);
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

describe("lectures de pièces par l'IA (20 par mois en formule gratuite)", () => {
  async function readsUsed(organizationId: string, used: number) {
    await db.insert(planUsage).values({
      organizationId,
      period: new Date().toISOString().slice(0, 7),
      key: "aiReads",
      used,
    });
  }
  const ticket = () =>
    new File([Buffer.from("ticket de caisse, jamais lu")], "ticket.png", { type: "image/png" });
  const stored = (organizationId: string) =>
    db.select().from(receipts).where(eq(receipts.organizationId, organizationId));

  it("au-delà des 20 lectures, un dépôt forgé est refusé avant d'enregistrer la pièce", async () => {
    const who = await signedIn(0);
    await readsUsed(who.organizationId, 20);
    const ai = vi.fn(async () => new Response("inattendu", { status: 500 }));
    vi.stubGlobal("fetch", ai);
    try {
      const upload = form({ locale: "fr" });
      upload.append("files", ticket());
      expect(await redirected(uploadReceiptsAction(upload))).toBe(
        "/fr/app/accounting/receipts?added=0&rejected=0&refused=1&quota=1",
      );
      expect(await stored(who.organizationId)).toHaveLength(0);
      expect(ai).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("« Scanner un ticket » au-delà des 20 lectures : la photo forgée n'est pas enregistrée", async () => {
    const who = await signedIn(0);
    await readsUsed(who.organizationId, 20);
    const ai = vi.fn(async () => new Response("inattendu", { status: 500 }));
    vi.stubGlobal("fetch", ai);
    try {
      const scan = form({ locale: "fr" });
      scan.append("ticket", ticket());
      expect(await redirected(scanTicketAction(scan))).toBe("/fr/app/expenses?error=quota");
      expect(await stored(who.organizationId)).toHaveLength(0);
      expect(ai).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("factures fournisseurs prises en photo (une lecture du mois)", () => {
  const period = () => new Date().toISOString().slice(0, 7);
  async function readsUsed(organizationId: string, used: number) {
    await db.insert(planUsage).values({ organizationId, period: period(), key: "aiReads", used });
  }
  async function readsNow(organizationId: string) {
    const [row] = await db
      .select({ used: planUsage.used })
      .from(planUsage)
      .where(and(eq(planUsage.organizationId, organizationId), eq(planUsage.key, "aiReads")));
    return row?.used ?? 0;
  }
  const photo = (seed: string) =>
    new File([Buffer.from(`photo de facture ${seed}`)], "facture.jpg", { type: "image/jpeg" });
  const send = (seed: string) => {
    const f = form({ locale: "fr" });
    f.append("photo", photo(seed));
    return billFromPhotoAction(f);
  };
  const bills = (organizationId: string) =>
    db.select().from(supplierBills).where(eq(supplierBills.organizationId, organizationId));
  const stored = (organizationId: string) =>
    db.select().from(receipts).where(eq(receipts.organizationId, organizationId));
  /** Le modèle de vision lit la facture : fournisseur, montant, échéance, IBAN, référence, compte. */
  const reader = () =>
    vi.fn(async (_url: string, init: { body: string }) => {
      const body = JSON.parse(init.body) as { messages: { content: unknown }[] };
      expect(JSON.stringify(body.messages[1]?.content)).toContain("data:image/jpeg;base64,");
      const answer = {
        supplier: "Druckerei Muster AG",
        date: "2026-03-10",
        total: "432.40",
        currency: "CHF",
        vat: "32.40",
        vat_code: "normal",
        invoice_number: "R-2026-117",
        description: "Flyers A5",
        account: "6500",
        due_date: "2026-04-09",
        iban: "CH93 0076 2011 6238 5295 7",
        payment_reference: "RF18539007547034",
        confidence: 0.94,
      };
      return Response.json({ choices: [{ message: { content: JSON.stringify(answer) } }] });
    });

  it("une photo devient un brouillon rempli par l'IA, à vérifier puis approuver, et compte une lecture", async () => {
    const who = await signedIn(0);
    const ai = reader();
    vi.stubGlobal("fetch", ai);
    try {
      const url = await redirected(send("a"));
      expect(url).toMatch(/^\/fr\/app\/accounting\/bills\/[0-9a-f-]{36}\?photo=1$/);
      expect(ai).toHaveBeenCalledTimes(1);
      const [bill] = await bills(who.organizationId);
      expect(url).toContain(bill?.id ?? "?");
      expect(bill).toMatchObject({
        status: "draft",
        source: "receipt",
        supplierName: "Druckerei Muster AG",
        number: "R-2026-117",
        issueDate: "2026-03-10",
        dueDate: "2026-04-09",
        totalCents: 43_240,
        currency: "CHF",
        vatCode: "normal",
        iban: "CH9300762011623852957",
        paymentReference: "RF18539007547034",
      });
      expect(bill?.accountId).toBeTruthy();
      const [receipt] = await stored(who.organizationId);
      expect(receipt).toMatchObject({ id: bill?.receiptId, status: "billed" });
      expect(await readsNow(who.organizationId)).toBe(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("la 20e lecture passe, la 21e photo est refusée sans être enregistrée ni lue", async () => {
    const who = await signedIn(0);
    await readsUsed(who.organizationId, 19);
    const ai = reader();
    vi.stubGlobal("fetch", ai);
    try {
      expect(await redirected(send("vingtième"))).toMatch(/\?photo=1$/);
      expect(await readsNow(who.organizationId)).toBe(20);
      expect(await redirected(send("de trop"))).toBe("/fr/app/accounting/bills?error=quota#photo");
      expect(ai).toHaveBeenCalledTimes(1);
      expect(await readsNow(who.organizationId)).toBe(20);
      expect(await bills(who.organizationId)).toHaveLength(1);
      expect(await stored(who.organizationId)).toHaveLength(1);
      // Pro : 50 lectures, la même photo passe.
      await setRank(who.organizationId, 1);
      expect(await redirected(send("de trop"))).toMatch(/\?photo=1$/);
      expect(await bills(who.organizationId)).toHaveLength(2);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("IA muette : la lecture est rendue, la photo reste dans les justificatifs, sans brouillon", async () => {
    const who = await signedIn(0);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("panne", { status: 500 })),
    );
    try {
      expect(await redirected(send("b"))).toBe("/fr/app/accounting/bills?error=unread#photo");
      expect(await readsNow(who.organizationId)).toBe(0);
      expect(await bills(who.organizationId)).toHaveLength(0);
      expect(await stored(who.organizationId)).toHaveLength(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("refuse un fichier qui n'est ni une photo ni un PDF, avant toute lecture", async () => {
    const who = await signedIn(0);
    const ai = reader();
    vi.stubGlobal("fetch", ai);
    try {
      const f = form({ locale: "fr" });
      f.append("photo", new File(["<Invoice/>"], "facture.xml", { type: "application/xml" }));
      expect(await redirected(billFromPhotoAction(f))).toBe(
        "/fr/app/accounting/bills?error=type#photo",
      );
      expect(ai).not.toHaveBeenCalled();
      expect(await stored(who.organizationId)).toHaveLength(0);
      expect(await readsNow(who.organizationId)).toBe(0);
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
