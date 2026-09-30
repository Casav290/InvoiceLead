import "server-only";
import { createHmac } from "node:crypto";
import { and, eq, isNull, ne } from "drizzle-orm";
import { sha256Hex } from "./auth/crypto";
import type { Db } from "./db";
import { invoices } from "./db/schema";
import { env } from "./env";
import { getInvoice } from "./invoices";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Jeton du lien de consultation d'une pièce : dérivé de son identifiant par HMAC, donc toujours le
 * même lien pour la même pièce, sans avoir à le conserver. La base ne garde que son empreinte, qui
 * sert à retrouver la pièce.
 */
export function shareToken(invoiceId: string): string {
  return createHmac("sha256", env().SESSION_SECRET)
    .update(`share:${invoiceId}`)
    .digest("base64url");
}

export function shareUrl(locale: string, token: string): string {
  return `${env().APP_URL}/${locale}/d/${token}`;
}

/** Active le lien d'une pièce émise de l'organisation et le rend ; null si la pièce n'y est pas. */
export async function enableShareLink(
  database: Db,
  organizationId: string,
  invoiceId: string,
): Promise<string | null> {
  if (!UUID.test(invoiceId)) return null;
  const token = shareToken(invoiceId);
  const [row] = await database
    .update(invoices)
    .set({ publicTokenHash: sha256Hex(token) })
    .where(
      and(
        eq(invoices.id, invoiceId),
        eq(invoices.organizationId, organizationId),
        ne(invoices.status, "draft"),
      ),
    )
    .returning({ id: invoices.id });
  return row ? token : null;
}

/** Pièce d'un lien de consultation, sans session. Note la première consultation. */
export async function findSharedDocument(database: Db, token: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const [row] = await database
    .select({ id: invoices.id, organizationId: invoices.organizationId })
    .from(invoices)
    .where(and(eq(invoices.publicTokenHash, sha256Hex(token)), ne(invoices.status, "draft")))
    .limit(1);
  if (!row) return null;
  await database
    .update(invoices)
    .set({ viewedAt: new Date() })
    .where(and(eq(invoices.id, row.id), isNull(invoices.viewedAt)));
  return getInvoice(database, row.organizationId, row.id);
}
