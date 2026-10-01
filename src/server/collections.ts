import { and, eq, inArray, sql } from "drizzle-orm";
import { addDays } from "@/lib/fiscal-year";
import type { Db } from "./db";
import { invoices } from "./db/schema";
import { listInvoices } from "./invoices";

/**
 * Comportement de paiement d'un client, appris de ses factures soldées : retard moyen par rapport à
 * l'échéance et part des factures payées en retard. Sert à adapter les relances et à prévoir les
 * encaissements.
 */
export type PaymentProfile = {
  contactId: string;
  paidInvoices: number;
  /** Jours entre l'échéance et le dernier paiement, en moyenne (négatif : payé en avance). */
  avgDaysLate: number;
  /** Part des factures payées plus de 5 jours après l'échéance. */
  lateShare: number;
  risk: "unknown" | "reliable" | "normal" | "late";
};

/** Au moins trois factures soldées pour juger un client. */
const MIN_HISTORY = 3;

export function classify(
  paid: number,
  avgDaysLate: number,
  lateShare: number,
): PaymentProfile["risk"] {
  if (paid < MIN_HISTORY) return "unknown";
  if (avgDaysLate > 15 || lateShare > 0.5) return "late";
  if (avgDaysLate <= 3 && lateShare <= 0.2) return "reliable";
  return "normal";
}

/**
 * Jours après l'échéance de chaque niveau de relance selon le profil : plus de délai pour les bons
 * payeurs, plus tôt pour les retardataires (qui reçoivent aussi un rappel courtois juste avant).
 */
export function reminderSchedule(risk: PaymentProfile["risk"]): readonly number[] {
  if (risk === "reliable") return [14, 30, 45];
  if (risk === "late") return [7, 20, 35];
  return [10, 25, 40];
}

/** Jours avant l'échéance où part le rappel courtois d'un client retardataire. */
export const COURTESY_DAYS = 3;

export async function paymentProfiles(
  database: Db,
  organizationId: string,
  contactIds?: string[],
): Promise<Map<string, PaymentProfile>> {
  if (contactIds && contactIds.length === 0) return new Map();
  // Factures entièrement payées (sans avoir) : date du dernier paiement contre l'échéance.
  const rows = await database
    .select({
      contactId: invoices.contactId,
      dueDate: invoices.dueDate,
      lastPaid: sql<
        string | null
      >`(select max(p.paid_on)::text from invoice_payments p where p.invoice_id = "invoices"."id")`,
      paid: sql<number>`coalesce((select sum(p.amount_cents) from invoice_payments p where p.invoice_id = "invoices"."id"), 0)::bigint`.mapWith(
        Number,
      ),
      total: invoices.totalCents,
    })
    .from(invoices)
    .where(
      and(
        eq(invoices.organizationId, organizationId),
        eq(invoices.kind, "invoice"),
        eq(invoices.status, "issued"),
        ...(contactIds ? [inArray(invoices.contactId, contactIds)] : []),
      ),
    );
  const by = new Map<string, number[]>();
  for (const r of rows) {
    if (!r.lastPaid || r.paid < r.total) continue;
    const late = Math.round((Date.parse(r.lastPaid) - Date.parse(r.dueDate)) / 86_400_000);
    by.set(r.contactId, [...(by.get(r.contactId) ?? []), late]);
  }
  const out = new Map<string, PaymentProfile>();
  for (const [contactId, delays] of by) {
    const avg = delays.reduce((s, d) => s + d, 0) / delays.length;
    const lateShare = delays.filter((d) => d > 5).length / delays.length;
    out.set(contactId, {
      contactId,
      paidInvoices: delays.length,
      avgDaysLate: Math.round(avg * 10) / 10,
      lateShare: Math.round(lateShare * 100) / 100,
      risk: classify(delays.length, avg, lateShare),
    });
  }
  return out;
}

export type CollectionWeek = { weekStart: string; expectedCents: number; invoices: number };

/**
 * Encaissements attendus sur les prochaines semaines : chaque facture ouverte, à la date où son
 * client paie d'habitude (échéance plus son retard moyen), dans la monnaie de l'entreprise. Ce qui
 * est déjà en retard tombe dans la semaine en cours.
 */
export async function expectedCollections(
  database: Db,
  organizationId: string,
  homeCurrency: string,
  today: string,
  weeks = 8,
): Promise<{ weeks: CollectionWeek[]; laterCents: number }> {
  const rows = (await listInvoices(database, organizationId, "invoice")).filter(
    (i) => i.status === "issued" && i.currency === homeCurrency,
  );
  const open = rows
    .map((i) => ({
      ...i,
      openCents: i.totalCents - i.paidCents - i.creditedCents + i.chargesCents,
    }))
    .filter((i) => i.openCents > 0);
  const ids = open.map((o) => o.id);
  const contactOf = new Map(
    ids.length === 0
      ? []
      : (
          await database
            .select({ id: invoices.id, contactId: invoices.contactId })
            .from(invoices)
            .where(inArray(invoices.id, ids))
        ).map((r) => [r.id, r.contactId] as const),
  );
  const contactIds = [...new Set(contactOf.values())];
  const profiles = await paymentProfiles(database, organizationId, contactIds);
  // Semaines du lundi au dimanche, à partir de la semaine en cours.
  const day = new Date(`${today}T00:00:00Z`).getUTCDay();
  const monday = addDays(today, -((day + 6) % 7));
  const result: CollectionWeek[] = Array.from({ length: weeks }, (_, k) => ({
    weekStart: addDays(monday, 7 * k),
    expectedCents: 0,
    invoices: 0,
  }));
  let laterCents = 0;
  for (const i of open) {
    const p = profiles.get(contactOf.get(i.id) ?? "");
    const delay = p && p.risk !== "unknown" ? Math.max(0, Math.round(p.avgDaysLate)) : 0;
    const expected = addDays(i.dueDate, delay) < today ? today : addDays(i.dueDate, delay);
    const k = Math.floor((Date.parse(expected) - Date.parse(monday)) / (7 * 86_400_000));
    const bucket = result[k];
    if (bucket) {
      bucket.expectedCents += i.openCents;
      bucket.invoices += 1;
    } else laterCents += i.openCents;
  }
  return { weeks: result, laterCents };
}
