import "server-only";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Db } from "./db";
import { auditLog, organizations } from "./db/schema";
import { getFile, putFile } from "./storage";

type Who = { organizationId: string; userId: string };

export const MAX_LOGO_BYTES = 1_000_000;

/** Type réel d'après les premiers octets : PNG ou JPEG seulement, ce que le PDF sait dessiner. */
export function logoType(bytes: Buffer): "image/png" | "image/jpeg" | null {
  if (
    bytes.length > 8 &&
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return "image/png";
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return "image/jpeg";
  return null;
}

export async function saveLogo(
  database: Db,
  who: Who,
  bytes: Buffer,
): Promise<"saved" | "type" | "size"> {
  if (bytes.length === 0 || bytes.length > MAX_LOGO_BYTES) return "size";
  const type = logoType(bytes);
  if (!type) return "type";
  const key = `${who.organizationId}/logo/${randomUUID()}.${type === "image/png" ? "png" : "jpg"}`;
  await putFile(database, who.organizationId, key, bytes, type);
  await database
    .update(organizations)
    .set({ logoKey: key, updatedAt: new Date() })
    .where(eq(organizations.id, who.organizationId));
  await database.insert(auditLog).values({
    organizationId: who.organizationId,
    userId: who.userId,
    action: "company.logo",
    entity: "organization",
    entityId: who.organizationId,
  });
  return "saved";
}

export async function removeLogo(database: Db, who: Who) {
  await database
    .update(organizations)
    .set({ logoKey: null, updatedAt: new Date() })
    .where(eq(organizations.id, who.organizationId));
}

/** Logo de l'organisation, ou null. */
export async function organizationLogo(database: Db, organizationId: string) {
  const [org] = await database
    .select({ logoKey: organizations.logoKey })
    .from(organizations)
    .where(eq(organizations.id, organizationId));
  if (!org?.logoKey) return null;
  const file = await getFile(database, organizationId, org.logoKey);
  return file ? { ...file, key: org.logoKey } : null;
}
