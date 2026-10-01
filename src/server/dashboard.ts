import { and, desc, eq, gte, inArray, lte, ne, sql } from "drizzle-orm";
import { addDays } from "@/lib/fiscal-year";
import type { Db } from "./db";
import { contacts, invoicePayments, invoices, organizations, supplierBills } from "./db/schema";

/**
 * Les chiffres du tableau de bord, en monnaie de l'entreprise : une pièce en devise compte à son
 * cours figé (`fx_rate`). Chiffre d'affaires hors taxes, net des avoirs ; encours toutes taxes,
 * frais de rappel compris.
 */
export type DashboardFigures = {
  currency: string;
  /** Douze derniers mois, le plus ancien d'abord : « AAAA-MM » et chiffre d'affaires HT. */
  months: { month: string; netCents: number }[];
  revenueMonthCents: number;
  revenuePrevMonthCents: number;
  revenueYearCents: number;
  invoicesMonth: number;
  collectedMonthCents: number;
  open: { count: number; cents: number };
  overdue: { count: number; cents: number };
  quotesOpen: { count: number; cents: number };
  quotesAccepted: { count: number; cents: number };
  /** Devis tranchés sur douze mois : part acceptée, null sans devis tranché. */
  acceptanceRate: number | null;
  drafts: number;
  billsToPay: { count: number; cents: number; overdue: number };
  overdueList: {
    id: string;
    number: string | null;
    contactName: string;
    dueDate: string;
    daysLate: number;
    openCents: number;
    currency: string;
  }[];
  quotesList: {
    id: string;
    number: string | null;
    contactName: string;
    issueDate: string;
    validUntil: string;
    netCents: number;
    currency: string;
  }[];
};

const monthOf = (iso: string) => iso.slice(0, 7);

/** Les douze mois finissant au mois de `today`, « AAAA-MM ». */
export function lastTwelveMonths(today: string): string[] {
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  return Array.from({ length: 12 }, (_, i) => {
    const k = y * 12 + (m - 1) - (11 - i);
    return `${Math.floor(k / 12)}-${String((k % 12) + 1).padStart(2, "0")}`;
  });
}

const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

export async function dashboardFigures(
  database: Db,
  organizationId: string,
  today: string,
): Promise<DashboardFigures> {
  const [org] = await database
    .select({ currency: organizations.currency })
    .from(organizations)
    .where(eq(organizations.id, organizationId));
  const home = org?.currency ?? "CHF";
  // Montant d'une pièce dans la monnaie de l'entreprise.
  const inHome = (cents: unknown) =>
    sql<number>`case when ${invoices.currency} = ${home} or ${invoices.fxRate} is null then ${cents} else round(${cents} * ${invoices.fxRate}) end`;
  const toHome = (cents: number, currency: string, fx: number | null) =>
    currency === home || !fx ? cents : Math.round(cents * fx);

  const months = lastTwelveMonths(today);
  const first = `${months[0]}-01`;
  const thisMonth = monthOf(today);
  const prevMonth = months[10] as string;

  // Chiffre d'affaires HT par mois : factures émises, moins les avoirs émis.
  const revenue = await database
    .select({
      month: sql<string>`to_char(${invoices.issueDate}, 'YYYY-MM')`,
      cents: sql<string>`sum(case when ${invoices.kind} = 'credit_note' then -1 else 1 end * ${inHome(invoices.netCents)})`,
      issued: sql<string>`count(*) filter (where ${invoices.kind} = 'invoice')`,
    })
    .from(invoices)
    .where(
      and(
        eq(invoices.organizationId, organizationId),
        inArray(invoices.kind, ["invoice", "credit_note"]),
        eq(invoices.status, "issued"),
        gte(invoices.issueDate, first),
        lte(invoices.issueDate, today),
      ),
    )
    .groupBy(sql`1`);
  const byMonth = new Map(revenue.map((r) => [r.month, r]));
  const series = months.map((month) => ({
    month,
    netCents: Number(byMonth.get(month)?.cents ?? 0),
  }));
  const year = today.slice(0, 4);

  // Encaissé ce mois : part de la créance soldée, en monnaie de l'entreprise.
  const [collected] = await database
    .select({
      cents: sql<
        string | null
      >`sum(coalesce(${invoicePayments.receivableHomeCents}, ${inHome(invoicePayments.amountCents)}))`,
    })
    .from(invoicePayments)
    .innerJoin(invoices, eq(invoices.id, invoicePayments.invoiceId))
    .where(
      and(
        eq(invoicePayments.organizationId, organizationId),
        gte(invoicePayments.paidOn, `${thisMonth}-01`),
        lte(invoicePayments.paidOn, today),
      ),
    );

  // Factures émises encore ouvertes.
  const issued = await database
    .select({
      id: invoices.id,
      number: invoices.number,
      dueDate: invoices.dueDate,
      totalCents: invoices.totalCents,
      currency: invoices.currency,
      fxRate: invoices.fxRate,
      contactName: contacts.name,
      paid: sql<string>`coalesce((select sum(p.amount_cents) from invoice_payments p where p.invoice_id = ${invoices.id}), 0)`,
      credited: sql<string>`coalesce((select sum(c.total_cents) from invoices c where c.related_invoice_id = ${invoices.id} and c.kind = 'credit_note' and c.status = 'issued'), 0)`,
      charges: sql<string>`coalesce((select sum(r.fee_cents + r.interest_cents) from invoice_reminders r where r.invoice_id = ${invoices.id} and r.waived_at is null), 0)`,
    })
    .from(invoices)
    .innerJoin(contacts, eq(contacts.id, invoices.contactId))
    .where(
      and(
        eq(invoices.organizationId, organizationId),
        eq(invoices.kind, "invoice"),
        eq(invoices.status, "issued"),
      ),
    );
  const openRows = issued
    .map((i) => ({
      ...i,
      openCents: i.totalCents - Number(i.paid) - Number(i.credited) + Number(i.charges),
    }))
    .filter((i) => i.openCents > 0);
  const late = openRows.filter((i) => i.dueDate < today);
  const sumHome = (rows: typeof openRows) =>
    rows.reduce((s, i) => s + toHome(i.openCents, i.currency, i.fxRate), 0);

  // Devis : en cours (émis, sans réponse), acceptés pas encore facturés, et taux d'acceptation.
  const quoteStats = await database
    .select({
      status: invoices.status,
      count: sql<string>`count(*)`,
      cents: sql<string>`sum(${inHome(invoices.netCents)})`,
      decided: sql<string>`count(*) filter (where ${invoices.issueDate} >= ${addDays(today, -365)})`,
    })
    .from(invoices)
    .where(and(eq(invoices.organizationId, organizationId), eq(invoices.kind, "quote")))
    .groupBy(invoices.status);
  const q = (status: string) => quoteStats.find((s) => s.status === status);
  const won = Number(q("accepted")?.decided ?? 0) + Number(q("invoiced")?.decided ?? 0);
  const lost = Number(q("declined")?.decided ?? 0);
  const drafts = quoteStats
    .filter((s) => s.status === "draft")
    .reduce((n, s) => n + Number(s.count), 0);

  const quotesList = await database
    .select({
      id: invoices.id,
      number: invoices.number,
      contactName: contacts.name,
      issueDate: invoices.issueDate,
      validUntil: invoices.dueDate,
      netCents: invoices.netCents,
      currency: invoices.currency,
    })
    .from(invoices)
    .innerJoin(contacts, eq(contacts.id, invoices.contactId))
    .where(
      and(
        eq(invoices.organizationId, organizationId),
        eq(invoices.kind, "quote"),
        eq(invoices.status, "issued"),
      ),
    )
    .orderBy(desc(invoices.issueDate), desc(invoices.createdAt))
    .limit(5);

  const [invoiceDrafts] = await database
    .select({ n: sql<string>`count(*)` })
    .from(invoices)
    .where(
      and(
        eq(invoices.organizationId, organizationId),
        inArray(invoices.kind, ["invoice", "credit_note"]),
        eq(invoices.status, "draft"),
      ),
    );

  // Factures fournisseurs et notes de frais pas encore payées.
  const bills = await database
    .select({
      totalCents: supplierBills.totalCents,
      currency: supplierBills.currency,
      fxRate: supplierBills.fxRate,
      dueDate: supplierBills.dueDate,
    })
    .from(supplierBills)
    .where(and(eq(supplierBills.organizationId, organizationId), ne(supplierBills.status, "paid")));

  return {
    currency: home,
    months: series,
    revenueMonthCents: series[11]?.netCents ?? 0,
    revenuePrevMonthCents: series.find((s) => s.month === prevMonth)?.netCents ?? 0,
    revenueYearCents: series
      .filter((s) => s.month.startsWith(year))
      .reduce((n, s) => n + s.netCents, 0),
    invoicesMonth: Number(byMonth.get(thisMonth)?.issued ?? 0),
    collectedMonthCents: Number(collected?.cents ?? 0),
    open: { count: openRows.length, cents: sumHome(openRows) },
    overdue: { count: late.length, cents: sumHome(late) },
    quotesOpen: { count: Number(q("issued")?.count ?? 0), cents: Number(q("issued")?.cents ?? 0) },
    quotesAccepted: {
      count: Number(q("accepted")?.count ?? 0),
      cents: Number(q("accepted")?.cents ?? 0),
    },
    acceptanceRate: won + lost > 0 ? won / (won + lost) : null,
    drafts: drafts + Number(invoiceDrafts?.n ?? 0),
    billsToPay: {
      count: bills.length,
      cents: bills.reduce((s, b) => s + toHome(b.totalCents, b.currency, b.fxRate), 0),
      overdue: bills.filter((b) => b.dueDate < today).length,
    },
    overdueList: late
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
      .slice(0, 5)
      .map((i) => ({
        id: i.id,
        number: i.number,
        contactName: i.contactName,
        dueDate: i.dueDate,
        daysLate: daysBetween(i.dueDate, today),
        openCents: i.openCents,
        currency: i.currency,
      })),
    quotesList,
  };
}
