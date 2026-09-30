import { and, desc, eq, isNull } from "drizzle-orm";
import { randomToken, sha256Hex } from "./auth/crypto";
import { betaAllowed } from "./beta";
import type { Db } from "./db";
import {
  type ApiKey,
  apiKeys,
  auditLog,
  memberships,
  type Organization,
  organizations,
  users,
} from "./db/schema";
import { env } from "./env";
import { hasFeature } from "./plans";
import { can } from "./roles";

type Who = { organizationId: string; userId: string };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const MAX_API_KEYS = 10;

/** Nouvelle clé : « il_live_ » suivi de 32 octets aléatoires. Rendue une seule fois. */
export async function createApiKey(
  database: Db,
  who: Who,
  name: string,
): Promise<{ key: string; row: ApiKey } | "invalid" | "tooMany"> {
  const label = name.trim();
  if (!label || label.length > 60) return "invalid";
  const active = await database
    .select({ id: apiKeys.id })
    .from(apiKeys)
    .where(and(eq(apiKeys.organizationId, who.organizationId), isNull(apiKeys.revokedAt)));
  if (active.length >= MAX_API_KEYS) return "tooMany";
  const key = `il_live_${randomToken(32)}`;
  const [row] = await database
    .insert(apiKeys)
    .values({
      organizationId: who.organizationId,
      name: label,
      prefix: key.slice(0, 12),
      keyHash: sha256Hex(key),
      createdBy: who.userId,
    })
    .returning();
  if (!row) throw new Error("api_key_not_saved");
  await database.insert(auditLog).values({
    organizationId: who.organizationId,
    userId: who.userId,
    action: "api_key.create",
    entity: "api_key",
    entityId: row.id,
    data: { name: label, prefix: row.prefix },
  });
  return { key, row };
}

export async function listApiKeys(database: Db, organizationId: string) {
  return database
    .select()
    .from(apiKeys)
    .where(and(eq(apiKeys.organizationId, organizationId), isNull(apiKeys.revokedAt)))
    .orderBy(desc(apiKeys.createdAt));
}

export async function revokeApiKey(database: Db, who: Who, id: string): Promise<boolean> {
  if (!UUID.test(id)) return false;
  const [row] = await database
    .update(apiKeys)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(apiKeys.id, id),
        eq(apiKeys.organizationId, who.organizationId),
        isNull(apiKeys.revokedAt),
      ),
    )
    .returning({ id: apiKeys.id });
  if (!row) return false;
  await database.insert(auditLog).values({
    organizationId: who.organizationId,
    userId: who.userId,
    action: "api_key.revoke",
    entity: "api_key",
    entityId: id,
  });
  return true;
}

export type ApiCaller = { organization: Organization; userId: string; keyId: string };

/**
 * Appelant d'une requête d'API, d'après « Authorization: Bearer il_live_… ». La clé doit être active,
 * l'entreprise avoir accès à InvoiceLead en Pro+, et la personne qui a créé la clé pouvoir encore
 * facturer. Sinon : « unauthorized » (clé inconnue) ou « forbidden » (formule ou droits).
 */
export async function apiCaller(
  database: Db,
  authorization: string | null,
): Promise<ApiCaller | "unauthorized" | "forbidden"> {
  const m = /^Bearer\s+(il_live_[A-Za-z0-9_-]{20,})$/.exec(authorization ?? "");
  if (!m?.[1]) return "unauthorized";
  const [row] = await database
    .select({ key: apiKeys, organization: organizations })
    .from(apiKeys)
    .innerJoin(organizations, eq(organizations.id, apiKeys.organizationId))
    .where(and(eq(apiKeys.keyHash, sha256Hex(m[1])), isNull(apiKeys.revokedAt)))
    .limit(1);
  if (!row?.key.createdBy) return "unauthorized";
  const org = row.organization;
  if (!org.hasAccess || !hasFeature(org, "api")) return "forbidden";
  const [creator] = await database
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, row.key.createdBy));
  const beta = { leadOrg: org.leadOrg ?? "", email: creator?.email ?? "" };
  if (!betaAllowed(env().BETA_ALLOWLIST, beta)) return "forbidden";
  const [member] = await database
    .select()
    .from(memberships)
    .where(and(eq(memberships.organizationId, org.id), eq(memberships.userId, row.key.createdBy)));
  if (!member || !can(member, "billing")) return "forbidden";
  await database.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, row.key.id));
  return { organization: org, userId: row.key.createdBy, keyId: row.key.id };
}
