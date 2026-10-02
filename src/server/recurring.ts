import { and, asc, eq, lte, not, sql } from "drizzle-orm";
import type { Db } from "./db";
import { anyUuid } from "./db/any";
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
import {
  featureAccess,
  foreignWithoutProFor,
  lockQuota,
  type OrgPlan,
  organizationPlan,
  PLANS,
  quotaAccess,
  tierOf,
} from "./plans";

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
): Promise<RecurringInvoice | "notFound" | "invalid" | "planLimit" | "plan"> {
  if (!UUID.test(invoiceId)) return "notFound";
  if (!(INTERVALS as readonly number[]).includes(input.intervalMonths)) return "invalid";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.nextDate)) return "invalid";
  const found = await getInvoice(database, who.organizationId, invoiceId);
  if (found?.invoice.kind !== "invoice") return "notFound";
  // Facture en devise sans la multidevise : la répéter produirait de nouvelles factures en devise,
  // donc une nouvelle récurrence (ou une reprise) est refusée ; celles d'avant attendent
  // (runningRecurring).
  if (await foreignWithoutProFor(database, who.organizationId, found.invoice.currency))
    return "plan";
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
      currency: invoices.currency,
    })
    .from(recurringInvoices)
    .innerJoin(invoices, eq(invoices.id, recurringInvoices.sourceInvoiceId))
    .innerJoin(contacts, eq(contacts.id, invoices.contactId))
    .where(eq(recurringInvoices.organizationId, organizationId))
    .orderBy(asc(recurringInvoices.nextDate));
}

/**
 * Récurrence de cette facture qui tourne (la plus proche échéance), ou null : aucune, ou seulement
 * des récurrences retenues par la formule.
 */
export async function runningRecurringOfInvoice(
  database: Db,
  organization: OrgPlan & { id: string },
  invoiceId: string,
) {
  const rows = await database
    .select({ id: recurringInvoices.id, nextDate: recurringInvoices.nextDate })
    .from(recurringInvoices)
    .where(
      and(
        eq(recurringInvoices.organizationId, organization.id),
        eq(recurringInvoices.sourceInvoiceId, invoiceId),
        eq(recurringInvoices.active, true),
      ),
    )
    .orderBy(asc(recurringInvoices.nextDate));
  if (rows.length === 0) return null;
  const running = await runningRecurring(database, organization);
  return rows.find((r) => running === null || running.has(r.id)) ?? null;
}

/** Met en pause ou reprend ; reprendre compte dans les récurrences actives de la formule. */
export async function setRecurringActive(
  database: Db,
  who: Who,
  id: string,
  active: boolean,
): Promise<boolean | "planLimit" | "plan"> {
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
    .select({ active: recurringInvoices.active, currency: invoices.currency })
    .from(recurringInvoices)
    .innerJoin(invoices, eq(invoices.id, recurringInvoices.sourceInvoiceId))
    .where(
      and(eq(recurringInvoices.id, id), eq(recurringInvoices.organizationId, who.organizationId)),
    );
  if (!row) return false;
  if (row.active) return true;
  if (await foreignWithoutProFor(database, who.organizationId, row.currency)) return "plan";
  return withActiveSlot(database, who.organizationId, set);
}

/**
 * Récurrences qui tournent : toutes en Pro ; en formule gratuite, la plus ancienne active seulement
 * (celles d'avant un retour à la formule gratuite attendent, sans être modifiées). Sans la
 * multidevise, une récurrence sur une facture en devise étrangère attend aussi.
 */
export async function runningRecurring(
  database: Db,
  organization: OrgPlan & { id: string },
): Promise<Set<string> | null> {
  return (await runningRecurringOf(database, [organization])).get(organization.id) ?? null;
}

/**
 * La même chose pour plusieurs entreprises à la fois (tâche quotidienne) : une requête par règle de
 * formule, pas une par entreprise. null : toutes ses récurrences actives tournent.
 */
async function runningRecurringOf(
  database: Db,
  orgs: (OrgPlan & { id: string })[],
): Promise<Map<string, Set<string> | null>> {
  const running = new Map<string, Set<string> | null>();
  const rules = new Map<string, { limit: number; homeOnly: boolean; ids: string[] }>();
  for (const org of orgs) {
    const limit = PLANS[tierOf(org)].quotas.recurring;
    const homeOnly = !featureAccess(org, "multiCurrency").allowed;
    if (!Number.isFinite(limit) && !homeOnly) {
      running.set(org.id, null);
      continue;
    }
    running.set(org.id, new Set());
    const key = `${limit}:${homeOnly}`;
    const rule = rules.get(key) ?? { limit, homeOnly, ids: [] };
    rule.ids.push(org.id);
    rules.set(key, rule);
  }
  for (const { limit, homeOnly, ids } of rules.values()) {
    // Rang de chaque récurrence active dans son entreprise, de la plus ancienne à la plus récente.
    const ranked = database
      .select({
        id: recurringInvoices.id,
        organizationId: recurringInvoices.organizationId,
        position:
          sql<number>`row_number() over (partition by ${recurringInvoices.organizationId} order by ${recurringInvoices.createdAt}, ${recurringInvoices.id})`.as(
            "position",
          ),
      })
      .from(recurringInvoices)
      .innerJoin(invoices, eq(invoices.id, recurringInvoices.sourceInvoiceId))
      .innerJoin(organizations, eq(organizations.id, recurringInvoices.organizationId))
      .where(
        and(
          anyUuid(recurringInvoices.organizationId, ids),
          eq(recurringInvoices.active, true),
          homeOnly ? eq(invoices.currency, organizations.currency) : undefined,
        ),
      )
      .as("ranked");
    const rows = await database
      .select({ id: ranked.id, organizationId: ranked.organizationId })
      .from(ranked)
      .where(Number.isFinite(limit) ? lte(ranked.position, limit) : undefined);
    for (const r of rows) running.get(r.organizationId)?.add(r.id);
  }
  return running;
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
 * reste en brouillon quand les 10 factures du mois sont déjà émises. Les récurrences retenues sont
 * seulement comptées : elles n'entrent pas dans les 500 traitées par passage.
 */
export async function runRecurring(
  database: Db,
  today: string,
  send?: (who: Who, invoiceId: string) => Promise<boolean>,
): Promise<RecurringRun> {
  const run: RecurringRun = { created: 0, issued: 0, sent: 0, failed: 0, held: 0 };
  const due = and(eq(recurringInvoices.active, true), lte(recurringInvoices.nextDate, today));
  // Ce que la formule de chaque entreprise concernée laisse tourner. Les récurrences retenues ne
  // bougent pas (leur échéance reste dans le passé) : elles sont écartées de la requête elle-même,
  // sinon les plus anciennes occuperaient toute la fenêtre de 500 chaque jour et plus aucune
  // facture récurrente ne partirait, chez personne.
  const orgIds = (
    await database
      .selectDistinct({ id: recurringInvoices.organizationId })
      .from(recurringInvoices)
      .where(due)
  ).map((r) => r.id);
  if (orgIds.length === 0) return run;
  const plans = await database
    .select({
      id: organizations.id,
      leadPlan: organizations.leadPlan,
      entitlements: organizations.entitlements,
      entitlementsAt: organizations.entitlementsAt,
    })
    .from(organizations)
    .where(anyUuid(organizations.id, orgIds));
  const running = await runningRecurringOf(database, plans);
  const everything: string[] = [];
  const chosen: string[] = [];
  for (const [orgId, allowed] of running) {
    if (allowed === null) everything.push(orgId);
    else chosen.push(...allowed);
  }
  const runs = sql`(${anyUuid(recurringInvoices.organizationId, everything)} or ${anyUuid(recurringInvoices.id, chosen)})`;
  const [held] = await database
    .select({ n: sql<number>`count(*)::int` })
    .from(recurringInvoices)
    .where(and(due, not(runs)));
  run.held += held?.n ?? 0;
  const rows = await database
    .select()
    .from(recurringInvoices)
    .where(and(due, runs))
    .orderBy(asc(recurringInvoices.nextDate), asc(recurringInvoices.id))
    .limit(500);
  for (const r of rows) {
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
        // Formule gratuite : au-delà des 10 factures du mois, issueInvoice la laisse en brouillon.
        const issued = await issueInvoice(database, who, created.id);
        if (issued === "planLimit" || issued === "plan") run.held += 1;
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
