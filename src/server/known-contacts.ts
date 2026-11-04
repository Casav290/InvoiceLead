import { sql } from "drizzle-orm";
import type { Db } from "./db";

/**
 * Lecture « contacts connus » pour VisitLead (contrat ~/projets/.unlazy/visitlead/SUITE-protocol.md §2,
 * 04.11.2026) : les clients d'InvoiceLead qui ont une adresse e-mail, au niveau de l'entreprise
 * (jeton exchange_read de VisitLead, organisation obligatoire, personne facultative et ignorée),
 * champs minimaux seulement. Archivés exclus. Tri (updated_at, id) croissant, curseur opaque.
 */

export const KNOWN_LIMIT = 500;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type Cursor = { u: string; i: string };
export const encodeCursor = (c: Cursor) => Buffer.from(JSON.stringify(c)).toString("base64url");
/** Curseur lisible, ou null (absent) ; « invalid » s'il est illisible. */
export function decodeCursor(raw: string | null): Cursor | null | "invalid" {
  if (!raw) return null;
  try {
    const c = JSON.parse(Buffer.from(raw, "base64url").toString());
    if (typeof c?.u !== "string" || Number.isNaN(Date.parse(c.u)) || typeof c?.i !== "string")
      return "invalid";
    return { u: new Date(c.u).toISOString(), i: c.i.slice(0, 200) };
  } catch {
    return "invalid";
  }
}

/** 120 lectures par minute et par organisation (mémoire de l'instance). */
const hits = new Map<string, number[]>();
export function knownBudget(org: string, now = Date.now()): boolean {
  const recent = (hits.get(org) ?? []).filter((t) => now - t < 60_000);
  if (recent.length >= 120) {
    hits.set(org, recent);
    return false;
  }
  recent.push(now);
  hits.set(org, recent);
  if (hits.size > 5000) hits.clear();
  return true;
}
export const forgetKnownBudget = () => hits.clear();

export type KnownReply = { status: number; body: Record<string, unknown> };

export async function knownContacts(
  database: Db,
  organizationId: string,
  query: URLSearchParams,
): Promise<KnownReply> {
  if (!knownBudget(organizationId)) return { status: 429, body: { error: "too_many_requests" } };
  const base = sql`organization_id = ${organizationId} and archived_at is null and is_customer
    and email is not null and trim(email) ~ '^[^@[:space:]]+@[^@[:space:]]+\\.[^@[:space:]]+$'`;
  if (query.get("count") === "1") {
    const r = await database.execute(
      sql`select count(distinct lower(trim(email)))::int as n from contacts where ${base}`,
    );
    return { status: 200, body: { count: Number((r.rows[0] as { n: number })?.n ?? 0) } };
  }
  const cursor = decodeCursor(query.get("cursor"));
  if (cursor === "invalid") return { status: 400, body: { error: "invalid_cursor" } };
  if (cursor && !UUID.test(cursor.i)) return { status: 400, body: { error: "invalid_cursor" } };
  const limit = Math.max(1, Math.min(KNOWN_LIMIT, Number(query.get("limit")) || KNOWN_LIMIT));
  const after = cursor
    ? sql`and (date_trunc('milliseconds', updated_at), id) > (${cursor.u}::timestamptz, ${cursor.i}::uuid)`
    : sql``;
  const r = await database.execute(sql`
    select id, kind, lower(trim(email)) as email, name, contact_person,
           date_trunc('milliseconds', updated_at) as updated_at
      from contacts where ${base} ${after}
     order by date_trunc('milliseconds', updated_at), id limit ${limit + 1}`);
  const rows = r.rows as {
    id: string;
    kind: string;
    email: string;
    name: string;
    contact_person: string | null;
    updated_at: Date | string;
  }[];
  const page = rows.slice(0, limit);
  const data = page
    .filter((x) => EMAIL.test(x.email))
    .map((x) => {
      const company = x.kind === "company";
      return {
        id: x.id,
        kind: "client",
        email: x.email,
        name: (company ? x.contact_person : x.name)?.trim() || null,
        company: company ? x.name?.trim() || null : null,
        title: null,
        updated_at: new Date(x.updated_at).toISOString(),
      };
    });
  const last = page[page.length - 1];
  const next =
    rows.length > limit && last
      ? encodeCursor({ u: new Date(last.updated_at).toISOString(), i: last.id })
      : null;
  return { status: 200, body: { data, next } };
}
