import { readFileSync } from "node:fs";
import { and, count, eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createFirstFiscalYear, getAccount, installChart, listAccounts } from "@/server/accounting";
import { confirmPost, type Deps } from "@/server/ai-assistant/handlers";
import { BATCH, MAX_BATCH, OPERATIONS, toolName } from "@/server/ai-assistant/operations";
import type { AssistantContext } from "@/server/ai-assistant/ops-core";
import { STABLE_PROMPT } from "@/server/ai-assistant/prompt";
import { buildTools, type ToolState } from "@/server/ai-assistant/tools";
import { attachLeadIdentity } from "@/server/auth/attach";
import { createSession, findSession } from "@/server/auth/session";
import { createBill } from "@/server/bills";
import { createContact, parseContactForm } from "@/server/contacts";
import type { Db } from "@/server/db";
import {
  accounts,
  contacts,
  crmleadOutbox,
  fiscalYears,
  invoiceLines,
  invoiceReminders,
  invoices,
  memberships,
  organizations,
  products,
  projects,
  receipts,
  recurringInvoices,
  supplierBills,
  timeEntries,
  users,
  vatReturns,
  webhookEndpoints,
} from "@/server/db/schema";
import { createInvoice, issueInvoice, parseInvoiceForm, updateInvoice } from "@/server/invoices";
import { createProduct } from "@/server/products";
import { createRecurring } from "@/server/recurring";
import { dueReminders } from "@/server/reminders";
import { addEntry, createProject, setProjectArchived, startTimer } from "@/server/time";
import { claims } from "../support/claims";
import { testDb } from "../support/db";
import { setTestEnv } from "../support/env";
import { leadPlan } from "../support/lead-plan";
import { samplePdf } from "../support/pdf";

/**
 * Cahier du 27.10.2026 (A1 à A8) : chaque écriture permise de l'interface s'applique depuis la bulle,
 * en deux temps. Pour CHAQUE opération : la proposition n'écrit rien (empreinte de toutes les tables
 * de l'entreprise inchangée), le jeton d'une autre personne ou d'une autre entreprise est refusé
 * (403), la confirmation écrit exactement ce qui est attendu, et le rejeu est refusé (403). Puis le
 * lot : une carte, un clic, une transaction (tout ou rien), clés locales, plafond. Aucun appel au
 * modèle ni au réseau : les outils sont appelés directement, les envois vers CRMlead sont observés.
 */

const sync = vi.hoisted(() => ({ scheduled: [] as string[] }));
vi.mock("@/server/crmlead-sync", async (original) => {
  const real = await original<typeof import("@/server/crmlead-sync")>();
  return {
    ...real,
    // Envoi vers CRMlead : noté, jamais joué (aucun appel réseau pendant les tests).
    scheduleCrmleadDelivery: async (_db: unknown, organizationId: string) => {
      sync.scheduled.push(organizationId);
    },
  };
});

// Relances dues : comportement réel, appels comptés (coût d'un lot, suites du 29.10.2026).
const due = vi.hoisted(() => ({ calls: 0 }));
vi.mock("@/server/reminders", async (original) => {
  const real = await original<typeof import("@/server/reminders")>();
  return {
    ...real,
    dueReminders: (...args: Parameters<typeof real.dueReminders>) => {
      due.calls += 1;
      return real.dueReminders(...args);
    },
  };
});

const t = testDb();
const db = t.database as Db;
const SECRET = "unit-secret-unit-secret-unit-secret-unit";
const TODAY = "2026-10-24";
beforeAll(() =>
  setTestEnv({
    ANTHROPIC_API_KEY: "sk-test-not-a-real-key",
    AI_API_KEY: "test",
    AI_BASE_URL: "https://ai.test/v4",
  }),
);
beforeEach(async () => {
  await t.reset();
  sync.scheduled = [];
});
afterEach(() => vi.unstubAllGlobals());
afterAll(() => t.close());

function form(values: Record<string, string | string[]>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(values))
    for (const x of Array.isArray(v) ? v : [v]) f.append(k, x);
  return f;
}

type Person = Awaited<ReturnType<typeof person>>;

async function person(
  sub: string,
  org = "org-atelier",
  role: "admin" | "manager" | "user" = "admin",
  tier = 2,
) {
  const a = await attachLeadIdentity(
    db,
    claims({ sub, email: `${sub}@atelier.test`, org, org_name: `Org ${org}`, org_role: role }),
  );
  await db
    .update(organizations)
    .set({ hasAccess: true, entitlements: { plan: leadPlan(tier) }, entitlementsAt: new Date() })
    .where(eq(organizations.id, a.organization.id));
  const opened = await createSession(db, {
    userId: a.user.id,
    organizationId: a.organization.id,
    idToken: null,
  });
  const session = await findSession(db, opened.token);
  if (!session) throw new Error("session");
  return { ...a, token: opened.token, session };
}

/** Session relue (entreprise et rôle tels qu'en base maintenant). */
async function refresh(p: Person): Promise<Person> {
  const session = await findSession(db, p.token);
  if (!session) throw new Error("session");
  return { ...p, session };
}

const whoOf = (p: Person) => ({ organizationId: p.organization.id, userId: p.user.id });

/** Réglages complets d'une entreprise suisse (émission possible), comme l'écran les enregistre. */
async function completeCompany(p: Person, extra: Partial<typeof organizations.$inferInsert> = {}) {
  await db
    .update(organizations)
    .set({
      legalName: "Atelier Muster GmbH",
      legalForm: "gmbh",
      street: "Bahnhofstrasse",
      buildingNumber: "1",
      postalCode: "8001",
      town: "Zürich",
      iban: "CH9300762011623852957",
      settingsCompletedAt: new Date(),
      ...extra,
    })
    .where(eq(organizations.id, p.organization.id));
}

async function customer(p: Person, name = "Client TEST SA", language = "fr") {
  const c = parseContactForm(
    form({
      kind: "company",
      isCustomer: "on",
      name,
      language,
      country: "CH",
      paymentTermDays: "30",
    }),
  );
  if (!c.ok) throw new Error("contact");
  return createContact(db, whoOf(p), c.data);
}

async function draft(
  p: Person,
  contactId: string,
  opts: { kind?: "invoice" | "quote"; price?: string; issueDate?: string } = {},
) {
  const r = parseInvoiceForm(
    form({
      contactId,
      language: "fr",
      issueDate: opts.issueDate ?? "2026-10-01",
      "line.description": ["Conseil"],
      "line.quantity": ["1"],
      "line.unit": ["flat"],
      "line.unitPrice": [opts.price ?? "1000"],
      "line.vatCode": ["normal"],
      "line.productId": [""],
    }),
    { vatRegistered: false },
  );
  if (!r.ok) throw new Error("pièce");
  const d = await createInvoice(db, whoOf(p), r.data, opts.kind ?? "invoice");
  if (typeof d !== "object" || !d) throw new Error("brouillon");
  return d;
}

async function issued(p: Person, contactId: string, kind: "invoice" | "quote" = "invoice") {
  const d = await draft(p, contactId, { kind });
  const i = await issueInvoice(db, whoOf(p), d.id);
  if (typeof i !== "object") throw new Error(`émission ${i}`);
  return i;
}

async function books(p: Person, start = "2026-01-01") {
  await installChart(db, whoOf(p), "corporation");
  await createFirstFiscalYear(db, whoOf(p), { start, extended: false });
}

async function project(p: Person, contactId: string, name = "Site vitrine") {
  const pr = await createProject(db, whoOf(p), {
    contactId,
    name,
    hourlyRateCents: 12000,
    budgetMinutes: null,
  });
  if (pr === "contact") throw new Error("projet");
  return pr;
}

function toolCtx(p: Person): AssistantContext {
  return {
    database: db,
    userId: p.user.id,
    userName: p.user.name ?? "Ada",
    organization: p.session.organization,
    membership: p.session.membership,
    today: TODAY,
    locale: "fr",
  };
}

function tools(p: Person) {
  const state: ToolState = { actions: [], called: [] };
  const list = buildTools(toolCtx(p), state, SECRET);
  const call = async (name: string, input: Record<string, unknown>) => {
    const tool = list.find((x) => x.name === name);
    if (!tool) throw new Error(`outil ${name}`);
    return JSON.parse(String(await tool.run(tool.parse(input) as never)));
  };
  const lastToken = () => {
    const a = state.actions.filter((x) => x.type === "confirm").at(-1);
    if (a?.type !== "confirm") throw new Error("pas de carte");
    return a;
  };
  return { list, state, call, lastToken };
}

const deps = (): Deps => ({
  database: db,
  apiKey: "sk-test-not-a-real-key",
  secret: SECRET,
  today: TODAY,
});

const confirmAs = (p: Person, token: string) =>
  confirmPost({ status: 200, session: p.session }, { token, locale: "fr" }, deps());

/**
 * Empreinte de TOUTES les données de l'entreprise : chaque table qui porte son identifiant, les
 * lignes de ses pièces et de son journal, et sa propre ligne. Les traces de la bulle (quota, jetons
 * consommés) et les sessions sont à part.
 */
async function fingerprint(organizationId: string) {
  const res = await db.execute(
    sql`select table_name from information_schema.columns where table_schema = 'public' and column_name = 'organization_id' and table_name not in ('assistant_usage', 'assistant_confirmations', 'sessions') order by table_name`,
  );
  const parts: string[] = [];
  const hash = async (query: ReturnType<typeof sql>) => {
    const r = await db.execute(query);
    return String((r.rows[0] as { h: string }).h);
  };
  for (const row of res.rows as { table_name: string }[])
    parts.push(
      await hash(
        sql`select md5(coalesce(string_agg(t::text, ',' order by t::text), '')) as h from ${sql.identifier(row.table_name)} t where t.organization_id = ${organizationId}`,
      ),
    );
  parts.push(
    await hash(
      sql`select md5(coalesce(string_agg(l::text, ',' order by l::text), '')) as h from invoice_lines l where l.invoice_id in (select id from invoices where organization_id = ${organizationId})`,
    ),
  );
  parts.push(
    await hash(
      sql`select md5(coalesce(string_agg(l::text, ',' order by l::text), '')) as h from journal_lines l where l.entry_id in (select id from journal_entries where organization_id = ${organizationId})`,
    ),
  );
  parts.push(
    await hash(sql`select md5(o::text) as h from organizations o where o.id = ${organizationId}`),
  );
  // Les comptes des personnes de l'entreprise (préférences : langue choisie).
  parts.push(
    await hash(
      sql`select md5(coalesce(string_agg(u::text, ',' order by u::text), '')) as h from users u where u.id in (select user_id from memberships where organization_id = ${organizationId})`,
    ),
  );
  return parts.join(":");
}

type Applied = {
  action: string;
  id: string;
  path: string;
  label: string;
  items?: { action: string; id: string; path: string }[];
};

type Scenario = {
  op: string;
  /** Données et droits avant la proposition ; rend l'entrée de l'outil. */
  setup: (p: Person) => Promise<Record<string, unknown>>;
  /** Ce que la confirmation doit avoir écrit, exactement. */
  check: (p: Person, result: Applied) => Promise<void>;
};

const one = async <T>(rows: Promise<T[]>) => {
  const [r] = await rows;
  if (!r) throw new Error("ligne absente");
  return r;
};

const SCENARIOS: Scenario[] = [
  {
    op: "create_contact",
    setup: async () => ({
      name: "Atelier Nouveau SA",
      email: "info@nouveau.example",
      country: "CH",
    }),
    check: async (p, r) => {
      const c = await one(db.select().from(contacts).where(eq(contacts.id, r.id)));
      expect(c).toMatchObject({
        organizationId: p.organization.id,
        name: "Atelier Nouveau SA",
        email: "info@nouveau.example",
        isCustomer: true,
        kind: "company",
      });
      expect(r.path).toBe(`/app/contacts/${r.id}`);
    },
  },
  {
    op: "update_contact",
    setup: async (p) => {
      const c = await customer(p);
      return { contactId: c.id, email: "compta@client.example", phone: "+41 21 555 00 00" };
    },
    check: async (_p, r) => {
      const c = await one(db.select().from(contacts).where(eq(contacts.id, r.id)));
      expect(c).toMatchObject({ email: "compta@client.example", phone: "+41 21 555 00 00" });
    },
  },
  {
    op: "create_invoice_draft",
    setup: async (p) => {
      const c = await customer(p);
      return {
        kind: "quote",
        contactId: c.id,
        lines: [
          { description: "Création site vitrine", unitPrice: "3500" },
          { description: "Hébergement 1 an", unitPrice: 240 },
        ],
      };
    },
    check: async (p, r) => {
      const q = await one(db.select().from(invoices).where(eq(invoices.id, r.id)));
      expect(q).toMatchObject({
        organizationId: p.organization.id,
        kind: "quote",
        status: "draft",
        number: null,
        netCents: 374000,
      });
      const lines = await db
        .select()
        .from(invoiceLines)
        .where(eq(invoiceLines.invoiceId, r.id))
        .orderBy(invoiceLines.position);
      expect(lines.map((l) => [l.description, l.quantityMilli, l.unitPriceCents])).toEqual([
        ["Création site vitrine", 1000, 350000],
        ["Hébergement 1 an", 1000, 24000],
      ]);
      expect(r.path).toBe(`/app/quotes/${r.id}`);
    },
  },
  {
    op: "update_invoice_draft",
    setup: async (p) => {
      const c = await customer(p);
      const d = await draft(p, c.id);
      return {
        documentId: d.id,
        title: "Octobre",
        lines: [{ description: "Conseil", quantity: "3", unit: "hour", unitPrice: "120" }],
      };
    },
    check: async (_p, r) => {
      const d = await one(db.select().from(invoices).where(eq(invoices.id, r.id)));
      expect(d).toMatchObject({ title: "Octobre", status: "draft", netCents: 36000 });
      const lines = await db.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, r.id));
      expect(lines.map((l) => [l.description, l.quantityMilli, l.unit])).toEqual([
        ["Conseil", 3000, "hour"],
      ]);
    },
  },
  {
    op: "issue_document",
    setup: async (p) => {
      await completeCompany(p);
      const c = await customer(p);
      const d = await draft(p, c.id);
      return { documentId: d.id };
    },
    check: async (_p, r) => {
      const d = await one(db.select().from(invoices).where(eq(invoices.id, r.id)));
      expect(d.status).toBe("issued");
      expect(d.number).toBe("2026-0001");
      expect(d.issuedAt).not.toBeNull();
    },
  },
  {
    op: "set_quote_outcome",
    setup: async (p) => {
      await completeCompany(p);
      const q = await issued(p, (await customer(p)).id, "quote");
      return { quoteId: q.id, outcome: "accepted" };
    },
    check: async (_p, r) => {
      const q = await one(db.select().from(invoices).where(eq(invoices.id, r.id)));
      expect(q.status).toBe("accepted");
    },
  },
  {
    op: "convert_quote_to_invoice",
    setup: async (p) => {
      await completeCompany(p);
      const q = await issued(p, (await customer(p)).id, "quote");
      return { quoteId: q.id };
    },
    check: async (_p, r) => {
      const inv = await one(db.select().from(invoices).where(eq(invoices.id, r.id)));
      expect(inv).toMatchObject({ kind: "invoice", status: "draft", netCents: 100000 });
      const quote = await one(
        db
          .select()
          .from(invoices)
          .where(eq(invoices.id, inv.sourceQuoteId ?? "")),
      );
      expect(quote.status).toBe("invoiced");
      expect(r.path).toBe(`/app/invoices/${r.id}`);
    },
  },
  {
    op: "create_deposit_invoice",
    setup: async (p) => {
      await completeCompany(p);
      const q = await issued(p, (await customer(p)).id, "quote");
      return { quoteId: q.id, percent: 30 };
    },
    check: async (_p, r) => {
      const inv = await one(db.select().from(invoices).where(eq(invoices.id, r.id)));
      expect(inv).toMatchObject({
        kind: "invoice",
        status: "draft",
        deposit: true,
        netCents: 30000,
      });
    },
  },
  {
    op: "create_credit_note",
    setup: async (p) => {
      await completeCompany(p);
      const i = await issued(p, (await customer(p)).id);
      return { invoiceId: i.id };
    },
    check: async (_p, r) => {
      const cn = await one(db.select().from(invoices).where(eq(invoices.id, r.id)));
      expect(cn).toMatchObject({ kind: "credit_note", status: "draft", totalCents: 100000 });
      expect(cn.relatedInvoiceId).not.toBeNull();
    },
  },
  {
    op: "create_recurring_invoice",
    setup: async (p) => {
      await completeCompany(p);
      const i = await issued(p, (await customer(p)).id);
      return { invoiceId: i.id, intervalMonths: 3, nextDate: "2026-11-01" };
    },
    check: async (p, r) => {
      const rec = await one(
        db.select().from(recurringInvoices).where(eq(recurringInvoices.id, r.id)),
      );
      expect(rec).toMatchObject({
        organizationId: p.organization.id,
        intervalMonths: 3,
        nextDate: "2026-11-01",
        autoSend: false,
        active: true,
      });
    },
  },
  {
    op: "set_recurring_status",
    setup: async (p) => {
      await completeCompany(p);
      const i = await issued(p, (await customer(p)).id);
      const rec = await createRecurring(db, whoOf(p), i.id, {
        intervalMonths: 1,
        nextDate: "2026-11-01",
        autoSend: false,
      });
      if (typeof rec === "string") throw new Error(rec);
      return { recurringId: rec.id, active: false };
    },
    check: async (_p, r) => {
      const rec = await one(
        db.select().from(recurringInvoices).where(eq(recurringInvoices.id, r.id)),
      );
      expect(rec.active).toBe(false);
    },
  },
  {
    op: "waive_reminder_charges",
    setup: async (p) => {
      await completeCompany(p);
      const i = await issued(p, (await customer(p)).id);
      await db.insert(invoiceReminders).values({
        organizationId: p.organization.id,
        invoiceId: i.id,
        level: 2,
        channel: "manual",
        feeCents: 2000,
        interestCents: 150,
      });
      return { invoiceId: i.id };
    },
    check: async (_p, r) => {
      const rem = await one(
        db.select().from(invoiceReminders).where(eq(invoiceReminders.invoiceId, r.id)),
      );
      expect(rem.waivedAt).not.toBeNull();
    },
  },
  {
    op: "create_product",
    setup: async () => ({
      name: "Hébergement annuel",
      sku: "HEB-1",
      unit: "flat",
      unitPrice: "240",
    }),
    check: async (p, r) => {
      const pr = await one(db.select().from(products).where(eq(products.id, r.id)));
      expect(pr).toMatchObject({
        organizationId: p.organization.id,
        name: "Hébergement annuel",
        sku: "HEB-1",
        unitPriceCents: 24000,
        vatCode: "normal",
      });
    },
  },
  {
    op: "update_product",
    setup: async (p) => {
      const pr = await createProduct(db, whoOf(p), {
        sku: null,
        name: "Maintenance",
        description: null,
        unit: "month",
        unitPriceCents: 9000,
        vatCode: "normal",
      });
      if (pr === "skuTaken") throw new Error("article");
      return { productId: pr.id, unitPrice: "95.50" };
    },
    check: async (_p, r) => {
      const pr = await one(db.select().from(products).where(eq(products.id, r.id)));
      expect(pr).toMatchObject({ name: "Maintenance", unitPriceCents: 9550, unit: "month" });
    },
  },
  {
    op: "create_project",
    setup: async (p) => {
      const c = await customer(p);
      return { contactId: c.id, name: "Refonte site", hourlyRate: "120", budgetHours: "20" };
    },
    check: async (p, r) => {
      const pr = await one(db.select().from(projects).where(eq(projects.id, r.id)));
      expect(pr).toMatchObject({
        organizationId: p.organization.id,
        name: "Refonte site",
        hourlyRateCents: 12000,
        budgetMinutes: 1200,
      });
    },
  },
  {
    op: "update_project",
    setup: async (p) => {
      const pr = await project(p, (await customer(p)).id);
      await setProjectArchived(db, whoOf(p), pr.id, true);
      return { projectId: pr.id, name: "Site vitrine v2", reactivate: true };
    },
    check: async (_p, r) => {
      const pr = await one(db.select().from(projects).where(eq(projects.id, r.id)));
      expect(pr).toMatchObject({ name: "Site vitrine v2", archivedAt: null });
    },
  },
  {
    op: "create_time_entry",
    setup: async (p) => {
      const pr = await project(p, (await customer(p)).id);
      return {
        projectId: pr.id,
        workDate: "2026-10-20",
        duration: "1:30",
        description: "Maquettes",
      };
    },
    check: async (p, r) => {
      const e = await one(db.select().from(timeEntries).where(eq(timeEntries.id, r.id)));
      expect(e).toMatchObject({
        userId: p.user.id,
        workDate: "2026-10-20",
        minutes: 90,
        description: "Maquettes",
        billable: true,
        rateCents: 12000,
        startedAt: null,
      });
    },
  },
  {
    op: "start_timer",
    setup: async (p) => {
      const pr = await project(p, (await customer(p)).id);
      return { projectId: pr.id, description: "Atelier client" };
    },
    check: async (p, r) => {
      const e = await one(db.select().from(timeEntries).where(eq(timeEntries.id, r.id)));
      expect(e.userId).toBe(p.user.id);
      expect(e.startedAt).not.toBeNull();
      expect(e.description).toBe("Atelier client");
    },
  },
  {
    op: "stop_timer",
    setup: async (p) => {
      const pr = await project(p, (await customer(p)).id);
      await startTimer(db, whoOf(p), pr.id, null, new Date(Date.now() - 30 * 60_000));
      return {};
    },
    check: async (_p, r) => {
      const e = await one(db.select().from(timeEntries).where(eq(timeEntries.id, r.id)));
      expect(e.startedAt).toBeNull();
      expect(e.minutes).toBeGreaterThanOrEqual(29);
      expect(e.minutes).toBeLessThanOrEqual(31);
    },
  },
  {
    op: "invoice_project_time",
    setup: async (p) => {
      const pr = await project(p, (await customer(p)).id);
      await addEntry(db, whoOf(p), {
        projectId: pr.id,
        workDate: "2026-10-20",
        minutes: 120,
        description: "Développement",
        billable: true,
      });
      return { projectId: pr.id };
    },
    check: async (_p, r) => {
      const inv = await one(db.select().from(invoices).where(eq(invoices.id, r.id)));
      expect(inv).toMatchObject({ kind: "invoice", status: "draft", netCents: 24000 });
      const [billed] = await db
        .select({ n: count() })
        .from(timeEntries)
        .where(eq(timeEntries.invoiceId, r.id));
      expect(billed?.n).toBe(1);
    },
  },
  {
    op: "create_expense_claim",
    setup: async () => ({
      description: "Train Lausanne Berne",
      amount: "48.60",
      date: "2026-10-20",
    }),
    check: async (p, r) => {
      const b = await one(db.select().from(supplierBills).where(eq(supplierBills.id, r.id)));
      expect(b).toMatchObject({
        organizationId: p.organization.id,
        source: "expense",
        status: "draft",
        totalCents: 4860,
        claimantId: p.user.id,
        issueDate: "2026-10-20",
      });
    },
  },
  {
    op: "create_supplier_bill",
    setup: async () => ({
      supplierName: "Imprimerie TEST SA",
      number: "F-77",
      issueDate: "2026-10-01",
      total: "540.00",
    }),
    check: async (p, r) => {
      const b = await one(db.select().from(supplierBills).where(eq(supplierBills.id, r.id)));
      expect(b).toMatchObject({
        organizationId: p.organization.id,
        supplierName: "Imprimerie TEST SA",
        number: "F-77",
        totalCents: 54000,
        currency: "CHF",
        dueDate: "2026-10-31",
        status: "draft",
      });
    },
  },
  {
    op: "update_supplier_bill",
    setup: async (p) => {
      const b = await createBill(db, whoOf(p), {
        supplierName: "Imprimerie TEST SA",
        supplierStreet: null,
        supplierPostalCode: null,
        supplierTown: null,
        supplierCountry: null,
        iban: null,
        bic: null,
        paymentReference: null,
        number: "F-78",
        issueDate: "2026-10-01",
        dueDate: "2026-10-31",
        currency: "CHF",
        totalCents: 54000,
        vatCode: null,
        accountId: null,
        description: null,
      });
      return { billId: b.id, total: "560", description: "Flyers" };
    },
    check: async (_p, r) => {
      const b = await one(db.select().from(supplierBills).where(eq(supplierBills.id, r.id)));
      expect(b).toMatchObject({ totalCents: 56000, description: "Flyers", number: "F-78" });
    },
  },
  {
    op: "approve_supplier_bill",
    setup: async (p) => {
      await books(p);
      const expense = (await listAccounts(db, p.organization.id)).find((a) => a.number === "4400");
      if (!expense) throw new Error("compte 4400");
      const b = await createBill(db, whoOf(p), {
        supplierName: "Imprimerie TEST SA",
        supplierStreet: null,
        supplierPostalCode: null,
        supplierTown: null,
        supplierCountry: null,
        iban: null,
        bic: null,
        paymentReference: null,
        number: "F-79",
        issueDate: "2026-10-01",
        dueDate: "2026-10-31",
        currency: "CHF",
        totalCents: 54000,
        vatCode: null,
        accountId: expense.id,
        description: null,
      });
      return { billId: b.id };
    },
    check: async (p, r) => {
      const b = await one(db.select().from(supplierBills).where(eq(supplierBills.id, r.id)));
      expect(b).toMatchObject({ status: "approved", approvedBy: p.user.id });
      expect(b.journalEntryId).not.toBeNull();
    },
  },
  {
    op: "create_bill_from_receipt",
    setup: async (p) => {
      const [rc] = await db
        .insert(receipts)
        .values({
          organizationId: p.organization.id,
          fileKey: `${p.organization.id}/receipts/x.pdf`,
          filename: "facture-imprimerie.pdf",
          contentType: "application/pdf",
          sizeBytes: 10,
          sha256: "a".repeat(64),
          status: "read",
          extraction: {
            supplier: "Imprimerie TEST SA",
            date: "2026-10-02",
            totalCents: 32400,
            currency: "CHF",
            vatCents: null,
            vatCode: null,
            invoiceNumber: "F-80",
            description: "Cartes de visite",
            accountNumber: null,
            confidence: 0.9,
          },
        })
        .returning();
      if (!rc) throw new Error("justificatif");
      return { receiptId: rc.id };
    },
    check: async (_p, r) => {
      const b = await one(db.select().from(supplierBills).where(eq(supplierBills.id, r.id)));
      expect(b).toMatchObject({
        supplierName: "Imprimerie TEST SA",
        totalCents: 32400,
        number: "F-80",
        source: "receipt",
      });
      const rc = await one(
        db
          .select()
          .from(receipts)
          .where(eq(receipts.id, b.receiptId ?? "")),
      );
      expect(rc.status).toBe("billed");
    },
  },
  {
    op: "post_pending_entries",
    setup: async (p) => {
      await completeCompany(p);
      await books(p);
      await issued(p, (await customer(p)).id);
      return {};
    },
    check: async (p) => {
      const [left] = await db
        .select({ n: count() })
        .from(invoices)
        .where(
          and(
            eq(invoices.organizationId, p.organization.id),
            eq(invoices.status, "issued"),
            sql`${invoices.journalEntryId} is null`,
          ),
        );
      expect(left?.n).toBe(0);
    },
  },
  {
    op: "validate_vat_return",
    setup: async (p) => {
      await completeCompany(p, {
        vatRegistered: true,
        vatMethod: "effective",
        vatSettlement: "agreed",
        uid: "CHE116281710",
      });
      await books(p);
      return { periodStart: "2026-07-01" };
    },
    check: async (p) => {
      const v = await one(
        db.select().from(vatReturns).where(eq(vatReturns.organizationId, p.organization.id)),
      );
      expect(v).toMatchObject({
        periodStart: "2026-07-01",
        periodEnd: "2026-09-30",
        validatedBy: p.user.id,
      });
    },
  },
  {
    op: "create_account",
    setup: async (p) => {
      await books(p);
      return { number: "6599", nameFr: "Frais divers TEST", type: "expense" };
    },
    check: async (p, r) => {
      const a = await one(db.select().from(accounts).where(eq(accounts.id, r.id)));
      expect(a).toMatchObject({
        organizationId: p.organization.id,
        number: "6599",
        nameFr: "Frais divers TEST",
        nameDe: "Frais divers TEST",
        type: "expense",
        active: true,
      });
    },
  },
  {
    op: "update_account",
    setup: async (p) => {
      await books(p);
      const a = (await listAccounts(db, p.organization.id)).find((x) => x.number === "6500");
      if (!a) throw new Error("compte 6500");
      return { accountId: a.id, nameFr: "Frais d'administration TEST" };
    },
    check: async (p, r) => {
      const a = await getAccount(db, p.organization.id, r.id);
      expect(a?.nameFr).toBe("Frais d'administration TEST");
      expect(a?.number).toBe("6500");
    },
  },
  {
    op: "install_chart",
    setup: async () => ({ template: "corporation" }),
    check: async (p) => {
      expect((await listAccounts(db, p.organization.id)).length).toBeGreaterThan(50);
    },
  },
  {
    op: "open_first_fiscal_year",
    setup: async () => ({ start: "2026-01-01" }),
    check: async (_p, r) => {
      const y = await one(db.select().from(fiscalYears).where(eq(fiscalYears.id, r.id)));
      expect(y).toMatchObject({ startDate: "2026-01-01", endDate: "2026-12-31", status: "open" });
    },
  },
  {
    op: "open_next_fiscal_year",
    setup: async (p) => {
      await books(p, "2025-01-01");
      return {};
    },
    check: async (_p, r) => {
      const y = await one(db.select().from(fiscalYears).where(eq(fiscalYears.id, r.id)));
      expect(y).toMatchObject({ startDate: "2026-01-01", endDate: "2026-12-31" });
    },
  },
  {
    op: "close_fiscal_year",
    setup: async (p) => {
      await books(p, "2025-01-01");
      const y = await one(
        db.select().from(fiscalYears).where(eq(fiscalYears.organizationId, p.organization.id)),
      );
      return { fiscalYearId: y.id };
    },
    check: async (_p, r) => {
      const y = await one(db.select().from(fiscalYears).where(eq(fiscalYears.id, r.id)));
      expect(y.status).toBe("closed");
    },
  },
  {
    op: "update_company_settings",
    setup: async (p) => {
      await completeCompany(p);
      return { phone: "+41 21 000 00 00", website: "https://atelier.example" };
    },
    check: async (p) => {
      const o = await one(
        db.select().from(organizations).where(eq(organizations.id, p.organization.id)),
      );
      expect(o).toMatchObject({
        phone: "+41 21 000 00 00",
        website: "https://atelier.example",
        legalName: "Atelier Muster GmbH",
        iban: "CH9300762011623852957",
      });
    },
  },
  {
    op: "set_interface_language",
    setup: async () => ({ language: "it" }),
    check: async (p, r) => {
      const [u] = await db.select().from(users).where(eq(users.id, p.user.id));
      expect(u?.chosenLocale).toBe("it");
      expect(r).toMatchObject({ locale: "it" });
    },
  },
  {
    op: "update_reminder_settings",
    setup: async () => ({ fee: "20", interestPercent: 5 }),
    check: async (p) => {
      const o = await one(
        db.select().from(organizations).where(eq(organizations.id, p.organization.id)),
      );
      expect(o).toMatchObject({ reminderFeeCents: 2000, lateInterestBp: 500, reminderAuto: false });
    },
  },
];

describe("chaque opération en deux temps (A1, A7, A8)", () => {
  it("chaque opération du registre a sa scène ici (sauf la lecture par l'IA, testée à part)", () => {
    const covered = new Set(SCENARIOS.map((s) => s.op));
    const missing = OPERATIONS.map((o) => o.id).filter(
      (id) => id !== "read_receipt" && !covered.has(id),
    );
    expect(missing).toEqual([]);
  });

  it.each(SCENARIOS)(
    "$op : proposition sans écriture, autre personne ou entreprise 403, confirmation exacte, rejeu 403",
    async (sc) => {
      let p = await person("sub-ada");
      const bob = await person("sub-bob", "org-atelier", "admin");
      const zoe = await person("sub-zoe", "org-autre", "admin");
      const input = await sc.setup(p);
      p = await refresh(p);
      const org = p.organization.id;
      const before = await fingerprint(org);
      const otherBefore = await fingerprint(zoe.organization.id);

      const { call, state, lastToken } = tools(p);
      const out = await call(toolName(sc.op), input);
      expect(out.status, JSON.stringify(out)).toBe("awaiting_user_confirmation");
      expect(state.actions.filter((a) => a.type === "confirm")).toHaveLength(1);
      // Proposer = essai à blanc annulé : rien n'a bougé, nulle part.
      expect(await fingerprint(org)).toBe(before);
      expect(sync.scheduled).toEqual([]);

      const { token, summary } = lastToken();
      expect(summary.action).toBe(sc.op);
      for (const other of [bob, zoe]) {
        const res = await confirmAs(other, token);
        expect(res).toEqual({ status: 403, body: { error: "invalid_token" } });
      }
      expect(await fingerprint(org)).toBe(before);

      const done = await confirmAs(p, token);
      expect(done.status, JSON.stringify(done.body)).toBe(200);
      const result = done.body.result as Applied;
      expect(result.action).toBe(sc.op);
      await sc.check(p, result);
      const after = await fingerprint(org);
      expect(after).not.toBe(before);

      expect(await confirmAs(p, token)).toEqual({ status: 403, body: { error: "token_used" } });
      expect(await fingerprint(org)).toBe(after);
      // L'autre entreprise n'a jamais été touchée.
      expect(await fingerprint(zoe.organization.id)).toBe(otherBefore);
    },
  );
});

describe("scénario phare : un devis en une phrase (A9)", () => {
  it("la carte montre les lignes et le total exacts, la confirmation écrit ce brouillon et rien d'autre", async () => {
    const p = await person("sub-ada");
    const c = await customer(p, "Client TEST SA");
    const { call, lastToken } = tools(p);
    const found = await call("search_contacts", { query: "Client TEST" });
    expect(found.contacts[0]).toMatchObject({ id: c.id, name: "Client TEST SA" });
    const out = await call("propose_create_invoice_draft", {
      kind: "quote",
      contactId: c.id,
      lines: [
        { description: "Création site vitrine", quantity: "1", unit: "flat", unitPrice: "3500" },
        { description: "Hébergement 1 an", quantity: "1", unit: "flat", unitPrice: "240" },
      ],
    });
    expect(out.summary.totals).toEqual({ currency: "CHF", net: 3740, tax: 0, total: 3740 });
    const { token, summary } = lastToken();
    expect(summary.fields).toEqual(
      expect.arrayContaining([
        { key: "documentKind", value: "quote", format: "enum" },
        { key: "customer", value: "Client TEST SA" },
        { key: "status", value: "draft", format: "enum" },
      ]),
    );
    expect(summary.lines).toEqual([
      {
        description: "Création site vitrine",
        quantity: "1",
        unit: "flat",
        unitPriceCents: 350000,
        netCents: 350000,
      },
      {
        description: "Hébergement 1 an",
        quantity: "1",
        unit: "flat",
        unitPriceCents: 24000,
        netCents: 24000,
      },
    ]);
    const done = await confirmAs(p, token);
    expect(done.status).toBe(200);
    const id = (done.body.result as Applied).id;
    const [quote] = await db.select().from(invoices).where(eq(invoices.id, id));
    expect(quote).toMatchObject({
      kind: "quote",
      status: "draft",
      number: null,
      contactId: c.id,
      netCents: 374000,
      vatCents: 0,
      totalCents: 374000,
      currency: "CHF",
    });
    const lines = await db
      .select()
      .from(invoiceLines)
      .where(eq(invoiceLines.invoiceId, id))
      .orderBy(invoiceLines.position);
    expect(
      lines.map((l) => ({
        description: l.description,
        quantity: String(l.quantityMilli / 1000),
        unit: l.unit,
        unitPriceCents: l.unitPriceCents,
        netCents: l.netCents,
      })),
    ).toEqual(summary.lines);
    // Une seule pièce, aucun envoi.
    const [n] = await db
      .select({ n: count() })
      .from(invoices)
      .where(eq(invoices.organizationId, p.organization.id));
    expect(n?.n).toBe(1);
    expect(sync.scheduled).toEqual([]);
  });
});

describe("lot : une carte, un clic, une transaction (A2, A3)", () => {
  const batchFor = (contactName: string) => ({
    operations: [
      {
        op: "create_contact",
        key: "c1",
        input: { name: contactName, email: "lot@client.example" },
      },
      {
        op: "create_invoice_draft",
        key: "q1",
        input: {
          kind: "quote",
          contactId: "@c1",
          lines: [
            { description: "Création site vitrine", unitPrice: "3500", productId: "@p1" },
            { description: "Hébergement 1 an", unitPrice: "240" },
          ],
        },
      },
      { op: "create_product", key: "p1", input: { name: "Site vitrine", unitPrice: "3500" } },
    ],
  });

  it("une référence vers une opération plus loin dans le lot est refusée, sans rien écrire", async () => {
    const p = await person("sub-ada");
    const before = await fingerprint(p.organization.id);
    const { call, state } = tools(p);
    const out = await call("propose_batch", batchFor("Nouveau Client SA"));
    expect(out.error).toMatch(/^operation 2 \(create_invoice_draft\): unknown_ref @p1/);
    expect(state.actions).toEqual([]);
    expect(await fingerprint(p.organization.id)).toBe(before);
  });

  it("nouveau client + son devis + un article : proposition sans écriture, puis tout écrit au clic", async () => {
    const p = await person("sub-ada");
    const before = await fingerprint(p.organization.id);
    const { call, lastToken } = tools(p);
    const batch = batchFor("Nouveau Client SA");
    // Ordre utile : l'article d'abord, la pièce qui le référence ensuite.
    const ops = batch.operations;
    const out = await call("propose_batch", { operations: [ops[2], ops[0], ops[1]] });
    expect(out.status, JSON.stringify(out)).toBe("awaiting_user_confirmation");
    expect(out.summary).toMatchObject({ operations: 3 });
    expect(await fingerprint(p.organization.id)).toBe(before);
    const { token, summary } = lastToken();
    expect(summary).toMatchObject({ action: BATCH, count: 3 });
    expect(summary.groups?.map((g) => [g.action, g.count])).toEqual([
      ["create_product", 1],
      ["create_contact", 1],
      ["create_invoice_draft", 1],
    ]);
    // La pièce du lot montre ses lignes et son total sur la carte.
    const quoteItem = summary.groups?.[2]?.items[0];
    expect(quoteItem).toMatchObject({ detail: "quote", amountCents: 374000, currency: "CHF" });
    expect(quoteItem?.lines).toHaveLength(2);

    const done = await confirmAs(p, token);
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    const result = done.body.result as Applied & { items: { action: string; id: string }[] };
    expect(result.items.map((i) => i.action)).toEqual([
      "create_product",
      "create_contact",
      "create_invoice_draft",
    ]);
    const [productId, contactId, quoteId] = result.items.map((i) => i.id);
    const [quote] = await db
      .select()
      .from(invoices)
      .where(eq(invoices.id, quoteId ?? ""));
    expect(quote).toMatchObject({ contactId, kind: "quote", status: "draft", netCents: 374000 });
    const lines = await db
      .select()
      .from(invoiceLines)
      .where(eq(invoiceLines.invoiceId, quoteId ?? ""))
      .orderBy(invoiceLines.position);
    expect(lines[0]?.productId).toBe(productId);
    // La page du résultat : la seule pièce du lot.
    expect(result.path).toBe(`/app/quotes/${quoteId}`);
    expect(await confirmAs(p, token)).toEqual({ status: 403, body: { error: "token_used" } });
  });

  it("échec au milieu du lot à la confirmation : rien n'est écrit, pas même les opérations d'avant", async () => {
    const p = await person("sub-ada");
    const { call, lastToken } = tools(p);
    const out = await call("propose_batch", {
      operations: [
        { op: "create_contact", key: "c1", input: { name: "Client Lot SA" } },
        { op: "create_product", input: { name: "Conseil", sku: "CONS-1", unitPrice: "150" } },
        { op: "create_project", input: { contactId: "@c1", name: "Projet lot" } },
      ],
    });
    expect(out.status, JSON.stringify(out)).toBe("awaiting_user_confirmation");
    const { token } = lastToken();
    // Entre la proposition et le clic, quelqu'un crée un article avec la même référence.
    await createProduct(db, whoOf(p), {
      sku: "CONS-1",
      name: "Conseil (écran)",
      description: null,
      unit: "hour",
      unitPriceCents: 15000,
      vatCode: "normal",
    });
    const before = await fingerprint(p.organization.id);
    const res = await confirmAs(p, token);
    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/^operation 2 \(create_product\): sku_taken/);
    expect(await fingerprint(p.organization.id)).toBe(before);
    const names = (
      await db.select().from(contacts).where(eq(contacts.organizationId, p.organization.id))
    ).map((c) => c.name);
    expect(names).not.toContain("Client Lot SA");
  });

  it("échec au milieu du lot à la proposition : aucune carte, rien d'écrit", async () => {
    const p = await person("sub-ada");
    const before = await fingerprint(p.organization.id);
    const { call, state } = tools(p);
    const out = await call("propose_batch", {
      operations: [
        { op: "create_contact", input: { name: "Client Un SA" } },
        { op: "create_contact", input: { name: "Client Deux SA", email: "pas-une-adresse" } },
        { op: "create_contact", input: { name: "Client Trois SA" } },
      ],
    });
    expect(out.error).toMatch(/^operation 2 \(create_contact\): invalid/);
    expect(out.hint).toBeTruthy();
    expect(state.actions).toEqual([]);
    expect(await fingerprint(p.organization.id)).toBe(before);
  });

  it("plafond : 150 opérations en une carte, la 151e est refusée", async () => {
    const p = await person("sub-ada");
    const { call, lastToken } = tools(p);
    const make = (n: number) =>
      Array.from({ length: n }, (_, i) => ({
        op: "create_product",
        input: { name: `Article ${i + 1}`, unitPrice: String(10 + i) },
      }));
    const tooMany = await call("propose_batch", { operations: make(MAX_BATCH + 1) }).catch(
      (e: Error) => ({ error: e.message }),
    );
    expect(JSON.stringify(tooMany)).toMatch(/150|too_big|too big|invalid/i);
    const out = await call("propose_batch", { operations: make(MAX_BATCH) });
    expect(out.status).toBe("awaiting_user_confirmation");
    const { token, summary } = lastToken();
    expect(summary.count).toBe(MAX_BATCH);
    expect(summary.groups?.[0]?.items.length).toBe(5);
    const done = await confirmAs(p, token);
    expect(done.status).toBe(200);
    const [n] = await db
      .select({ n: count() })
      .from(products)
      .where(eq(products.organizationId, p.organization.id));
    expect(n?.n).toBe(MAX_BATCH);
  });

  it("refuse les clés en double, une référence du mauvais type et la lecture par l'IA dans un lot", async () => {
    const p = await person("sub-ada");
    const { call } = tools(p);
    const dup = await call("propose_batch", {
      operations: [
        { op: "create_contact", key: "a", input: { name: "Un SA" } },
        { op: "create_contact", key: "a", input: { name: "Deux SA" } },
      ],
    });
    expect(dup.error).toMatch(/duplicate_key a/);
    const kind = await call("propose_batch", {
      operations: [
        { op: "create_product", key: "x", input: { name: "Article", unitPrice: "10" } },
        { op: "create_project", input: { contactId: "@x", name: "Projet" } },
      ],
    });
    expect(kind.error).toMatch(/ref_kind @x/);
    const read = await call("propose_batch", {
      operations: [
        { op: "read_receipt", input: { receiptId: "00000000-0000-0000-0000-000000000000" } },
      ],
    }).catch((e: Error) => ({ error: e.message }));
    expect(JSON.stringify(read)).toMatch(/read_receipt|invalid/);
  });
});

describe("lot : l'entreprise relue après un réglage (A2)", () => {
  it("deux réglages de l'entreprise dans un même lot s'ajoutent, le second n'efface pas le premier", async () => {
    let p = await person("sub-ada");
    await completeCompany(p);
    p = await refresh(p);
    const { call, lastToken } = tools(p);
    const out = await call("propose_batch", {
      operations: [
        { op: "update_reminder_settings", input: { fee: "20" } },
        { op: "update_reminder_settings", input: { interestPercent: 5 } },
        { op: "update_company_settings", input: { phone: "+41 21 000 00 00" } },
        { op: "update_company_settings", input: { website: "https://atelier.example" } },
      ],
    });
    expect(out.status, JSON.stringify(out)).toBe("awaiting_user_confirmation");
    const done = await confirmAs(p, lastToken().token);
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    const o = await one(
      db.select().from(organizations).where(eq(organizations.id, p.organization.id)),
    );
    expect(o).toMatchObject({
      reminderFeeCents: 2000,
      lateInterestBp: 500,
      phone: "+41 21 000 00 00",
      website: "https://atelier.example",
    });
  });
});

describe("interdits au bord des actions permises (A7)", () => {
  it("une récurrence qui s'envoie par e-mail ne reprend pas depuis la bulle ; la pause reste permise", async () => {
    const p = await person("sub-ada");
    await completeCompany(p);
    const i = await issued(p, (await customer(p)).id);
    const rec = await createRecurring(db, whoOf(p), i.id, {
      intervalMonths: 1,
      nextDate: "2026-11-01",
      autoSend: true,
    });
    if (typeof rec === "string") throw new Error(rec);
    const { call, state, lastToken } = tools(await refresh(p));
    // Pause : permise, rien n'est envoyé.
    const pause = await call("propose_set_recurring_status", {
      recurringId: rec.id,
      active: false,
    });
    expect(pause.status, JSON.stringify(pause)).toBe("awaiting_user_confirmation");
    expect((await confirmAs(p, lastToken().token)).status).toBe(200);
    // Reprise d'une récurrence à envoi automatique : refusée, aucune carte, rien d'écrit.
    const before = await fingerprint(p.organization.id);
    const cards = state.actions.length;
    const resume = await call("propose_set_recurring_status", {
      recurringId: rec.id,
      active: true,
    });
    expect(resume.error).toBe("auto_send_on_screen");
    expect(resume.hint).toMatch(/recurring/);
    expect(state.actions).toHaveLength(cards);
    const batch = await call("propose_batch", {
      operations: [{ op: "set_recurring_status", input: { recurringId: rec.id, active: true } }],
    });
    expect(batch.error).toMatch(/auto_send_on_screen/);
    expect(state.actions).toHaveLength(cards);
    expect(await fingerprint(p.organization.id)).toBe(before);
    const [row] = await db.select().from(recurringInvoices).where(eq(recurringInvoices.id, rec.id));
    expect(row).toMatchObject({ active: false, autoSend: true });
  });

  it("une facture reçue par la plateforme ne s'approuve pas depuis la bulle (l'acceptation lui repart)", async () => {
    const p = await person("sub-ada");
    await books(p);
    const expense = (await listAccounts(db, p.organization.id)).find((a) => a.number === "4400");
    if (!expense) throw new Error("compte 4400");
    const b = await createBill(db, whoOf(p), {
      supplierName: "Fournisseur Plateforme TEST",
      supplierStreet: null,
      supplierPostalCode: null,
      supplierTown: null,
      supplierCountry: null,
      iban: null,
      bic: null,
      paymentReference: null,
      number: "PA-1",
      issueDate: "2026-10-01",
      dueDate: "2026-10-31",
      currency: "CHF",
      totalCents: 12000,
      vatCode: null,
      accountId: expense.id,
      description: null,
    });
    await db
      .update(supplierBills)
      .set({ platformRef: "pa-test-1" })
      .where(eq(supplierBills.id, b.id));
    const before = await fingerprint(p.organization.id);
    const { call, state } = tools(p);
    const out = await call("propose_approve_supplier_bill", { billId: b.id });
    expect(out.error).toBe("platform_bill_on_screen");
    expect(out.hint).toMatch(/platform/);
    const batch = await call("propose_batch", {
      operations: [{ op: "approve_supplier_bill", input: { billId: b.id } }],
    });
    expect(batch.error).toMatch(/platform_bill_on_screen/);
    expect(state.actions).toEqual([]);
    expect(await fingerprint(p.organization.id)).toBe(before);
    const [row] = await db.select().from(supplierBills).where(eq(supplierBills.id, b.id));
    expect(row?.status).toBe("draft");
  });

  it("plan comptable : désactiver un compte est refusé (comme archiver), le libellé suit la langue", async () => {
    const p = await person("sub-ada");
    await books(p);
    const a = (await listAccounts(db, p.organization.id)).find((x) => x.number === "6500");
    if (!a) throw new Error("compte 6500");
    expect(a.nameFr).not.toBe(a.nameDe);
    const before = await fingerprint(p.organization.id);
    const { call, state, lastToken } = tools(p);
    await expect(
      call("propose_update_account", { accountId: a.id, active: false }),
    ).rejects.toThrow();
    const batch = await call("propose_batch", {
      operations: [{ op: "update_account", input: { accountId: a.id, active: false } }],
    });
    expect(batch.error).toMatch(/^operation 1 \(update_account\): invalid_input/);
    expect(state.actions).toEqual([]);
    expect(await fingerprint(p.organization.id)).toBe(before);
    // Une modification permise : la carte et le résultat nomment le compte en français (langue de
    // la session), jamais avec le libellé allemand.
    const out = await call("propose_update_account", { accountId: a.id, nameEn: "Admin TEST" });
    expect(out.status, JSON.stringify(out)).toBe("awaiting_user_confirmation");
    const { token, summary } = lastToken();
    expect(summary.fields[0]).toMatchObject({ key: "account", value: `6500 ${a.nameFr}` });
    const done = await confirmAs(p, token);
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    expect((done.body.result as Applied).label).toBe(`6500 ${a.nameFr}`);
  });

  it("consigne d'une demande interdite : le dire, dire où le faire et ouvrir l'écran, même si la personne y est déjà (A4 d)", () => {
    // Sur la page du devis, « supprime ce devis » doit aussi donner le lien de l'écran dans le fil :
    // sans cette précision, le modèle jugeait l'ouverture inutile (essai réel du 29.10.2026, G5).
    expect(STABLE_PROMPT).toContain("saying plainly that you cannot do it yourself");
    expect(STABLE_PROMPT).toContain("explain in one or two sentences where the user does it");
    expect(STABLE_PROMPT).toContain(
      "always open that page with open_page, even when the user is already on it",
    );
  });
});

describe("droits : les mêmes que les actions des écrans", () => {
  async function asRole(appRole: string) {
    const admin = await person("sub-ada");
    const p = await person("sub-bea", "org-atelier", "user");
    await db
      .update(memberships)
      .set({ appRole })
      .where(
        and(eq(memberships.userId, p.user.id), eq(memberships.organizationId, p.organization.id)),
      );
    return { admin, p: await refresh(p) };
  }

  it("lecture seule : aucune proposition, et la consigne le dit", async () => {
    const { p } = await asRole("readonly");
    const { call, state } = tools(p);
    const attempts: [string, Record<string, unknown>][] = [
      ["propose_create_contact", { name: "X SA" }],
      ["propose_create_expense_claim", { description: "Taxi", amount: "20" }],
      ["propose_create_supplier_bill", { supplierName: "X", issueDate: TODAY, total: "10" }],
    ];
    for (const [op, input] of attempts)
      expect(await call(op, input)).toMatchObject({ error: "forbidden_role" });
    expect(state.actions).toEqual([]);
  });

  it("comptabilité seule : fournisseurs et notes de frais oui, devis et contacts non", async () => {
    const { p } = await asRole("accounting");
    const { call } = tools(p);
    expect(await call("propose_create_contact", { name: "X SA" })).toMatchObject({
      error: "forbidden_role",
    });
    expect(
      (
        await call("propose_create_supplier_bill", {
          supplierName: "Fournisseur SA",
          issueDate: TODAY,
          total: "10",
        })
      ).status,
    ).toBe("awaiting_user_confirmation");
    expect(
      (await call("propose_create_expense_claim", { description: "Taxi", amount: "20" })).status,
    ).toBe("awaiting_user_confirmation");
    expect(
      await call("propose_update_company_settings", { phone: "+41 21 000 00 00" }),
    ).toMatchObject({
      error: "forbidden_role",
    });
  });

  it("un lot dont une opération n'est plus permise au moment du clic : 403, rien d'écrit, jeton gardé", async () => {
    const admin = await person("sub-ada");
    const { call, lastToken } = tools(admin);
    await call("propose_batch", {
      operations: [
        { op: "create_contact", input: { name: "Client Droit SA" } },
        {
          op: "create_supplier_bill",
          input: { supplierName: "Fournisseur SA", issueDate: TODAY, total: "10" },
        },
      ],
    });
    const { token } = lastToken();
    await db
      .update(memberships)
      .set({ role: "user", appRole: "billing" })
      .where(eq(memberships.userId, admin.user.id));
    const before = await fingerprint(admin.organization.id);
    const res = await confirmAs(await refresh(admin), token);
    expect(res).toEqual({ status: 403, body: { error: "forbidden_role" } });
    expect(await fingerprint(admin.organization.id)).toBe(before);
    const [used] = await db.select({ n: count() }).from(sql`assistant_confirmations`);
    expect(used?.n).toBe(0);
  });
});

describe("effets extérieurs différés (CRMlead)", () => {
  it("devis relié à CRMlead : rien en file ni envoyé à la proposition, envoyé après la validation", async () => {
    let p = await person("sub-ada");
    await completeCompany(p);
    await db
      .update(organizations)
      .set({ leadOrg: "org_lead_atelier" })
      .where(eq(organizations.id, p.organization.id));
    const c = await customer(p);
    const quote = await issued(p, c.id, "quote");
    await db
      .update(invoices)
      .set({ crmleadLeadId: "0b8f8c1e-7a0e-4a43-9a31-3b1b3a7b1c22" })
      .where(eq(invoices.id, quote.id));
    // L'émission du devis (avant) a pu mettre un état en file : on part d'une file vide.
    await db.delete(crmleadOutbox).where(eq(crmleadOutbox.organizationId, p.organization.id));
    sync.scheduled = [];
    p = await refresh(p);
    const { call, lastToken } = tools(p);
    const out = await call("propose_set_quote_outcome", { quoteId: quote.id, outcome: "accepted" });
    expect(out.status).toBe("awaiting_user_confirmation");
    const queued = () =>
      db.select().from(crmleadOutbox).where(eq(crmleadOutbox.organizationId, p.organization.id));
    expect(await queued()).toEqual([]);
    expect(sync.scheduled).toEqual([]);
    const done = await confirmAs(p, lastToken().token);
    expect(done.status).toBe(200);
    expect((await queued()).length).toBe(1);
    expect(sync.scheduled).toEqual([p.organization.id]);
  });

  it("émettre : la pièce est comptabilisée après la validation, comme l'action « Émettre »", async () => {
    let p = await person("sub-ada");
    await completeCompany(p);
    await books(p);
    const d = await draft(p, (await customer(p)).id);
    p = await refresh(p);
    const { call, lastToken } = tools(p);
    expect((await call("propose_issue_document", { documentId: d.id })).status).toBe(
      "awaiting_user_confirmation",
    );
    const [notYet] = await db.select().from(invoices).where(eq(invoices.id, d.id));
    expect(notYet).toMatchObject({ status: "draft", journalEntryId: null });
    expect((await confirmAs(p, lastToken().token)).status).toBe(200);
    const [after] = await db.select().from(invoices).where(eq(invoices.id, d.id));
    expect(after?.status).toBe("issued");
    expect(after?.journalEntryId).not.toBeNull();
  });
});

describe("lecture d'un justificatif par l'IA (hors lot, hors transaction)", () => {
  it("propose sans lire, lit au clic, refusée dans un lot", async () => {
    const p = await person("sub-ada");
    const pdf = await samplePdf([
      "Imprimerie TEST SA",
      "Facture F-81 du 03.10.2026",
      "Total CHF 64.80",
    ]);
    const { uploadReceipt } = await import("@/server/receipts");
    const rc = await uploadReceipt(db, whoOf(p), {
      name: "f81.pdf",
      type: "application/pdf",
      bytes: pdf,
    });
    if (typeof rc === "string") throw new Error(rc);
    const fetches: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        fetches.push(String(url));
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    supplier: "Imprimerie TEST SA",
                    date: "2026-10-03",
                    totalCents: 6480,
                    currency: "CHF",
                    invoiceNumber: "F-81",
                    confidence: 0.9,
                  }),
                },
              },
            ],
          }),
        );
      }),
    );
    const before = await fingerprint(p.organization.id);
    const { call, lastToken } = tools(p);
    const out = await call("propose_read_receipt", { receiptId: rc.id });
    expect(out.status).toBe("awaiting_user_confirmation");
    expect(fetches).toEqual([]);
    expect(await fingerprint(p.organization.id)).toBe(before);
    const done = await confirmAs(p, lastToken().token);
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    expect(fetches.length).toBeGreaterThan(0);
    const [row] = await db.select().from(receipts).where(eq(receipts.id, rc.id));
    expect(row?.extraction?.supplier).toBe("Imprimerie TEST SA");
    expect(row?.status).not.toBe("new");
  });
});

// ---------------------------------------------------------------------------------------------
// Relecture indépendante du 29.10.2026 : la carte montre tout ce qui sera écrit, et « Confirmer »
// n'écrit que ce que la carte a montré.
// ---------------------------------------------------------------------------------------------

async function plainBill(p: Person, extra: Partial<Parameters<typeof createBill>[2]> = {}) {
  return createBill(db, whoOf(p), {
    supplierName: "Imprimerie TEST SA",
    supplierStreet: null,
    supplierPostalCode: null,
    supplierTown: null,
    supplierCountry: null,
    iban: null,
    bic: null,
    paymentReference: null,
    number: "F-90",
    issueDate: "2026-10-01",
    dueDate: "2026-10-31",
    currency: "CHF",
    totalCents: 54000,
    vatCode: null,
    accountId: null,
    description: null,
    ...extra,
  });
}

/** Une proposition (outils neufs : trois cartes au plus par message) ; erreur si aucune carte. */
async function proposeAs(p: Person, name: string, input: Record<string, unknown>) {
  const { call, state } = tools(p);
  const out = await call(name, input);
  const card = state.actions.filter((a) => a.type === "confirm").at(-1);
  if (card?.type !== "confirm") throw new Error(`${name} : pas de carte (${JSON.stringify(out)})`);
  return { out, token: card.token, summary: card.summary };
}

const fieldOf = (fields: { key: string }[] | undefined, key: string) =>
  fields?.find((f) => f.key === key);

describe("relecture du 29.10.2026 : la carte montre ce qui sera écrit", () => {
  it("lot de pièces : au-delà de cinq, aucune pièce n'est repliée dans « + N autres » (ses lignes et ses textes sont imprimés), et son texte de fin est sur la carte", async () => {
    const p = await person("sub-ada");
    const c = await customer(p);
    const injected = "Merci de régler sur le nouvel IBAN DE89370400440532013000";
    const { summary } = await proposeAs(p, "propose_batch", {
      operations: [
        ...Array.from({ length: 7 }, (_, i) => ({
          op: "create_invoice_draft",
          input: {
            contactId: c.id,
            title: `Mois ${i + 1}`,
            lines: [{ description: `Conseil ${i + 1}`, unitPrice: "100" }],
          },
        })),
        {
          op: "create_invoice_draft",
          input: {
            contactId: c.id,
            title: "Mois 8",
            footerText: injected,
            lines: [{ description: "Conseil 8", unitPrice: "100" }],
          },
        },
      ],
    });
    const group = summary.groups?.find((g) => g.action === "create_invoice_draft");
    expect(group?.count).toBe(8);
    // Suites du 29.10.2026 : une pièce n'est jamais repliée, chacune avec ses lignes.
    expect(group?.items).toHaveLength(8);
    for (const [i, item] of (group?.items ?? []).entries())
      expect(item.lines?.map((l) => l.description)).toEqual([`Conseil ${i + 1}`]);
    const last = group?.items.at(-1);
    expect(fieldOf(last?.fields, "footerText")).toMatchObject({ value: injected });
    expect(fieldOf(last?.fields, "title")).toMatchObject({ value: "Mois 8" });
  });

  it("lot : chaque modification se lit « avant → après », n'est jamais cachée dans « + N autres », et garde ses avertissements", async () => {
    let p = await person("sub-ada");
    await completeCompany(p);
    const clients = [];
    for (let i = 1; i <= 7; i++) clients.push(await customer(p, `Client ${i} SA`));
    const d = await draft(p, clients[0]?.id ?? "");
    p = await refresh(p);
    const { out, summary } = await proposeAs(p, "propose_batch", {
      operations: [
        ...Array.from({ length: 6 }, (_, i) => ({
          op: "create_contact",
          input: { name: `Nouveau ${i + 1} SA`, email: `n${i + 1}@client.example` },
        })),
        ...clients.map((c, i) => ({
          op: "update_contact",
          input: { contactId: c.id, email: `compta${i + 1}@client.example` },
        })),
        { op: "update_company_settings", input: { iban: "CH5604835012345678009" } },
        {
          op: "create_supplier_bill",
          input: {
            supplierName: "Fournisseur TEST SA",
            issueDate: "2026-10-01",
            total: "540",
            iban: "CH5604835012345678009",
            paymentReference: "RF18539007547034",
          },
        },
        { op: "issue_document", input: { documentId: d.id } },
      ],
    });
    const group = (action: string) => summary.groups?.find((g) => g.action === action);
    // Créations avec une adresse e-mail (où partiront les envois) : jamais repliées (suites du
    // 29.10.2026), chacune avec ce qu'elle écrit.
    expect(group("create_contact")?.count).toBe(6);
    expect(group("create_contact")?.items).toHaveLength(6);
    expect(fieldOf(group("create_contact")?.items[5]?.fields, "email")).toMatchObject({
      value: "n6@client.example",
    });
    // Modifications : toutes montrées, chacune « avant → après ».
    const updates = group("update_contact");
    expect(updates?.count).toBe(7);
    expect(updates?.items).toHaveLength(7);
    for (const [i, item] of (updates?.items ?? []).entries())
      expect(fieldOf(item.fields, "email")).toEqual({
        key: "email",
        before: "",
        value: `compta${i + 1}@client.example`,
      });
    expect(
      fieldOf(group("update_company_settings")?.items[0]?.fields, "company.iban"),
    ).toMatchObject({ before: "CH9300762011623852957", value: "CH5604835012345678009" });
    // La facture fournisseur montre où ira le paiement.
    const bill = group("create_supplier_bill")?.items[0];
    expect(fieldOf(bill?.fields, "iban")).toMatchObject({ value: "CH5604835012345678009" });
    expect(fieldOf(bill?.fields, "paymentReference")).toMatchObject({
      value: "RF18539007547034",
    });
    // Avertissements de chaque opération, sous l'opération (ou le groupe) qu'ils concernent.
    const allNotes = (summary.groups ?? []).flatMap((g) => [
      ...(g.notes ?? []),
      ...g.items.flatMap((i) => i.notes ?? []),
    ]);
    expect(allNotes).toEqual(expect.arrayContaining(["checkBankDetails", "issueFinal"]));
    expect(group("issue_document")?.notes).toEqual(expect.arrayContaining(["issueFinal"]));
    expect(summary.notes).toBeUndefined();
    // Le modèle lit aussi ces changements, pour les dire.
    expect(JSON.stringify(out.summary)).toContain("CH5604835012345678009");
    expect(JSON.stringify(out.summary)).toContain("compta7@client.example");
  });

  it("émettre avec les relances automatiques : refusé si la facture est déjà échue (une relance partirait au prochain passage) ; sinon la carte le dit, sans « rien n'est envoyé »", async () => {
    let p = await person("sub-ada");
    await completeCompany(p, { reminderAuto: true });
    const c = await customer(p);
    await db.update(contacts).set({ email: "compta@client.example" }).where(eq(contacts.id, c.id));
    const late = await draft(p, c.id, { issueDate: "2026-09-01" });
    p = await refresh(p);
    const before = await fingerprint(p.organization.id);
    const { call, state } = tools(p);
    const refused = await call("propose_issue_document", { documentId: late.id });
    expect(refused.error).toBe("auto_reminder_on_screen");
    expect(refused.hint).toMatch(/reminder/);
    const batch = await call("propose_batch", {
      operations: [
        {
          op: "create_invoice_draft",
          key: "d1",
          input: {
            contactId: c.id,
            issueDate: "2026-09-01",
            lines: [{ description: "Septembre", unitPrice: "1000" }],
          },
        },
        { op: "issue_document", input: { documentId: "@d1" } },
      ],
    });
    expect(batch.error).toMatch(/^operation 2 \(issue_document\): auto_reminder_on_screen/);
    expect(state.actions).toEqual([]);
    expect(await fingerprint(p.organization.id)).toBe(before);
    // Échéance à venir : rien ne part maintenant, la carte dit que les relances suivront.
    const current = await draft(p, c.id, { issueDate: TODAY });
    const ok = await proposeAs(p, "propose_issue_document", { documentId: current.id });
    expect(ok.summary.notes).toEqual(expect.arrayContaining(["issueFinal", "autoReminders"]));
    expect(ok.summary.notes).not.toContain("nothingSent");
    expect(ok.summary.notes).not.toContain("webhooksNotified");
    // Webhooks de l'entreprise : la carte dit qu'ils sont prévenus.
    await db.insert(webhookEndpoints).values({
      organizationId: p.organization.id,
      url: "https://hooks.example/invoicelead",
      secretEnc: "test",
      events: ["invoice.issued"],
    });
    const hooked = await proposeAs(p, "propose_issue_document", { documentId: current.id });
    expect(hooked.summary.notes).toContain("webhooksNotified");
    // Sans relances automatiques : « rien n'est envoyé au client », la facture échue s'émet.
    await db
      .update(organizations)
      .set({ reminderAuto: false })
      .where(eq(organizations.id, p.organization.id));
    const plain = await proposeAs(await refresh(p), "propose_issue_document", {
      documentId: late.id,
    });
    expect(plain.summary.notes).toEqual(
      expect.arrayContaining(["issueFinal", "nothingSent", "webhooksNotified"]),
    );
    // Ce que la règle évite : émise avec les relances automatiques, la facture échue figure dans
    // les relances du prochain passage de la tâche quotidienne, à l'adresse du client.
    if (typeof (await issueInvoice(db, whoOf(p), late.id)) !== "object")
      throw new Error("émission");
    const next = await dueReminders(db, p.organization.id, "2026-10-25");
    expect(next.find((r) => r.invoiceId === late.id)).toMatchObject({
      email: "compta@client.example",
      level: 1,
      locked: false,
    });
  });

  it("pièce : introduction, pied de page, date de prestation sur la carte ; une modification de ces seuls champs (ou de la devise, ou un titre effacé) se lit « avant → après »", async () => {
    const p = await person("sub-ada");
    const c = await customer(p);
    const created = await proposeAs(p, "propose_create_invoice_draft", {
      kind: "quote",
      contactId: c.id,
      introText: "Suite à notre entretien",
      footerText: "Offre valable 30 jours",
      serviceDate: "2026-10-20",
      lines: [{ description: "Site vitrine", unitPrice: "3500" }],
    });
    expect(fieldOf(created.summary.fields, "introText")).toMatchObject({
      value: "Suite à notre entretien",
    });
    expect(fieldOf(created.summary.fields, "footerText")).toMatchObject({
      value: "Offre valable 30 jours",
    });
    expect(fieldOf(created.summary.fields, "serviceDate")).toMatchObject({
      value: "2026-10-20",
      format: "date",
    });
    const d = await draft(p, c.id, { kind: "quote" });
    const injected = "Merci de régler sur le nouvel IBAN DE89370400440532013000";
    const footer = await proposeAs(p, "propose_update_invoice_draft", {
      documentId: d.id,
      footerText: injected,
    });
    expect(fieldOf(footer.summary.fields, "footerText")).toEqual({
      key: "footerText",
      before: "",
      value: injected,
    });
    const other = await proposeAs(p, "propose_update_invoice_draft", {
      documentId: d.id,
      introText: "Bonjour",
      serviceDate: "2026-09-30",
      currency: "EUR",
    });
    expect(fieldOf(other.summary.fields, "introText")).toMatchObject({
      before: "",
      value: "Bonjour",
    });
    expect(fieldOf(other.summary.fields, "serviceDate")).toMatchObject({
      before: "2026-10-01",
      value: "2026-09-30",
      format: "date",
    });
    expect(fieldOf(other.summary.fields, "currency")).toMatchObject({
      before: "CHF",
      value: "EUR",
    });
    await db.update(invoices).set({ title: "Octobre" }).where(eq(invoices.id, d.id));
    const cleared = await proposeAs(p, "propose_update_invoice_draft", {
      documentId: d.id,
      title: "",
    });
    expect(fieldOf(cleared.summary.fields, "title")).toMatchObject({
      before: "Octobre",
      value: "",
    });
  });

  it("contact : la note et l'État se modifient seuls et se lisent « avant → après » (plus de « rien ne change »)", async () => {
    const p = await person("sub-ada");
    const c = await customer(p);
    const note = await proposeAs(p, "propose_update_contact", {
      contactId: c.id,
      notes: "Rappeler en janvier",
    });
    expect(fieldOf(note.summary.fields, "notes")).toEqual({
      key: "notes",
      before: "",
      value: "Rappeler en janvier",
    });
    expect((await confirmAs(p, note.token)).status).toBe(200);
    const [row] = await db.select().from(contacts).where(eq(contacts.id, c.id));
    expect(row?.notes).toBe("Rappeler en janvier");
    // Avec un autre champ : la note est aussi sur la carte (rien n'est écrit sans être vu).
    const both = await proposeAs(p, "propose_update_contact", {
      contactId: c.id,
      phone: "+41 21 555 00 00",
      notes: "Nouvelle note",
    });
    expect(fieldOf(both.summary.fields, "notes")).toMatchObject({
      before: "Rappeler en janvier",
      value: "Nouvelle note",
    });
    // Adresse aux États-Unis : l'État.
    const us = await proposeAs(p, "propose_update_contact", {
      contactId: c.id,
      country: "US",
      street: "Main Street",
      buildingNumber: "100",
      postalCode: "78701",
      town: "Austin",
      region: "TX",
    });
    expect(fieldOf(us.summary.fields, "region")).toMatchObject({ before: "", value: "TX" });
    // Création : la note est montrée.
    const created = await proposeAs(p, "propose_create_contact", {
      name: "Nouveau Client SA",
      notes: "Client venu du salon",
    });
    expect(fieldOf(created.summary.fields, "notes")).toMatchObject({
      value: "Client venu du salon",
    });
  });

  it("facture fournisseur : référence de paiement, BIC, adresse et devise du fournisseur se lisent « avant → après »", async () => {
    const p = await person("sub-ada");
    const b = await plainBill(p);
    const cases: [Record<string, unknown>, string, string, string][] = [
      [{ paymentReference: "RF18539007547034" }, "paymentReference", "", "RF18539007547034"],
      [{ bic: "POFICHBEXXX" }, "bic", "", "POFICHBEXXX"],
      [
        { supplierStreet: "Rue du Lac 1", supplierPostalCode: "1000", supplierTown: "Lausanne" },
        "supplierAddress",
        "",
        "Rue du Lac 1, 1000 Lausanne",
      ],
      [{ supplierCountry: "DE" }, "supplierCountry", "", "DE"],
      [{ currency: "EUR" }, "currency", "CHF", "EUR"],
    ];
    for (const [input, key, before, value] of cases) {
      const { summary } = await proposeAs(p, "propose_update_supplier_bill", {
        billId: b.id,
        ...input,
      });
      expect(fieldOf(summary.fields, key), key).toMatchObject({ before, value });
    }
    // Création : la référence de paiement et le BIC sont montrés avec l'IBAN.
    const created = await proposeAs(p, "propose_create_supplier_bill", {
      supplierName: "Fournisseur TEST SA",
      issueDate: "2026-10-01",
      total: "100",
      iban: "CH5604835012345678009",
      bic: "POFICHBEXXX",
      paymentReference: "RF18539007547034",
    });
    for (const key of ["iban", "bic", "paymentReference"])
      expect(fieldOf(created.summary.fields, key), key).toBeTruthy();
  });

  it("réglages de l'entreprise : changer de pays montre aussi la devise qui suit ; une raison sociale vide remplie depuis le nom est montrée", async () => {
    let p = await person("sub-ada");
    await completeCompany(p, { legalName: null });
    p = await refresh(p);
    const phone = await proposeAs(p, "propose_update_company_settings", {
      phone: "+41 21 000 00 00",
    });
    expect(fieldOf(phone.summary.fields, "company.legalName")).toMatchObject({
      before: "",
      value: p.organization.name,
    });
    const de = await proposeAs(p, "propose_update_company_settings", {
      country: "DE",
      street: "Hauptstraße",
      postalCode: "10115",
      town: "Berlin",
      taxNumber: "12/345/67890",
    });
    expect(fieldOf(de.summary.fields, "company.country")).toMatchObject({
      before: "CH",
      value: "DE",
    });
    expect(fieldOf(de.summary.fields, "company.currency")).toMatchObject({
      before: "CHF",
      value: "EUR",
    });
  });

  it("« Confirmer » refusé (409) si ce que la carte montrait a changé depuis : pièce modifiée, IBAN du fournisseur changé, contact d'un lot renommé ; rien d'écrit ; le chrono suit l'heure du clic", async () => {
    let p = await person("sub-ada");
    await completeCompany(p);
    await books(p);
    const c = await customer(p);
    const d = await draft(p, c.id);
    p = await refresh(p);
    const issue = await proposeAs(p, "propose_issue_document", { documentId: d.id });
    // Pendant les dix minutes, la pièce est modifiée à l'écran : 12'000 au lieu de 1'000.
    const changed = parseInvoiceForm(
      form({
        contactId: c.id,
        language: "fr",
        issueDate: "2026-10-01",
        "line.description": ["Conseil"],
        "line.quantity": ["1"],
        "line.unit": ["flat"],
        "line.unitPrice": ["12000"],
        "line.vatCode": ["normal"],
        "line.productId": [""],
      }),
      { vatRegistered: false },
    );
    if (!changed.ok) throw new Error("pièce");
    await updateInvoice(db, whoOf(p), d.id, changed.data, "invoice");
    let before = await fingerprint(p.organization.id);
    expect(await confirmAs(p, issue.token)).toEqual({ status: 409, body: { error: "stale" } });
    expect(await fingerprint(p.organization.id)).toBe(before);
    expect(await one(db.select().from(invoices).where(eq(invoices.id, d.id)))).toMatchObject({
      status: "draft",
      number: null,
    });
    // Facture fournisseur dont l'IBAN change avant l'approbation.
    const expense = (await listAccounts(db, p.organization.id)).find((a) => a.number === "4400");
    const b = await plainBill(p, { accountId: expense?.id ?? null, iban: "CH9300762011623852957" });
    const approve = await proposeAs(p, "propose_approve_supplier_bill", { billId: b.id });
    await db
      .update(supplierBills)
      .set({ iban: "CH5604835012345678009" })
      .where(eq(supplierBills.id, b.id));
    before = await fingerprint(p.organization.id);
    expect(await confirmAs(p, approve.token)).toEqual({ status: 409, body: { error: "stale" } });
    expect(await fingerprint(p.organization.id)).toBe(before);
    // Rien n'a changé depuis la nouvelle carte : la confirmation passe.
    const again = await proposeAs(p, "propose_approve_supplier_bill", { billId: b.id });
    expect((await confirmAs(p, again.token)).status).toBe(200);
    // Lot : un contact renommé à l'écran entre la carte et le clic.
    const lot = await proposeAs(p, "propose_batch", {
      operations: [
        { op: "update_contact", input: { contactId: c.id, email: "lot@client.example" } },
        { op: "create_product", input: { name: "Conseil", unitPrice: "150" } },
      ],
    });
    await db.update(contacts).set({ name: "Client Renommé SA" }).where(eq(contacts.id, c.id));
    before = await fingerprint(p.organization.id);
    expect(await confirmAs(p, lot.token)).toEqual({ status: 409, body: { error: "stale" } });
    expect(await fingerprint(p.organization.id)).toBe(before);
    // Chrono : la durée suit l'heure du clic, ce n'est pas un changement des données.
    const pr = await project(p, c.id);
    await startTimer(db, whoOf(p), pr.id, null, new Date(Date.now() - 30 * 60_000));
    const stop = await proposeAs(p, "propose_stop_timer", {});
    await db
      .update(timeEntries)
      .set({ startedAt: new Date(Date.now() - 45 * 60_000) })
      .where(
        and(
          eq(timeEntries.organizationId, p.organization.id),
          sql`${timeEntries.startedAt} is not null`,
        ),
      );
    const stopped = await confirmAs(p, stop.token);
    expect(stopped.status, JSON.stringify(stopped.body)).toBe(200);
    const entry = await one(
      db
        .select()
        .from(timeEntries)
        .where(eq(timeEntries.id, (stopped.body.result as Applied).id)),
    );
    expect(entry.minutes).toBeGreaterThanOrEqual(44);
  });
});

describe("suites du 29.10.2026 (contre-vérification) : relances, carte d'un lot", () => {
  /** Entreprise Pro avec relances automatiques, client SANS adresse e-mail, facture du 01.09 (échue le 01.10). */
  async function lateWithoutEmail() {
    let p = await person("sub-ada");
    await completeCompany(p, { reminderAuto: true });
    const c = await customer(p);
    const late = await draft(p, c.id, { issueDate: "2026-09-01" });
    p = await refresh(p);
    return { p, c, late };
  }

  it("relances automatiques : émettre puis donner une adresse e-mail au client, dans un même lot, est refusé (l'ordre du lot ne contourne plus le refus)", async () => {
    const { p, c, late } = await lateWithoutEmail();
    const before = await fingerprint(p.organization.id);
    const { call, state } = tools(p);
    const issueThenMail = await call("propose_batch", {
      operations: [
        { op: "issue_document", input: { documentId: late.id } },
        { op: "update_contact", input: { contactId: c.id, email: "compta@client.example" } },
      ],
    });
    expect(issueThenMail.error).toMatch(/^operation 1 \(issue_document\): auto_reminder_on_screen/);
    expect(issueThenMail.hint).toMatch(/whatever the order/);
    const mailThenIssue = await call("propose_batch", {
      operations: [
        { op: "update_contact", input: { contactId: c.id, email: "compta@client.example" } },
        { op: "issue_document", input: { documentId: late.id } },
      ],
    });
    expect(mailThenIssue.error).toMatch(/auto_reminder_on_screen/);
    expect(state.actions).toEqual([]);
    expect(await fingerprint(p.organization.id)).toBe(before);
    // Sans adresse e-mail, aucune relance ne peut partir : l'émission seule reste possible.
    const alone = await proposeAs(p, "propose_issue_document", { documentId: late.id });
    expect(alone.summary.notes).toEqual(expect.arrayContaining(["issueFinal", "autoReminders"]));
    // L'adresse arrive à l'écran entre la carte et le clic : « Confirmer » refuse, rien n'est écrit.
    await db.update(contacts).set({ email: "compta@client.example" }).where(eq(contacts.id, c.id));
    const mid = await fingerprint(p.organization.id);
    const done = await confirmAs(p, alone.token);
    expect(done.status).toBe(422);
    expect(done.body.error).toBe("auto_reminder_on_screen");
    expect(await fingerprint(p.organization.id)).toBe(mid);
    const [row] = await db.select().from(invoices).where(eq(invoices.id, late.id));
    expect(row?.status).toBe("draft");
  });

  it("relances automatiques : donner sa première adresse e-mail à un client qui a une facture émise échue est refusé (la relance partirait au prochain passage) ; changer une adresse existante ou sans relances automatiques reste possible", async () => {
    const { p, c, late } = await lateWithoutEmail();
    if (typeof (await issueInvoice(db, whoOf(p), late.id)) !== "object")
      throw new Error("émission");
    // Ce que la règle évite : avec l'adresse, la facture figure dans les relances du lendemain.
    expect(
      (await dueReminders(db, p.organization.id, "2026-10-25")).find(
        (r) => r.invoiceId === late.id,
      ),
    ).toMatchObject({ email: null, level: 1 });
    const before = await fingerprint(p.organization.id);
    const { call, state } = tools(p);
    const refused = await call("propose_update_contact", {
      contactId: c.id,
      email: "compta@client.example",
    });
    expect(refused.error).toBe("auto_reminder_on_screen");
    expect(refused.hint).toMatch(/contact page/);
    const inBatch = await call("propose_batch", {
      operations: [
        { op: "create_contact", input: { name: "Autre SA" } },
        { op: "update_contact", input: { contactId: c.id, email: "compta@client.example" } },
      ],
    });
    expect(inBatch.error).toMatch(/^operation 2 \(update_contact\): auto_reminder_on_screen/);
    expect(state.actions).toEqual([]);
    expect(await fingerprint(p.organization.id)).toBe(before);
    // Une autre modification du même client (sans adresse) reste possible.
    await proposeAs(p, "propose_update_contact", { contactId: c.id, phone: "+41 21 000 00 00" });
    // Une adresse déjà là : la relance partait déjà, seule l'adresse change (avant → après).
    await db.update(contacts).set({ email: "old@client.example" }).where(eq(contacts.id, c.id));
    const changed = await proposeAs(p, "propose_update_contact", {
      contactId: c.id,
      email: "compta@client.example",
    });
    expect(fieldOf(changed.summary.fields, "email")).toMatchObject({
      before: "old@client.example",
      value: "compta@client.example",
    });
    // Sans relances automatiques : la carte est proposée.
    await db.update(contacts).set({ email: null }).where(eq(contacts.id, c.id));
    await db
      .update(organizations)
      .set({ reminderAuto: false })
      .where(eq(organizations.id, p.organization.id));
    await proposeAs(await refresh(p), "propose_update_contact", {
      contactId: c.id,
      email: "compta@client.example",
    });
  });

  it("relances automatiques : un lot de 20 émissions lit les relances dues deux fois au plus (et non deux fois par émission), à la proposition comme à la confirmation", async () => {
    let p = await person("sub-ada");
    await completeCompany(p, { reminderAuto: true });
    const c = await customer(p);
    await db.update(contacts).set({ email: "compta@client.example" }).where(eq(contacts.id, c.id));
    const drafts = [];
    for (let i = 0; i < 20; i++) drafts.push(await draft(p, c.id, { issueDate: TODAY }));
    p = await refresh(p);
    due.calls = 0;
    const { token } = await proposeAs(p, "propose_batch", {
      operations: drafts.map((d) => ({ op: "issue_document", input: { documentId: d.id } })),
    });
    expect(due.calls).toBeLessThanOrEqual(2);
    due.calls = 0;
    const done = await confirmAs(p, token);
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    expect(due.calls).toBeLessThanOrEqual(2);
  });

  it("carte d'un lot : une création qui écrit une note, une adresse e-mail ou une description n'est jamais repliée ; les créations sans texte libre le restent au-delà de cinq", async () => {
    const p = await person("sub-ada");
    const withText = await proposeAs(p, "propose_batch", {
      operations: Array.from({ length: 7 }, (_, i) => ({
        op: "create_contact",
        input: { name: `Contact ${i + 1}`, notes: `NOTE-${i + 1}`, email: `c${i + 1}@x.example` },
      })),
    });
    const contactsGroup = withText.summary.groups?.find((g) => g.action === "create_contact");
    expect(contactsGroup?.items).toHaveLength(7);
    const shown = JSON.stringify(withText.summary);
    for (const part of ["NOTE-5", "NOTE-6", "NOTE-7", "c6@x.example", "c7@x.example"])
      expect(shown).toContain(part);
    const products = await proposeAs(p, "propose_batch", {
      operations: Array.from({ length: 7 }, (_, i) => ({
        op: "create_product",
        input: {
          name: `Article ${i + 1}`,
          unitPrice: "10",
          ...(i === 6 ? { description: "Payer sur IBAN DE89370400440532013000" } : {}),
        },
      })),
    });
    const productGroup = products.summary.groups?.find((g) => g.action === "create_product");
    // Cinq articles simples, plus celui qui porte une description : « + 1 autre ».
    expect(productGroup?.items).toHaveLength(6);
    expect(JSON.stringify(products.summary)).toContain("DE89370400440532013000");
    const plain = await proposeAs(p, "propose_batch", {
      operations: Array.from({ length: 7 }, (_, i) => ({
        op: "create_contact",
        input: { name: `Simple ${i + 1}` },
      })),
    });
    expect(plain.summary.groups?.[0]?.items).toHaveLength(5);
    expect(plain.summary.groups?.[0]?.count).toBe(7);
  });

  it("carte d'un lot de plus de deux pièces : chaque pièce garde ses lignes (une description de ligne est imprimée)", async () => {
    const p = await person("sub-ada");
    const c = await customer(p);
    const { summary } = await proposeAs(p, "propose_batch", {
      operations: Array.from({ length: 3 }, (_, i) => ({
        op: "create_invoice_draft",
        input: {
          contactId: c.id,
          lines: [
            { description: `Payer sur IBAN DE89370400440532013000 (${i + 1})`, unitPrice: "100" },
          ],
        },
      })),
    });
    const items = summary.groups?.find((g) => g.action === "create_invoice_draft")?.items ?? [];
    expect(items).toHaveLength(3);
    for (const [i, item] of items.entries()) {
      expect(item.lines?.[0]?.description).toBe(`Payer sur IBAN DE89370400440532013000 (${i + 1})`);
      expect(item.totals?.totalCents).toBeGreaterThan(0);
    }
  });

  it("carte d'un lot : chaque remarque dit à quoi elle s'applique (une facture et un devis émis ensemble : « les relances partiront » sous la facture, « rien n'est envoyé » sous le devis)", async () => {
    let p = await person("sub-ada");
    await completeCompany(p, { reminderAuto: true });
    const c = await customer(p);
    await db.update(contacts).set({ email: "compta@client.example" }).where(eq(contacts.id, c.id));
    const invoice = await draft(p, c.id, { issueDate: TODAY });
    const quote = await draft(p, c.id, { kind: "quote", issueDate: TODAY });
    p = await refresh(p);
    const { out, summary } = await proposeAs(p, "propose_batch", {
      operations: [
        { op: "issue_document", input: { documentId: invoice.id } },
        { op: "issue_document", input: { documentId: quote.id } },
      ],
    });
    expect(summary.notes).toBeUndefined();
    const group = summary.groups?.find((g) => g.action === "issue_document");
    expect(group?.notes).toEqual(["issueFinal"]);
    expect(group?.items.map((i) => i.notes)).toEqual([["autoReminders"], ["nothingSent"]]);
    // Le modèle lit la même répartition.
    const forModel = JSON.stringify(out.summary);
    expect(forModel).toContain("[notes: autoReminders]");
    expect(forModel).toContain("[notes: nothingSent]");
  });
});

describe("inventaire (A1)", () => {
  it("docs/ASSISTANT-ACTIONS.md nomme chaque outil propose_* donné au modèle, et rien qui n'existe pas", async () => {
    const doc = readFileSync(new URL("../../docs/ASSISTANT-ACTIONS.md", import.meta.url), "utf8");
    const named = new Set([...doc.matchAll(/`(propose_[a-z_]+)`/g)].map((m) => m[1] ?? ""));
    const p = await person("sub-ada");
    const given = new Set(
      tools(p)
        .list.map((x) => x.name)
        .filter((n) => n.startsWith("propose_")),
    );
    const registered = new Set([...OPERATIONS.map((o) => toolName(o.id)), toolName(BATCH)]);
    expect([...given].sort()).toEqual([...registered].sort());
    expect([...registered].filter((n) => !named.has(n))).toEqual([]);
    expect([...named].filter((n) => !given.has(n))).toEqual([]);
  });
});
