import { createHmac } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { and, asc, desc, eq, inArray, isNull, lte } from "drizzle-orm";
import { decrypt, encrypt, randomToken } from "./auth/crypto";
import type { Db } from "./db";
import { auditLog, webhookDeliveries, webhookEndpoints } from "./db/schema";
import { env } from "./env";

type Who = { organizationId: string; userId: string };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const WEBHOOK_EVENTS = ["invoice.issued", "invoice.paid", "payment.created"] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];
export const MAX_ENDPOINTS = 5;
/** Délais avant chaque nouvel essai : 1 min, 5 min, 30 min, 2 h, 12 h, puis abandon. */
const RETRY_MINUTES = [1, 5, 30, 120, 720];
const PURPOSE = "webhook-secret";

/** Tests de bout en bout : un faux serveur local reçoit les événements. */
const allowLocal = () => process.env.WEBHOOK_ALLOW_LOCAL === "1";

/** Adresse IP privée, locale ou réservée : un webhook n'y est jamais envoyé. */
export function privateAddress(ip: string): boolean {
  if (isIP(ip) === 6) {
    const v = ip.toLowerCase();
    if (v === "::1" || v === "::") return true;
    if (v.startsWith("::ffff:")) return privateAddress(v.slice(7));
    return /^(fc|fd|fe8|fe9|fea|feb)/.test(v);
  }
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n))) return true;
  const [a = 0, b = 0] = p;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224
  );
}

/** Adresse de webhook admise : https, sans identifiants, vers un hôte public. */
export function checkWebhookUrl(value: string): URL | null {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (url.username || url.password || value.length > 500) return null;
  if (allowLocal()) return url.protocol === "https:" || url.protocol === "http:" ? url : null;
  if (url.protocol !== "https:") return null;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal"))
    return null;
  if (isIP(host) && privateAddress(host)) return null;
  return url;
}

export async function createEndpoint(
  database: Db,
  who: Who,
  input: { url: string; events: string[] },
): Promise<{ secret: string; id: string } | "url" | "events" | "tooMany"> {
  const url = checkWebhookUrl(input.url);
  if (!url) return "url";
  const events = WEBHOOK_EVENTS.filter((e) => input.events.includes(e));
  if (events.length === 0) return "events";
  const active = await database
    .select({ id: webhookEndpoints.id })
    .from(webhookEndpoints)
    .where(
      and(
        eq(webhookEndpoints.organizationId, who.organizationId),
        isNull(webhookEndpoints.disabledAt),
      ),
    );
  if (active.length >= MAX_ENDPOINTS) return "tooMany";
  const secret = `whsec_${randomToken(24)}`;
  const [row] = await database
    .insert(webhookEndpoints)
    .values({
      organizationId: who.organizationId,
      url: url.toString(),
      secretEnc: encrypt(secret, env().SESSION_SECRET, PURPOSE),
      events,
      createdBy: who.userId,
    })
    .returning({ id: webhookEndpoints.id });
  if (!row) throw new Error("endpoint_not_saved");
  await database.insert(auditLog).values({
    organizationId: who.organizationId,
    userId: who.userId,
    action: "webhook.create",
    entity: "webhook",
    entityId: row.id,
    data: { url: url.toString(), events },
  });
  return { secret, id: row.id };
}

export async function listEndpoints(database: Db, organizationId: string) {
  const rows = await database
    .select({
      id: webhookEndpoints.id,
      url: webhookEndpoints.url,
      events: webhookEndpoints.events,
      createdAt: webhookEndpoints.createdAt,
    })
    .from(webhookEndpoints)
    .where(
      and(eq(webhookEndpoints.organizationId, organizationId), isNull(webhookEndpoints.disabledAt)),
    )
    .orderBy(asc(webhookEndpoints.createdAt));
  const recent = rows.length
    ? await database
        .select({
          endpointId: webhookDeliveries.endpointId,
          event: webhookDeliveries.event,
          status: webhookDeliveries.status,
          lastStatus: webhookDeliveries.lastStatus,
          createdAt: webhookDeliveries.createdAt,
        })
        .from(webhookDeliveries)
        .where(
          inArray(
            webhookDeliveries.endpointId,
            rows.map((r) => r.id),
          ),
        )
        .orderBy(desc(webhookDeliveries.createdAt))
        .limit(50)
    : [];
  return rows.map((r) => ({ ...r, deliveries: recent.filter((d) => d.endpointId === r.id) }));
}

export async function disableEndpoint(database: Db, who: Who, id: string): Promise<boolean> {
  if (!UUID.test(id)) return false;
  const [row] = await database
    .update(webhookEndpoints)
    .set({ disabledAt: new Date() })
    .where(
      and(
        eq(webhookEndpoints.id, id),
        eq(webhookEndpoints.organizationId, who.organizationId),
        isNull(webhookEndpoints.disabledAt),
      ),
    )
    .returning({ id: webhookEndpoints.id });
  if (!row) return false;
  await database.insert(auditLog).values({
    organizationId: who.organizationId,
    userId: who.userId,
    action: "webhook.disable",
    entity: "webhook",
    entityId: id,
  });
  return true;
}

/**
 * Met un événement en file pour chaque adresse abonnée de l'entreprise. Rien ne part ici : l'envoi
 * se fait après la réponse (flushWebhooks), et la tâche quotidienne reprend ce qui a échoué.
 */
export async function emitEvent(
  database: Db,
  organizationId: string,
  event: WebhookEvent,
  data: Record<string, unknown>,
): Promise<number> {
  const endpoints = await database
    .select({ id: webhookEndpoints.id, events: webhookEndpoints.events })
    .from(webhookEndpoints)
    .where(
      and(eq(webhookEndpoints.organizationId, organizationId), isNull(webhookEndpoints.disabledAt)),
    );
  const targets = endpoints.filter((e) => e.events.includes(event));
  if (targets.length === 0) return 0;
  const created = new Date().toISOString();
  await database.insert(webhookDeliveries).values(
    targets.map((e) => ({
      organizationId,
      endpointId: e.id,
      event,
      payload: { type: event, created, data },
    })),
  );
  return targets.length;
}

/** En-tête « InvoiceLead-Signature: t=…,v1=… » : HMAC-SHA256 de « t.corps » avec le secret. */
export function signPayload(secret: string, body: string, timestamp: number): string {
  const mac = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  return `t=${timestamp},v1=${mac}`;
}

async function resolvesPublic(url: URL): Promise<boolean> {
  if (allowLocal()) return true;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host)) return !privateAddress(host);
  try {
    const addresses = await lookup(host, { all: true });
    return addresses.length > 0 && addresses.every((a) => !privateAddress(a.address));
  } catch {
    return false;
  }
}

/** Envoie les événements en attente (d'une entreprise, ou tous), au plus `limit` à la fois. */
export async function deliverPending(
  database: Db,
  options: { organizationId?: string; now?: Date; limit?: number; fetcher?: typeof fetch } = {},
): Promise<{ delivered: number; failed: number }> {
  const now = options.now ?? new Date();
  const fetcher = options.fetcher ?? fetch;
  const rows = await database
    .select({ delivery: webhookDeliveries, endpoint: webhookEndpoints })
    .from(webhookDeliveries)
    .innerJoin(webhookEndpoints, eq(webhookEndpoints.id, webhookDeliveries.endpointId))
    .where(
      and(
        eq(webhookDeliveries.status, "pending"),
        lte(webhookDeliveries.nextAttemptAt, now),
        isNull(webhookEndpoints.disabledAt),
        ...(options.organizationId
          ? [eq(webhookDeliveries.organizationId, options.organizationId)]
          : []),
      ),
    )
    .orderBy(asc(webhookDeliveries.createdAt))
    .limit(options.limit ?? 50);
  let delivered = 0;
  let failed = 0;
  for (const { delivery, endpoint } of rows) {
    const secret = decrypt(endpoint.secretEnc, env().SESSION_SECRET, PURPOSE);
    const body = JSON.stringify({ id: delivery.id, ...(delivery.payload as object) });
    let status: number | null = null;
    let error: string | null = null;
    const url = checkWebhookUrl(endpoint.url);
    if (!secret || !url) error = "configuration";
    else if (!(await resolvesPublic(url))) error = "address";
    else {
      try {
        const res = await fetcher(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "User-Agent": "InvoiceLead-Webhooks/1",
            "InvoiceLead-Event": delivery.event,
            "InvoiceLead-Delivery": delivery.id,
            "InvoiceLead-Signature": signPayload(secret, body, Math.floor(now.getTime() / 1000)),
          },
          body,
          redirect: "manual",
          signal: AbortSignal.timeout(5000),
        });
        status = res.status;
        if (res.status < 200 || res.status >= 300) error = `http_${res.status}`;
      } catch (e) {
        error = e instanceof Error && e.name === "TimeoutError" ? "timeout" : "network";
      }
    }
    const attempts = delivery.attempts + 1;
    if (!error) {
      delivered += 1;
      await database
        .update(webhookDeliveries)
        .set({
          status: "delivered",
          attempts,
          lastStatus: status,
          lastError: null,
          deliveredAt: now,
        })
        .where(eq(webhookDeliveries.id, delivery.id));
      continue;
    }
    failed += 1;
    const wait = RETRY_MINUTES[attempts - 1];
    await database
      .update(webhookDeliveries)
      .set({
        status: wait === undefined ? "failed" : "pending",
        attempts,
        lastStatus: status,
        lastError: error,
        nextAttemptAt: new Date(now.getTime() + (wait ?? 0) * 60_000),
      })
      .where(eq(webhookDeliveries.id, delivery.id));
  }
  return { delivered, failed };
}

/**
 * Envoie la file d'une entreprise après la réponse, quand la requête le permet (next/server
 * `after`) ; sinon tout de suite. Ne lève jamais : un webhook ne bloque pas la facturation.
 */
export async function flushWebhooks(database: Db, organizationId: string) {
  const run = () =>
    deliverPending(database, { organizationId }).catch((e: unknown) => {
      console.error("[webhooks] envoi reporté", e instanceof Error ? e.message : "inconnu");
    });
  try {
    const { after } = await import("next/server");
    after(run);
  } catch {
    await run();
  }
}

/** Résumé d'une pièce dans un événement, montants en centimes. */
export function invoiceSummary(invoice: {
  id: string;
  number: string | null;
  kind: string;
  status: string;
  currency: string;
  contactId: string;
  issueDate: string;
  dueDate: string;
  netCents: number;
  vatCents: number;
  totalCents: number;
}) {
  return {
    id: invoice.id,
    number: invoice.number,
    kind: invoice.kind,
    status: invoice.status,
    currency: invoice.currency,
    contactId: invoice.contactId,
    issueDate: invoice.issueDate,
    dueDate: invoice.dueDate,
    netCents: invoice.netCents,
    vatCents: invoice.vatCents,
    totalCents: invoice.totalCents,
  };
}
