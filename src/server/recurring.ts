import { and, asc, eq, inArray, lte } from "drizzle-orm";
import type { Db } from "./db";
import {
  auditLog,
  contacts,
  invoices,
  organizations,
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
import { lockQuota, organizationPlan, PLANS, quotaAccess, tierOf } from "./plans";

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

/**
 * Compte puis crée ou reprend une récurrence sous un verrou de l'entreprise : la formule gratuite
 * garde une seule facture récurrente active, même avec deux demandes simultanées.
 */
async function withActiveSlot<T>(
  database: Db,
  organizationId: string,
  run: (tx: Db) => Promise<T>,
): Promise<T | "planLimit"> {
  const plan = await organizationPlan(database, organizationId);
  if (!plan) return "planLimit";
  return database.transaction(async (tx) => {
    const t = tx as unknown as Db;
    await lockQuota(t, organizationId, "recurring");
    if (!(await quotaAccess(t, plan, "recurring")).allowed) return "planLimit" as const;
    return run(t);
  });
}

export async function createRecurring(
  database: Db,
  who: Who,
  invoiceId: string,
  input: { intervalMonths: number; nextDate: string; autoSend: boolean },
): Promise<RecurringInvoice | "notFound" | "invalid" | "planLimit"> {
  if (!UUID.test(invoiceId)) return "notFound";
  if (!(INTERVALS as readonly number[]).includes(input.intervalMonths)) return "invalid";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.nextDate)) return "invalid";
  const found = await getInvoice(database, who.organizationId, invoiceId);
  if (found?.invoice.kind !== "invoice") return "notFound";
  const created = await withActiveSlot(database, who.organizationId, async (tx) => {
    const [inserted] = await tx
      .insert(recurringInvoices)
      .values({
        ...input,
        organizationId: who.organizationId,
        sourceInvoiceId: invoiceId,
        createdBy: who.userId,
      })
      .returning();
    return inserted;
  });
  if (created === "planLimit") return created;
  const row = created;
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

/** Met en pause ou reprend ; reprendre compte dans les récurrences actives de la formule. */
export async function setRecurringActive(
  database: Db,
  who: Who,
  id: string,
  active: boolean,
): Promise<boolean | "planLimit"> {
  if (!UUID.test(id)) return false;
  const set = (tx: Db) =>
    tx
      .update(recurringInvoices)
      .set({ active })
      .where(
        and(eq(recurringInvoices.id, id), eq(recurringInvoices.organizationId, who.organizationId)),
      )
      .returning({ id: recurringInvoices.id })
      .then((rows) => rows.length > 0);
  if (!active) return set(database);
  const [row] = await database
    .select({ active: recurringInvoices.active })
    .from(recurringInvoices)
    .where(
      and(eq(recurringInvoices.id, id), eq(recurringInvoices.organizationId, who.organizationId)),
    );
  if (!row) return false;
  if (row.active) return true;
  return withActiveSlot(database, who.organizationId, set);
}

/**
 * Récurrences qui tournent : toutes en Pro ; en formule gratuite, la plus ancienne active seulement
 * (celles d'avant un retour à la formule gratuite attendent, sans être modifiées).
 */
export async function runningRecurring(
  database: Db,
  organization: { id: string; leadPlan: string; entitlements: unknown },
): Promise<Set<string> | null> {
  const limit = PLANS[tierOf(organization)].quotas.recurring;
  if (!Number.isFinite(limit)) return null;
  const rows = await database
    .select({ id: recurringInvoices.id })
    .from(recurringInvoices)
    .where(
      and(
        eq(recurringInvoices.organizationId, organization.id),
        eq(recurringInvoices.active, true),
      ),
    )
    .orderBy(asc(recurringInvoices.createdAt), asc(recurringInvoices.id))
    .limit(limit);
  return new Set(rows.map((r) => r.id));
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

export type RecurringRun = {
  created: number;
  issued: number;
  sent: number;
  failed: number;
  /** Retenues par la formule gratuite : récurrence au-delà de la première, ou facture laissée en brouillon (10 factures du mois émises). */
  held: number;
};

/**
 * Tâche quotidienne : crée la facture de chaque récurrence échue (une par passage, pour rattraper
 * sans surprise), l'émet et l'envoie si l'envoi automatique est choisi, puis avance l'échéance.
 * `send` est injecté pour que la tâche planifiée utilise l'envoi réel (e-mail, PDF, lien).
 *
 * Formule gratuite : une seule récurrence tourne (la plus ancienne active), et la facture créée
 * reste en brouillon quand les 10 factures du mois sont déjà émises.
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
  const run: RecurringRun = { created: 0, issued: 0, sent: 0, failed: 0, held: 0 };
  const orgIds = [...new Set(due.map((r) => r.organizationId))];
  const orgs = new Map(
    orgIds.length === 0
      ? []
      : (
          await database
            .select({
              id: organizations.id,
              leadPlan: organizations.leadPlan,
              entitlements: organizations.entitlements,
            })
            .from(organizations)
            .where(inArray(organizations.id, orgIds))
        ).map((o) => [o.id, o]),
  );
  const running = new Map<string, Set<string> | null>();
  for (const org of orgs.values()) running.set(org.id, await runningRecurring(database, org));
  for (const r of due) {
    const who = { organizationId: r.organizationId, userId: r.createdBy ?? "" };
    const org = orgs.get(r.organizationId);
    const allowed = running.get(r.organizationId);
    if (!org || (allowed && !allowed.has(r.id))) {
      run.held += 1;
      continue;
    }
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
        // Formule gratuite : au-delà des 10 factures du mois, issueInvoice la laisse en brouillon.
        const issued = await issueInvoice(database, who, created.id);
        if (issued === "planLimit") run.held += 1;
        else if (typeof issued === "object") {
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
