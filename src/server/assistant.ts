import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { addDays } from "@/lib/fiscal-year";
import { listFiscalYears } from "./accounting";
import { aiLanguageName, chatJson } from "./ai";
import { autopilotSummary } from "./autopilot";
import type { Db } from "./db";
import { auditLog, contacts, invoices, organizations, supplierBills } from "./db/schema";
import { listInvoices } from "./invoices";
import { accountBalances } from "./reports";
import { listProjects } from "./time";

type Who = { organizationId: string; userId: string };
const money = (cents: number) => Math.round(cents) / 100;

/**
 * Instantané chiffré des livres, calculé ici et pas par l'IA : c'est la seule matière dont
 * l'assistant dispose pour répondre. Montants en unités de la monnaie de l'entreprise.
 */
export async function bookFacts(database: Db, organizationId: string, today: string) {
  const [org] = await database
    .select()
    .from(organizations)
    .where(eq(organizations.id, organizationId));
  if (!org) throw new Error("organization_missing");
  const years = await listFiscalYears(database, organizationId);
  const year = years.find((y) => y.startDate <= today && y.endDate >= today) ?? years[0];
  const balances = year ? await accountBalances(database, organizationId, year.id) : [];
  const sum = (type: string) =>
    balances.filter((b) => b.account.type === type).reduce((s, b) => s + b.balanceCents, 0);
  const revenue = sum("revenue");
  const expenses = sum("expense");
  const byRole = (role: string) =>
    balances.filter((b) => b.account.role === role).reduce((s, b) => s + b.balanceCents, 0);
  const top = (type: string) =>
    balances
      .filter((b) => b.account.type === type && b.balanceCents !== 0)
      .sort((a, b) => Math.abs(b.balanceCents) - Math.abs(a.balanceCents))
      .slice(0, 15)
      .map((b) => ({
        account: `${b.account.number} ${b.account.nameFr}`,
        amount: money(b.balanceCents),
      }));

  const issued = (await listInvoices(database, organizationId, "invoice")).filter(
    (i) => i.status === "issued",
  );
  const open = issued
    .map((i) => ({
      ...i,
      openCents: i.totalCents - i.paidCents - i.creditedCents + i.chargesCents,
    }))
    .filter((i) => i.openCents > 0)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const overdue = open.filter((i) => i.dueDate < today);

  const since = addDays(today, -365);
  const monthly = await database
    .select({
      month: sql<string>`to_char(${invoices.issueDate}::date, 'YYYY-MM')`,
      net: sql<string>`sum(case when ${invoices.kind} = 'credit_note' then -${invoices.netCents} else ${invoices.netCents} end)`,
    })
    .from(invoices)
    .where(
      and(
        eq(invoices.organizationId, organizationId),
        inArray(invoices.kind, ["invoice", "credit_note"]),
        eq(invoices.status, "issued"),
        gte(invoices.issueDate, since),
      ),
    )
    .groupBy(sql`1`)
    .orderBy(sql`1`);
  const customers = await database
    .select({
      name: contacts.name,
      net: sql<string>`sum(case when ${invoices.kind} = 'credit_note' then -${invoices.netCents} else ${invoices.netCents} end)`,
    })
    .from(invoices)
    .innerJoin(contacts, eq(contacts.id, invoices.contactId))
    .where(
      and(
        eq(invoices.organizationId, organizationId),
        inArray(invoices.kind, ["invoice", "credit_note"]),
        eq(invoices.status, "issued"),
        gte(invoices.issueDate, since),
      ),
    )
    .groupBy(contacts.name)
    .orderBy(desc(sql`2`))
    .limit(10);
  const bills = await database
    .select()
    .from(supplierBills)
    .where(
      and(
        eq(supplierBills.organizationId, organizationId),
        inArray(supplierBills.status, ["draft", "approved", "scheduled"]),
      ),
    )
    .orderBy(supplierBills.dueDate)
    .limit(30);
  const projects = (await listProjects(database, organizationId)).filter(
    (p) => p.unbilledMinutes > 0,
  );
  const work = await autopilotSummary(database, organizationId, today);

  return {
    today,
    company: {
      name: org.legalName ?? org.name,
      country: org.country,
      currency: org.currency,
      vatRegistered: org.vatRegistered,
    },
    fiscalYear: year ? { from: year.startDate, to: year.endDate, status: year.status } : null,
    profitAndLoss: {
      revenue: money(revenue),
      expenses: money(expenses),
      result: money(revenue - expenses),
      topRevenueAccounts: top("revenue"),
      topExpenseAccounts: top("expense"),
    },
    liquidity: { bank: money(byRole("bank")), cash: money(byRole("cash")) },
    receivables: {
      openTotal: money(open.reduce((s, i) => s + i.openCents, 0)),
      overdueTotal: money(overdue.reduce((s, i) => s + i.openCents, 0)),
      openInvoices: open.slice(0, 25).map((i) => ({
        number: i.number,
        customer: i.contactName,
        currency: i.currency,
        open: money(i.openCents),
        due: i.dueDate,
        daysLate:
          i.dueDate < today
            ? Math.round((Date.parse(today) - Date.parse(i.dueDate)) / 86_400_000)
            : 0,
      })),
    },
    revenueByMonth: monthly.map((m) => ({ month: m.month, net: money(Number(m.net)) })),
    topCustomersLast12Months: customers.map((c) => ({
      customer: c.name,
      net: money(Number(c.net)),
    })),
    supplierBillsToPay: bills.map((b) => ({
      supplier: b.supplierName,
      status: b.status,
      currency: b.currency,
      amount: money(b.totalCents),
      due: b.dueDate,
    })),
    unbilledTime: projects.map((p) => ({
      project: p.project.name,
      customer: p.customer,
      hours: Math.round((p.unbilledMinutes / 60) * 100) / 100,
      amount: money(p.unbilledCents),
    })),
    toDo: {
      bankTransactionsToReview: work.toReview,
      autopilotEntriesToApprove: work.toApprove,
      anomalies: work.anomalies,
    },
  };
}

export const ASSISTANT_LINKS = {
  invoices: "/app/invoices",
  reminders: "/app/invoices/reminders",
  bank: "/app/accounting/bank",
  review: "/app/accounting/review",
  bills: "/app/accounting/bills",
  reports: "/app/accounting/reports",
  vat: "/app/accounting/vat",
  time: "/app/time/projects",
} as const;
export type AssistantLink = keyof typeof ASSISTANT_LINKS;

export type AssistantAnswer = { answer: string; links: AssistantLink[] };

/**
 * Répond à une question sur les livres, à partir de l'instantané seulement. L'assistant ne voit pas
 * la base et ne peut rien modifier ; s'il ne trouve pas la réponse, il le dit.
 */
export async function askAssistant(
  database: Db,
  who: Who,
  question: string,
  language: "de" | "fr" | "en",
  today = new Date().toISOString().slice(0, 10),
): Promise<AssistantAnswer | "empty" | "failed"> {
  const q = question.trim().slice(0, 500);
  if (!q) return "empty";
  const facts = await bookFacts(database, who.organizationId, today);
  const system = [
    "You are the bookkeeping assistant of InvoiceLead, an invoicing and accounting app for small businesses.",
    "Answer the user's question about their own books using ONLY the JSON facts provided. Never invent numbers.",
    "If the facts do not contain the answer, say so plainly and say which screen of InvoiceLead shows it.",
    `Answer in ${aiLanguageName(language)}, in two to six short sentences, without markdown tables. Amounts with their currency.`,
    `links: up to three screens useful for the follow-up, among ${Object.keys(ASSISTANT_LINKS).join(", ")}.`,
    'Answer with JSON only: {"answer":"...","links":["invoices"]}',
  ].join("\n");
  let raw: unknown;
  try {
    raw = await chatJson([
      { role: "system", content: system },
      { role: "user", content: JSON.stringify({ question: q, facts }) },
    ]);
  } catch (e) {
    console.error("[assistant] réponse impossible", e instanceof Error ? e.message : "inconnu");
    return "failed";
  }
  const r = (raw ?? {}) as { answer?: unknown; links?: unknown };
  const answer = typeof r.answer === "string" ? r.answer.trim().slice(0, 2000) : "";
  if (!answer) return "failed";
  const links = (Array.isArray(r.links) ? r.links : [])
    .filter((l): l is AssistantLink => typeof l === "string" && l in ASSISTANT_LINKS)
    .slice(0, 3);
  await database.insert(auditLog).values({
    organizationId: who.organizationId,
    userId: who.userId,
    action: "assistant.ask",
    entity: "organization",
    entityId: who.organizationId,
    data: { length: q.length },
  });
  return { answer, links };
}
