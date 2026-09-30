import { and, eq, inArray, isNull, lte, sql } from "drizzle-orm";
import { nextFiscalYear } from "@/lib/fiscal-year";
import { canSetUpAccounting } from "./company";
import type { Db } from "./db";
import { auditLog, bankTransactions, fiscalYears, invoices } from "./db/schema";
import { appendEntry, LedgerError, type Posting, roleAccounts } from "./ledger";
import { accountBalances, incomeStatement } from "./reports";

type Who = { organizationId: string; userId: string };

export type ClosingCheck = { code: string; count?: number };

/** Ce qui empêche de clôturer un exercice : pièces non comptabilisées, banque en attente, ordre. */
export async function closingChecks(
  database: Db,
  organizationId: string,
  yearId: string,
): Promise<ClosingCheck[]> {
  const [year] = await database
    .select()
    .from(fiscalYears)
    .where(and(eq(fiscalYears.id, yearId), eq(fiscalYears.organizationId, organizationId)));
  if (!year) return [{ code: "notFound" }];
  if (year.status !== "open") return [{ code: "alreadyClosed" }];
  const checks: ClosingCheck[] = [];
  const [earlier] = await database
    .select({ id: fiscalYears.id })
    .from(fiscalYears)
    .where(
      and(
        eq(fiscalYears.organizationId, organizationId),
        eq(fiscalYears.status, "open"),
        sql`${fiscalYears.startDate} < ${year.startDate}`,
      ),
    );
  if (earlier) checks.push({ code: "earlierOpen" });
  const [docs] = await database
    .select({ n: sql<number>`count(*)::int` })
    .from(invoices)
    .where(
      and(
        eq(invoices.organizationId, organizationId),
        inArray(invoices.kind, ["invoice", "credit_note"]),
        eq(invoices.status, "issued"),
        isNull(invoices.journalEntryId),
        lte(invoices.issueDate, year.endDate),
      ),
    );
  if ((docs?.n ?? 0) > 0) checks.push({ code: "unposted", count: docs?.n });
  const [bank] = await database
    .select({ n: sql<number>`count(*)::int` })
    .from(bankTransactions)
    .where(
      and(
        eq(bankTransactions.organizationId, organizationId),
        inArray(bankTransactions.status, ["new", "proposed"]),
        lte(bankTransactions.bookingDate, year.endDate),
      ),
    );
  if ((bank?.n ?? 0) > 0) checks.push({ code: "pendingBank", count: bank?.n });
  return checks;
}

export type CloseResult =
  | { ok: true; resultCents: number; nextYearId: string }
  | { ok: false; reason: string };

/**
 * Clôture d'un exercice : le résultat passe des comptes de charges et produits au compte « bénéfice
 * ou perte de l'exercice », l'exercice suivant s'ouvre (créé au besoin) avec les soldes du bilan
 * repris en écriture d'ouverture, puis l'exercice clôturé n'accepte plus aucune écriture.
 */
export async function closeFiscalYear(
  database: Db,
  who: Who,
  yearId: string,
): Promise<CloseResult> {
  if (!(await canSetUpAccounting(database, who.organizationId, who.userId)))
    return { ok: false, reason: "forbidden" };
  const blocking = await closingChecks(database, who.organizationId, yearId);
  if (blocking.length > 0) return { ok: false, reason: blocking[0]?.code ?? "blocked" };
  const roles = await roleAccounts(database, who.organizationId);
  if (!roles.annual_result) return { ok: false, reason: "noChart" };

  try {
    return await database.transaction(async (tx) => {
      const tdb = tx as unknown as Db;
      const [year] = await tx
        .select()
        .from(fiscalYears)
        .where(eq(fiscalYears.id, yearId))
        .for("update");
      if (year?.status !== "open") throw new LedgerError("alreadyClosed");

      // 1. Résultat : chaque charge et chaque produit est soldé contre le compte de résultat.
      const balances = await accountBalances(tdb, who.organizationId, year.id);
      const { resultCents } = incomeStatement(balances);
      const closing: Posting[] = balances
        .filter((b) => b.account.type === "revenue" || b.account.type === "expense")
        .map((b) => ({ accountId: b.account.id, amountCents: b.creditCents - b.debitCents }));
      closing.push({ accountId: roles.annual_result ?? "", amountCents: -resultCents });
      if (closing.filter((p) => p.amountCents !== 0).length >= 2) {
        await appendEntry(tdb, who, {
          entryDate: year.endDate,
          description: `Jahresabschluss / Clôture ${year.startDate} – ${year.endDate}`,
          sourceType: "closing",
          sourceId: year.id,
          postings: closing,
        });
      }

      // 2. Exercice suivant, ouvert au besoin.
      const next = nextFiscalYear(year.endDate);
      let [following] = await tx
        .select()
        .from(fiscalYears)
        .where(
          and(
            eq(fiscalYears.organizationId, who.organizationId),
            eq(fiscalYears.startDate, next.start),
          ),
        );
      if (!following) {
        [following] = await tx
          .insert(fiscalYears)
          .values({ organizationId: who.organizationId, startDate: next.start, endDate: next.end })
          .returning();
      }
      if (!following) throw new Error("next_year");

      // 3. Ouverture : soldes du bilan (résultat compris) repris au premier jour de l'exercice suivant.
      const sheet = await tx
        .select({
          accountId: sql<string>`jl.account_id`,
          net: sql<string>`sum(jl.debit_cents - jl.credit_cents)`,
        })
        .from(
          sql`journal_lines jl join journal_entries je on je.id = jl.entry_id join accounts a on a.id = jl.account_id`,
        )
        .where(sql`je.fiscal_year_id = ${year.id} and a.type in ('asset', 'liability', 'equity')`)
        .groupBy(sql`jl.account_id`);
      const opening: Posting[] = sheet
        .map((r) => ({ accountId: r.accountId, amountCents: Number(r.net) }))
        .filter((p) => p.amountCents !== 0);
      if (opening.length >= 2) {
        await appendEntry(tdb, who, {
          entryDate: following.startDate,
          description: `Eröffnungsbilanz / Bilan d'ouverture ${following.startDate}`,
          sourceType: "opening",
          sourceId: year.id,
          postings: opening,
        });
      }

      // 4. Exercice clos : plus aucune écriture n'y entre (appendEntry refuse un exercice fermé).
      await tx
        .update(fiscalYears)
        .set({ status: "closed", closedAt: new Date() })
        .where(eq(fiscalYears.id, year.id));
      await tx.insert(auditLog).values({
        organizationId: who.organizationId,
        userId: who.userId,
        action: "fiscal_year.close",
        entity: "fiscal_year",
        entityId: year.id,
        data: { resultCents },
      });
      return { ok: true as const, resultCents, nextYearId: following.id };
    });
  } catch (e) {
    if (e instanceof LedgerError) return { ok: false, reason: e.message };
    throw e;
  }
}
