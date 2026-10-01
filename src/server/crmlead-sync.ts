import { and, eq, inArray, lte, sql } from "drizzle-orm";
import type { Db } from "./db";
import { crmleadOutbox, invoices, organizations } from "./db/schema";
import { env } from "./env";
import { send } from "./lead-id/leadId";
import { invoiceBalance } from "./payments";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Reprises : 1 min, 5 min, 30 min, 2 h, 12 h, puis abandon. */
const RETRY_MINUTES = [1, 5, 30, 120, 720];

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
  if (depth > 2) return null;
  const parentId = invoice.sourceQuoteId ?? invoice.relatedInvoiceId;
  if (!parentId) return null;
  const [parent] = await database
    .select()
    .from(invoices)
    .where(and(eq(invoices.id, parentId), eq(invoices.organizationId, invoice.organizationId)));
  return parent ? crmleadLeadOf(database, parent, depth + 1) : null;
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
  const lang = ["de", "fr", "en"].includes(invoice.language) ? invoice.language : "de";
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

/**
 * Envoie ce qui est dû (d'une organisation, ou de toutes pour la tâche quotidienne). Chaque envoi
 * est d'abord réservé (« sending ») : deux passages simultanés ne l'envoient jamais deux fois, et
 * un nouvel état arrivé pendant l'envoi reste en attente au lieu d'être marqué livré.
 */
export async function deliverCrmlead(
  database: Db,
  opts: { organizationId?: string; limit?: number } = {},
): Promise<{ delivered: number; failed: number }> {
  const now = new Date();
  const due = await database
    .select({ id: crmleadOutbox.id })
    .from(crmleadOutbox)
    .where(
      and(
        inArray(crmleadOutbox.status, ["pending", "sending"]),
        lte(crmleadOutbox.nextAttemptAt, now),
        ...(opts.organizationId ? [eq(crmleadOutbox.organizationId, opts.organizationId)] : []),
      ),
    )
    .orderBy(crmleadOutbox.createdAt)
    .limit(opts.limit ?? 20);
  let delivered = 0;
  let failed = 0;
  for (const { id } of due) {
    const [row] = await database
      .update(crmleadOutbox)
      .set({ status: "sending", nextAttemptAt: new Date(Date.now() + CLAIM_MINUTES * 60_000) })
      .where(
        and(
          eq(crmleadOutbox.id, id),
          inArray(crmleadOutbox.status, ["pending", "sending"]),
          lte(crmleadOutbox.nextAttemptAt, now),
        ),
      )
      .returning();
    if (!row) continue;
    const e = row.envelope as Parameters<typeof send>[1];
    try {
      await send({ app: "crmlead", url: env().LEAD_ID_ISSUER }, e);
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
      const status = (error as { status?: number }).status;
      const message = error instanceof Error ? error.message.slice(0, 200) : "inconnu";
      // Lead introuvable ou à la corbeille, formule sans CRMlead : réessayer ne changerait rien.
      const final =
        status === 404 || status === 409 || status === 402 || status === 400 || status === 422;
      const wait = RETRY_MINUTES[row.attempts];
      const retry = !final && wait !== undefined;
      try {
        await database
          .update(crmleadOutbox)
          .set({
            status: retry ? "pending" : "failed",
            attempts: row.attempts + 1,
            lastError: message,
            nextAttemptAt: new Date(Date.now() + (wait ?? 0) * 60_000),
          })
          .where(eq(crmleadOutbox.id, row.id));
      } catch {
        // Un état plus récent attend déjà pour la même pièce : celui-ci est dépassé.
        await database
          .update(crmleadOutbox)
          .set({ status: "superseded", attempts: row.attempts + 1, lastError: message })
          .where(eq(crmleadOutbox.id, row.id));
      }
      failed++;
    }
  }
  return { delivered, failed };
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
