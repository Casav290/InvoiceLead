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
import { refreshPlan } from "./plan-refresh";
import { featureAccess } from "./plans";
import { can } from "./roles";

type Who = { organizationId: string; userId: string };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Portée d'une clé. « full » : toute l'API REST et le serveur MCP, formule Pro+. « projectlead » :
 * la clé qui relie ProjectLead, ouverte à toutes les formules, limitée à ce que ProjectLead appelle
 * (lire et créer des contacts, créer des brouillons de factures ; voir ProjectLead,
 * server/lib/invoicelead.ts). Rien d'autre : ni lecture des factures, ni émission, ni paiement, ni
 * PDF, ni devis, ni MCP, ni webhooks.
 */
export const API_SCOPES = ["full", "projectlead"] as const;
export type ApiScope = (typeof API_SCOPES)[number];

/** Points d'accès, tels que les vérifie apiCaller avant toute action. */
export type ApiEndpoint =
  | "contacts.list"
  | "contacts.create"
  | "invoices.list"
  | "invoices.get"
  | "invoices.createDraft"
  | "quotes.createDraft"
  | "invoices.issue"
  | "invoices.pay"
  | "invoices.pdf"
  | "mcp";

/** Ce qu'ouvre la clé ProjectLead, et seulement cela. */
export const PROJECTLEAD_ENDPOINTS: readonly ApiEndpoint[] = [
  "contacts.list",
  "contacts.create",
  "invoices.createDraft",
];

/** Une clé de cette portée peut-elle appeler ce point d'accès ? Une portée inconnue n'ouvre rien. */
export function scopeAllows(scope: string, endpoint: ApiEndpoint): boolean {
  if (scope === "full") return true;
  if (scope === "projectlead") return PROJECTLEAD_ENDPOINTS.includes(endpoint);
  return false;
}

/** Clés actives au plus, par portée. */
export const MAX_API_KEYS: Record<ApiScope, number> = { full: 10, projectlead: 3 };
/** Nom de la clé ProjectLead dans la liste et le journal. */
export const PROJECTLEAD_KEY_NAME = "ProjectLead";

/**
 * Nouvelle clé : « il_live_ » suivi de 32 octets aléatoires. Rendue une seule fois. La clé ProjectLead
 * porte le même préfixe : ProjectLead l'attend sous cette forme.
 */
export async function createApiKey(
  database: Db,
  who: Who,
  name: string,
  scope: ApiScope = "full",
): Promise<{ key: string; row: ApiKey } | "invalid" | "tooMany"> {
  const label = name.trim();
  if (!label || label.length > 60) return "invalid";
  const active = await database
    .select({ id: apiKeys.id })
    .from(apiKeys)
    .where(
      and(
        eq(apiKeys.organizationId, who.organizationId),
        eq(apiKeys.scope, scope),
        isNull(apiKeys.revokedAt),
      ),
    );
  if (active.length >= MAX_API_KEYS[scope]) return "tooMany";
  const key = `il_live_${randomToken(32)}`;
  const [row] = await database
    .insert(apiKeys)
    .values({
      organizationId: who.organizationId,
      name: label,
      prefix: key.slice(0, 12),
      keyHash: sha256Hex(key),
      scope,
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
    data: { name: label, prefix: row.prefix, scope },
  });
  return { key, row };
}

/** Clé qui relie ProjectLead : toutes les formules, portée « projectlead ». */
export function createProjectLeadKey(database: Db, who: Who) {
  return createApiKey(database, who, PROJECTLEAD_KEY_NAME, "projectlead");
}

/** Clés actives de l'entreprise d'une portée. */
export async function listApiKeys(database: Db, organizationId: string, scope: ApiScope = "full") {
  return database
    .select()
    .from(apiKeys)
    .where(
      and(
        eq(apiKeys.organizationId, organizationId),
        eq(apiKeys.scope, scope),
        isNull(apiKeys.revokedAt),
      ),
    )
    .orderBy(desc(apiKeys.createdAt));
}

/** Révoque une clé active de l'entreprise (de cette portée seulement, quand elle est donnée). */
export async function revokeApiKey(
  database: Db,
  who: Who,
  id: string,
  scope?: ApiScope,
): Promise<boolean> {
  if (!UUID.test(id)) return false;
  const [row] = await database
    .update(apiKeys)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(apiKeys.id, id),
        eq(apiKeys.organizationId, who.organizationId),
        isNull(apiKeys.revokedAt),
        scope ? eq(apiKeys.scope, scope) : undefined,
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

export type ApiCaller = {
  organization: Organization;
  userId: string;
  keyId: string;
  scope: ApiScope;
};

/**
 * Appelant d'une requête d'API, d'après « Authorization: Bearer il_live_… », pour un point d'accès
 * donné. La clé doit être active et sa portée ouvrir ce point d'accès ; l'entreprise doit avoir accès
 * à InvoiceLead, en Pro+ pour une clé complète (la clé ProjectLead vaut dans toutes les formules) ; la
 * personne qui a créé la clé doit pouvoir encore facturer. Sinon : « unauthorized » (clé inconnue)
 * ou « forbidden » (portée, formule ou droits).
 */
export async function apiCaller(
  database: Db,
  authorization: string | null,
  endpoint: ApiEndpoint,
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
  // Portée d'abord : une clé ProjectLead n'atteint jamais un autre point d'accès, quelle que soit la
  // formule (et une portée inconnue n'ouvre rien).
  const scope = row.key.scope;
  if (!scopeAllows(scope, endpoint)) return "forbidden";
  // Une entreprise qui n'utilise que l'API ne se connecte plus : sa formule est relue au Compte Lead.
  const org = await refreshPlan(database, row.organization);
  if (!org.hasAccess) return "forbidden";
  if (scope === "full" && !featureAccess(org, "api").allowed) return "forbidden";
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
  return {
    organization: org,
    userId: row.key.createdBy,
    keyId: row.key.id,
    scope: scope as ApiScope,
  };
}
