import { readFileSync } from "node:fs";
import { and, count, eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createFirstFiscalYear, getAccount, installChart, listAccounts } from "@/server/accounting";
import { confirmPost, type Deps } from "@/server/ai-assistant/handlers";
import { BATCH, MAX_BATCH, OPERATIONS, toolName } from "@/server/ai-assistant/operations";
import type { AssistantContext } from "@/server/ai-assistant/ops-core";
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
} from "@/server/db/schema";
import { createInvoice, issueInvoice, parseInvoiceForm } from "@/server/invoices";
import { createProduct } from "@/server/products";
import { createRecurring } from "@/server/recurring";
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
