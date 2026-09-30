import { createHash } from "node:crypto";
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lte, sql } from "drizzle-orm";
import type { AccountRole } from "@/countries/ch/chart-of-accounts";
import { clearingAccount } from "@/countries/clearing";
import { vatOf } from "@/lib/money";
import type { Db } from "./db";
import {
  accounts,
  auditLog,
  fiscalYears,
  type Invoice,
  invoiceLines,
  invoicePayments,
  invoices,
  journalEntries,
  journalLines,
  organizations,
  vatReturns,
} from "./db/schema";

type Who = { organizationId: string; userId: string };

/** Montant signé : positif au débit, négatif au crédit. */
export type Posting = {
  accountId: string;
  amountCents: number;
  vatRateBp?: number | null;
  vatBaseCents?: number | null;
};

export type EntryInput = {
  entryDate: string;
  description: string;
  sourceType:
    | "invoice"
    | "credit_note"
    | "payment"
    | "payment_reversal"
    | "bank"
    | "vat"
    | "closing"
    | "opening"
    | "manual";
  sourceId?: string | null;
  reversalOf?: string | null;
  postings: Posting[];
};

export const GENESIS_HASH = "0".repeat(64);

type HashInput = {
  seq: number;
  number: number;
  fiscalYearId: string;
  entryDate: string;
  description: string;
  sourceType: string;
  sourceId: string | null;
  reversalOf: string | null;
  prevHash: string;
  lines: {
    accountId: string;
    debitCents: number;
    creditCents: number;
    vatRateBp: number | null;
    vatBaseCents: number | null;
  }[];
};

/** Empreinte d'une écriture : contenu complet, dans un ordre fixe, plus l'empreinte précédente. */
export function entryHash(e: HashInput): string {
  const canonical = JSON.stringify([
    e.seq,
    e.number,
    e.fiscalYearId,
    e.entryDate,
    e.description,
    e.sourceType,
    e.sourceId,
    e.reversalOf,
    e.prevHash,
    e.lines.map((l) => [l.accountId, l.debitCents, l.creditCents, l.vatRateBp, l.vatBaseCents]),
  ]);
  return createHash("sha256").update(canonical).digest("hex");
}

export class LedgerError extends Error {}

function reasonOf(e: LedgerError): NonNullable<PostingSummary["reason"]> {
  return e.message === "noChart" || e.message === "vatPeriodClosed" ? e.message : "noFiscalYear";
}

/** Exercice ouvert qui contient la date, ou null. */
export async function openYearFor(database: Db, organizationId: string, date: string) {
  const [year] = await database
    .select()
    .from(fiscalYears)
    .where(
      and(
        eq(fiscalYears.organizationId, organizationId),
        lte(fiscalYears.startDate, date),
        gte(fiscalYears.endDate, date),
      ),
    )
    .limit(1);
  return year && year.status === "open" ? year : null;
}

export async function roleAccounts(
  database: Db,
  organizationId: string,
): Promise<Partial<Record<AccountRole, string>>> {
  const rows = await database
    .select({ id: accounts.id, role: accounts.role })
    .from(accounts)
    .where(and(eq(accounts.organizationId, organizationId), isNotNull(accounts.role)));
  return Object.fromEntries(rows.map((r) => [r.role, r.id]));
}

/**
 * Ajoute une écriture équilibrée au journal. À appeler dans une transaction : l'organisation est
 * verrouillée le temps de prendre le numéro suivant et l'empreinte précédente.
 */
export async function appendEntry(tx: Db, who: Who, input: EntryInput) {
  const postings = input.postings.filter((p) => p.amountCents !== 0);
  if (postings.length < 2) throw new LedgerError("empty_entry");
  if (postings.reduce((s, p) => s + p.amountCents, 0) !== 0) throw new LedgerError("unbalanced");
  const year = await openYearFor(tx, who.organizationId, input.entryDate);
  if (!year) throw new LedgerError("noFiscalYear");
  // Une période TVA validée est close : plus aucune écriture n'y entre (le décompte est figé).
  const [closed] = await tx
    .select({ id: vatReturns.id })
    .from(vatReturns)
    .where(
      and(
        eq(vatReturns.organizationId, who.organizationId),
        lte(vatReturns.periodStart, input.entryDate),
        gte(vatReturns.periodEnd, input.entryDate),
      ),
    )
    .limit(1);
  if (closed) throw new LedgerError("vatPeriodClosed");

  await tx
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.id, who.organizationId))
    .for("update");
  const [last] = await tx
    .select({ seq: journalEntries.seq, hash: journalEntries.hash })
    .from(journalEntries)
    .where(eq(journalEntries.organizationId, who.organizationId))
    .orderBy(desc(journalEntries.seq))
    .limit(1);
  const [lastInYear] = await tx
    .select({ number: sql<number>`max(${journalEntries.number})` })
    .from(journalEntries)
    .where(eq(journalEntries.fiscalYearId, year.id));

  const lines = postings.map((p) => ({
    accountId: p.accountId,
    debitCents: p.amountCents > 0 ? p.amountCents : 0,
    creditCents: p.amountCents < 0 ? -p.amountCents : 0,
    vatRateBp: p.vatRateBp ?? null,
    vatBaseCents: p.vatBaseCents ?? null,
  }));
  const head = {
    seq: (last?.seq ?? 0) + 1,
    number: Number(lastInYear?.number ?? 0) + 1,
    fiscalYearId: year.id,
    entryDate: input.entryDate,
    description: input.description,
    sourceType: input.sourceType,
    sourceId: input.sourceId ?? null,
    reversalOf: input.reversalOf ?? null,
    prevHash: last?.hash ?? GENESIS_HASH,
  };
  const hash = entryHash({ ...head, lines });
  const [entry] = await tx
    .insert(journalEntries)
    .values({ ...head, organizationId: who.organizationId, hash, createdBy: who.userId })
    .returning();
  if (!entry) throw new Error("entry_not_saved");
  await tx
    .insert(journalLines)
    .values(lines.map((l, i) => ({ ...l, entryId: entry.id, position: i + 1 })));
  return entry;
}

/** Écritures d'une facture émise (ou d'un avoir, en sens inverse). */
async function documentPostings(
  tx: Db,
  invoice: Invoice,
  roles: Partial<Record<AccountRole, string>>,
): Promise<Posting[]> {
  const receivable = roles.receivable;
  const revenue = roles.revenue_default;
  const vatOutput = roles.vat_output;
  if (!receivable || !revenue || !vatOutput) throw new LedgerError("noChart");
  const groups = await tx
    .select({
      rateBp: invoiceLines.vatRateBp,
      net: sql<string>`sum(${invoiceLines.netCents})`,
    })
    .from(invoiceLines)
    .where(eq(invoiceLines.invoiceId, invoice.id))
    .groupBy(invoiceLines.vatRateBp)
    .orderBy(desc(invoiceLines.vatRateBp));
  const sign = invoice.kind === "credit_note" ? -1 : 1;
  const postings: Posting[] = [{ accountId: receivable, amountCents: sign * invoice.totalCents }];
  let vatTotal = 0;
  for (const g of groups) {
    const net = Number(g.net);
    postings.push({
      accountId: revenue,
      amountCents: -sign * net,
      vatRateBp: invoice.vatRegistered ? g.rateBp : null,
    });
    if (invoice.vatRegistered && g.rateBp > 0) {
      // Même arrondi que sur la facture : TVA par taux, au centime.
      const vat = vatOf(net, g.rateBp);
      vatTotal += vat;
      postings.push({
        accountId: vatOutput,
        amountCents: -sign * vat,
        vatRateBp: g.rateBp,
        vatBaseCents: sign * net,
      });
    }
  }
  if (vatTotal !== invoice.vatCents) throw new LedgerError("vat_mismatch");
  return postings;
}

export type PostingSummary = {
  posted: number;
  waiting: number;
  reason: "noChart" | "noFiscalYear" | "vatPeriodClosed" | null;
};

/**
 * Comptabilise tout ce qui ne l'est pas encore : pièces émises puis paiements, par date. Une pièce
 * qu'on ne peut pas encore comptabiliser (plan comptable absent, exercice non ouvert) attend, et sera
 * reprise au prochain passage.
 */
export async function postPending(database: Db, who: Who): Promise<PostingSummary> {
  let posted = 0;
  let waiting = 0;
  let reason: PostingSummary["reason"] = null;
  await ensureClearingAccount(database, who.organizationId);
  const roles = await roleAccounts(database, who.organizationId);

  const docs = await database
    .select({ id: invoices.id })
    .from(invoices)
    .where(
      and(
        eq(invoices.organizationId, who.organizationId),
        inArray(invoices.kind, ["invoice", "credit_note"]),
        eq(invoices.status, "issued"),
        isNull(invoices.journalEntryId),
      ),
    )
    .orderBy(asc(invoices.issueDate), asc(invoices.issuedAt));
  for (const d of docs) {
    try {
      const done = await database.transaction(async (tx) => {
        const [invoice] = await tx
          .select()
          .from(invoices)
          .where(eq(invoices.id, d.id))
          .for("update");
        if (!invoice || invoice.journalEntryId) return false;
        const entry = await appendEntry(tx as unknown as Db, who, {
          entryDate: invoice.issueDate,
          description:
            `${invoice.kind === "credit_note" ? "Gutschrift / Avoir" : "Rechnung / Facture"} ${invoice.number}, ${invoice.recipient?.name ?? ""}`.trim(),
          sourceType: invoice.kind === "credit_note" ? "credit_note" : "invoice",
          sourceId: invoice.id,
          postings: await documentPostings(tx as unknown as Db, invoice, roles),
        });
        await tx.update(invoices).set({ journalEntryId: entry.id }).where(eq(invoices.id, d.id));
        return true;
      });
      if (done) posted += 1;
    } catch (e) {
      if (!(e instanceof LedgerError)) throw e;
      waiting += 1;
      reason ??= reasonOf(e);
    }
  }

  const payments = await database
    .select({ id: invoicePayments.id })
    .from(invoicePayments)
    .innerJoin(invoices, eq(invoices.id, invoicePayments.invoiceId))
    .where(
      and(
        eq(invoicePayments.organizationId, who.organizationId),
        isNull(invoicePayments.journalEntryId),
        isNotNull(invoices.journalEntryId),
      ),
    )
    .orderBy(asc(invoicePayments.paidOn), asc(invoicePayments.createdAt));
  for (const p of payments) {
    try {
      const done = await database.transaction(async (tx) => {
        const [payment] = await tx
          .select({ payment: invoicePayments, number: invoices.number })
          .from(invoicePayments)
          .innerJoin(invoices, eq(invoices.id, invoicePayments.invoiceId))
          .where(eq(invoicePayments.id, p.id))
          .for("update", { of: invoicePayments });
        if (!payment || payment.payment.journalEntryId) return false;
        const entry = await appendEntry(tx as unknown as Db, who, {
          entryDate: payment.payment.paidOn,
          description: `Zahlung / Paiement ${payment.number}`,
          sourceType: "payment",
          sourceId: payment.payment.id,
          postings: paymentPostings(payment.payment.method, payment.payment.amountCents, roles),
        });
        await tx
          .update(invoicePayments)
          .set({ journalEntryId: entry.id })
          .where(eq(invoicePayments.id, p.id));
        return true;
      });
      if (done) posted += 1;
    } catch (e) {
      if (!(e instanceof LedgerError)) throw e;
      waiting += 1;
      reason ??= reasonOf(e);
    }
  }

  // Pièces émises dont la facture elle-même attend encore : leurs paiements attendent aussi.
  const [blocked] = await database
    .select({ n: sql<number>`count(*)::int` })
    .from(invoicePayments)
    .innerJoin(invoices, eq(invoices.id, invoicePayments.invoiceId))
    .where(
      and(
        eq(invoicePayments.organizationId, who.organizationId),
        isNull(invoicePayments.journalEntryId),
        isNull(invoices.journalEntryId),
      ),
    );
  waiting += blocked?.n ?? 0;

  if (posted > 0) {
    await database.insert(auditLog).values({
      organizationId: who.organizationId,
      userId: who.userId,
      action: "ledger.post",
      entity: "organization",
      entityId: who.organizationId,
      data: { posted },
    });
  }
  return { posted, waiting, reason };
}

/**
 * Plan installé avant l'arrivée des paiements en ligne : le compte d'attente est ajouté au premier
 * paiement en ligne à comptabiliser.
 */
async function ensureClearingAccount(database: Db, organizationId: string) {
  const [online] = await database
    .select({ id: invoicePayments.id })
    .from(invoicePayments)
    .where(
      and(
        eq(invoicePayments.organizationId, organizationId),
        eq(invoicePayments.method, "online"),
        isNull(invoicePayments.journalEntryId),
      ),
    )
    .limit(1);
  if (!online) return;
  const roles = await roleAccounts(database, organizationId);
  if (roles.payment_clearing || !roles.bank) return;
  const [org] = await database
    .select({ country: organizations.country })
    .from(organizations)
    .where(eq(organizations.id, organizationId));
  const a = clearingAccount(org?.country);
  await database
    .insert(accounts)
    .values({
      organizationId,
      number: a.number,
      nameDe: a.de,
      nameFr: a.fr,
      nameEn: a.en ?? null,
      type: a.type,
      role: a.role ?? null,
    })
    .onConflictDoNothing();
}

export function paymentPostings(
  method: string,
  amountCents: number,
  roles: Partial<Record<AccountRole, string>>,
): Posting[] {
  // Paiement en ligne : il attend sur le compte du prestataire jusqu'au versement sur la banque.
  const money =
    method === "cash" ? roles.cash : method === "online" ? roles.payment_clearing : roles.bank;
  if (!money || !roles.receivable) throw new LedgerError("noChart");
  return [
    { accountId: money, amountCents },
    { accountId: roles.receivable, amountCents: -amountCents },
  ];
}

/** Extourne l'écriture d'un paiement supprimé, à la date du jour (ou à sa date si l'exercice du jour n'est pas ouvert). */
export async function reversePaymentEntry(
  tx: Db,
  who: Who,
  entryId: string,
  paymentId: string,
  today: string,
) {
  const [original] = await tx
    .select()
    .from(journalEntries)
    .where(
      and(eq(journalEntries.id, entryId), eq(journalEntries.organizationId, who.organizationId)),
    );
  if (!original) throw new LedgerError("noEntry");
  const lines = await tx
    .select()
    .from(journalLines)
    .where(eq(journalLines.entryId, entryId))
    .orderBy(asc(journalLines.position));
  const date = (await openYearFor(tx, who.organizationId, today)) ? today : original.entryDate;
  return appendEntry(tx, who, {
    entryDate: date,
    description: `Storno / Extourne: ${original.description}`,
    sourceType: "payment_reversal",
    sourceId: paymentId,
    reversalOf: original.id,
    postings: lines.map((l) => ({
      accountId: l.accountId,
      amountCents: l.creditCents - l.debitCents,
      vatRateBp: l.vatRateBp,
      vatBaseCents: l.vatBaseCents === null ? null : -l.vatBaseCents,
    })),
  });
}

/** Recalcule toute la chaîne d'empreintes ; rend la première écriture qui ne correspond plus. */
export async function verifyChain(
  database: Db,
  organizationId: string,
): Promise<{ ok: true; count: number } | { ok: false; seq: number }> {
  const entries = await database
    .select()
    .from(journalEntries)
    .where(eq(journalEntries.organizationId, organizationId))
    .orderBy(asc(journalEntries.seq));
  let prev = GENESIS_HASH;
  for (const e of entries) {
    const lines = await database
      .select()
      .from(journalLines)
      .where(eq(journalLines.entryId, e.id))
      .orderBy(asc(journalLines.position));
    const expected = entryHash({
      ...e,
      prevHash: prev,
      lines: lines.map((l) => ({
        accountId: l.accountId,
        debitCents: l.debitCents,
        creditCents: l.creditCents,
        vatRateBp: l.vatRateBp,
        vatBaseCents: l.vatBaseCents,
      })),
    });
    if (e.prevHash !== prev || e.hash !== expected) return { ok: false, seq: e.seq };
    prev = e.hash;
  }
  return { ok: true, count: entries.length };
}

/** Nombre de pièces et paiements émis qui ne sont pas encore au journal. */
export async function countUnposted(database: Db, organizationId: string): Promise<number> {
  const [docs] = await database
    .select({ n: sql<number>`count(*)::int` })
    .from(invoices)
    .where(
      and(
        eq(invoices.organizationId, organizationId),
        inArray(invoices.kind, ["invoice", "credit_note"]),
        eq(invoices.status, "issued"),
        isNull(invoices.journalEntryId),
      ),
    );
  const [pays] = await database
    .select({ n: sql<number>`count(*)::int` })
    .from(invoicePayments)
    .where(
      and(
        eq(invoicePayments.organizationId, organizationId),
        isNull(invoicePayments.journalEntryId),
      ),
    );
  return (docs?.n ?? 0) + (pays?.n ?? 0);
}

export type JournalRow = {
  id: string;
  number: number;
  entryDate: string;
  description: string;
  sourceType: string;
  lines: {
    accountNumber: string;
    nameDe: string;
    nameFr: string;
    debitCents: number;
    creditCents: number;
  }[];
};

/** Écritures d'un exercice, les plus récentes d'abord. */
export async function listJournal(
  database: Db,
  organizationId: string,
  fiscalYearId: string,
  limit = 300,
): Promise<JournalRow[]> {
  const entries = await database
    .select()
    .from(journalEntries)
    .where(
      and(
        eq(journalEntries.organizationId, organizationId),
        eq(journalEntries.fiscalYearId, fiscalYearId),
      ),
    )
    .orderBy(desc(journalEntries.number))
    .limit(limit);
  if (entries.length === 0) return [];
  const lines = await database
    .select({
      entryId: journalLines.entryId,
      position: journalLines.position,
      accountNumber: accounts.number,
      nameDe: accounts.nameDe,
      nameFr: accounts.nameFr,
      debitCents: journalLines.debitCents,
      creditCents: journalLines.creditCents,
    })
    .from(journalLines)
    .innerJoin(accounts, eq(accounts.id, journalLines.accountId))
    .where(
      inArray(
        journalLines.entryId,
        entries.map((e) => e.id),
      ),
    )
    .orderBy(asc(journalLines.position));
  return entries.map((e) => ({
    id: e.id,
    number: e.number,
    entryDate: e.entryDate,
    description: e.description,
    sourceType: e.sourceType,
    lines: lines.filter((l) => l.entryId === e.id),
  }));
}
