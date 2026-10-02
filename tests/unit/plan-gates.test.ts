import { and, eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { type ApiCaller, apiCaller, createApiKey } from "@/server/api-keys";
import { askAssistant } from "@/server/assistant";
import { attachLeadIdentity } from "@/server/auth/attach";
import { sendAutopilotDigests } from "@/server/autopilot-digest";
import { importStatement } from "@/server/bank";
import { approveBill, createBill } from "@/server/bills";
import { parseCompanyForm, saveCompanySettings } from "@/server/company";
import { createContact, createContactWithinPlan, parseContactForm } from "@/server/contacts";
import {
  contacts,
  invoiceReminders,
  invoices,
  memberships,
  organizations,
  recurringInvoices,
  webhookDeliveries,
} from "@/server/db/schema";
import {
  convertQuoteToInvoice,
  createCreditNote,
  createDepositInvoice,
  createInvoice,
  issueInvoice,
  parseInvoiceForm,
} from "@/server/invoices";
import { handleMcp } from "@/server/mcp";
import { forgetRefreshAttempts, refreshPlan, refreshStalePlans } from "@/server/plan-refresh";
import { consumeQuota, featureAccess, quotaAccess, tierOf } from "@/server/plans";
import { extractReceipt, readReceipt, uploadReceipt } from "@/server/receipts";
import { createRecurring, runRecurring, setRecurringActive } from "@/server/recurring";
import { runAutoReminders, sendAllReminders, sendReminder } from "@/server/reminders";
import { acceptInvitation, hasSeat, inviteFiduciary } from "@/server/team";
import { createEndpoint, deliverPending, emitEvent } from "@/server/webhooks";
import { camt053 } from "../support/camt";
import { claims } from "../support/claims";
import { testDb } from "../support/db";
import { setTestEnv } from "../support/env";

// Les e-mails (relances, récapitulatif) se traduisent avec les vrais messages, hors de Next.
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

/**
 * Les allocations et les fonctions réservées sont tenues par le serveur, pas seulement par les
 * écrans grisés : une demande forgée au-delà de la limite est refusée, quelle que soit sa source.
 */
const t = testDb();
const db = t.database;
beforeAll(() =>
  setTestEnv({
    AI_API_KEY: "test",
    AI_BASE_URL: "https://ai.test/v4",
    RESEND_API_KEY: "re_test",
    WEBHOOK_ALLOW_LOCAL: "1",
  }),
);
beforeEach(() => t.reset());
afterEach(() => vi.unstubAllGlobals());
afterAll(() => t.close());

const today = () => new Date().toISOString().slice(0, 10);

function form(values: Record<string, string | string[]>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(values))
    for (const x of Array.isArray(v) ? v : [v]) f.append(k, x);
  return f;
}

function contactInput(name: string) {
  const parsed = parseContactForm(
    form({ kind: "company", isCustomer: "on", name, language: "de", country: "CH" }),
  );
  if (!parsed.ok) throw new Error("contact");
  return parsed.data;
}

async function company(rank: number, n = "a") {
  const a = await attachLeadIdentity(
    db,
    claims({ sub: `sub-${n}`, email: `${n}@atelier.test`, org: `org-${n}` }),
  );
  await db
    .update(organizations)
    .set({
      entitlements: { plan: { rank } },
      legalName: "Atelier Muster GmbH",
      street: "Bahnhofstrasse",
      postalCode: "8001",
      town: "Zürich",
      iban: "CH9300762011623852957",
      settingsCompletedAt: new Date(),
    })
    .where(eq(organizations.id, a.organization.id));
  const org = { ...a.organization, entitlements: { plan: { rank } } };
  return { org, who: { organizationId: org.id, userId: a.user.id } };
}

async function setRank(organizationId: string, rank: number) {
  await db
    .update(organizations)
    .set({ entitlements: { plan: { rank } } })
    .where(eq(organizations.id, organizationId));
}

/** Brouillon de facture du 1er mars 2026, échue le 31 mars (client avec ou sans e-mail). */
async function invoiceFor(
  who: { organizationId: string; userId: string },
  name: string,
  email?: string,
  currency?: string,
  kind: "invoice" | "quote" = "invoice",
) {
  const c = parseContactForm(
    form({
      kind: "company",
      isCustomer: "on",
      name,
      language: "de",
      country: "CH",
      paymentTermDays: "30",
      ...(email ? { email } : {}),
    }),
  );
  if (!c.ok) throw new Error("contact");
  const contact = await createContact(db, who, c.data);
  const r = parseInvoiceForm(
    form({
      contactId: contact.id,
      language: "de",
      issueDate: "2026-03-01",
      "line.description": ["Beratung"],
      "line.quantity": ["1"],
      "line.unit": ["flat"],
      "line.unitPrice": ["100"],
      "line.vatCode": ["normal"],
      "line.productId": [""],
      ...(currency ? { currency, fxRate: "0.95" } : {}),
    }),
    { vatRegistered: false },
  );
  if (!r.ok) throw new Error(`facture ${JSON.stringify(r.errors)}`);
  const draft = await createInvoice(db, who, r.data, kind);
  if (typeof draft !== "object" || !draft) throw new Error("brouillon");
  return draft;
}

/**
 * Ralentit une écriture de la base (déclencheur pg_sleep) pour que deux transactions simultanées
 * se chevauchent vraiment : sans verrou, la seconde compte avant que la première ne valide.
 */
async function slowWrites(on: string, run: () => Promise<void>, when?: string) {
  // La base sert aussi aux tests de bout en bout : si vitest s'arrête net avant le nettoyage, le
  // déclencheur laissé derrière ne ralentit plus rien passé 30 secondes.
  const until = new Date(Date.now() + 30_000).toISOString();
  await db.execute(sql.raw("drop function if exists il_test_slow() cascade"));
  await db.execute(
    sql.raw(
      `create or replace function il_test_slow() returns trigger language plpgsql as $$ begin if clock_timestamp() < '${until}'::timestamptz then perform pg_sleep(0.4); end if; return new; end $$`,
    ),
  );
  await db.execute(
    sql.raw(
      `create trigger il_test_slow ${on} for each row ${when ? `when (${when})` : ""} execute function il_test_slow()`,
    ),
  );
  try {
    await run();
  } finally {
    // La fonction et son déclencheur partent ensemble.
    await db.execute(sql.raw("drop function if exists il_test_slow() cascade"));
  }
}

function aiJson(json: object) {
  return Response.json({ choices: [{ message: { content: JSON.stringify(json) } }] });
}

describe("lectures de pièces par l'IA", () => {
  it("comptent chaque lecture et relecture, refusent la 21e et rendent l'unité si l'IA échoue", async () => {
    const { org, who } = await company(0);
    const receipt = await uploadReceipt(db, who, {
      name: "ticket.png",
      type: "image/png",
      bytes: Buffer.from("not really a png, read by the fake AI"),
    });
    if (typeof receipt !== "object") throw new Error(receipt);
    // L'IA ne répond pas : rien n'est compté.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("down", { status: 503 })),
    );
    expect(await readReceipt(db, who, receipt.id, "fr")).toBe("failed");
    expect((await quotaAccess(db, org, "aiReads")).used).toBe(0);

    const ai = vi.fn(async () =>
      aiJson({ supplier: "Café", date: "2026-03-02", total: "12.50", confidence: 0.9 }),
    );
    vi.stubGlobal("fetch", ai);
    expect(await readReceipt(db, who, receipt.id, "fr")).toBe("read");
    // Une relecture (demande forgée sur une pièce déjà lue) compte aussi.
    expect(await readReceipt(db, who, receipt.id, "fr")).toBe("read");
    expect((await quotaAccess(db, org, "aiReads")).used).toBe(2);
    for (let i = 0; i < 18; i++) await consumeQuota(db, org, "aiReads");
    ai.mockClear();
    expect(await readReceipt(db, who, receipt.id, "fr")).toBe("quota");
    expect(ai).not.toHaveBeenCalled();
    expect((await quotaAccess(db, org, "aiReads")).used).toBe(20);

    // Pro : 50 lectures ; la même pièce se relit.
    await setRank(org.id, 1);
    expect(await readReceipt(db, who, receipt.id, "fr")).toBe("read");
  });
});

describe("assistant", () => {
  it("répond à 10 questions par mois en formule gratuite, refuse la onzième", async () => {
    const { org, who } = await company(0);
    const ai = vi.fn(async () => aiJson({ answer: "Rien à payer.", links: [] }));
    vi.stubGlobal("fetch", ai);
    for (let i = 0; i < 10; i++)
      expect(await askAssistant(db, who, `Question ${i}`, "fr")).toMatchObject({
        answer: "Rien à payer.",
      });
    expect(await askAssistant(db, who, "Encore une ?", "fr")).toBe("quota");
    expect(ai).toHaveBeenCalledTimes(10);
    // Le mois suivant, les questions reviennent.
    expect(await askAssistant(db, who, "Et en novembre ?", "fr", "2099-11-02")).toMatchObject({
      answer: "Rien à payer.",
    });
    // En Pro, sans limite.
    await setRank(org.id, 1);
    expect(await askAssistant(db, who, "Et en Pro ?", "fr")).toMatchObject({
      answer: "Rien à payer.",
    });
  });

  it("rend la question quand l'IA ne répond pas", async () => {
    const { org, who } = await company(0);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("down", { status: 500 })),
    );
    expect(await askAssistant(db, who, "Qui me doit ?", "fr")).toBe("failed");
    expect((await quotaAccess(db, org, "assistant")).used).toBe(0);
  });
});

describe("relances", () => {
  it("formule gratuite : 5 premières relances par mois, la sixième refusée", async () => {
    const { org, who } = await company(0);
    const ids: string[] = [];
    for (let i = 0; i < 6; i++) {
      const draft = await invoiceFor(who, `Kunde ${i}`);
      const issued = await issueInvoice(db, who, draft.id);
      if (typeof issued !== "object") throw new Error(issued);
      ids.push(issued.id);
    }
    for (const id of ids.slice(0, 5))
      expect(await sendReminder(db, who, id, "2026-04-10", true)).toBe("recorded");
    expect(await sendReminder(db, who, ids[5] ?? "", "2026-04-10", true)).toBe("quota");
    expect(await quotaAccess(db, org, "reminders", "2026-04-10")).toMatchObject({
      used: 5,
      allowed: false,
    });
    // Le mois suivant, la sixième part ; la deuxième relance d'une autre reste Pro.
    expect(await sendReminder(db, who, ids[5] ?? "", "2026-05-01", true)).toBe("recorded");
    expect(await sendReminder(db, who, ids[0] ?? "", "2026-05-01", true)).toBe("plan");
    await setRank(org.id, 1);
    expect(await sendReminder(db, who, ids[0] ?? "", "2026-05-01", true)).toBe("recorded");
  });
});

describe("relances envoyées par e-mail", () => {
  it("« Tout envoyer » s'arrête aux 5 relances du mois ; un envoi échoué rend son unité", async () => {
    const { org, who } = await company(0);
    for (let i = 0; i < 7; i++) {
      const draft = await invoiceFor(who, `Kunde ${i}`, `kunde${i}@example.test`);
      const issued = await issueInvoice(db, who, draft.id);
      if (typeof issued !== "object") throw new Error(issued);
    }
    // Resend refuse le premier envoi, accepte les suivants.
    let calls = 0;
    const mail = vi.fn(async () =>
      ++calls === 1 ? new Response("down", { status: 503 }) : Response.json({ id: `m${calls}` }),
    );
    vi.stubGlobal("fetch", mail);
    const run = await sendAllReminders(db, who, "2026-04-10");
    expect(run).toMatchObject({ sent: 5, quotaReached: true });
    expect(mail).toHaveBeenCalledTimes(6);
    expect(await quotaAccess(db, org, "reminders", "2026-04-10")).toMatchObject({
      used: 5,
      allowed: false,
    });
    // Les relances non envoyées restent dues ; rien ne part au-delà de l'allocation.
    mail.mockClear();
    expect(await sendAllReminders(db, who, "2026-04-11")).toMatchObject({
      sent: 0,
      quotaReached: true,
    });
    expect(mail).not.toHaveBeenCalled();
  });
});

describe("import des relevés", () => {
  const statement = (id: string) =>
    camt053("CH9300762011623852957", [
      { id, date: "2026-03-10", amount: "50.00", credit: false, party: "Swisscom" },
    ]);

  it("formule gratuite : un relevé par mois ; un fichier illisible ne compte pas", async () => {
    const { org, who } = await company(0);
    expect(await importStatement(db, who, "<pas du camt/>", "2026-10-02")).toBe("format");
    expect(await importStatement(db, who, statement("A1"), "2026-10-02")).toMatchObject({
      imported: 1,
    });
    expect(await importStatement(db, who, statement("A2"), "2026-10-20")).toBe("quota");
    expect((await quotaAccess(db, org, "bankImports", "2026-10-20")).used).toBe(1);
    expect(await importStatement(db, who, statement("A2"), "2026-11-01")).toMatchObject({
      imported: 1,
    });
    await setRank(org.id, 1);
    expect(await importStatement(db, who, statement("A3"), "2026-11-02")).toMatchObject({
      imported: 1,
    });
  });

  it("un relevé déjà importé (doublons seulement) ne consomme pas l'import du mois", async () => {
    const { org, who } = await company(1);
    expect(await importStatement(db, who, statement("B1"), "2026-10-02")).toMatchObject({
      imported: 1,
    });
    await setRank(org.id, 0);
    expect(
      await quotaAccess(
        db,
        { ...org, entitlements: { plan: { rank: 0 } } },
        "bankImports",
        "2026-10-02",
      ),
    ).toMatchObject({ used: 1, allowed: false });
    await setRank(org.id, 1);
    expect(await importStatement(db, who, statement("B1"), "2026-10-03")).toMatchObject({
      imported: 0,
      duplicates: 1,
    });
    expect((await quotaAccess(db, org, "bankImports", "2026-10-03")).used).toBe(1);
  });
});

describe("factures récurrentes", () => {
  it("formule gratuite : une seule active, à la création comme à la reprise", async () => {
    const { org, who } = await company(0);
    const a = await invoiceFor(who, "Abo A");
    const b = await invoiceFor(who, "Abo B");
    const input = { intervalMonths: 1, nextDate: "2026-04-01", autoSend: false };
    const first = await createRecurring(db, who, a.id, input);
    if (typeof first !== "object") throw new Error(first);
    expect(await createRecurring(db, who, b.id, input)).toBe("planLimit");
    expect(await setRecurringActive(db, who, first.id, false)).toBe(true);
    const second = await createRecurring(db, who, b.id, input);
    if (typeof second !== "object") throw new Error(second);
    // Reprendre la première dépasserait la formule.
    expect(await setRecurringActive(db, who, first.id, true)).toBe("planLimit");
    await setRank(org.id, 1);
    expect(await setRecurringActive(db, who, first.id, true)).toBe(true);
  });

  it("deux demandes simultanées n'en créent qu'une", async () => {
    const { org, who } = await company(0);
    const a = await invoiceFor(who, "Abo A");
    const b = await invoiceFor(who, "Abo B");
    const input = { intervalMonths: 1, nextDate: "2026-04-01", autoSend: false };
    let results: Awaited<ReturnType<typeof createRecurring>>[] = [];
    // Chaque création dort 0,4 s avant de valider : sans verrou, l'autre compterait 0 et passerait.
    await slowWrites("before insert on recurring_invoices", async () => {
      results = await Promise.all([
        createRecurring(db, who, a.id, input),
        createRecurring(db, who, b.id, input),
      ]);
    });
    expect(results.filter((r) => typeof r === "object")).toHaveLength(1);
    expect(results.filter((r) => r === "planLimit")).toHaveLength(1);
    expect((await quotaAccess(db, org, "recurring")).used).toBe(1);
  });

  it("revenue en formule gratuite, l'entreprise garde ses récurrences mais une seule tourne", async () => {
    const { org, who } = await company(1);
    const a = await invoiceFor(who, "Abo A");
    const b = await invoiceFor(who, "Abo B");
    const input = { intervalMonths: 1, nextDate: today(), autoSend: false };
    const first = await createRecurring(db, who, a.id, input);
    const second = await createRecurring(db, who, b.id, input);
    if (typeof first !== "object" || typeof second !== "object") throw new Error("récurrence");
    await setRank(org.id, 0);
    expect(await runRecurring(db, today())).toMatchObject({ created: 1, held: 1, failed: 0 });
    const [held] = await db
      .select()
      .from(recurringInvoices)
      .where(eq(recurringInvoices.id, second.id));
    // Rien n'est modifié : elle repart dès le retour à Pro.
    expect(held).toMatchObject({ active: true, nextDate: today() });
  });

  it("des centaines de récurrences retenues ne bouchent pas la tâche quotidienne des autres entreprises", async () => {
    // Entreprise revenue en formule gratuite avec 600 récurrences échues depuis longtemps.
    const former = await company(1, "former");
    const model = await invoiceFor(former.who, "Abo A");
    const input = { intervalMonths: 1, nextDate: today(), autoSend: false };
    const first = await createRecurring(db, former.who, model.id, input);
    if (typeof first !== "object") throw new Error(first);
    await db.insert(recurringInvoices).values(
      Array.from({ length: 600 }, () => ({
        organizationId: former.org.id,
        sourceInvoiceId: model.id,
        intervalMonths: 1,
        nextDate: "2025-01-01",
        createdBy: former.who.userId,
      })),
    );
    await setRank(former.org.id, 0);
    // Une entreprise Pro, avec une récurrence du jour.
    const pro = await company(1, "pro");
    const proModel = await invoiceFor(pro.who, "Abo Pro");
    const proRecurring = await createRecurring(db, pro.who, proModel.id, input);
    if (typeof proRecurring !== "object") throw new Error(proRecurring);

    // Les 600 retenues sont les plus anciennes ; elles ne prennent pas la fenêtre de 500.
    expect(await runRecurring(db, today())).toMatchObject({ created: 2, held: 600, failed: 0 });
    const next = async (id: string) =>
      (await db.select().from(recurringInvoices).where(eq(recurringInvoices.id, id)))[0]?.nextDate;
    expect(await next(proRecurring.id)).not.toBe(today());
    expect(await next(first.id)).not.toBe(today());
    const [{ untouched } = { untouched: -1 }] = await db
      .select({ untouched: sql<number>`count(*)::int` })
      .from(recurringInvoices)
      .where(
        and(
          eq(recurringInvoices.organizationId, former.org.id),
          eq(recurringInvoices.nextDate, "2025-01-01"),
        ),
      );
    expect(untouched).toBe(600);
    // Passage suivant : les deux ont avancé d'un mois, les retenues sont seulement comptées.
    expect(await runRecurring(db, today())).toMatchObject({ created: 0, held: 600 });
  });

  it("laisse en brouillon la facture du jour quand les 10 factures du mois sont émises", async () => {
    const { who } = await company(0);
    for (let i = 0; i < 10; i++) {
      const d = await invoiceFor(who, `Kunde ${i}`);
      const issued = await issueInvoice(db, who, d.id);
      if (typeof issued !== "object") throw new Error(issued);
    }
    const model = await invoiceFor(who, "Abo");
    const r = await createRecurring(db, who, model.id, {
      intervalMonths: 1,
      nextDate: today(),
      autoSend: true,
    });
    if (typeof r !== "object") throw new Error(r);
    expect(await runRecurring(db, today())).toMatchObject({ created: 1, issued: 0, held: 1 });
  });
});

describe("fonctions réservées", () => {
  it("une invitation de fiduciaire ne s'accepte plus après le retour à la formule gratuite", async () => {
    const client = await company(1, "client");
    const fid = await attachLeadIdentity(
      db,
      claims({ sub: "sub-fid", email: "compta@fidu.test", org: "org-fidu", org_name: "Fidu SA" }),
    );
    const inv = await inviteFiduciary(db, client.who, "compta@fidu.test");
    if (typeof inv === "string") throw new Error(inv);
    await setRank(client.org.id, 0);
    expect((await acceptInvitation(db, fid.user, inv.token)).status).toBe("plan");
    await setRank(client.org.id, 1);
    expect((await acceptInvitation(db, fid.user, inv.token)).status).toBe("accepted");
  });

  it("les webhooks ne partent plus d'une entreprise sortie de Pro+", async () => {
    const { org, who } = await company(2);
    const endpoint = await createEndpoint(db, who, {
      url: "https://hooks.example.test/il",
      events: ["invoice.issued"],
    });
    if (typeof endpoint === "string") throw new Error(endpoint);
    expect(await emitEvent(db, org.id, "invoice.issued", { id: "x" })).toBe(1);
    await setRank(org.id, 1);
    expect(await emitEvent(db, org.id, "invoice.issued", { id: "y" })).toBe(0);
    expect(await db.select().from(webhookDeliveries)).toHaveLength(1);
  });

  it("le récapitulatif du pilote par e-mail reste dans Pro", async () => {
    const { org, who } = await company(0);
    await db.update(organizations).set({ autopilot: true }).where(eq(organizations.id, org.id));
    // Un mouvement importé attend une personne : le récapitulatif aurait quelque chose à dire.
    expect(
      await importStatement(
        db,
        who,
        camt053("CH9300762011623852957", [
          { id: "D1", date: "2026-10-01", amount: "50.00", credit: false, party: "Swisscom" },
        ]),
        "2026-10-02",
      ),
    ).toMatchObject({ imported: 1 });
    const mail = vi.fn(async () => Response.json({ id: "m1" }));
    vi.stubGlobal("fetch", mail);
    expect(await sendAutopilotDigests(db, "2026-10-05")).toBe(0);
    expect(mail).not.toHaveBeenCalled();
    // La même entreprise en Pro le reçoit.
    await setRank(org.id, 1);
    expect(await sendAutopilotDigests(db, "2026-10-05")).toBe(1);
    expect(mail).toHaveBeenCalledOnce();
  });

  it("l'accès d'une fiduciaire est suspendu en formule gratuite et revient avec Pro", async () => {
    const client = await company(1, "client");
    const fid = await attachLeadIdentity(
      db,
      claims({ sub: "sub-fid", email: "compta@fidu.test", org: "org-fidu", org_name: "Fidu SA" }),
    );
    const inv = await inviteFiduciary(db, client.who, "compta@fidu.test");
    if (typeof inv === "string") throw new Error(inv);
    expect((await acceptInvitation(db, fid.user, inv.token)).status).toBe("accepted");
    const plan = (rank: number) => ({ ...client.org, entitlements: { plan: { rank } } });
    expect(await hasSeat(db, plan(1), fid.user.id)).toBe(true);
    await setRank(client.org.id, 0);
    expect(await hasSeat(db, plan(0), fid.user.id)).toBe(false);
    // L'entreprise elle-même garde sa place.
    expect(await hasSeat(db, plan(0), client.who.userId)).toBe(true);
    await setRank(client.org.id, 1);
    expect(await hasSeat(db, plan(1), fid.user.id)).toBe(true);
  });

  it("les livraisons en attente d'une entreprise sortie de Pro+ attendent, puis repartent", async () => {
    const { org, who } = await company(2);
    const endpoint = await createEndpoint(db, who, {
      url: "https://hooks.example.test/il",
      events: ["invoice.issued"],
    });
    if (typeof endpoint === "string") throw new Error(endpoint);
    expect(await emitEvent(db, org.id, "invoice.issued", { id: "x" })).toBe(1);
    const [before] = await db.select().from(webhookDeliveries);
    expect(before).toMatchObject({ status: "pending", attempts: 0 });
    await setRank(org.id, 1);
    const fetcher = vi.fn(async () => new Response("ok", { status: 200 }));
    const now = new Date("2026-10-05T08:00:00Z");
    expect(await deliverPending(db, { organizationId: org.id, now, fetcher })).toEqual({
      delivered: 0,
      failed: 0,
    });
    expect(await deliverPending(db, { now, fetcher })).toEqual({ delivered: 0, failed: 0 });
    expect(fetcher).not.toHaveBeenCalled();
    // Rien n'est modifié pendant l'attente : ni tentative comptée, ni date repoussée.
    const [held] = await db.select().from(webhookDeliveries);
    expect(held).toEqual(before);
    // Retour à Pro+ : la livraison part au passage suivant.
    await setRank(org.id, 2);
    expect(await deliverPending(db, { organizationId: org.id, now, fetcher })).toMatchObject({
      delivered: 1,
    });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("des centaines de livraisons retenues ne bouchent pas la file des entreprises encore en Pro+", async () => {
    // Entreprise sortie de Pro+ avec 600 livraisons anciennes en attente (adresse en panne).
    const former = await company(2, "former");
    const old = await createEndpoint(db, former.who, {
      url: "https://hooks.example.test/old",
      events: ["invoice.issued"],
    });
    if (typeof old === "string") throw new Error(old);
    const since = new Date("2026-01-01T00:00:00Z");
    await db.insert(webhookDeliveries).values(
      Array.from({ length: 600 }, (_, i) => ({
        organizationId: former.org.id,
        endpointId: old.id,
        event: "invoice.issued",
        payload: { type: "invoice.issued", data: { n: i } },
        attempts: 2,
        createdAt: since,
        nextAttemptAt: since,
      })),
    );
    await setRank(former.org.id, 1);
    // Une entreprise encore en Pro+, avec une livraison plus récente.
    const current = await company(2, "current");
    const hook = await createEndpoint(db, current.who, {
      url: "https://hooks.example.test/live",
      events: ["invoice.issued"],
    });
    if (typeof hook === "string") throw new Error(hook);
    expect(await emitEvent(db, current.org.id, "invoice.issued", { id: "x" })).toBe(1);
    const fetcher = vi.fn(async () => new Response("ok", { status: 200 }));
    const now = new Date(Date.now() + 60_000);
    // La tâche quotidienne prend 500 livraisons par passage : celle de Pro+ en fait partie.
    expect(await deliverPending(db, { now, limit: 500, fetcher })).toEqual({
      delivered: 1,
      failed: 0,
    });
    expect(fetcher).toHaveBeenCalledOnce();
    const [{ waiting } = { waiting: -1 }] = await db
      .select({ waiting: sql<number>`count(*)::int` })
      .from(webhookDeliveries)
      .where(
        and(
          eq(webhookDeliveries.organizationId, former.org.id),
          eq(webhookDeliveries.status, "pending"),
          eq(webhookDeliveries.attempts, 2),
          eq(webhookDeliveries.nextAttemptAt, since),
        ),
      );
    expect(waiting).toBe(600);
  });
});

describe("factures émises du mois", () => {
  it("se comptent d'après le type en base : la 11e facture est refusée, devis et avoirs passent", async () => {
    const { who } = await company(0);
    const issued = [];
    for (let i = 0; i < 10; i++) {
      const d = await invoiceFor(who, `Kunde ${i}`);
      const r = await issueInvoice(db, who, d.id);
      if (typeof r !== "object") throw new Error(r);
      issued.push(r);
    }
    const eleventh = await invoiceFor(who, "Kunde 11");
    expect(await issueInvoice(db, who, eleventh.id)).toBe("planLimit");
    const [still] = await db.select().from(invoices).where(eq(invoices.id, eleventh.id));
    expect(still).toMatchObject({ status: "draft", number: null });
    // Un avoir ne compte pas dans les 10 factures.
    const credit = await createCreditNote(db, who, issued[0]?.id ?? "", "2026-03-05");
    if (typeof credit !== "object") throw new Error(credit);
    expect(await issueInvoice(db, who, credit.id)).toMatchObject({ kind: "credit_note" });
  });

  it("deux émissions simultanées à 9 sur 10 n'en laissent passer qu'une", async () => {
    const { org, who } = await company(0);
    for (let i = 0; i < 9; i++) {
      const d = await invoiceFor(who, `Kunde ${i}`);
      const r = await issueInvoice(db, who, d.id);
      if (typeof r !== "object") throw new Error(r);
    }
    const a = await invoiceFor(who, "Kunde A");
    const b = await invoiceFor(who, "Kunde B");
    let results: Awaited<ReturnType<typeof issueInvoice>>[] = [];
    await slowWrites(
      "before update on invoices",
      async () => {
        results = await Promise.all([issueInvoice(db, who, a.id), issueInvoice(db, who, b.id)]);
      },
      "old.status = 'draft' and new.status = 'issued'",
    );
    expect(results.filter((r) => typeof r === "object")).toHaveLength(1);
    expect(results.filter((r) => r === "planLimit")).toHaveLength(1);
    expect((await quotaAccess(db, org, "invoices")).used).toBe(10);
  });
});

describe("contacts", () => {
  it("formule gratuite : le 51e contact est refusé, même avec deux créations simultanées", async () => {
    const { org, who } = await company(0);
    for (let i = 0; i < 49; i++) await createContact(db, who, contactInput(`C${i}`));
    let results: Awaited<ReturnType<typeof createContactWithinPlan>>[] = [];
    await slowWrites("before insert on contacts", async () => {
      results = await Promise.all([
        createContactWithinPlan(db, who, contactInput("C49")),
        createContactWithinPlan(db, who, contactInput("C50")),
      ]);
    });
    expect(results.filter((r) => typeof r === "object")).toHaveLength(1);
    expect(results.filter((r) => r === "planLimit")).toHaveLength(1);
    const rows = await db.select().from(contacts).where(eq(contacts.organizationId, org.id));
    expect(rows).toHaveLength(50);
    await setRank(org.id, 1);
    expect(await createContactWithinPlan(db, who, contactInput("Pro"))).toMatchObject({
      name: "Pro",
    });
  });
});

describe("serveur MCP au-delà des allocations", () => {
  it("refuse contact et émission par « plan_limit » si la formule a changé depuis la clé", async () => {
    const { org, who } = await company(0);
    for (let i = 0; i < 50; i++) await createContact(db, who, contactInput(`C${i}`));
    for (let i = 0; i < 10; i++) {
      const d = await invoiceFor(who, `Kunde ${i}`);
      const r = await issueInvoice(db, who, d.id);
      if (typeof r !== "object") throw new Error(r);
    }
    const draft = await invoiceFor(who, "Kunde 11");
    const [row] = await db.select().from(organizations).where(eq(organizations.id, org.id));
    if (!row) throw new Error("organisation");
    // Appelant fabriqué : une entreprise revenue en formule gratuite après le contrôle de la clé.
    const caller: ApiCaller = { organization: row, userId: who.userId, keyId: "k", scope: "full" };
    const call = (name: string, args: object) =>
      handleMcp(caller, {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name, arguments: args },
      });
    const contact = await call("create_contact", {
      name: "Encore un",
      language: "de",
      country: "CH",
    });
    expect(contact.body).toMatchObject({ result: { isError: true } });
    expect(JSON.stringify(contact.body)).toContain("plan_limit");
    const issue = await call("issue_invoice", { id: draft.id });
    expect(issue.body).toMatchObject({ result: { isError: true } });
    expect(JSON.stringify(issue.body)).toContain("plan_limit");
    const live = await db
      .select()
      .from(contacts)
      .where(and(eq(contacts.organizationId, org.id), eq(contacts.name, "Encore un")));
    expect(live).toHaveLength(0);
  });
});

describe("changement de pays", () => {
  const germany = () => {
    const parsed = parseCompanyForm(
      form({
        country: "DE",
        legalName: "Werkstatt Müller GmbH",
        legalForm: "gmbh",
        street: "Friedrichstrasse",
        buildingNumber: "10",
        postalCode: "10117",
        town: "Berlin",
        uid: "DE 136 695 976",
        vatRegistered: "on",
        vatSettlement: "agreed",
        iban: "DE89 3704 0044 0532 0130 00",
        fiscalYearStartMonth: "1",
      }),
    );
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
    return parsed.data;
  };

  it("formule gratuite : refusé tant qu'un brouillon garderait l'ancienne devise", async () => {
    const { org, who } = await company(0);
    await invoiceFor(who, "Kunde AG");
    expect(await saveCompanySettings(db, who, germany())).toBe("countryDrafts");
    const [same] = await db.select().from(organizations).where(eq(organizations.id, org.id));
    expect(same).toMatchObject({ country: "CH", currency: "CHF" });
    // En Pro, le brouillon en CHF devient une facture en devise, permise.
    await setRank(org.id, 1);
    expect(await saveCompanySettings(db, who, germany())).toBe("saved");
  });
});

describe("relances automatiques du matin", () => {
  it("ne partent pas pour une entreprise gratuite qui les a activées ; partent en Pro", async () => {
    const { org, who } = await company(0);
    await db.update(organizations).set({ reminderAuto: true }).where(eq(organizations.id, org.id));
    // Une facture échue depuis 10 jours, avec une adresse : la relance serait envoyable.
    const draft = await invoiceFor(who, "Kunde AG", "kunde@example.test");
    const issued = await issueInvoice(db, who, draft.id);
    if (typeof issued !== "object") throw new Error(issued);
    const mail = vi.fn(async () => Response.json({ id: "m1" }));
    vi.stubGlobal("fetch", mail);
    expect(await runAutoReminders(db, "2026-04-10")).toEqual({ sent: 0 });
    expect(mail).not.toHaveBeenCalled();
    expect(await db.select().from(invoiceReminders)).toHaveLength(0);
    expect((await quotaAccess(db, org, "reminders", "2026-04-10")).used).toBe(0);
    await setRank(org.id, 1);
    expect(await runAutoReminders(db, "2026-04-10")).toEqual({ sent: 1 });
    expect(mail).toHaveBeenCalledOnce();
  });
});

describe("relance envoyée deux fois en même temps", () => {
  it("un seul e-mail part et une seule relance est comptée", async () => {
    const { org, who } = await company(0);
    const draft = await invoiceFor(who, "Kunde AG", "kunde@example.test");
    const issued = await issueInvoice(db, who, draft.id);
    if (typeof issued !== "object") throw new Error(issued);
    // L'envoi prend du temps : sans réservation, la seconde demande enverrait aussi.
    const mail = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 300));
      return Response.json({ id: "m1" });
    });
    vi.stubGlobal("fetch", mail);
    const results = await Promise.all([
      sendReminder(db, who, issued.id, "2026-04-10"),
      sendReminder(db, who, issued.id, "2026-04-10"),
      sendReminder(db, who, issued.id, "2026-04-10"),
    ]);
    expect(results.filter((r) => r === "sent")).toHaveLength(1);
    expect(mail).toHaveBeenCalledOnce();
    expect((await quotaAccess(db, org, "reminders", "2026-04-10")).used).toBe(1);
    expect(await db.select().from(invoiceReminders)).toHaveLength(1);
  });

  it("un e-mail refusé ne laisse aucune relance notée et rend l'unité", async () => {
    const { org, who } = await company(0);
    const draft = await invoiceFor(who, "Kunde AG", "kunde@example.test");
    const issued = await issueInvoice(db, who, draft.id);
    if (typeof issued !== "object") throw new Error(issued);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("down", { status: 503 })),
    );
    expect(await sendReminder(db, who, issued.id, "2026-04-10")).toBe("failed");
    expect(await db.select().from(invoiceReminders)).toHaveLength(0);
    expect((await quotaAccess(db, org, "reminders", "2026-04-10")).used).toBe(0);
  });
});

describe("lectures de pièces : réservation et remboursement sur le même mois", () => {
  it("une lecture commencée le 31 et ratée rend l'unité de ce mois-là", async () => {
    const { org, who } = await company(0);
    const receipt = await uploadReceipt(db, who, {
      name: "ticket.png",
      type: "image/png",
      bytes: Buffer.from("ticket du 31"),
    });
    if (typeof receipt !== "object") throw new Error(receipt);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("down", { status: 503 })),
    );
    expect(await extractReceipt(db, who, receipt.id, "fr", "2026-01-31")).toBe("failed");
    expect((await quotaAccess(db, org, "aiReads", "2026-01-31")).used).toBe(0);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => aiJson({ supplier: "Café", total: "4.50", confidence: 0.9 })),
    );
    expect(await extractReceipt(db, who, receipt.id, "fr", "2026-01-31")).toMatchObject({
      supplier: "Café",
    });
    expect((await quotaAccess(db, org, "aiReads", "2026-01-31")).used).toBe(1);
    expect((await quotaAccess(db, org, "aiReads", "2026-02-01")).used).toBe(0);
  });
});

describe("import des relevés : un relevé, c'est un compte et un mois", () => {
  const entry = (id: string, date: string) => ({
    id,
    date,
    amount: "10.00",
    credit: false,
    party: "Swisscom",
  });
  /** Deux relevés (deux comptes) dans un seul fichier camt.053. */
  const twoAccounts = () => {
    const a = camt053("CH9300762011623852957", [entry("M1", "2026-03-10")]);
    const b = camt053("CH5604835012345678009", [entry("M2", "2026-03-11")]);
    const second = b.slice(b.indexOf("<Stmt>"), b.indexOf("</Stmt>") + "</Stmt>".length);
    return a.replace("</Stmt>", `</Stmt>${second}`);
  };

  it("formule gratuite : un fichier de plusieurs comptes ou de plusieurs mois est refusé sans compter", async () => {
    const { org, who } = await company(0);
    expect(await importStatement(db, who, twoAccounts(), "2026-10-02")).toBe("scope");
    const year = camt053("CH9300762011623852957", [
      entry("Y1", "2026-01-05"),
      entry("Y2", "2026-06-05"),
      entry("Y3", "2026-12-05"),
    ]);
    expect(await importStatement(db, who, year, "2026-10-02")).toBe("scope");
    // Plusieurs relevés dont les suivants ne disent pas leur compte : rien ne prouve qu'il s'agit
    // du même. Refusé, sans compter.
    const unnamed = (() => {
      const a = camt053("CH9300762011623852957", [entry("U1", "2026-09-02")]);
      const b = camt053("CH5604835012345678009", [entry("U2", "2026-09-03")]);
      const second = b
        .slice(b.indexOf("<Stmt>"), b.indexOf("</Stmt>") + "</Stmt>".length)
        .replace(/<Acct>.*?<\/Acct>/s, "");
      return a.replace("</Stmt>", `</Stmt>${second}`);
    })();
    expect(await importStatement(db, who, unnamed, "2026-10-02")).toBe("scope");
    expect((await quotaAccess(db, org, "bankImports", "2026-10-02")).used).toBe(0);
    // Un relevé mensuel ordinaire (31 jours au plus) passe.
    const month = camt053("CH9300762011623852957", [
      entry("S1", "2026-09-01"),
      entry("S2", "2026-09-30"),
    ]);
    expect(await importStatement(db, who, month, "2026-10-02")).toMatchObject({ imported: 2 });
    // En Pro, le fichier de l'année et celui des deux comptes passent.
    await setRank(org.id, 1);
    expect(await importStatement(db, who, year, "2026-10-03")).toMatchObject({ imported: 3 });
    expect(await importStatement(db, who, twoAccounts(), "2026-10-03")).toMatchObject({
      imported: 2,
    });
  });

  it("formule gratuite : des relevés journaliers du même compte, dans le même mois, passent", async () => {
    const { who } = await company(0);
    const a = camt053("CH9300762011623852957", [entry("J1", "2026-09-01")]);
    const b = camt053("CH93 0076 2011 6238 5295 7", [entry("J2", "2026-09-02")]);
    const second = b.slice(b.indexOf("<Stmt>"), b.indexOf("</Stmt>") + "</Stmt>".length);
    const daily = a.replace("</Stmt>", `</Stmt>${second}`);
    expect(await importStatement(db, who, daily, "2026-10-02")).toMatchObject({ imported: 2 });
  });
});

describe("multidevise par d'autres chemins", () => {
  it("formule gratuite : un brouillon ou un devis en EUR d'avant ne s'émet ni ne se facture ; un avoir reste permis", async () => {
    const { org, who } = await company(1);
    // En Pro : une facture en EUR émise, un brouillon en EUR, un devis en EUR émis.
    const sold = await issueInvoice(
      db,
      who,
      (await invoiceFor(who, "Kunde GmbH", undefined, "EUR")).id,
    );
    if (typeof sold !== "object") throw new Error(sold);
    const draft = await invoiceFor(who, "Kunde AG", undefined, "EUR");
    const quote = await issueInvoice(
      db,
      who,
      (await invoiceFor(who, "Kunde SA", undefined, "EUR", "quote")).id,
    );
    if (typeof quote !== "object") throw new Error(quote);
    await setRank(org.id, 0);
    const fx = vi.fn(async () => Response.json({ rates: { CHF: 0.95 } }));
    expect(await issueInvoice(db, who, draft.id, fx)).toBe("plan");
    expect(fx).not.toHaveBeenCalled();
    expect(await convertQuoteToInvoice(db, who, quote.id, "2026-03-10")).toBe("plan");
    expect(await createDepositInvoice(db, who, quote.id, 30, "2026-03-10")).toBe("plan");
    // Rien n'est créé ni émis, le devis reste ouvert.
    const docs = await db.select().from(invoices).where(eq(invoices.organizationId, org.id));
    expect(docs.map((d) => [d.id, d.status]).sort()).toEqual(
      [
        [sold.id, "issued"],
        [draft.id, "draft"],
        [quote.id, "issued"],
      ].sort(),
    );
    // Un avoir corrige la facture déjà émise, dans sa devise : il reste permis.
    const credit = await createCreditNote(db, who, sold.id, "2026-03-15");
    if (typeof credit !== "object") throw new Error(String(credit));
    expect(await issueInvoice(db, who, credit.id)).toMatchObject({
      status: "issued",
      currency: "EUR",
    });
    // En Pro, le même brouillon s'émet et le devis se facture.
    await setRank(org.id, 1);
    expect(await issueInvoice(db, who, draft.id, fx)).toMatchObject({ status: "issued" });
    expect(await convertQuoteToInvoice(db, who, quote.id, "2026-03-10")).toMatchObject({
      kind: "invoice",
      currency: "EUR",
    });
  });

  it("formule gratuite : une facture fournisseur en EUR (justificatif, e-facture) ne s'approuve pas", async () => {
    const { org, who } = await company(0);
    const bill = await createBill(
      db,
      who,
      {
        supplierName: "Lieferant GmbH",
        supplierStreet: null,
        supplierPostalCode: null,
        supplierTown: null,
        supplierCountry: "DE",
        iban: null,
        bic: null,
        paymentReference: null,
        number: "R-1",
        issueDate: "2026-03-10",
        dueDate: "2026-04-09",
        currency: "EUR",
        totalCents: 12_000,
        vatCode: null,
        accountId: null,
        description: null,
      },
      { source: "einvoice" },
    );
    const noRate = vi.fn(async () => new Response("down", { status: 503 }));
    expect(await approveBill(db, who, bill.id, noRate)).toBe("plan");
    expect(noRate).not.toHaveBeenCalled();
    // En Pro, le contrôle de formule passe (ici, faute de compte de charge).
    await setRank(org.id, 1);
    expect(await approveBill(db, who, bill.id, noRate)).toBe("noAccount");
  });

  it("formule gratuite : pas de nouvelle récurrence sur une facture en EUR, et celle d'avant attend", async () => {
    const { org, who } = await company(1);
    const eur = await invoiceFor(who, "Kunde GmbH", undefined, "EUR");
    const input = { intervalMonths: 1, nextDate: today(), autoSend: false };
    const before = await createRecurring(db, who, eur.id, input);
    if (typeof before !== "object") throw new Error(before);
    await setRank(org.id, 0);
    expect(await runRecurring(db, today())).toMatchObject({ created: 0, held: 1 });
    expect(await setRecurringActive(db, who, before.id, false)).toBe(true);
    expect(await setRecurringActive(db, who, before.id, true)).toBe("plan");
    expect(await createRecurring(db, who, eur.id, input)).toBe("plan");
    // Une facture en CHF reste répétable (une active en formule gratuite).
    const chf = await invoiceFor(who, "Kunde AG");
    expect(await createRecurring(db, who, chf.id, input)).toMatchObject({ active: true });
    await setRank(org.id, 1);
    expect(await setRecurringActive(db, who, before.id, true)).toBe(true);
  });
});

describe("formule relue au Compte Lead", () => {
  const ago = (hours: number) => new Date(Date.now() - hours * 3_600_000);
  async function aged(organizationId: string, hours: number) {
    await db
      .update(organizations)
      .set({ entitlementsAt: ago(hours) })
      .where(eq(organizations.id, organizationId));
    const [row] = await db.select().from(organizations).where(eq(organizations.id, organizationId));
    if (!row) throw new Error("entreprise");
    return row;
  }
  /**
   * Faux Compte Lead : jeton d'application, puis les droits de l'organisation (rang donné, ou
   * silence si null). Toute autre adresse (Resend) répond comme un envoi réussi.
   */
  function leadAnswers(rank: number | null) {
    return vi.fn(async (input: string | URL | Request) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.endsWith("/oauth/token"))
        return Response.json({ access_token: "app", token_type: "Bearer", expires_in: 300 });
      if (url.includes("/api/lead-id/v1/entitlements"))
        return rank === null
          ? new Response("down", { status: 503 })
          : Response.json({
              org: "org-a",
              plan: { code: ["free", "pro", "pro_plus"][rank], name: "x", rank, seats: null },
              apps: { invoicelead: { access: true, status: "live", upgrade_url: null } },
              subscriptions: [],
            });
      return Response.json({ id: "m1" });
    });
  }
  beforeEach(() => forgetRefreshAttempts());

  it("au-delà de 72 h sans nouvelle, la formule enregistrée ne vaut plus (formule gratuite)", async () => {
    const { org } = await company(2);
    const fresh = await aged(org.id, 1);
    expect(tierOf(fresh)).toBe("proplus");
    expect(tierOf(await aged(org.id, 71))).toBe("proplus");
    const old = await aged(org.id, 73);
    expect(tierOf(old)).toBe("free");
    expect(featureAccess(old, "api").allowed).toBe(false);
  });

  it("une clé d'API d'une entreprise qui a résilié Pro+ sans se reconnecter est refusée", async () => {
    const { org, who } = await company(2);
    const key = await createApiKey(db, who, "Compta");
    if (typeof key === "string") throw new Error(key);
    await aged(org.id, 13);
    // Le Compte Lead dit : formule gratuite. La formule est réécrite et l'API refusée.
    vi.stubGlobal("fetch", leadAnswers(0));
    expect(await apiCaller(db, `Bearer ${key.key}`, "contacts.list")).toBe("forbidden");
    const [row] = await db.select().from(organizations).where(eq(organizations.id, org.id));
    expect(row && tierOf(row)).toBe("free");
    expect(row?.leadPlan).toBe("free");
    // Revenue à Pro+ : la clé repasse dès la relecture suivante.
    await aged(org.id, 13);
    forgetRefreshAttempts();
    vi.stubGlobal("fetch", leadAnswers(2));
    expect(await apiCaller(db, `Bearer ${key.key}`, "contacts.list")).toMatchObject({
      keyId: key.row.id,
    });
  });

  it("Compte Lead muet : la formule vaut encore jusqu'à 72 h, puis la clé est refusée", async () => {
    const { org, who } = await company(2);
    const key = await createApiKey(db, who, "Compta");
    if (typeof key === "string") throw new Error(key);
    const lead = leadAnswers(null);
    vi.stubGlobal("fetch", lead);
    await aged(org.id, 20);
    expect(await apiCaller(db, `Bearer ${key.key}`, "contacts.list")).toMatchObject({
      keyId: key.row.id,
    });
    expect(lead).toHaveBeenCalled();
    // Pas de nouvelle tentative avant 10 minutes.
    lead.mockClear();
    expect(await apiCaller(db, `Bearer ${key.key}`, "contacts.list")).toMatchObject({
      keyId: key.row.id,
    });
    expect(lead).not.toHaveBeenCalled();
    await aged(org.id, 80);
    expect(await apiCaller(db, `Bearer ${key.key}`, "contacts.list")).toBe("forbidden");
  });

  it("la tâche quotidienne relit les formules payantes anciennes avant les relances", async () => {
    const { org, who } = await company(1);
    await db.update(organizations).set({ reminderAuto: true }).where(eq(organizations.id, org.id));
    const draft = await invoiceFor(who, "Kunde AG", "kunde@example.test");
    const issued = await issueInvoice(db, who, draft.id);
    if (typeof issued !== "object") throw new Error(issued);
    await aged(org.id, 13);
    const free = await company(0, "b");
    await aged(free.org.id, 200);
    const lead = leadAnswers(0);
    vi.stubGlobal("fetch", lead);
    // Seule l'entreprise payante est relue ; l'entreprise gratuite n'a rien à perdre.
    expect(await refreshStalePlans(db)).toEqual({ refreshed: 1, stale: 0 });
    const asked = lead.mock.calls
      .map((c) => String(c[0]))
      .filter((u) => u.includes("entitlements"));
    expect(asked).toEqual([expect.stringContaining("org=org-a")]);
    // Résiliée : rien ne part le matin.
    lead.mockClear();
    expect(await runAutoReminders(db, "2026-04-10")).toEqual({ sent: 0 });
    expect(lead).not.toHaveBeenCalled();
    // Témoin : la même entreprise, revenue à Pro, reçoit sa relance par e-mail.
    await setRank(org.id, 1);
    expect(await runAutoReminders(db, "2026-04-10")).toEqual({ sent: 1 });
  });

  it("une invitation de fiduciaire ne s'accepte pas quand la formule Pro a plus de 72 h", async () => {
    const client = await company(1, "client");
    const fid = await attachLeadIdentity(
      db,
      claims({ sub: "sub-fid", email: "compta@fidu.test", org: "org-fidu", org_name: "Fidu SA" }),
    );
    const inv = await inviteFiduciary(db, client.who, "compta@fidu.test");
    if (typeof inv === "string") throw new Error(inv);
    // Résiliée sans nouvelle connexion : la formule enregistrée dit encore Pro, mais elle est trop vieille.
    await aged(client.org.id, 73);
    expect((await acceptInvitation(db, fid.user, inv.token)).status).toBe("plan");
    const fiduciaryMembers = () =>
      db
        .select()
        .from(memberships)
        .where(
          and(eq(memberships.organizationId, client.org.id), eq(memberships.userId, fid.user.id)),
        );
    expect(await fiduciaryMembers()).toHaveLength(0);
    // Relue récemment, toujours en Pro : l'invitation s'accepte.
    await aged(client.org.id, 1);
    expect((await acceptInvitation(db, fid.user, inv.token)).status).toBe("accepted");
    expect(await fiduciaryMembers()).toHaveLength(1);
  });

  it("une formule récente n'est pas relue", async () => {
    const { org } = await company(1);
    const row = await aged(org.id, 2);
    const lead = leadAnswers(0);
    vi.stubGlobal("fetch", lead);
    expect(await refreshPlan(db, row)).toBe(row);
    expect(lead).not.toHaveBeenCalled();
  });
});
