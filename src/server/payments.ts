import { and, asc, eq, sql } from "drizzle-orm";
import { parseAmountToCents } from "@/lib/amount-input";
import { parseFxRate } from "@/lib/currencies";
import { isIsoDate } from "@/lib/fiscal-year";
import type { Db } from "./db";
import {
  auditLog,
  type InvoicePayment,
  invoicePayments,
  invoices,
  organizations,
} from "./db/schema";
import { fetchFxRate } from "./fx";
import { creditedCents } from "./invoices";
import { LedgerError, reversePaymentEntry } from "./ledger";

type Who = { organizationId: string; userId: string };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const PAYMENT_METHODS = ["bank", "cash", "other"] as const;

export type PaymentInput = {
  paidOn: string;
  amountCents: number;
  method: (typeof PAYMENT_METHODS)[number];
  note: string | null;
  /** Facture en devise : cours du jour du paiement ; absent, celui de la BCE. */
  fxRate?: number | null;
};

export function parsePaymentForm(
  form: FormData,
): { ok: true; data: PaymentInput } | { ok: false; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const paidOn = String(form.get("paidOn") ?? "").trim();
  if (!isIsoDate(paidOn)) errors.paidOn = "date";
  const amountCents = parseAmountToCents(String(form.get("amount") ?? ""));
  if (!amountCents) errors.amount = "amount";
  const method = String(form.get("method") ?? "bank") as PaymentInput["method"];
  if (!PAYMENT_METHODS.includes(method)) errors.method = "required";
  const note = String(form.get("note") ?? "").trim() || null;
  if (note && note.length > 200) errors.note = "tooLong";
  const fxText = String(form.get("fxRate") ?? "").trim();
  const fxRate = fxText ? parseFxRate(fxText) : null;
  if (fxText && fxRate === null) errors.fxRate = "fxRate";
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, data: { paidOn, amountCents: amountCents ?? 0, method, note, fxRate } };
}

export type Balance = {
  totalCents: number;
  creditedCents: number;
  paidCents: number;
  openCents: number;
};

async function paidCents(database: Db, invoiceId: string): Promise<number> {
  const [row] = await database
    .select({ sum: sql<string | null>`sum(${invoicePayments.amountCents})` })
    .from(invoicePayments)
    .where(eq(invoicePayments.invoiceId, invoiceId));
  return Number(row?.sum ?? 0);
}

/** Solde d'une facture : total, moins les avoirs émis, moins les paiements reçus. */
export async function invoiceBalance(database: Db, invoiceId: string, totalCents: number) {
  const [credited, paid] = await Promise.all([
    creditedCents(database, invoiceId),
    paidCents(database, invoiceId),
  ]);
  return {
    totalCents,
    creditedCents: credited,
    paidCents: paid,
    openCents: totalCents - credited - paid,
  } satisfies Balance;
}

export async function listPayments(
  database: Db,
  organizationId: string,
  invoiceId: string,
): Promise<InvoicePayment[]> {
  if (!UUID.test(invoiceId)) return [];
  return database
    .select()
    .from(invoicePayments)
    .where(
      and(
        eq(invoicePayments.invoiceId, invoiceId),
        eq(invoicePayments.organizationId, organizationId),
      ),
    )
    .orderBy(asc(invoicePayments.paidOn), asc(invoicePayments.createdAt));
}

/** Enregistre un paiement sur une facture émise, sans dépasser le solde ouvert. */
/**
 * Cours d'un paiement sur une facture en devise : celui saisi, sinon le cours BCE du jour du paiement,
 * sinon celui de la facture (sans différence de change). Null pour une facture dans la monnaie de
 * l'entreprise.
 */
export async function paymentFxRate(
  database: Db,
  invoiceId: string,
  paidOn: string,
  entered: number | null | undefined,
  fetcher?: typeof fetch,
): Promise<number | null> {
  const [row] = await database
    .select({ currency: invoices.currency, fxRate: invoices.fxRate, home: organizations.currency })
    .from(invoices)
    .innerJoin(organizations, eq(organizations.id, invoices.organizationId))
    .where(eq(invoices.id, invoiceId));
  if (!row?.fxRate || row.currency === row.home) return null;
  return entered ?? (await fetchFxRate(row.currency, row.home, paidOn, fetcher)) ?? row.fxRate;
}

export async function addPayment(
  database: Db,
  who: Who,
  invoiceId: string,
  data: PaymentInput,
  fetcher?: typeof fetch,
): Promise<InvoicePayment | "notFound" | "tooHigh"> {
  if (!UUID.test(invoiceId)) return "notFound";
  const fxRate = await paymentFxRate(database, invoiceId, data.paidOn, data.fxRate, fetcher);
  return database.transaction(async (tx) => {
    const [invoice] = await tx
      .select()
      .from(invoices)
      .where(and(eq(invoices.id, invoiceId), eq(invoices.organizationId, who.organizationId)))
      .for("update");
    if (invoice?.kind !== "invoice" || invoice.status !== "issued") return "notFound";
    const balance = await invoiceBalance(tx as unknown as Db, invoiceId, invoice.totalCents);
    if (data.amountCents > balance.openCents) return "tooHigh";
    const [row] = await tx
      .insert(invoicePayments)
      .values({
        ...data,
        fxRate,
        invoiceId,
        organizationId: who.organizationId,
        createdBy: who.userId,
      })
      .returning();
    if (!row) throw new Error("payment_not_saved");
    await tx.insert(auditLog).values({
      organizationId: who.organizationId,
      userId: who.userId,
      action: "payment.create",
      entity: "invoice",
      entityId: invoiceId,
      data: { paymentId: row.id, amountCents: row.amountCents, paidOn: row.paidOn },
    });
    return row;
  });
}

/**
 * Supprime un paiement saisi par erreur. S'il était déjà comptabilisé, son écriture est extournée dans
 * la même transaction : le journal garde les deux écritures, rien n'y est effacé.
 */
export async function deletePayment(
  database: Db,
  who: Who,
  paymentId: string,
  today = new Date().toISOString().slice(0, 10),
): Promise<boolean | "closed"> {
  if (!UUID.test(paymentId)) return false;
  try {
    return await database.transaction(async (tx) => {
      const [row] = await tx
        .delete(invoicePayments)
        .where(
          and(
            eq(invoicePayments.id, paymentId),
            eq(invoicePayments.organizationId, who.organizationId),
          ),
        )
        .returning();
      if (!row) return false;
      if (row.journalEntryId) {
        await reversePaymentEntry(tx as unknown as Db, who, row.journalEntryId, paymentId, today);
      }
      await tx.insert(auditLog).values({
        organizationId: who.organizationId,
        userId: who.userId,
        action: "payment.delete",
        entity: "invoice",
        entityId: row.invoiceId,
        data: { paymentId, amountCents: row.amountCents, paidOn: row.paidOn },
      });
      return true;
    });
  } catch (e) {
    if (e instanceof LedgerError) return "closed";
    throw e;
  }
}

export type PaymentState = "open" | "partial" | "paid" | "overdue" | "credited";

/** État de paiement affiché d'une facture émise. */
export function paymentState(b: Balance, dueDate: string, today: string): PaymentState {
  if (b.openCents <= 0) return b.paidCents === 0 && b.creditedCents > 0 ? "credited" : "paid";
  if (dueDate < today) return "overdue";
  return b.paidCents > 0 || b.creditedCents > 0 ? "partial" : "open";
}
