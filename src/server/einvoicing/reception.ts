import "server-only";
import { and, eq, inArray, isNotNull, lt, or, sql } from "drizzle-orm";
import { isValidFrVatId, isValidSiret, normalizeSiret } from "@/countries/fr/vat";
import { addDays } from "@/lib/fiscal-year";
import { importEInvoice } from "@/server/bills";
import type { Db } from "@/server/db";
import {
  auditLog,
  type EinvoiceConnection,
  einvoiceConnections,
  memberships,
  organizations,
  type SupplierBill,
  supplierBills,
} from "@/server/db/schema";
import { uploadReceipt } from "@/server/receipts";
import { type B2Brouter, B2BrouterError } from "./b2brouter";

/**
 * Réception des factures électroniques en France (réforme du 1er septembre 2026) par la plateforme
 * agréée B2Brouter : inscription du SIREN à l'annuaire de la DGFiP, relevé des factures reçues
 * (XML d'origine archivé comme justificatif, facture à payer en brouillon), puis décisions de
 * l'entreprise (approuvée, refusée avec motif, payée) rendues à la plateforme.
 */

type Who = { organizationId: string; userId: string };

/** Le compte n'est pas encore inscrit à l'annuaire (inscription interrompue, à reprendre). */
const NOT_REGISTERED = "notRegistered";
const PAGE = 50;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_PAGES = 4;

export async function getConnection(
  database: Db,
  organizationId: string,
): Promise<EinvoiceConnection | null> {
  const [row] = await database
    .select()
    .from(einvoiceConnections)
    .where(eq(einvoiceConnections.organizationId, organizationId));
  return row ?? null;
}

export type ReceptionState = "none" | "notRegistered" | "scheduled" | "active";

/** État affiché : rien, inscription à reprendre, active dès `startDate`, ou active. */
export function receptionState(c: EinvoiceConnection | null, today: string): ReceptionState {
  if (!c) return "none";
  if (c.lastError === NOT_REGISTERED) return "notRegistered";
  return c.startDate > today ? "scheduled" : "active";
}

export type RegisterResult =
  | EinvoiceConnection
  | "unavailable"
  | "notFrance"
  | "siret"
  | "alreadyElsewhere"
  | "failed";

/**
 * Inscrit l'entreprise : compte créé chez B2Brouter (une fois), puis inscription à l'annuaire, active
 * le lendemain. Un SIREN déjà inscrit chez une autre plateforme demande son code de transfert.
 */
export async function registerReception(
  database: Db,
  who: Who,
  client: B2Brouter | null,
  today: string,
  migrationCode: string | null,
): Promise<RegisterResult> {
  if (!client) return "unavailable";
  const [org] = await database
    .select()
    .from(organizations)
    .where(eq(organizations.id, who.organizationId));
  if (org?.country !== "FR") return "notFrance";
  const siret = normalizeSiret(org.taxNumber ?? "");
  if (!isValidSiret(siret)) return "siret";
  const siren = siret.slice(0, 9);
  const existing = await getConnection(database, who.organizationId);
  if (existing && existing.lastError !== NOT_REGISTERED) return existing;

  let accountId = existing?.externalAccountId ?? null;
  const startDate = addDays(today, 1);
  try {
    if (!accountId) {
      const vat = (org.uid ?? "").replace(/\s/g, "").toUpperCase();
      accountId = await client.createAccount({
        name: (org.legalName || org.name).slice(0, 140),
        siren,
        vatNumber: isValidFrVatId(vat) ? vat : null,
        street: [org.street, org.buildingNumber].filter(Boolean).join(" ") || null,
        postalCode: org.postalCode,
        town: org.town,
        email: org.email,
      });
      // Compte gardé tout de suite : une inscription interrompue reprend sur le même compte.
      await database.insert(einvoiceConnections).values({
        organizationId: who.organizationId,
        externalAccountId: accountId,
        siren,
        startDate,
        registeredBy: who.userId,
        lastError: NOT_REGISTERED,
      });
    }
    await client.registerReception(accountId, {
      startDate,
      email: org.email,
      migrationCode: migrationCode?.trim() || null,
    });
  } catch (e) {
    if (!(e instanceof B2BrouterError)) throw e;
    // 422 : SIREN encore inscrit chez une autre plateforme (code de transfert demandé).
    if (e.status === 422 && /annuaire|already|registered|migration/i.test(e.body))
      return "alreadyElsewhere";
    return "failed";
  }
  const [row] = await database
    .update(einvoiceConnections)
    .set({ startDate, lastError: null, registeredBy: who.userId, updatedAt: new Date() })
    .where(eq(einvoiceConnections.organizationId, who.organizationId))
    .returning();
  await database.insert(auditLog).values({
    organizationId: who.organizationId,
    userId: who.userId,
    action: "einvoice.register",
    entity: "organization",
    entityId: who.organizationId,
    data: { provider: "b2brouter", siren, startDate },
  });
  if (!row) throw new Error("connection_not_saved");
  return row;
}

/** Personne au nom de qui les factures relevées sont créées : l'inscrivant, sinon un administrateur. */
async function actor(database: Db, c: EinvoiceConnection): Promise<Who | null> {
  if (c.registeredBy) {
    const [m] = await database
      .select({ userId: memberships.userId })
      .from(memberships)
      .where(
        and(
          eq(memberships.organizationId, c.organizationId),
          eq(memberships.userId, c.registeredBy),
        ),
      );
    if (m) return { organizationId: c.organizationId, userId: m.userId };
  }
  const [admin] = await database
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(
      and(
        eq(memberships.organizationId, c.organizationId),
        inArray(memberships.role, ["admin", "manager"]),
      ),
    )
    .limit(1);
  return admin ? { organizationId: c.organizationId, userId: admin.userId } : null;
}

const ref = (id: string) => `b2brouter:${id}`;
const unref = (platformRef: string) => platformRef.replace(/^b2brouter:/, "");

/** État à rendre à la plateforme pour une facture reçue, selon sa place dans InvoiceLead. */
export function platformStateFor(status: string): "accepted" | "refused" | "paid" | null {
  if (status === "approved" || status === "scheduled") return "accepted";
  if (status === "paid") return "paid";
  if (status === "refused") return "refused";
  return null;
}

/** Rend à la plateforme les décisions pas encore transmises (approuvée, refusée, payée). */
export async function pushStates(
  database: Db,
  organizationId: string,
  client: B2Brouter,
): Promise<number> {
  const bills = await database
    .select()
    .from(supplierBills)
    .where(
      and(
        eq(supplierBills.organizationId, organizationId),
        isNotNull(supplierBills.platformRef),
        inArray(supplierBills.status, ["approved", "scheduled", "paid", "refused"]),
      ),
    )
    .limit(500);
  let pushed = 0;
  for (const bill of bills) {
    const state = platformStateFor(bill.status);
    if (!state || bill.platformState === state || !bill.platformRef) continue;
    // Une facture payée sans approbation transmise passe d'abord par « accepted ».
    if (state === "paid" && bill.platformState !== "accepted")
      await client.markAs(unref(bill.platformRef), "accepted");
    await client.markAs(
      unref(bill.platformRef),
      state,
      state === "refused" ? (bill.refusalReason ?? undefined) : undefined,
    );
    await database
      .update(supplierBills)
      .set({ platformState: state })
      .where(eq(supplierBills.id, bill.id));
    pushed++;
  }
  return pushed;
}

/** Type du fichier reçu : celui annoncé, sinon lu dans ses premiers octets (PDF ou XML). */
export function receivedType(announced: string, bytes: Buffer): string | null {
  if (announced === "application/pdf" || announced === "application/xml") return announced;
  if (announced === "text/xml") return "application/xml";
  const head = bytes
    .subarray(0, 64)
    .toString("utf8")
    .replace(/^\uFEFF/, "")
    .trimStart();
  if (head.startsWith("%PDF")) return "application/pdf";
  if (head.startsWith("<")) return "application/xml";
  return null;
}

/**
 * Prend une facture reçue : facture à payer, ou justificatif quand elle ne se lit pas sans IA.
 * Rend false quand elle doit rester chez la plateforme (fichier inconnu ou trop gros), sans être
 * acquittée, pour ne jamais perdre une facture.
 */
async function take(
  database: Db,
  who: Who,
  c: EinvoiceConnection,
  client: B2Brouter,
  row: { id: string; number: string | null },
  result: SyncResult,
): Promise<boolean> {
  const [already] = await database
    .select({ id: supplierBills.id })
    .from(supplierBills)
    .where(
      and(
        eq(supplierBills.organizationId, c.organizationId),
        eq(supplierBills.platformRef, ref(row.id)),
      ),
    );
  if (already) return true;
  const file = await client.downloadOriginal(row.id);
  const type = receivedType(file.type, file.bytes);
  if (!type) {
    result.error = "unreadable";
    return false;
  }
  const name = `${(row.number ?? row.id).replace(/[^\p{L}\p{N}._-]/gu, "_")}.${
    type === "application/pdf" ? "pdf" : "xml"
  }`;
  const bill = await importEInvoice(database, who, { name, type, bytes: file.bytes }, ref(row.id));
  if (typeof bill === "object") {
    result.imported++;
    return true;
  }
  // Même fichier déjà importé à la main : rien de plus.
  if (bill === "duplicate") return true;
  if (bill === "notEInvoice" || bill === "creditNote") {
    // Gardée comme justificatif : lue par l'IA ou à la main dans les justificatifs.
    const stored = await uploadReceipt(database, who, { name, type, bytes: file.bytes });
    if (typeof stored === "object") result.stored++;
    if (typeof stored === "object" || stored === "duplicate") return true;
  }
  result.error = "unreadable";
  return false;
}

export type SyncResult = { imported: number; stored: number; pushed: number; error: string | null };

/**
 * Relève les factures reçues par la plateforme : chacune devient une facture à payer (brouillon) ou,
 * illisible (avoir, PDF sans XML), un justificatif à lire ; puis elle est acquittée pour ne plus
 * revenir. Ensuite, les décisions de l'entreprise repartent à la plateforme.
 */
export async function syncConnection(
  database: Db,
  c: EinvoiceConnection,
  client: B2Brouter,
): Promise<SyncResult> {
  const result: SyncResult = { imported: 0, stored: 0, pushed: 0, error: null };
  if (c.lastError === NOT_REGISTERED) return { ...result, error: NOT_REGISTERED };
  const who = await actor(database, c);
  if (!who) {
    result.error = "noUser";
  } else {
    try {
      for (let page = 0; page < MAX_PAGES; page++) {
        const rows = await client.listReceived(c.externalAccountId, 0, PAGE);
        let kept = 0;
        for (const row of rows) {
          try {
            if (await take(database, who, c, client, row, result)) await client.ack(row.id);
            else kept++;
          } catch (e) {
            // Une facture en échec reste chez la plateforme pour le relevé suivant ; les autres
            // passent.
            if (!(e instanceof B2BrouterError)) throw e;
            result.error = e.message;
            kept++;
          }
        }
        // Les factures acquittées sortent de la liste ; celles gardées occupent le début.
        if (rows.length < PAGE || kept >= rows.length) break;
      }
      result.pushed = await pushStates(database, c.organizationId, client);
    } catch (e) {
      if (!(e instanceof B2BrouterError)) throw e;
      result.error = e.message;
    }
  }
  await database
    .update(einvoiceConnections)
    .set({ lastSyncAt: new Date(), lastError: result.error, updatedAt: new Date() })
    .where(eq(einvoiceConnections.id, c.id));
  return result;
}

/**
 * Relève une entreprise si son dernier relevé date de plus de `minutes` (ouverture des factures fournisseurs,
 * bouton « Relever maintenant ») : la date est prise d'abord, deux ouvertures ne relèvent pas deux
 * fois.
 */
export async function syncIfStale(
  database: Db,
  organizationId: string,
  client: B2Brouter | null,
  minutes = 15,
): Promise<SyncResult | null> {
  if (!client) return null;
  const [claimed] = await database
    .update(einvoiceConnections)
    .set({ lastSyncAt: new Date() })
    .where(
      and(
        eq(einvoiceConnections.organizationId, organizationId),
        or(
          sql`${einvoiceConnections.lastSyncAt} is null`,
          lt(einvoiceConnections.lastSyncAt, sql`now() - make_interval(mins => ${minutes})`),
        ),
        or(
          sql`${einvoiceConnections.lastError} is null`,
          sql`${einvoiceConnections.lastError} <> ${NOT_REGISTERED}`,
        ),
      ),
    )
    .returning();
  return claimed ? syncConnection(database, claimed, client) : null;
}

/** Tâche quotidienne : toutes les entreprises inscrites. */
export async function syncAll(
  database: Db,
  client: B2Brouter | null,
): Promise<{ companies: number; imported: number; errors: number }> {
  const out = { companies: 0, imported: 0, errors: 0 };
  if (!client) return out;
  const rows = await database
    .select({ id: einvoiceConnections.organizationId })
    .from(einvoiceConnections);
  for (const { id } of rows) {
    const r = await syncIfStale(database, id, client, 1);
    if (!r) continue;
    out.companies++;
    out.imported += r.imported;
    if (r.error) out.errors++;
  }
  return out;
}

/**
 * Refuse une facture reçue par la plateforme, encore en brouillon, avec un motif (rendu au
 * fournisseur par la plateforme). Les autres factures se suppriment, elles ne se refusent pas.
 */
export async function refuseBill(
  database: Db,
  who: Who,
  id: string,
  reason: string,
): Promise<SupplierBill | "notFound" | "reason"> {
  if (!UUID.test(id)) return "notFound";
  const motive = reason.trim().slice(0, 500);
  if (motive.length < 3) return "reason";
  const [row] = await database
    .update(supplierBills)
    .set({ status: "refused", refusalReason: motive, updatedAt: new Date() })
    .where(
      and(
        eq(supplierBills.id, id),
        eq(supplierBills.organizationId, who.organizationId),
        eq(supplierBills.status, "draft"),
        isNotNull(supplierBills.platformRef),
      ),
    )
    .returning();
  if (!row) return "notFound";
  await database.insert(auditLog).values({
    organizationId: who.organizationId,
    userId: who.userId,
    action: "bill.refuse",
    entity: "bill",
    entityId: row.id,
    data: { reason: motive, platformRef: row.platformRef },
  });
  return row;
}
