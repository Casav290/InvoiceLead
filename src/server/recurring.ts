import { and, asc, eq, lte } from "drizzle-orm";
import type { Db } from "./db";
import {
  auditLog,
  contacts,
  invoices,
  type RecurringInvoice,
  recurringInvoices,
} from "./db/schema";
import {
  createInvoice,
  getInvoice,
  type InvoiceInput,
  type InvoiceLineInput,
  issueInvoice,
} from "./invoices";
import { postPending } from "./ledger";

type Who = { organizationId: string; userId: string };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const INTERVALS = [1, 3, 6, 12] as const;

/** Même jour, `months` mois plus tard (fin de mois ramenée au dernier jour du mois cible). */
export function addMonths(iso: string, months: number): string {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(d, last));
  return target.toISOString().slice(0, 10);
}

export async function createRecurring(
  database: Db,
  who: Who,
  invoiceId: string,
  input: { intervalMonths: number; nextDate: string; autoSend: boolean },
): Promise<RecurringInvoice | "notFound" | "invalid"> {
  if (!UUID.test(invoiceId)) return "notFound";
  if (!(INTERVALS as readonly number[]).includes(input.intervalMonths)) return "invalid";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.nextDate)) return "invalid";
  const found = await getInvoice(database, who.organizationId, invoiceId);
  if (found?.invoice.kind !== "invoice") return "notFound";
  const [row] = await database
    .insert(recurringInvoices)
    .values({
      ...input,
      organizationId: who.organizationId,
      sourceInvoiceId: invoiceId,
      createdBy: who.userId,
    })
    .returning();
  if (!row) throw new Error("recurring_not_saved");
  await database.insert(auditLog).values({
    organizationId: who.organizationId,
    userId: who.userId,
    action: "recurring.create",
    entity: "invoice",
    entityId: invoiceId,
    data: input,
  });
  return row;
}

export async function listRecurring(database: Db, organizationId: string) {
  return database
    .select({
      recurring: recurringInvoices,
      number: invoices.number,
      customer: contacts.name,
      total: invoices.totalCents,
    })
    .from(recurringInvoices)
    .innerJoin(invoices, eq(invoices.id, recurringInvoices.sourceInvoiceId))
    .innerJoin(contacts, eq(contacts.id, invoices.contactId))
    .where(eq(recurringInvoices.organizationId, organizationId))
    .orderBy(asc(recurringInvoices.nextDate));
}

export async function setRecurringActive(database: Db, who: Who, id: string, active: boolean) {
  if (!UUID.test(id)) return false;
  const rows = await database
    .update(recurringInvoices)
    .set({ active })
    .where(
      and(eq(recurringInvoices.id, id), eq(recurringInvoices.organizationId, who.organizationId)),
    )
    .returning({ id: recurringInvoices.id });
  return rows.length > 0;
}

export async function deleteRecurring(database: Db, who: Who, id: string) {
  if (!UUID.test(id)) return false;
  const rows = await database
    .delete(recurringInvoices)
    .where(
      and(eq(recurringInvoices.id, id), eq(recurringInvoices.organizationId, who.organizationId)),
    )
    .returning({ id: recurringInvoices.id });
  return rows.length > 0;
}

export type RecurringRun = { created: number; issued: number; sent: number; failed: number };

/**
 * Tâche quotidienne : crée la facture de chaque récurrence échue (une par passage, pour rattraper
 * sans surprise), l'émet et l'envoie si l'envoi automatique est choisi, puis avance l'échéance.
 * `send` est injecté pour que la tâche planifiée utilise l'envoi réel (e-mail, PDF, lien).
 */
export async function runRecurring(
  database: Db,
  today: string,
  send?: (who: Who, invoiceId: string) => Promise<boolean>,
): Promise<RecurringRun> {
  const due = await database
    .select()
    .from(recurringInvoices)
    .where(and(eq(recurringInvoices.active, true), lte(recurringInvoices.nextDate, today)))
    .orderBy(asc(recurringInvoices.nextDate))
    .limit(500);
  const run: RecurringRun = { created: 0, issued: 0, sent: 0, failed: 0 };
  for (const r of due) {
    const who = { organizationId: r.organizationId, userId: r.createdBy ?? "" };
    try {
      const found = await getInvoice(database, r.organizationId, r.sourceInvoiceId);
      if (!found || !r.createdBy) throw new Error("source_missing");
      const { invoice, lines } = found;
      const data: InvoiceInput = {
        contactId: invoice.contactId,
        language: invoice.language as InvoiceInput["language"],
        title: invoice.title,
        introText: invoice.introText,
        footerText: invoice.footerText,
        issueDate: r.nextDate,
        serviceDate: r.nextDate,
        dueDate: null,
        // Même devise que le modèle ; le cours est celui du jour d'émission de chaque facture.
        currency: invoice.currency as InvoiceInput["currency"],
        lines: lines.map((l) => ({
          productId: l.productId,
          description: l.description,
          quantityMilli: l.quantityMilli,
          unit: l.unit as InvoiceLineInput["unit"],
          unitPriceCents: l.unitPriceCents,
          vatCode: (l.vatCode as InvoiceLineInput["vatCode"]) ?? "normal",
        })),
      };
      const created = await createInvoice(database, who, data);
      if (typeof created !== "object" || !created) throw new Error(String(created));
      run.created += 1;
      // L'échéance avance tout de suite : une panne à l'envoi ne recrée pas la facture demain.
      await database
        .update(recurringInvoices)
        .set({ nextDate: addMonths(r.nextDate, r.intervalMonths), lastInvoiceId: created.id })
        .where(eq(recurringInvoices.id, r.id));
      if (r.autoSend) {
        const issued = await issueInvoice(database, who, created.id);
        if (typeof issued === "object") {
          run.issued += 1;
          await postPending(database, who);
          if (send && (await send(who, created.id))) run.sent += 1;
        }
      }
    } catch (e) {
      run.failed += 1;
      console.error("[recurring] échec", r.id, e instanceof Error ? e.message : "inconnu");
    }
  }
  return run;
}
