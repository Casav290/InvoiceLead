import { and, eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiCaller } from "@/server/api-keys";
import { askAssistant } from "@/server/assistant";
import { attachLeadIdentity } from "@/server/auth/attach";
import { sendAutopilotDigests } from "@/server/autopilot-digest";
import { importStatement } from "@/server/bank";
import { parseCompanyForm, saveCompanySettings } from "@/server/company";
import { createContact, createContactWithinPlan, parseContactForm } from "@/server/contacts";
import {
  contacts,
  invoices,
  organizations,
  recurringInvoices,
  webhookDeliveries,
} from "@/server/db/schema";
import { createCreditNote, createInvoice, issueInvoice, parseInvoiceForm } from "@/server/invoices";
import { handleMcp } from "@/server/mcp";
import { consumeQuota, quotaAccess } from "@/server/plans";
import { readReceipt, uploadReceipt } from "@/server/receipts";
import { createRecurring, runRecurring, setRecurringActive } from "@/server/recurring";
import { sendAllReminders, sendReminder } from "@/server/reminders";
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
    }),
    { vatRegistered: false },
  );
  if (!r.ok) throw new Error("facture");
  const draft = await createInvoice(db, who, r.data);
  if (typeof draft !== "object" || !draft) throw new Error("brouillon");
  return draft;
}

/**
 * Ralentit une écriture de la base (déclencheur pg_sleep) pour que deux transactions simultanées
 * se chevauchent vraiment : sans verrou, la seconde compte avant que la première ne valide.
 */
async function slowWrites(on: string, run: () => Promise<void>, when?: string) {
  await db.execute(
    sql.raw(
      "create or replace function il_test_slow() returns trigger language plpgsql as $$ begin perform pg_sleep(0.4); return new; end $$",
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
    const table = on.split(" on ")[1] ?? "";
    await db.execute(sql.raw(`drop trigger if exists il_test_slow on ${table}`));
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
    await setRank(org.id, 1);
    const fetcher = vi.fn(async () => new Response("ok", { status: 200 }));
    const now = new Date("2026-10-05T08:00:00Z");
    expect(await deliverPending(db, { organizationId: org.id, now, fetcher })).toEqual({
      delivered: 0,
      failed: 0,
    });
    expect(fetcher).not.toHaveBeenCalled();
    const [held] = await db.select().from(webhookDeliveries);
    expect(held).toMatchObject({ status: "pending", attempts: 0 });
    expect(held?.nextAttemptAt.getTime()).toBe(now.getTime() + 86_400_000);
    // Retour à Pro+ : la livraison part au passage suivant.
    await setRank(org.id, 2);
    const later = new Date(now.getTime() + 86_400_000);
    expect(await deliverPending(db, { organizationId: org.id, now: later, fetcher })).toMatchObject(
      { delivered: 1 },
    );
    expect(fetcher).toHaveBeenCalledOnce();
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
    const caller: ApiCaller = { organization: row, userId: who.userId, keyId: "k" };
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
