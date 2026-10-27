import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { and, desc, eq, gte, lte } from "drizzle-orm";
import { z } from "zod";
import { routing } from "@/i18n/routing";
import { accountName } from "@/lib/account-name";
import { listAccounts, listFiscalYears } from "../accounting";
import { bookFacts } from "../assistant";
import { listBills } from "../bills";
import { closingChecks } from "../closing";
import { getContact, listContacts } from "../contacts";
import { dashboardFigures } from "../dashboard";
import { contacts, invoicePayments, invoices } from "../db/schema";
import { DOCUMENT_KINDS, getInvoice, listInvoices } from "../invoices";
import { invoiceBalance, listPayments } from "../payments";
import { featureAccess } from "../plans";
import { listProducts } from "../products";
import { listReceipts } from "../receipts";
import { listRecurring } from "../recurring";
import { dueReminders, listReminders } from "../reminders";
import { formatMinutes, listEntries, listProjects } from "../time";
import {
  BATCH,
  batchSchema,
  MAX_BATCH,
  OPERATIONS,
  type Proposal,
  proposeBatch,
  proposeOne,
  toolName,
} from "./operations";
import { vatPeriods } from "./ops-books";
import type { AssistantContext, ConfirmSummary } from "./ops-core";
import { signAction } from "./token";

/**
 * Outils de la bulle Assistant IA d'InvoiceLead : les fonctions de l'application, appelées avec
 * l'entreprise et les droits de la session (jamais un identifiant d'entreprise venu du modèle).
 * Lectures tronquées à 50 lignes, champs utiles seulement. Les écritures ne font que proposer : une
 * carte « À confirmer » par outil `propose_*`, appliquée au clic (operations.ts).
 */
export const MAX_ROWS = 50;
/** Au plus trois cartes « À confirmer » par message (un lot compte pour une carte). */
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
  "/app/settings/lead-apps",
  "/app/settings/einvoicing",
] as const;

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const PAGE_PATTERNS = OPENABLE_PAGES.map(
  (p) => new RegExp(`^${p.replace(":id", UUID).replace(/\//g, "\\/")}$`, "i"),
);

/** Préfixe de langue d'un chemin (« /fr/… »), pour toutes les langues de l'application. */
const LOCALE_PREFIX = new RegExp(`^/(${routing.locales.join("|")})(?=/)`);

/** Chemin de page accepté (sans la langue), ou null. */
export function safePagePath(path: unknown): string | null {
  if (typeof path !== "string") return null;
  const clean = path.trim().replace(LOCALE_PREFIX, "").replace(/\/+$/, "") || "/app";
  return PAGE_PATTERNS.some((re) => re.test(clean)) ? clean : null;
}

/** Ce que le modèle lit d'une proposition : la carte en bref (les libellés restent ceux des données). */
function forModel(summary: ConfirmSummary) {
  if (summary.groups)
    return {
      operations: summary.count,
      groups: summary.groups.map((g) => ({
        action: g.action,
        count: g.count,
        examples: g.items.map((i) =>
          [
            i.detail,
            i.label,
            i.amountCents !== undefined ? `${units(i.amountCents)} ${i.currency ?? ""}`.trim() : "",
          ]
            .filter(Boolean)
            .join(" · "),
        ),
      })),
    };
  return {
    action: summary.action,
    fields: summary.fields.map((f) => ({
      key: f.key,
      value:
        f.format === "money" ? `${units(Number(f.value))} ${f.currency ?? ""}`.trim() : f.value,
      ...(f.before !== undefined
        ? {
            before:
              f.format === "money" && f.before !== ""
                ? `${units(Number(f.before))} ${f.currency ?? ""}`.trim()
                : f.before,
          }
        : {}),
    })),
    ...(summary.lines
      ? {
          lines: summary.lines.slice(0, 20).map((l) => ({
            description: l.description,
            quantity: l.quantity,
            unit: l.unit,
            unitPrice: units(l.unitPriceCents),
            net: units(l.netCents),
          })),
        }
      : {}),
    ...(summary.totals
      ? {
          totals: {
            currency: summary.totals.currency,
            net: units(summary.totals.netCents),
            tax: units(summary.totals.vatCents),
            total: units(summary.totals.totalCents),
          },
        }
      : {}),
    ...(summary.notes ? { notes: summary.notes } : {}),
  };
}

/** Indication donnée au modèle avec un refus, pour qu'il l'explique ou corrige sa proposition. */
function hint(error: string): string | undefined {
  if (error.includes("forbidden_role"))
    return "The user's role does not allow this change; an administrator can change roles in /app/settings/team. Say so; do not retry.";
  if (error.includes("forbidden_country"))
    return "Accounting is not available for this company's country.";
  if (/plan_|planLimit|plan_limit|"plan"| plan$/.test(error) || error.endsWith(": plan"))
    return "The company's plan does not include this or its limit is reached; the user can see plans in /app/settings/plan. Explain it; do not retry.";
  if (error.includes("invalid"))
    return "Fix the fields listed (same rules as the form) and propose again in the same answer.";
  if (error.includes("not_found"))
    return "Look the item up with the read tools first, or create it in the same propose_batch and reference it with @key.";
  if (error.includes("unknown_ref") || error.includes("ref_"))
    return "In propose_batch, a reference @key must name the key of an EARLIER operation that creates that kind of item.";
  if (error.includes("no_change"))
    return "Nothing would change: the values are already the current ones.";
  return undefined;
}

const proposeNote =
  "A confirmation card with this summary is shown to the user. Nothing is saved until they click Confirm; do not say it is done.";

export function buildTools(ctx: AssistantContext, state: ToolState, secret: string) {
  const org = ctx.organization.id;
  const track = (name: string) => state.called.push(name);
  const failed = (error: string) => json({ error });

  async function propose(id: string, input: Record<string, unknown>) {
    track(toolName(id));
    if (state.actions.filter((a) => a.type === "confirm").length >= MAX_PROPOSALS)
      return json({
        error: "too_many_proposals_in_one_message",
        hint: "Group the remaining changes in one propose_batch card.",
      });
    const proposal: Proposal =
      id === BATCH ? await proposeBatch(ctx, input) : await proposeOne(ctx, id, input);
    if (!proposal.ok) return json({ error: proposal.error, hint: hint(proposal.error) });
    const token = signAction(proposal.action, { userId: ctx.userId, organizationId: org }, secret);
    state.actions.push({ type: "confirm", token, summary: proposal.summary });
    return json({
      status: "awaiting_user_confirmation",
      note: proposeNote,
      summary: forModel(proposal.summary),
    });
  }

  const readTools = [
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
        if (!c) return failed("not_found");
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
        if (!found) return failed("not_found");
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
          crmleadDealInherited: !!i.crmleadLeadId && !i.externalRef,
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
      name: "list_projects",
      description:
        "Time-tracking projects (active by default, or archived=true) with their customer, hourly rate, budget, hours worked and billable time not invoiced yet.",
      inputSchema: z.object({ archived: z.boolean().optional() }),
      run: async ({ archived }) => {
        track("list_projects");
        const rows = await listProjects(ctx.database, org, { archived: archived === true });
        return json({
          total: rows.length,
          projects: rows.slice(0, MAX_ROWS).map((p) => ({
            id: p.project.id,
            name: p.project.name,
            customer: p.customer,
            customerId: p.project.contactId,
            hourlyRate: units(p.project.hourlyRateCents),
            budgetHours: p.project.budgetMinutes === null ? null : p.project.budgetMinutes / 60,
            hoursWorked: formatMinutes(p.minutes),
            unbilledHours: formatMinutes(p.unbilledMinutes),
            unbilledAmount: units(p.unbilledCents),
            archived: !!p.project.archivedAt,
          })),
        });
      },
    }),
    betaZodTool({
      name: "list_time_entries",
      description:
        "Recent time entries of the company, newest first, optionally of one project and since a date: date, duration, description, billable, invoiced, running timer.",
      inputSchema: z.object({ projectId: z.string().optional(), since: isoDate.optional() }),
      run: async ({ projectId, since }) => {
        track("list_time_entries");
        const rows = await listEntries(ctx.database, org, {
          ...(projectId && /^[0-9a-f-]{36}$/i.test(projectId) ? { projectId } : {}),
          ...(since ? { since } : {}),
        });
        return json({
          total: rows.length,
          entries: rows.slice(0, MAX_ROWS).map((r) => ({
            id: r.entry.id,
            project: r.project,
            projectId: r.entry.projectId,
            date: r.entry.workDate,
            duration: formatMinutes(r.entry.minutes),
            description: r.entry.description,
            billable: r.entry.billable,
            invoiced: !!r.entry.invoiceId,
            running: !!r.entry.startedAt,
            mine: r.entry.userId === ctx.userId,
          })),
        });
      },
    }),
    betaZodTool({
      name: "list_supplier_bills",
      description:
        "Supplier bills and expense claims (source expense or mileage), due first: supplier, number, status (draft, approved, scheduled, paid, refused), dates, amount. Filters: status, source, supplier text.",
      inputSchema: z.object({
        status: z.enum(["draft", "approved", "scheduled", "paid", "refused"]).optional(),
        source: z.enum(["manual", "receipt", "einvoice", "expense", "mileage"]).optional(),
        supplier: z.string().max(100).optional(),
      }),
      run: async ({ status, source, supplier }) => {
        track("list_supplier_bills");
        const rows = (await listBills(ctx.database, org))
          .filter((b) => !status || b.status === status)
          .filter((b) => !source || b.source === source)
          .filter(
            (b) => !supplier || b.supplierName.toLowerCase().includes(supplier.toLowerCase()),
          );
        return json({
          total: rows.length,
          bills: rows.slice(0, MAX_ROWS).map((b) => ({
            id: b.id,
            supplier: b.supplierName,
            number: b.number,
            status: b.status,
            source: b.source,
            issueDate: b.issueDate,
            dueDate: b.dueDate,
            currency: b.currency,
            total: units(b.totalCents),
            hasAccount: !!b.accountId,
            myExpenseClaim: b.claimantId === ctx.userId,
          })),
        });
      },
    }),
    betaZodTool({
      name: "list_receipts",
      description:
        "Supporting documents uploaded to the books (receipts, supplier invoices), newest first: file name, status (new, read, error, matched, billed, posted) and what the reading found.",
      inputSchema: z.object({
        status: z.enum(["new", "read", "error", "matched", "billed", "posted"]).optional(),
      }),
      run: async ({ status }) => {
        track("list_receipts");
        const rows = (await listReceipts(ctx.database, org)).filter(
          (r) => !status || r.status === status,
        );
        return json({
          total: rows.length,
          receipts: rows.slice(0, MAX_ROWS).map((r) => ({
            id: r.id,
            file: r.filename,
            status: r.status,
            supplier: r.extraction?.supplier ?? null,
            date: r.extraction?.date ?? null,
            total: r.extraction?.totalCents ? units(r.extraction.totalCents) : null,
            currency: r.extraction?.currency ?? null,
          })),
        });
      },
    }),
    betaZodTool({
      name: "list_recurring_invoices",
      description:
        "Recurring invoices: model invoice, customer, interval in months, next date, active or paused, automatic sending.",
      inputSchema: z.object({}),
      run: async () => {
        track("list_recurring_invoices");
        const rows = await listRecurring(ctx.database, org);
        return json({
          total: rows.length,
          recurring: rows.slice(0, MAX_ROWS).map((r) => ({
            id: r.recurring.id,
            invoiceNumber: r.number,
            customer: r.customer,
            total: units(r.total),
            currency: r.currency,
            intervalMonths: r.recurring.intervalMonths,
            nextDate: r.recurring.nextDate,
            active: r.recurring.active,
            autoSend: r.recurring.autoSend,
          })),
        });
      },
    }),
    betaZodTool({
      name: "list_accounts",
      description:
        "Chart of accounts of the company, optionally filtered by number prefix or name text and by type (asset, liability, equity, revenue, expense). Use it to find the expense account of a supplier bill.",
      inputSchema: z.object({
        query: z.string().max(60).optional(),
        type: z.enum(["asset", "liability", "equity", "revenue", "expense", "closing"]).optional(),
      }),
      run: async ({ query, type }) => {
        track("list_accounts");
        const q = (query ?? "").trim().toLowerCase();
        const rows = (await listAccounts(ctx.database, org))
          .filter((a) => !type || a.type === type)
          .filter(
            (a) =>
              !q ||
              a.number.startsWith(q) ||
              [a.nameDe, a.nameFr, a.nameEn ?? ""].some((n) => n.toLowerCase().includes(q)),
          );
        return json({
          total: rows.length,
          accounts: rows.slice(0, MAX_ROWS).map((a) => ({
            id: a.id,
            number: a.number,
            name: accountName(a, ctx.locale),
            type: a.type,
            vatCode: a.vatCode,
            active: a.active,
            system: !!a.role,
          })),
        });
      },
    }),
    betaZodTool({
      name: "list_fiscal_years",
      description:
        "Financial years (open or closed), newest first, and for an open year what still prevents closing it (documents not booked, bank lines waiting, an earlier open year).",
      inputSchema: z.object({}),
      run: async () => {
        track("list_fiscal_years");
        const years = await listFiscalYears(ctx.database, org);
        const out = [];
        for (const y of years.slice(0, 10))
          out.push({
            id: y.id,
            start: y.startDate,
            end: y.endDate,
            status: y.status,
            closingBlockers:
              y.status === "open" ? await closingChecks(ctx.database, org, y.id) : [],
          });
        return json({ total: years.length, years: out });
      },
    }),
    betaZodTool({
      name: "list_vat_periods",
      description:
        "Periods of the VAT (or US sales tax) return offered by the VAT screen, newest first, and whether each is already validated; also whether the company's plan includes validating returns.",
      inputSchema: z.object({}),
      run: async () => {
        track("list_vat_periods");
        const periods = await vatPeriods(ctx);
        return json({
          planIncludesValidation: featureAccess(ctx.organization, "vatReturn").allowed,
          periods: periods.slice(0, 12),
        });
      },
    }),
    betaZodTool({
      name: "get_company_settings",
      description:
        "The company settings as on the settings screen (legal name and form, address, contact details, VAT or tax numbers, VAT registration and method, IBAN, QR-IBAN, first month of the financial year) and the reminder settings (automatic reminders, fee, late interest).",
      inputSchema: z.object({}),
      run: async () => {
        track("get_company_settings");
        const o = ctx.organization;
        return json({
          country: o.country,
          currency: o.currency,
          legalName: o.legalName ?? o.name,
          legalForm: o.legalForm,
          street: o.street,
          buildingNumber: o.buildingNumber,
          postalCode: o.postalCode,
          town: o.town,
          email: o.email,
          phone: o.phone,
          website: o.website,
          uid: o.uid,
          taxNumber: o.taxNumber,
          vatRegistered: o.vatRegistered,
          vatMethod: o.vatMethod,
          vatSettlement: o.vatSettlement,
          netTaxRatePercent: o.netTaxRateBp ? o.netTaxRateBp / 100 : null,
          region: o.region,
          salesTaxRatePercent: o.salesTaxRateBp ? o.salesTaxRateBp / 100 : null,
          iban: o.iban,
          qrIban: o.qrIban,
          fiscalYearStartMonth: o.fiscalYearStartMonth,
          settingsComplete: !!o.settingsCompletedAt,
          reminders: {
            automatic: o.reminderAuto,
            fee: units(o.reminderFeeCents),
            lateInterestPercent: o.lateInterestBp ? o.lateInterestBp / 100 : null,
          },
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
        if (!safe) return failed("page_not_allowed");
        state.actions = state.actions.filter((a) => a.type !== "navigate");
        state.actions.push({ type: "navigate", path: safe });
        return json({ status: "page_will_open", path: safe });
      },
    }),
  ];

  const proposeTools = OPERATIONS.map((op) =>
    betaZodTool({
      name: toolName(op.id),
      description: op.description,
      inputSchema: op.schema as z.ZodObject,
      run: (input: Record<string, unknown>) => propose(op.id, input),
    }),
  );

  const batchTool = betaZodTool({
    name: toolName(BATCH),
    description: `PROPOSE several changes as ONE confirmation card, applied all together in one transaction (all or nothing), up to ${MAX_BATCH} operations: e.g. several contacts or products, a new customer and its quote, a project and its time entries. Each operation is {op, key?, input}: op is the name of a propose_<op> tool without "propose_", input has exactly the fields of that tool. An operation that creates something can have a key (e.g. "c1"); a later operation uses "@c1" in place of the id (contactId, productId in lines, projectId, documentId, quoteId, invoiceId, billId, accountId). Operations run in order. Use it whenever there is more than one change.`,
    inputSchema: batchSchema,
    run: (input) => propose(BATCH, input as Record<string, unknown>),
  });

  return [...readTools, ...proposeTools, batchTool];
}
