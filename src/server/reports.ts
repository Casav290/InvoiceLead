import { and, asc, eq, sql } from "drizzle-orm";
import type { Db } from "./db";
import { type Account, accounts, journalEntries, journalLines } from "./db/schema";

export type AccountBalance = {
  account: Account;
  debitCents: number;
  creditCents: number;
  /** Solde au sens du compte : débiteur pour un actif ou une charge, créditeur sinon. */
  balanceCents: number;
};

const debitSide = (type: string) => type === "asset" || type === "expense";

/** Mouvements et soldes de chaque compte mouvementé dans l'exercice. */
export async function accountBalances(
  database: Db,
  organizationId: string,
  fiscalYearId: string,
): Promise<AccountBalance[]> {
  const rows = await database
    .select({
      account: accounts,
      debit: sql<string>`coalesce(sum(${journalLines.debitCents}), 0)`,
      credit: sql<string>`coalesce(sum(${journalLines.creditCents}), 0)`,
    })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
    .innerJoin(accounts, eq(accounts.id, journalLines.accountId))
    .where(
      and(
        eq(journalEntries.organizationId, organizationId),
        eq(journalEntries.fiscalYearId, fiscalYearId),
      ),
    )
    .groupBy(accounts.id)
    .orderBy(asc(accounts.number));
  return rows.map((r) => {
    const debitCents = Number(r.debit);
    const creditCents = Number(r.credit);
    const raw = debitCents - creditCents;
    return {
      account: r.account,
      debitCents,
      creditCents,
      balanceCents: debitSide(r.account.type) ? raw : -raw,
    };
  });
}

export type Group = { key: string; totalCents: number; rows: AccountBalance[] };

function group(rows: AccountBalance[], keyOf: (a: Account) => string): Group[] {
  const map = new Map<string, AccountBalance[]>();
  for (const r of rows) {
    const k = keyOf(r.account);
    map.set(k, [...(map.get(k) ?? []), r]);
  }
  return [...map.entries()].map(([key, list]) => ({
    key,
    rows: list,
    totalCents: list.reduce((s, r) => s + r.balanceCents, 0),
  }));
}

/**
 * Compte de résultat par classe (3 produits d'exploitation, 4 à 6 charges, 7 annexes, 8 hors
 * exploitation). Un compte de produit dans une classe de charges (produits financiers) compte en moins.
 */
export function incomeStatement(balances: AccountBalance[]) {
  const rows = balances.filter((b) => b.account.type === "revenue" || b.account.type === "expense");
  const signed = rows.map((b) => ({
    ...b,
    // Produit positif, charge négative : le résultat est la simple somme.
    balanceCents: b.account.type === "revenue" ? b.balanceCents : -b.balanceCents,
  }));
  const groups = group(signed, (a) => a.number.slice(0, 1));
  const resultCents = signed.reduce((s, b) => s + b.balanceCents, 0);
  return { groups, resultCents };
}

/** Bilan : actifs d'un côté, dettes et capitaux propres (résultat de l'exercice compris) de l'autre. */
export function balanceSheet(balances: AccountBalance[], resultCents: number) {
  const assets = balances.filter((b) => b.account.type === "asset");
  const liabilities = balances.filter((b) => b.account.type === "liability");
  const equity = balances.filter((b) => b.account.type === "equity");
  const assetsCents = assets.reduce((s, b) => s + b.balanceCents, 0);
  const liabilitiesCents = liabilities.reduce((s, b) => s + b.balanceCents, 0);
  const equityCents = equity.reduce((s, b) => s + b.balanceCents, 0) + resultCents;
  return {
    assets: group(assets, (a) => a.number.slice(0, 2)),
    liabilities: group(liabilities, (a) => a.number.slice(0, 2)),
    equity,
    assetsCents,
    liabilitiesCents,
    equityCents,
    resultCents,
    balanced: assetsCents === liabilitiesCents + equityCents,
  };
}

export type LedgerLine = {
  entryId: string;
  number: number;
  entryDate: string;
  description: string;
  debitCents: number;
  creditCents: number;
  runningCents: number;
};

/** Grand livre d'un compte sur l'exercice, avec le solde progressif. */
export async function accountLedger(
  database: Db,
  organizationId: string,
  fiscalYearId: string,
  accountId: string,
): Promise<{ account: Account; lines: LedgerLine[] } | null> {
  if (!/^[0-9a-f-]{36}$/i.test(accountId)) return null;
  const [account] = await database
    .select()
    .from(accounts)
    .where(and(eq(accounts.id, accountId), eq(accounts.organizationId, organizationId)));
  if (!account) return null;
  const rows = await database
    .select({
      entryId: journalEntries.id,
      number: journalEntries.number,
      entryDate: journalEntries.entryDate,
      description: journalEntries.description,
      debitCents: journalLines.debitCents,
      creditCents: journalLines.creditCents,
    })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
    .where(
      and(
        eq(journalLines.accountId, accountId),
        eq(journalEntries.fiscalYearId, fiscalYearId),
        eq(journalEntries.organizationId, organizationId),
      ),
    )
    .orderBy(asc(journalEntries.entryDate), asc(journalEntries.number), asc(journalLines.position));
  let running = 0;
  const sign = debitSide(account.type) ? 1 : -1;
  return {
    account,
    lines: rows.map((r) => {
      running += sign * (r.debitCents - r.creditCents);
      return { ...r, runningCents: running };
    }),
  };
}
