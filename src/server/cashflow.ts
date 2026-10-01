import { and, eq, inArray } from "drizzle-orm";
import { toHome } from "@/lib/currencies";
import { addDays } from "@/lib/fiscal-year";
import { listFiscalYears } from "./accounting";
import { expectedCollections } from "./collections";
import type { Db } from "./db";
import { organizations, supplierBills } from "./db/schema";
import { accountBalances } from "./reports";

export type CashWeek = {
  weekStart: string;
  inCents: number;
  outCents: number;
  /** Liquidités à la fin de la semaine. */
  closingCents: number;
};

export type CashForecast = {
  currency: string;
  openingCents: number;
  weeks: CashWeek[];
  laterInCents: number;
  laterOutCents: number;
  /** Première semaine où les liquidités passent sous zéro, s'il y en a une. */
  shortfall: CashWeek | null;
};

/** Lundi de la semaine d'une date. */
export function mondayOf(date: string): string {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return addDays(date, -((day + 6) % 7));
}

/**
 * Semaine par semaine : liquidités de départ, plus les encaissements attendus, moins les paiements
 * prévus. Un paiement déjà échu tombe dans la semaine en cours.
 */
export function buildForecast(
  currency: string,
  openingCents: number,
  inflows: { weekStart: string; cents: number }[],
  outflows: { date: string; cents: number }[],
  today: string,
  weeks: number,
): CashForecast {
  const monday = mondayOf(today);
  const rows = Array.from({ length: weeks }, (_, k) => ({
    weekStart: addDays(monday, 7 * k),
    inCents: 0,
    outCents: 0,
    closingCents: 0,
  }));
  const index = (date: string) =>
    Math.floor(
      (Date.parse(mondayOf(date < today ? today : date)) - Date.parse(monday)) / 604_800_000,
    );
  let laterInCents = 0;
  let laterOutCents = 0;
  for (const i of inflows) {
    const row = rows[index(i.weekStart)];
    if (row) row.inCents += i.cents;
    else laterInCents += i.cents;
  }
  for (const o of outflows) {
    const row = rows[index(o.date)];
    if (row) row.outCents += o.cents;
    else laterOutCents += o.cents;
  }
  let balance = openingCents;
  let shortfall: CashWeek | null = null;
  for (const row of rows) {
    balance += row.inCents - row.outCents;
    row.closingCents = balance;
    if (balance < 0 && !shortfall) shortfall = row;
  }
  return { currency, openingCents, weeks: rows, laterInCents, laterOutCents, shortfall };
}

/**
 * Prévision de trésorerie : liquidités du jour (comptes bancaires et caisse), factures ouvertes à la
 * date où chaque client paie d'habitude, factures fournisseurs et notes de frais à leur échéance.
 */
export async function cashForecast(
  database: Db,
  organizationId: string,
  today: string,
  weeks = 13,
): Promise<CashForecast> {
  const [org] = await database
    .select({ currency: organizations.currency })
    .from(organizations)
    .where(eq(organizations.id, organizationId));
  if (!org) throw new Error("organization_missing");
  const years = await listFiscalYears(database, organizationId);
  const year = years.find((y) => y.startDate <= today && y.endDate >= today) ?? years[0];
  const balances = year ? await accountBalances(database, organizationId, year.id) : [];
  const openingCents = balances
    .filter((b) => b.account.role === "bank" || b.account.role === "cash")
    .reduce((s, b) => s + b.balanceCents, 0);
  const collections = await expectedCollections(
    database,
    organizationId,
    org.currency,
    today,
    weeks,
  );
  const inflows = collections.weeks.map((w) => ({
    weekStart: w.weekStart,
    cents: w.expectedCents,
  }));
  if (collections.laterCents > 0)
    inflows.push({ weekStart: addDays(mondayOf(today), 7 * weeks), cents: collections.laterCents });
  const bills = await database
    .select()
    .from(supplierBills)
    .where(
      and(
        eq(supplierBills.organizationId, organizationId),
        inArray(supplierBills.status, ["draft", "approved", "scheduled"]),
      ),
    );
  // Factures en devise : au cours figé à l'approbation ; un brouillon en devise sans cours est omis.
  const outflows = bills
    .filter((b) => b.currency === org.currency || b.fxRate)
    .map((b) => ({
      date: b.dueDate,
      cents: b.currency === org.currency ? b.totalCents : toHome(b.totalCents, b.fxRate),
    }));
  return buildForecast(org.currency, openingCents, inflows, outflows, today, weeks);
}
