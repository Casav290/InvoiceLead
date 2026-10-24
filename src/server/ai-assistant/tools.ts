import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { and, desc, eq, gte, lte } from "drizzle-orm";
import { z } from "zod";
import { bookFacts } from "../assistant";
import { getContact, listContacts } from "../contacts";
import { dashboardFigures } from "../dashboard";
import { contacts, invoicePayments, invoices } from "../db/schema";
import { DOCUMENT_KINDS, getInvoice, listInvoices } from "../invoices";
import { invoiceBalance, listPayments } from "../payments";
import { listProducts } from "../products";
import { dueReminders, listReminders } from "../reminders";
import { type ProposedAction, signAction } from "./token";
import { type AssistantContext, type ConfirmSummary, prepareWrite, type WriteTool } from "./writes";

/**
 * Outils de la bulle Assistant IA d'InvoiceLead : les fonctions de l'application, appelées avec
 * l'entreprise et les droits de la session (jamais un identifiant d'entreprise venu du modèle).
 * Résultats tronqués à 50 lignes, champs utiles seulement. Les écritures ne font que proposer.
 */
export const MAX_ROWS = 50;
/** Au plus trois propositions « À confirmer » par message. */
export const MAX_PROPOSALS = 3;

export type AssistantAction =
  | { type: "navigate"; path: string }
  | { type: "confirm"; token: string; summary: ConfirmSummary };

export type ToolState = {
  actions: AssistantAction[];
  called: string[];
};

const units = (cents: number) => Math.round(cents) / 100;
const json = (value: unknown) => JSON.stringify(value);
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .describe("YYYY-MM-DD");

/**
 * Pages que l'assistant peut ouvrir (sans la langue). `:id` = un identifiant (UUID) rendu par un outil.
 * Les écrans d'abonnement, d'équipe ou de clés s'ouvrent aussi : la personne y agit elle-même.
 */
export const OPENABLE_PAGES = [
  "/app",
  "/app/invoices",
  "/app/invoices/new",
  "/app/invoices/:id",
  "/app/invoices/reminders",
  "/app/invoices/recurring",
  "/app/quotes",
  "/app/quotes/new",
  "/app/quotes/:id",
  "/app/credit-notes",
  "/app/credit-notes/:id",
  "/app/contacts",
  "/app/contacts/new",
  "/app/contacts/:id",
  "/app/products",
  "/app/products/new",
  "/app/products/:id",
  "/app/expenses",
  "/app/time",
  "/app/time/projects",
  "/app/time/projects/:id",
  "/app/accounting",
  "/app/accounting/bank",
  "/app/accounting/bills",
  "/app/accounting/bills/new",
  "/app/accounting/bills/:id",
  "/app/accounting/receipts",
  "/app/accounting/review",
  "/app/accounting/reports",
  "/app/accounting/vat",
  "/app/accounting/cashflow",
  "/app/assistant",
  "/app/feedback",
  "/app/import/crmlead",
  "/app/settings/company",
  "/app/settings/team",
  "/app/settings/plan",
  "/app/settings/payments",
  "/app/settings/api",
  "/app/settings/accounts",
  "/app/settings/fiscal-years",
  "/app/settings/projectlead",
  "/app/settings/einvoicing",
] as const;

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const PAGE_PATTERNS = OPENABLE_PAGES.map(
  (p) => new RegExp(`^${p.replace(":id", UUID).replace(/\//g, "\\/")}$`, "i"),
);

/** Chemin de page accepté (sans la langue), ou null. */
export function safePagePath(path: unknown): string | null {
  if (typeof path !== "string") return null;
  const clean =
    path
      .trim()
      .replace(/^\/(de|fr|en)(?=\/)/, "")
      .replace(/\/+$/, "") || "/app";
  return PAGE_PATTERNS.some((re) => re.test(clean)) ? clean : null;
}

const lineSchema = z.object({
  description: z.string().max(500),
  quantity: z.string().optional().describe('e.g. "1", "2.5"; default 1'),
  unit: z.enum(["hour", "day", "piece", "flat", "km", "month"]).optional(),
  unitPrice: z.string().describe('net unit price in units, dot decimal, e.g. "150.00"'),
  vatCode: z
    .enum(["normal", "reduced", "lodging", "exempt", "export"])
    .optional()
    .describe("only for VAT-registered companies; default normal"),
  productId: z.string().optional().describe("id from list_products, optional"),
});

const contactFields = {
  name: z.string().max(70).optional(),
  kind: z.enum(["company", "person"]).optional(),
  isCustomer: z.boolean().optional(),
  isSupplier: z.boolean().optional(),
  contactPerson: z.string().max(70).optional(),
  email: z.string().max(200).optional(),
  phone: z.string().max(40).optional(),
  street: z.string().max(70).optional(),
  buildingNumber: z.string().max(16).optional(),
  postalCode: z.string().max(16).optional(),
  town: z.string().max(35).optional(),
  region: z.string().max(35).optional().describe("US state code (TX, NY…) for US addresses"),
  country: z.enum(["CH", "LI", "DE", "FR", "IT", "AT", "GB", "US"]).optional(),
  language: z.enum(["de", "fr", "it", "en"]).optional(),
  uid: z.string().max(40).optional().describe("company VAT / UID number"),
  paymentTermDays: z.number().int().min(0).max(365).optional(),
  notes: z.string().max(1000).optional(),
};

const draftFields = {
  title: z.string().max(200).optional(),
  introText: z.string().max(2000).optional(),
  footerText: z.string().max(2000).optional(),
  issueDate: isoDate.optional(),
  serviceDate: isoDate.optional(),
  dueDate: isoDate.optional(),
  language: z.enum(["de", "fr", "en"]).optional(),
  currency: z.enum(["CHF", "EUR", "USD", "GBP"]).optional(),
};

export function buildTools(ctx: AssistantContext, state: ToolState, secret: string) {
  const org = ctx.organization.id;
  const track = (name: string) => state.called.push(name);
  const fail = (error: string) => json({ error });

  async function propose(tool: WriteTool, input: Record<string, unknown>) {
    track(tool);
    if (state.actions.filter((a) => a.type === "confirm").length >= MAX_PROPOSALS)
      return fail("too_many_proposals_in_one_message");
    const prepared = await prepareWrite(ctx, tool, input);
    if (!prepared.ok) return fail(prepared.error);
    const action: ProposedAction = { tool, input };
    const token = signAction(action, { userId: ctx.userId, organizationId: org }, secret);
    state.actions.push({ type: "confirm", token, summary: prepared.summary });
    return json({
      status: "awaiting_user_confirmation",
      note: "A confirmation card with this summary is shown to the user. Nothing is saved until they click Confirm; do not say it is done.",
      summary: prepared.summary,
    });
  }

  return [
    betaZodTool({
      name: "get_key_figures",
      description:
        "Dashboard figures of the company: revenue this month / previous month / this year, invoices issued this month, cash collected this month, open and overdue receivables (with the overdue list), open and accepted quotes, acceptance rate, drafts, supplier bills to pay, revenue of the last 12 months. Amounts in units of the company currency.",
      inputSchema: z.object({}),
      run: async () => {
        track("get_key_figures");
        const f = await dashboardFigures(ctx.database, org, ctx.today);
        return json({
          today: ctx.today,
          currency: f.currency,
          revenueThisMonth: units(f.revenueMonthCents),
          revenuePreviousMonth: units(f.revenuePrevMonthCents),
          revenueThisYear: units(f.revenueYearCents),
          invoicesIssuedThisMonth: f.invoicesMonth,
          collectedThisMonth: units(f.collectedMonthCents),
          openReceivables: { count: f.open.count, amount: units(f.open.cents) },
          overdueReceivables: { count: f.overdue.count, amount: units(f.overdue.cents) },
          openQuotes: { count: f.quotesOpen.count, amount: units(f.quotesOpen.cents) },
          acceptedQuotes: { count: f.quotesAccepted.count, amount: units(f.quotesAccepted.cents) },
          quoteAcceptanceRate: f.acceptanceRate,
          drafts: f.drafts,
          supplierBillsToPay: {
            count: f.billsToPay.count,
            amount: units(f.billsToPay.cents),
            overdue: f.billsToPay.overdue,
          },
          revenueByMonth: f.months.map((m) => ({ month: m.month, net: units(m.netCents) })),
          overdueInvoices: f.overdueList.slice(0, 20).map((o) => ({
            id: o.id,
            number: o.number,
            customer: o.contactName,
            dueDate: o.dueDate,
            daysLate: o.daysLate,
            open: units(o.openCents),
            currency: o.currency,
          })),
        });
      },
    }),
    betaZodTool({
      name: "get_books_summary",
      description:
        "Accounting snapshot: profit and loss of the current financial year, bank and cash balances, open and overdue customer invoices, revenue by month, top customers of the last 12 months, supplier bills to pay, unbilled time, bank lines and entries waiting for review. Amounts in units.",
      inputSchema: z.object({}),
      run: async () => {
        track("get_books_summary");
        return json(await bookFacts(ctx.database, org, ctx.today));
      },
    }),
    betaZodTool({
      name: "search_contacts",
      description:
        "Customers and suppliers of the company (active ones), optionally filtered by a text found in the name, e-mail or town. Returns at most 50, with their id.",
      inputSchema: z.object({
        query: z.string().max(100).optional(),
        role: z.enum(["customer", "supplier"]).optional(),
      }),
      run: async ({ query, role }) => {
        track("search_contacts");
        const rows = (await listContacts(ctx.database, org, query ?? "")).filter((c) =>
          role === "customer" ? c.isCustomer : role === "supplier" ? c.isSupplier : true,
        );
        return json({
          total: rows.length,
          contacts: rows.slice(0, MAX_ROWS).map((c) => ({
            id: c.id,
            name: c.name,
            kind: c.kind,
            customer: c.isCustomer,
            supplier: c.isSupplier,
            email: c.email,
            town: c.town,
            country: c.country,
            language: c.language,
            paymentTermDays: c.paymentTermDays,
          })),
        });
      },
    }),
    betaZodTool({
      name: "get_contact",
      description: "One contact with all its fields, by id.",
      inputSchema: z.object({ contactId: z.string() }),
      run: async ({ contactId }) => {
        track("get_contact");
        const c = await getContact(ctx.database, org, contactId);
        if (!c) return fail("not_found");
        return json({
          id: c.id,
          name: c.name,
          kind: c.kind,
          customer: c.isCustomer,
          supplier: c.isSupplier,
          archived: !!c.archivedAt,
          contactPerson: c.contactPerson,
          email: c.email,
          phone: c.phone,
          street: c.street,
          buildingNumber: c.buildingNumber,
          postalCode: c.postalCode,
          town: c.town,
          region: c.region,
          country: c.country,
          language: c.language,
          uid: c.uid,
          paymentTermDays: c.paymentTermDays,
          notes: c.notes,
        });
      },
    }),
    betaZodTool({
      name: "list_documents",
      description:
        "Invoices, quotes or credit notes, newest first, with their open amount. Filters: status (draft, issued; quotes also accepted, declined, invoiced), payment (open, overdue, paid; issued invoices only), customer name text, issue date range. Returns at most 50 and the total count.",
      inputSchema: z.object({
        kind: z.enum(DOCUMENT_KINDS).optional().describe("default invoice"),
        status: z.enum(["draft", "issued", "accepted", "declined", "invoiced"]).optional(),
        payment: z.enum(["open", "overdue", "paid"]).optional(),
        customer: z.string().max(100).optional(),
        from: isoDate.optional(),
        to: isoDate.optional(),
      }),
      run: async ({ kind, status, payment, customer, from, to }) => {
        track("list_documents");
        const rows = (await listInvoices(ctx.database, org, kind ?? "invoice"))
          .map((r) => ({
            ...r,
            openCents: r.totalCents - r.paidCents - r.creditedCents + r.chargesCents,
          }))
          .filter((r) => !status || r.status === status)
          .filter((r) => !customer || r.contactName.toLowerCase().includes(customer.toLowerCase()))
          .filter((r) => !from || r.issueDate >= from)
          .filter((r) => !to || r.issueDate <= to)
          .filter((r) => {
            if (!payment) return true;
            if (r.status !== "issued") return false;
            if (payment === "paid") return r.openCents <= 0;
            if (payment === "overdue") return r.openCents > 0 && r.dueDate < ctx.today;
            return r.openCents > 0;
          });
        return json({
          total: rows.length,
          documents: rows.slice(0, MAX_ROWS).map((r) => ({
            id: r.id,
            number: r.number,
            status: r.status,
            customer: r.contactName,
            issueDate: r.issueDate,
            dueDate: r.dueDate,
            currency: r.currency,
            total: units(r.totalCents),
            paid: units(r.paidCents),
            open: r.status === "issued" ? units(r.openCents) : null,
          })),
        });
      },
    }),
    betaZodTool({
      name: "get_document",
      description:
        "One invoice, quote or credit note by id: lines, totals and, for an issued invoice, its balance, the payments received and the reminders already sent.",
      inputSchema: z.object({ documentId: z.string() }),
      run: async ({ documentId }) => {
        track("get_document");
        const found = await getInvoice(ctx.database, org, documentId);
        if (!found) return fail("not_found");
        const i = found.invoice;
        const issued = i.kind === "invoice" && i.status === "issued";
        const balance = issued ? await invoiceBalance(ctx.database, i.id, i.totalCents) : null;
        const payments = issued ? await listPayments(ctx.database, org, i.id) : [];
        const reminders = issued ? await listReminders(ctx.database, org, i.id) : [];
        return json({
          id: i.id,
          kind: i.kind,
          number: i.number,
          status: i.status,
          customer: { id: found.contact.id, name: found.contact.name },
          language: i.language,
          currency: i.currency,
          title: i.title,
          issueDate: i.issueDate,
          serviceDate: i.serviceDate,
          dueDate: i.dueDate,
          net: units(i.netCents),
          vat: units(i.vatCents),
          total: units(i.totalCents),
          related: found.related,
          lines: found.lines.slice(0, MAX_ROWS).map((l) => ({
            description: l.description,
            quantity: l.quantityMilli / 1000,
            unit: l.unit,
            unitPrice: units(l.unitPriceCents),
            vatCode: l.vatCode,
            vatRatePercent: l.vatRateBp / 100,
            net: units(l.netCents),
          })),
          ...(balance
            ? {
                balance: {
                  paid: units(balance.paidCents),
                  credited: units(balance.creditedCents),
                  charges: units(balance.chargesCents ?? 0),
                  open: units(balance.openCents),
                },
                payments: payments.slice(0, MAX_ROWS).map((p) => ({
                  paidOn: p.paidOn,
                  amount: units(p.amountCents),
                  method: p.method,
                })),
                reminders: reminders.slice(0, MAX_ROWS).map((r) => ({
                  level: r.level,
                  sentAt: r.sentAt,
                  channel: r.channel,
                  fee: units(r.feeCents),
                  interest: units(r.interestCents),
                  waived: !!r.waivedAt,
                })),
              }
            : {}),
        });
      },
    }),
    betaZodTool({
      name: "list_payments_received",
      description:
        "Payments received on customer invoices, newest first, optionally between two dates. Read only. Returns at most 50 and the total.",
      inputSchema: z.object({ from: isoDate.optional(), to: isoDate.optional() }),
      run: async ({ from, to }) => {
        track("list_payments_received");
        const rows = await ctx.database
          .select({
            paidOn: invoicePayments.paidOn,
            amountCents: invoicePayments.amountCents,
            method: invoicePayments.method,
            invoiceId: invoices.id,
            number: invoices.number,
            currency: invoices.currency,
            customer: contacts.name,
          })
          .from(invoicePayments)
          .innerJoin(
            invoices,
            and(eq(invoices.id, invoicePayments.invoiceId), eq(invoices.organizationId, org)),
          )
          .innerJoin(contacts, eq(contacts.id, invoices.contactId))
          .where(
            and(
              eq(invoicePayments.organizationId, org),
              from ? gte(invoicePayments.paidOn, from) : undefined,
              to ? lte(invoicePayments.paidOn, to) : undefined,
            ),
          )
          .orderBy(desc(invoicePayments.paidOn), desc(invoicePayments.createdAt))
          .limit(500);
        const byCurrency = new Map<string, number>();
        for (const r of rows)
          byCurrency.set(r.currency, (byCurrency.get(r.currency) ?? 0) + r.amountCents);
        return json({
          total: rows.length,
          sums: [...byCurrency].map(([currency, cents]) => ({ currency, amount: units(cents) })),
          payments: rows.slice(0, MAX_ROWS).map((r) => ({
            paidOn: r.paidOn,
            amount: units(r.amountCents),
            currency: r.currency,
            method: r.method,
            invoiceId: r.invoiceId,
            invoiceNumber: r.number,
            customer: r.customer,
          })),
        });
      },
    }),
    betaZodTool({
      name: "list_due_reminders",
      description:
        "Overdue invoices for which a payment reminder is due today (level, days late, fee, interest, total due, customer payment profile). Read only: reminders are sent by the user from the reminders screen.",
      inputSchema: z.object({}),
      run: async () => {
        track("list_due_reminders");
        const rows = await dueReminders(ctx.database, org, ctx.today);
        return json({
          total: rows.length,
          reminders: rows.slice(0, MAX_ROWS).map((r) => ({
            invoiceId: r.invoiceId,
            number: r.number,
            customer: r.customer,
            hasEmail: !!r.email,
            dueDate: r.dueDate,
            daysLate: r.daysLate,
            level: r.level,
            currency: r.currency,
            open: units(r.openCents),
            fee: units(r.feeCents),
            interest: units(r.interestCents),
            totalDue: units(r.totalDueCents),
            risk: r.risk,
            lockedByPlan: r.locked,
          })),
        });
      },
    }),
    betaZodTool({
      name: "list_products",
      description:
        "Products and services of the catalogue (name, unit, net unit price, VAT code), optionally filtered by name or SKU. Useful to fill invoice lines.",
      inputSchema: z.object({ query: z.string().max(100).optional() }),
      run: async ({ query }) => {
        track("list_products");
        const rows = await listProducts(ctx.database, org, query ?? "");
        return json({
          total: rows.length,
          products: rows.slice(0, MAX_ROWS).map((p) => ({
            id: p.id,
            name: p.name,
            sku: p.sku,
            unit: p.unit,
            unitPrice: units(p.unitPriceCents),
            vatCode: p.vatCode,
          })),
        });
      },
    }),
    betaZodTool({
      name: "open_page",
      description: `Open a page of InvoiceLead in the user's browser. Allowed paths (no language prefix): ${OPENABLE_PAGES.join(", ")}. Replace :id by an id returned by another tool.`,
      inputSchema: z.object({ path: z.string().max(200) }),
      run: async ({ path }) => {
        track("open_page");
        const safe = safePagePath(path);
        if (!safe) return fail("page_not_allowed");
        state.actions = state.actions.filter((a) => a.type !== "navigate");
        state.actions.push({ type: "navigate", path: safe });
        return json({ status: "page_will_open", path: safe });
      },
    }),
    betaZodTool({
      name: "create_contact",
      description:
        "PROPOSE a new contact (customer by default). Nothing is saved: the user sees a confirmation card and must click Confirm. Search first to avoid duplicates.",
      inputSchema: z.object({ ...contactFields, name: z.string().min(1).max(70) }),
      run: (input) => propose("create_contact", input),
    }),
    betaZodTool({
      name: "update_contact",
      description:
        "PROPOSE changes to an existing contact: give its id and only the fields to change. Nothing is saved until the user confirms.",
      inputSchema: z.object({ contactId: z.string(), ...contactFields }),
      run: (input) => propose("update_contact", input),
    }),
    betaZodTool({
      name: "create_invoice_draft",
      description:
        "PROPOSE a new DRAFT invoice (or quote with kind=quote) for an existing customer (contactId from search_contacts). VAT is computed by InvoiceLead. Nothing is saved until the user confirms; the draft is never issued nor sent.",
      inputSchema: z.object({
        kind: z.enum(["invoice", "quote"]).optional(),
        contactId: z.string(),
        lines: z.array(lineSchema).min(1).max(50),
        ...draftFields,
      }),
      run: (input) => propose("create_invoice_draft", input),
    }),
    betaZodTool({
      name: "update_invoice_draft",
      description:
        "PROPOSE changes to a DRAFT invoice or quote (documentId). Give only the fields to change; `lines`, when given, replaces all lines. Issued documents cannot be changed. Nothing is saved until the user confirms.",
      inputSchema: z.object({
        documentId: z.string(),
        contactId: z.string().optional(),
        lines: z.array(lineSchema).min(1).max(50).optional(),
        ...draftFields,
      }),
      run: (input) => propose("update_invoice_draft", input),
    }),
  ];
}
