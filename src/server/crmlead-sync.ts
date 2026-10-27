import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { isLocale } from "@/i18n/locales";
import type { Db } from "./db";
import { crmleadOutbox, invoices, organizations } from "./db/schema";
import { env } from "./env";
import { send } from "./lead-id/leadId";
import { invoiceBalance } from "./payments";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/**
 * Reprises d'une panne (CRMlead, ERPlead ou réseau injoignables, 5xx, 401 répété) : 1 min, 5 min,
 * 30 min, 2 h, 12 h, puis toutes les 12 h. Une panne ne rend jamais un envoi définitif.
 */
const RETRY_MINUTES = [1, 5, 30, 120, 720];
/**
 * « waiting » : CRMlead ne connaît pas encore l'entreprise (404 unknown_org, CRMlead pas encore
 * ouvert avec le Compte Lead). Relancé toutes les heures si le Compte Lead dit CRMlead utilisé
 * (apps.crmlead.used), sinon une fois par jour ; gardé 30 jours, puis « expired ».
 */
const WAITING_DAYS = 30;
/** Refus définitifs : droits ou expéditeur (403), lead à la corbeille ou état refusé (409), enveloppe refusée. */
const FINAL = new Set([400, 403, 409, 422]);

type Invoice = typeof invoices.$inferSelect;

/**
 * Le lead CRMlead d'une pièce : celui du devis ou de la facture importés depuis CRMlead
 * (`crmlead:<lead>`), sinon celui du devis d'origine (facture finale, acompte) ou de la facture
 * corrigée (avoir). Rien pour une pièce sans lien avec CRMlead.
 */
export async function crmleadLeadOf(
  database: Db,
  invoice: Invoice,
  depth = 0,
): Promise<string | null> {
  const ref = invoice.externalRef?.startsWith("crmlead:") ? invoice.externalRef.slice(8) : null;
  if (ref && UUID.test(ref)) return ref;
  if (invoice.crmleadLeadId && UUID.test(invoice.crmleadLeadId)) return invoice.crmleadLeadId;
  if (depth > 2) return null;
  const parentId = invoice.sourceQuoteId ?? invoice.relatedInvoiceId;
  if (!parentId) return null;
  const [parent] = await database
    .select()
    .from(invoices)
    .where(and(eq(invoices.id, parentId), eq(invoices.organizationId, invoice.organizationId)));
  return parent ? crmleadLeadOf(database, parent, depth + 1) : null;
}

/** Un devis repris d'une affaire reste relié 180 jours : au-delà, un nouveau devis est une nouvelle affaire. */
const INHERIT_DAYS = 180;

/**
 * L'affaire CRMlead d'un nouveau devis fait à la main pour un client : celle de son dernier devis relié, quand il a
 * moins de 180 jours et n'est pas encore devenu facture (26.10.2026 : O-2026-0001 refusé, O-2026-0002 à 7 500 CHF
 * accepté, et CRMlead comme ProjectLead gardaient les 5 000 du premier). Rien quand ce n'est pas clair.
 */
export async function inheritedCrmleadLead(
  database: Db,
  organizationId: string,
  contactId: string,
): Promise<string | null> {
  const since = new Date(Date.now() - INHERIT_DAYS * 86_400_000);
  const [last] = await database
    .select()
    .from(invoices)
    .where(
      and(
        eq(invoices.organizationId, organizationId),
        eq(invoices.contactId, contactId),
        eq(invoices.kind, "quote"),
        sql`(${invoices.externalRef} like 'crmlead:%' or ${invoices.crmleadLeadId} is not null)`,
        gte(invoices.createdAt, since),
      ),
    )
    .orderBy(sql`${invoices.createdAt} desc`)
    .limit(1);
  if (!last || last.status === "invoiced") return null;
  return crmleadLeadOf(database, last);
}

/** Retire le lien repris d'une pièce (celui de l'import d'origine reste : il est la pièce de l'affaire). */
export async function detachCrmlead(database: Db, organizationId: string, invoiceId: string) {
  if (!UUID.test(invoiceId)) return false;
  const rows = await database
    .update(invoices)
    .set({ crmleadLeadId: null, updatedAt: new Date() })
    .where(and(eq(invoices.id, invoiceId), eq(invoices.organizationId, organizationId)))
    .returning({ id: invoices.id });
  return rows.length > 0;
}

/** État montré dans CRMlead : celui du devis, ou pour une facture, émise, payée en partie, payée, annulée. */
export async function documentStatus(database: Db, invoice: Invoice): Promise<string> {
  if (invoice.kind !== "invoice" || invoice.status !== "issued") return invoice.status;
  const b = await invoiceBalance(database, invoice.id, invoice.totalCents);
  if (b.creditedCents >= invoice.totalCents && invoice.totalCents > 0) return "credited";
  if (b.openCents <= 0) return "paid";
  if (b.paidCents > 0) return "partial";
  return "issued";
}

/**
 * Met en file l'état d'une pièce liée à un lead CRMlead. Les brouillons ne partent pas. Un envoi
 * pas encore parti pour la même pièce est remplacé par le nouvel état.
 */
export async function queueCrmlead(database: Db, organizationId: string, invoiceId: string) {
  if (!UUID.test(invoiceId)) return false;
  const [invoice] = await database
    .select()
    .from(invoices)
    .where(and(eq(invoices.id, invoiceId), eq(invoices.organizationId, organizationId)));
  if (!invoice || invoice.status === "draft") return false;
  const leadId = await crmleadLeadOf(database, invoice);
  if (!leadId) return false;
  const [org] = await database
    .select({ leadOrg: organizations.leadOrg })
    .from(organizations)
    .where(eq(organizations.id, organizationId));
  if (!org?.leadOrg) return false;
  const section =
    invoice.kind === "quote"
      ? "quotes"
      : invoice.kind === "credit_note"
        ? "credit-notes"
        : "invoices";
  const lang = isLocale(invoice.language) ? invoice.language : "de";
  const envelope = {
    type: "document",
    org: org.leadOrg,
    source: { id: invoice.id, url: `${env().APP_URL}/${lang}/app/${section}/${invoice.id}` },
    data: {
      kind: invoice.kind,
      number: invoice.number,
      status: await documentStatus(database, invoice),
      net_cents: invoice.netCents,
      total_cents: invoice.totalCents,
      currency: invoice.currency,
      issue_date: invoice.issueDate,
      lead_id: leadId,
      // Ordre des états : CRMlead ignore un état plus ancien que celui qu'il a déjà.
      version: Date.now(),
    },
  };
  // Un état plus ancien qui attendait que CRMlead connaisse l'entreprise est remplacé par celui-ci.
  await database
    .update(crmleadOutbox)
    .set({ status: "superseded" })
    .where(and(eq(crmleadOutbox.invoiceId, invoiceId), eq(crmleadOutbox.status, "waiting")));
  await database
    .insert(crmleadOutbox)
    .values({ organizationId, invoiceId, envelope })
    .onConflictDoUpdate({
      target: crmleadOutbox.invoiceId,
      targetWhere: sql`${crmleadOutbox.status} = 'pending'`,
      set: { envelope, attempts: 0, nextAttemptAt: new Date(), lastError: null },
    });
  return true;
}

/** Un envoi réservé mais jamais conclu (arrêt brutal) est repris après ce délai. */
const CLAIM_MINUTES = 10;

/** CRMlead déjà ouvert par l'entreprise avec le Compte Lead (copie des droits, pour l'affichage et le rythme des relances). */
async function crmleadUsed(database: Db, organizationId: string): Promise<boolean> {
  const [org] = await database
    .select({ entitlements: organizations.entitlements })
    .from(organizations)
    .where(eq(organizations.id, organizationId));
  const apps = (org?.entitlements as { apps?: Record<string, { used?: unknown }> } | null)?.apps;
  return apps?.crmlead?.used === true;
}

/**
 * Envoie ce qui est dû (d'une organisation, ou de toutes pour les tâches horaires). Chaque envoi
 * est d'abord réservé (« sending ») : deux passages simultanés ne l'envoient jamais deux fois, et
 * un nouvel état arrivé pendant l'envoi reste en attente au lieu d'être marqué livré.
 */
export async function deliverCrmlead(
  database: Db,
  opts: { organizationId?: string; limit?: number } = {},
): Promise<{ delivered: number; failed: number; waiting: number }> {
  const now = new Date();
  const due = await database
    .select({ id: crmleadOutbox.id })
    .from(crmleadOutbox)
    .where(
      and(
        inArray(crmleadOutbox.status, ["pending", "sending", "waiting"]),
        lte(crmleadOutbox.nextAttemptAt, now),
        ...(opts.organizationId ? [eq(crmleadOutbox.organizationId, opts.organizationId)] : []),
      ),
    )
    .orderBy(crmleadOutbox.createdAt)
    .limit(opts.limit ?? 20);
  let delivered = 0;
  let failed = 0;
  let waiting = 0;
  for (const { id } of due) {
    const [row] = await database
      .update(crmleadOutbox)
      .set({ status: "sending", nextAttemptAt: new Date(Date.now() + CLAIM_MINUTES * 60_000) })
      .where(
        and(
          eq(crmleadOutbox.id, id),
          inArray(crmleadOutbox.status, ["pending", "sending", "waiting"]),
          lte(crmleadOutbox.nextAttemptAt, now),
        ),
      )
      .returning();
    if (!row) continue;
    // Une ligne « waiting » réservée garde sa nature : si l'envoi échoue encore en 404, elle y revient.
    const e = row.envelope as Parameters<typeof send>[1];
    try {
      await send({ app: "crmlead", url: env().CRMLEAD_URL }, e);
      await database
        .update(crmleadOutbox)
        .set({
          status: "delivered",
          deliveredAt: new Date(),
          attempts: row.attempts + 1,
          lastError: null,
        })
        .where(eq(crmleadOutbox.id, row.id));
      delivered++;
    } catch (error) {
      const status = (error as { status?: number }).status ?? 0;
      const message = error instanceof Error ? error.message.slice(0, 200) : "inconnu";
      const age = Date.now() - new Date(row.createdAt).getTime();
      let next: { status: string; at: number };
      if (status === 404) {
        // CRMlead ne connaît pas (encore) l'entreprise : on attend qu'elle l'ouvre.
        next =
          age > WAITING_DAYS * 86_400_000
            ? { status: "expired", at: 0 }
            : {
                status: "waiting",
                at: ((await crmleadUsed(database, row.organizationId)) ? 60 : 24 * 60) * 60_000,
              };
      } else if (FINAL.has(status)) {
        next = { status: "failed", at: 0 };
      } else {
        const wait = RETRY_MINUTES[Math.min(row.attempts, RETRY_MINUTES.length - 1)] ?? 720;
        next =
          age > WAITING_DAYS * 86_400_000
            ? { status: "expired", at: 0 }
            : { status: "pending", at: wait * 60_000 };
      }
      try {
        await database
          .update(crmleadOutbox)
          .set({
            status: next.status,
            attempts: row.attempts + 1,
            lastError: message,
            nextAttemptAt: new Date(Date.now() + next.at),
          })
          .where(eq(crmleadOutbox.id, row.id));
      } catch {
        // Un état plus récent attend déjà pour la même pièce : celui-ci est dépassé.
        await database
          .update(crmleadOutbox)
          .set({ status: "superseded", attempts: row.attempts + 1, lastError: message })
          .where(eq(crmleadOutbox.id, row.id));
      }
      if (next.status === "waiting") waiting++;
      else failed++;
    }
  }
  return { delivered, failed, waiting };
}

/** Met en file puis envoie après la réponse ; une panne de CRMlead ne bloque jamais la facturation. */
export async function syncCrmlead(database: Db, organizationId: string, invoiceIds: string[]) {
  try {
    let queued = false;
    for (const id of invoiceIds)
      queued = (await queueCrmlead(database, organizationId, id)) || queued;
    if (!queued) return;
    const run = () =>
      deliverCrmlead(database, { organizationId }).catch((e: unknown) => {
        console.error("[crmlead] envoi reporté", e instanceof Error ? e.message : "inconnu");
      });
    try {
      const { after } = await import("next/server");
      after(run);
    } catch {
      await run();
    }
  } catch (e) {
    console.error("[crmlead] mise en file impossible", e instanceof Error ? e.message : "inconnu");
  }
}
