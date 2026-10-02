import { and, asc, desc, eq, gte, inArray, isNull, ne, sql } from "drizzle-orm";
import { validateTransaction } from "./bank";
import { counterpartyKey, directionOf, learnRule } from "./booking-rules";
import type { Db } from "./db";
import {
  accounts,
  auditLog,
  type BankProposal,
  type BankTransaction,
  bankTransactions,
  bookingRules,
  journalLines,
  organizations,
  receipts,
  supplierBills,
} from "./db/schema";
import { LedgerError, reverseEntry } from "./ledger";
import { deletePayment } from "./payments";

type Who = { organizationId: string; userId: string };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Règle apprise confirmée au moins trois fois (0.88 + 3 × 0.03, voir ruleConfidence). */
export const RULE_AUTO = 0.965;
/** Confiance exigée d'une proposition de l'IA seule pour passer sans relecture. */
export const AI_AUTO = 0.97;
/** Sorties en dessous de ce montant : un justificatif manquant n'est pas signalé (frais, petits achats). */
export const RECEIPT_MIN_CENTS = 5_000;
/** Délai laissé pour déposer le justificatif d'une sortie avant de le réclamer. */
const RECEIPT_GRACE_DAYS = 7;

/**
 * Proposition assez sûre pour être comptabilisée sans clic : référence de paiement d'une facture,
 * règle apprise confirmée plusieurs fois, ou IA très confiante. Le reste attend une personne.
 */
export function autoSafe(proposal: BankProposal | null | undefined): boolean {
  if (!proposal) return false;
  if (proposal.source === "reference") return true;
  if (proposal.source === "rule") return proposal.confidence >= RULE_AUTO;
  return proposal.confidence >= AI_AUTO;
}

function addDays(iso: string, days: number) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export type Anomaly =
  | {
      kind: "duplicate";
      transactionId: string;
      otherId: string;
      date: string;
      amountCents: number;
      counterparty: string | null;
    }
  | {
      kind: "missingReceipt";
      transactionId: string;
      date: string;
      amountCents: number;
      counterparty: string | null;
    }
  | {
      kind: "unusualAmount";
      transactionId: string;
      date: string;
      amountCents: number;
      counterparty: string | null;
      usualCents: number;
    };

/**
 * Ce qu'une personne devrait regarder : mouvements en double (même montant, même contrepartie, à
 * trois jours près), sorties comptabilisées sans justificatif, montants inhabituels pour une
 * contrepartie (plus de trois fois sa médiane).
 */
export async function findAnomalies(
  database: Db,
  organizationId: string,
  today = new Date().toISOString().slice(0, 10),
): Promise<Anomaly[]> {
  const since = addDays(today, -120);
  const rows = await database
    .select()
    .from(bankTransactions)
    .where(
      and(
        eq(bankTransactions.organizationId, organizationId),
        ne(bankTransactions.status, "ignored"),
        gte(bankTransactions.bookingDate, since),
      ),
    )
    .orderBy(asc(bankTransactions.bookingDate));
  const out: Anomaly[] = [];

  // Doublons : le second mouvement est signalé, une seule fois par paire.
  for (let i = 0; i < rows.length; i++) {
    const a = rows[i] as BankTransaction;
    for (let j = i + 1; j < rows.length; j++) {
      const b = rows[j] as BankTransaction;
      if (b.bookingDate > addDays(a.bookingDate, 3)) break;
      if (
        a.amountCents === b.amountCents &&
        counterpartyKey(a.counterparty) !== null &&
        counterpartyKey(a.counterparty) === counterpartyKey(b.counterparty) &&
        (a.reference ?? "") === (b.reference ?? "")
      ) {
        out.push({
          kind: "duplicate",
          transactionId: b.id,
          otherId: a.id,
          date: b.bookingDate,
          amountCents: b.amountCents,
          counterparty: b.counterparty,
        });
      }
    }
  }

  // Sorties comptabilisées sur une charge, sans justificatif, au-delà du délai.
  const posted = rows.filter(
    (r) =>
      r.status === "posted" &&
      r.journalEntryId &&
      r.amountCents <= -RECEIPT_MIN_CENTS &&
      r.bookingDate <= addDays(today, -RECEIPT_GRACE_DAYS),
  );
  if (posted.length > 0) {
    const withReceipt = new Set(
      (
        await database
          .select({ tx: receipts.bankTransactionId })
          .from(receipts)
          .where(
            and(
              eq(receipts.organizationId, organizationId),
              inArray(
                receipts.bankTransactionId,
                posted.map((p) => p.id),
              ),
            ),
          )
      ).map((r) => r.tx),
    );
    const expenseEntries = new Set(
      (
        await database
          .select({ entryId: journalLines.entryId })
          .from(journalLines)
          .innerJoin(accounts, eq(accounts.id, journalLines.accountId))
          .where(
            and(
              inArray(
                journalLines.entryId,
                posted.map((p) => p.journalEntryId as string),
              ),
              eq(accounts.type, "expense"),
              sql`${accounts.role} is distinct from 'bank_fees'`,
            ),
          )
      ).map((r) => r.entryId),
    );
    for (const p of posted) {
      if (withReceipt.has(p.id) || !expenseEntries.has(p.journalEntryId as string)) continue;
      out.push({
        kind: "missingReceipt",
        transactionId: p.id,
        date: p.bookingDate,
        amountCents: p.amountCents,
        counterparty: p.counterparty,
      });
    }
  }

  // Montants inhabituels pour une contrepartie connue (au moins trois mouvements avant).
  const byParty = new Map<string, BankTransaction[]>();
  for (const r of rows) {
    const key = counterpartyKey(r.counterparty);
    if (!key) continue;
    const k = `${key}:${directionOf(r.amountCents)}`;
    byParty.set(k, [...(byParty.get(k) ?? []), r]);
  }
  for (const list of byParty.values()) {
    for (let i = 3; i < list.length; i++) {
      const r = list[i] as BankTransaction;
      const before = list
        .slice(0, i)
        .map((x) => Math.abs(x.amountCents))
        .sort((x, y) => x - y);
      const median = before[Math.floor(before.length / 2)] ?? 0;
      if (median > 0 && Math.abs(r.amountCents) > median * 3 && Math.abs(r.amountCents) >= 10_000) {
        out.push({
          kind: "unusualAmount",
          transactionId: r.id,
          date: r.bookingDate,
          amountCents: r.amountCents,
          counterparty: r.counterparty,
          usualCents: median,
        });
      }
    }
  }
  return out;
}

/**
 * Pilote automatique : comptabilise sans clic les propositions sûres, sauf un mouvement signalé
 * comme anomalie (doublon possible, montant inhabituel), qui attend toujours une personne. Ouvert à
 * toutes les formules : en formule gratuite, il travaille sur les lignes du relevé importé du mois.
 */
export async function runAutopilot(database: Db, who: Who): Promise<number> {
  const [org] = await database
    .select()
    .from(organizations)
    .where(eq(organizations.id, who.organizationId));
  if (!org?.autopilot) return 0;
  const flagged = new Set(
    (await findAnomalies(database, who.organizationId))
      .filter((a) => a.kind !== "missingReceipt")
      .map((a) => a.transactionId),
  );
  const rows = await database
    .select()
    .from(bankTransactions)
    .where(
      and(
        eq(bankTransactions.organizationId, who.organizationId),
        eq(bankTransactions.status, "proposed"),
      ),
    )
    .orderBy(asc(bankTransactions.bookingDate));
  let posted = 0;
  for (const r of rows) {
    if (flagged.has(r.id) || !autoSafe(r.proposal)) continue;
    if ((await validateTransaction(database, who, r.id, undefined, { learn: false })) !== "posted")
      continue;
    await database
      .update(bankTransactions)
      .set({ autoPosted: true })
      .where(eq(bankTransactions.id, r.id));
    posted += 1;
  }
  if (posted > 0)
    await database.insert(auditLog).values({
      organizationId: who.organizationId,
      userId: who.userId,
      action: "autopilot.post",
      entity: "organization",
      entityId: who.organizationId,
      data: { posted },
    });
  return posted;
}

/** Écritures passées par le pilote automatique et pas encore approuvées, les plus récentes d'abord. */
export async function reviewQueue(database: Db, organizationId: string) {
  return database
    .select()
    .from(bankTransactions)
    .where(
      and(
        eq(bankTransactions.organizationId, organizationId),
        eq(bankTransactions.autoPosted, true),
        eq(bankTransactions.status, "posted"),
        isNull(bankTransactions.reviewedAt),
      ),
    )
    .orderBy(desc(bankTransactions.bookingDate))
    .limit(500);
}

/**
 * « J'ai vérifié » : approuve toutes les écritures automatiques en attente. L'approbation vaut
 * validation humaine : les règles en sortent renforcées, comme après une validation à la main.
 */
export async function approveReview(database: Db, who: Who): Promise<number> {
  const rows = await database
    .update(bankTransactions)
    .set({ reviewedAt: new Date() })
    .where(
      and(
        eq(bankTransactions.organizationId, who.organizationId),
        eq(bankTransactions.autoPosted, true),
        isNull(bankTransactions.reviewedAt),
      ),
    )
    .returning();
  for (const r of rows) {
    if (r.proposal?.kind === "account")
      await learnRule(database, who, {
        counterparty: r.counterparty,
        amountCents: r.amountCents,
        accountId: r.proposal.accountId,
        vatCode: r.proposal.vatCode,
      });
  }
  if (rows.length > 0)
    await database.insert(auditLog).values({
      organizationId: who.organizationId,
      userId: who.userId,
      action: "autopilot.approve",
      entity: "organization",
      entityId: who.organizationId,
      data: { count: rows.length },
    });
  return rows.length;
}

/**
 * Annule une écriture automatique jugée fausse : elle est extournée (le journal garde les deux), le
 * mouvement revient à relire, et la règle qui l'avait proposée est oubliée.
 */
export async function undoAutoPosting(
  database: Db,
  who: Who,
  id: string,
  today = new Date().toISOString().slice(0, 10),
): Promise<"undone" | "notFound" | "closed"> {
  if (!UUID.test(id)) return "notFound";
  const [tx] = await database
    .select()
    .from(bankTransactions)
    .where(
      and(
        eq(bankTransactions.id, id),
        eq(bankTransactions.organizationId, who.organizationId),
        eq(bankTransactions.autoPosted, true),
        eq(bankTransactions.status, "posted"),
      ),
    );
  if (!tx) return "notFound";
  try {
    if (tx.paymentId) {
      const removed = await deletePayment(database, who, tx.paymentId, today);
      if (removed === "closed") return "closed";
    }
    await database.transaction(async (t) => {
      if (tx.journalEntryId)
        await reverseEntry(
          t as unknown as Db,
          who,
          tx.journalEntryId,
          "bank_reversal",
          tx.id,
          today,
        );
      await t
        .update(bankTransactions)
        .set({
          status: "proposed",
          journalEntryId: null,
          paymentId: null,
          autoPosted: false,
          reviewedAt: null,
          validatedBy: null,
          validatedAt: null,
        })
        .where(eq(bankTransactions.id, tx.id));
      await t
        .update(receipts)
        .set({ status: "matched", journalEntryId: null })
        .where(eq(receipts.bankTransactionId, tx.id));
      // Paiement de facture fournisseur : la facture redevient à payer.
      await t
        .update(supplierBills)
        .set({ status: "scheduled", paidOn: null, paymentEntryId: null, bankTransactionId: null })
        .where(eq(supplierBills.bankTransactionId, tx.id));
      const key = counterpartyKey(tx.counterparty);
      if (tx.proposal?.kind === "account" && key)
        await t
          .delete(bookingRules)
          .where(
            and(
              eq(bookingRules.organizationId, who.organizationId),
              eq(bookingRules.counterpartyKey, key),
              eq(bookingRules.direction, directionOf(tx.amountCents)),
              eq(bookingRules.accountId, tx.proposal.accountId),
            ),
          );
      await t.insert(auditLog).values({
        organizationId: who.organizationId,
        userId: who.userId,
        action: "autopilot.undo",
        entity: "bank_transaction",
        entityId: tx.id,
      });
    });
  } catch (e) {
    if (e instanceof LedgerError) return "closed";
    throw e;
  }
  return "undone";
}

/** Chiffres du récapitulatif hebdomadaire : passé seul, à revoir, à relire, anomalies. */
export async function autopilotSummary(
  database: Db,
  organizationId: string,
  today = new Date().toISOString().slice(0, 10),
) {
  const [counts] = await database
    .select({
      autoWeek: sql<number>`count(*) filter (where ${bankTransactions.autoPosted} and ${bankTransactions.validatedAt} >= now() - interval '7 days')::int`,
      toApprove: sql<number>`count(*) filter (where ${bankTransactions.autoPosted} and ${bankTransactions.status} = 'posted' and ${bankTransactions.reviewedAt} is null)::int`,
      toReview: sql<number>`count(*) filter (where ${bankTransactions.status} in ('new', 'proposed'))::int`,
    })
    .from(bankTransactions)
    .where(eq(bankTransactions.organizationId, organizationId));
  const anomalies = await findAnomalies(database, organizationId, today);
  return {
    autoWeek: counts?.autoWeek ?? 0,
    toApprove: counts?.toApprove ?? 0,
    toReview: counts?.toReview ?? 0,
    anomalies: anomalies.length,
  };
}
