import { generateKeyPairSync, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import { and, eq, sql } from "drizzle-orm";
import { Client } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as cardRoute } from "@/app/.well-known/lead-app.json/route";
import { POST as inboxRoute } from "@/app/api/lead-exchange/v1/inbox/route";
import { GET as readRoute } from "@/app/api/lead-exchange/v1/read/route";
import { attachLeadIdentity } from "@/server/auth/attach";
import { auditLog, contacts, invoices, memberships, organizations } from "@/server/db/schema";
import { issueInvoice } from "@/server/invoices";
import { checkEnvelope, forgetExchangeToken, send } from "@/server/lead-id/leadId";
import { claims } from "../support/claims";
import { testDb } from "../support/db";
import { setTestEnv } from "../support/env";
import { leadPlan } from "../support/lead-plan";

/**
 * Liaison sans clé (contrat du 26.10.2026, §2 et §3) : boîte de réception 'invoice' de ProjectLead
 * et lecture des clients, avec un faux ERPlead (paire RSA locale, JWKS) qui signe les jetons
 * d'échange liés à l'organisation et à la personne.
 */
const t = testDb();
const db = t.database;
const ERP = "https://erplead.io";
const ORG = "0b9f3c55-6f1e-4e57-9a43-1f2d3c4b5a60";
const OTHER_ORG = "7c1d2e3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f";
const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });

beforeAll(() => setTestEnv({ LEAD_ID_ISSUER: ERP }));
beforeEach(async () => {
  await t.reset();
  await db.delete(contacts);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      url === `${ERP}/oauth/jwks`
        ? Response.json({ keys: [{ ...keys.publicKey.export({ format: "jwk" }), kid: "erp-1" }] })
        : new Response("{}", { status: 404 }),
    ),
  );
});
afterEach(() => vi.unstubAllGlobals());
afterAll(() => t.close());

function jwt(c: Record<string, unknown>, signer = keys.privateKey, iss = ERP) {
  const h = Buffer.from(JSON.stringify({ alg: "RS256", kid: "erp-1" })).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const p = Buffer.from(
    JSON.stringify({ iss, iat: now, exp: now + 900, jti: crypto.randomUUID(), ...c }),
  ).toString("base64url");
  return `${h}.${p}.${sign("sha256", Buffer.from(`${h}.${p}`), signer).toString("base64url")}`;
}

/** Jeton d'échange tel qu'ERPlead l'émet (contrat §1). */
const token = (o: { app?: string; org?: string | null; person?: string; scope?: string } = {}) =>
  jwt({
    sub: `client:${o.app ?? "projectlead"}`,
    aud: ["invoicelead", "lead-id"],
    client_id: o.app ?? "projectlead",
    app: o.app ?? "projectlead",
    scope: o.scope ?? "exchange",
    token_use: "exchange",
    ...(o.org === null ? {} : { org: o.org ?? ORG }),
    ...(o.person ? { person: o.person, person_role: "user" } : {}),
  });
/** Ancien jeton sans organisation (transition). */
const oldToken = (app = "projectlead") =>
  jwt({ sub: `client:${app}`, aud: "invoicelead", app, scope: "exchange" });

const client = (over: Record<string, unknown> = {}) => ({
  source_id: "c-42",
  kind: "company",
  name: "Boulangerie Rochat SA",
  contact_person: "Anne Rochat",
  email: "anne@rochat.test",
  phone: null,
  street: "Rue du Lac",
  building_number: "12",
  postal_code: "1003",
  town: "Lausanne",
  country: "CH",
  language: "fr",
  vat_number: null,
  ...over,
});
const envelope = (over: Record<string, unknown> = {}, data: Record<string, unknown> = {}) => ({
  id: crypto.randomUUID(),
  type: "invoice",
  org: ORG,
  occurred_at: new Date().toISOString(),
  source: { app: "projectlead", id: "run:p-1:2026-10" },
  data: {
    client: client(),
    title: "Site vitrine — octobre 2026",
    intro: "Temps passé en octobre.",
    service_date: "2026-10-31",
    currency: "CHF",
    vat_code: "normal",
    language: "fr",
    lines: [
      { description: "Développement", quantity: 7.5, unit: "hour", unit_price_cents: 12000 },
      { description: "Réunion", quantity: 1, unit: "hour", unit_price_cents: 12000 },
    ],
    ...data,
  },
  ...over,
});

async function post(body: unknown, auth = token()) {
  const r = await inboxRoute(
    new Request("https://invoicelead.io/api/lead-exchange/v1/inbox", {
      method: "POST",
      headers: { authorization: `Bearer ${auth}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
  return { status: r.status, body: (await r.json()) as Record<string, unknown> };
}
async function read(query: string, auth: string) {
  const r = await readRoute(
    new Request(`https://invoicelead.io/api/lead-exchange/v1/read?${query}`, {
      headers: { authorization: `Bearer ${auth}` },
    }),
  );
  return { status: r.status, body: (await r.json()) as Record<string, unknown> };
}

/** L'entreprise : Ada (administratrice), formule `tier` (2 = Pro+, cinq places). */
async function company(tier = 2) {
  const ada = await attachLeadIdentity(
    db,
    claims({ org: ORG, sub: "sub-ada", lead: { ...claims().lead, plan: leadPlan(tier) } }),
  );
  await db
    .update(organizations)
    .set({
      hasAccess: true,
      entitlements: { plan: leadPlan(tier), apps: {} },
      entitlementsAt: new Date(),
    })
    .where(eq(organizations.id, ada.organization.id));
  return { orgId: ada.organization.id, adaId: ada.user.id };
}
/** Une autre personne de l'entreprise, rôle Lead `user`, droits ici `appRole`. */
async function member(sub: string, appRole: string | null, org = ORG) {
  const a = await attachLeadIdentity(
    db,
    claims({
      org,
      sub,
      email: `${sub}@atelier.test`,
      name: `Personne ${sub}`,
      org_role: "user",
      lead: { ...claims().lead, plan: leadPlan(2) },
    }),
  );
  await db
    .update(memberships)
    .set({ appRole })
    .where(
      and(eq(memberships.userId, a.user.id), eq(memberships.organizationId, a.organization.id)),
    );
  return a.user.id;
}
const drafts = (orgId: string) =>
  db.select().from(invoices).where(eq(invoices.organizationId, orgId));
const contactsOf = (orgId: string) =>
  db.select().from(contacts).where(eq(contacts.organizationId, orgId));

describe("carte de visite", () => {
  it("annonce la boîte, la lecture, ce qui est accepté, envoyé et lu", async () => {
    const r = await cardRoute();
    expect(await r.json()).toEqual({
      app: "invoicelead",
      exchange: {
        version: 1,
        inbox: "https://invoicelead.io/api/lead-exchange/v1/inbox",
        accepts: ["invoice"],
        sends: ["document"],
        read: "https://invoicelead.io/api/lead-exchange/v1/read",
        reads: ["contact"],
      },
    });
  });
});

describe("boîte de réception : enveloppe 'invoice' de ProjectLead", () => {
  it("même source.id deux fois : un seul brouillon, remplacé (201 puis 200)", async () => {
    const { orgId, adaId } = await company();
    const first = await post(envelope());
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({ status: "created", total_cents: 102000 });
    const again = await post(
      envelope(
        {},
        {
          lines: [
            { description: "Développement", quantity: 2, unit: "hour", unit_price_cents: 12000 },
          ],
        },
      ),
    );
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ id: first.body.id, status: "updated", total_cents: 24000 });
    const rows = await drafts(orgId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      status: "draft",
      externalRef: "projectlead:run:p-1:2026-10",
      createdBy: adaId,
      serviceDate: "2026-10-31",
      title: "Site vitrine — octobre 2026",
    });
    expect(await contactsOf(orgId)).toHaveLength(1);
  });

  it("déjà émise : 409 already_issued avec l'identifiant", async () => {
    const { orgId, adaId } = await company();
    await db
      .update(organizations)
      .set({
        legalName: "Atelier Muster GmbH",
        street: "Bahnhofstrasse",
        postalCode: "8001",
        town: "Zürich",
        iban: "CH9300762011623852957",
        settingsCompletedAt: new Date(),
      })
      .where(eq(organizations.id, orgId));
    const first = await post(envelope());
    const issued = await issueInvoice(
      db,
      { organizationId: orgId, userId: adaId },
      String(first.body.id),
    );
    expect(typeof issued).toBe("object");
    const again = await post(envelope());
    expect(again).toEqual({ status: 409, body: { error: "already_issued", id: first.body.id } });
  });

  it("indice de contact d'une autre entreprise ignoré ; contact retrouvé par external_ref puis par e-mail", async () => {
    // Autre entreprise, avec son contact.
    const other = await attachLeadIdentity(
      db,
      claims({ org: OTHER_ORG, sub: "sub-zoe", email: "zoe@x.test" }),
    );
    const [foreign] = await db
      .insert(contacts)
      .values({ organizationId: other.organization.id, name: "Boulangerie Rochat SA" })
      .returning();
    const { orgId } = await company();
    const r1 = await post(
      envelope({}, { client: client({ invoicelead_contact_id: foreign?.id }) }),
    );
    expect(r1.status).toBe(201);
    expect(r1.body.contact_id).not.toBe(foreign?.id);
    const [mine] = await contactsOf(orgId);
    expect(mine?.externalRef).toBe("projectlead:c-42");
    // Même client ProjectLead, autre nom et autre e-mail : retrouvé par external_ref.
    const r2 = await post(
      envelope(
        { source: { app: "projectlead", id: "run:p-1:2026-11" } },
        { client: client({ name: "Rochat Boulangerie", email: "autre@rochat.test" }) },
      ),
    );
    expect(r2.body.contact_id).toBe(mine?.id);
    // Autre client ProjectLead, même e-mail : retrouvé par l'e-mail.
    const r3 = await post(
      envelope(
        { source: { app: "projectlead", id: "run:p-2:2026-11" } },
        { client: client({ source_id: "c-99", name: "Rochat & Fils", email: "ANNE@rochat.test" }) },
      ),
    );
    expect(r3.body.contact_id).toBe(mine?.id);
    expect(await contactsOf(orgId)).toHaveLength(1);
    expect((await contactsOf(other.organization.id)).map((c) => c.id)).toEqual([foreign?.id]);
  });

  it("un clic et la tâche mensuelle en même temps : un seul contact", async () => {
    const { orgId } = await company();
    const [a, b] = await Promise.all([
      post(envelope({ source: { app: "projectlead", id: "run:p-1:2026-10" } })),
      post(
        envelope({ source: { app: "projectlead", id: "run:p-1:2026-09" } }),
        token({ person: "sub-ada" }),
      ),
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 201]);
    expect(a.body.contact_id).toBe(b.body.contact_id);
    expect(await contactsOf(orgId)).toHaveLength(1);
    expect(await drafts(orgId)).toHaveLength(2);
  });

  it("au-delà de la limite de contacts de la formule : 409 contact_limit, jamais 402", async () => {
    const { orgId } = await company(0);
    await db
      .insert(contacts)
      .values(
        Array.from({ length: 50 }, (_, i) => ({ organizationId: orgId, name: `Client ${i}` })),
      );
    const r = await post(envelope());
    expect(r).toEqual({
      status: 409,
      body: { error: "contact_limit", limit: 50, count: 50, plan: "free" },
    });
    expect(await drafts(orgId)).toHaveLength(0);
  });

  it("entreprise en formule gratuite : brouillon créé (201)", async () => {
    const { orgId } = await company(0);
    const r = await post(envelope());
    expect(r.status).toBe(201);
    expect(await drafts(orgId)).toHaveLength(1);
  });

  it("refus : org_mismatch 403, expéditeur crmlead 403, jeton sans org 401, org inconnue 404, jeton invalide 401", async () => {
    await company();
    expect(await post(envelope({ org: OTHER_ORG }))).toEqual({
      status: 403,
      body: { error: "org_mismatch" },
    });
    expect(
      await post(envelope({ source: { app: "crmlead", id: "x" } }), token({ app: "crmlead" })),
    ).toEqual({ status: 403, body: { error: "sender_not_allowed" } });
    expect(await post(envelope(), token({ app: "crmlead" }))).toEqual({
      status: 403,
      body: { error: "source_mismatch" },
    });
    expect(await post(envelope(), token({ org: null }))).toEqual({
      status: 401,
      body: { error: "org_required" },
    });
    expect(await post(envelope(), oldToken())).toEqual({
      status: 401,
      body: { error: "org_required" },
    });
    expect(await post(envelope({ type: "deal" }))).toEqual({
      status: 422,
      body: { error: "unsupported_type" },
    });
    expect(await post(envelope({ org: OTHER_ORG }), token({ org: OTHER_ORG }))).toEqual({
      status: 404,
      body: { error: "unknown_org" },
    });
    // Signé par une autre clé, ou par un autre émetteur (ancien crmlead.io), ou portée de lecture.
    const forged = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;
    expect(
      (
        await post(
          envelope(),
          jwt(
            {
              sub: "client:projectlead",
              aud: "invoicelead",
              app: "projectlead",
              scope: "exchange",
              token_use: "exchange",
              org: ORG,
            },
            forged,
          ),
        )
      ).status,
    ).toBe(401);
    expect(
      (
        await post(
          envelope(),
          jwt(
            {
              sub: "client:projectlead",
              aud: "invoicelead",
              app: "projectlead",
              scope: "exchange",
              token_use: "exchange",
              org: ORG,
            },
            keys.privateKey,
            "https://crmlead.io",
          ),
        )
      ).status,
    ).toBe(401);
    expect((await post(envelope(), token({ scope: "exchange_read" }))).status).toBe(401);
    // Enveloppe trop grande.
    expect(
      await post(
        envelope(
          {},
          {
            lines: Array.from({ length: 201 }, () => ({
              description: "x",
              quantity: 1,
              unit: "hour",
              unit_price_cents: 1,
            })),
          },
        ),
      ),
    ).toEqual({ status: 400, body: { error: "invalid_envelope" } });
  });

  it("membre avec le droit de facturer : brouillon créé par lui", async () => {
    const { orgId } = await company();
    const bob = await member("sub-bob", "billing");
    const r = await post(envelope(), token({ person: "sub-bob" }));
    expect(r.status).toBe(201);
    const [row] = await drafts(orgId);
    expect(row?.createdBy).toBe(bob);
    const journal = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, "projectlead.draft_for"));
    expect(journal).toHaveLength(0);
  });

  it("membre sans le droit de facturer : 403 person_not_allowed avec le nom de l'administrateur", async () => {
    const { orgId } = await company();
    await member("sub-carl", "accounting");
    expect(await post(envelope(), token({ person: "sub-carl" }))).toEqual({
      status: 403,
      body: { error: "person_not_allowed", admin: "Ada Muster" },
    });
    expect(await drafts(orgId)).toHaveLength(0);
  });

  it("personne non membre (ou tâche sans personne) : créé par le premier administrateur, et journalisé", async () => {
    const { orgId, adaId } = await company();
    await member("sub-dan", "all", OTHER_ORG); // membre d'une autre entreprise seulement
    const r = await post(envelope(), token({ person: "sub-dan" }));
    expect(r.status).toBe(201);
    const [row] = await drafts(orgId);
    expect(row?.createdBy).toBe(adaId);
    const [entry] = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.action, "projectlead.draft_for"), eq(auditLog.organizationId, orgId)));
    expect(entry).toMatchObject({ userId: adaId, entityId: row?.id, data: { person: "sub-dan" } });
  });
});

describe("lecture des clients pour ProjectLead", () => {
  async function seed() {
    const { orgId } = await company();
    await db.insert(contacts).values([
      { organizationId: orgId, name: "Rochat SA", email: "a@rochat.test" },
      { organizationId: orgId, name: "Fournisseur Rochat", isCustomer: false, isSupplier: true },
    ]);
    return orgId;
  }
  const readToken = (person?: string, org?: string) =>
    token({ scope: "exchange_read", ...(person ? { person } : {}), ...(org ? { org } : {}) });

  it("personne exigée", async () => {
    await seed();
    expect(await read("type=contact&q=rochat", readToken())).toEqual({
      status: 400,
      body: { error: "person_required" },
    });
  });

  it("clients seulement, avec les droits de la personne (forme de /api/v1/contacts)", async () => {
    await seed();
    const r = await read("type=contact&q=rochat", readToken("sub-ada"));
    expect(r.status).toBe(200);
    const data = r.body.data as Record<string, unknown>[];
    expect(data.map((c) => c.name)).toEqual(["Rochat SA"]);
    expect(Object.keys(data[0] ?? {}).sort()).toEqual(
      [
        "id",
        "kind",
        "name",
        "contactPerson",
        "email",
        "phone",
        "street",
        "buildingNumber",
        "postalCode",
        "town",
        "country",
        "language",
        "uid",
        "isCustomer",
      ].sort(),
    );
  });

  it("personne d'une autre entreprise : 403 ; non membre : 403 not_opened ; bloquée : disabled", async () => {
    await seed();
    await member("sub-eve", "all", OTHER_ORG);
    expect(await read("type=contact", readToken("sub-eve"))).toEqual({
      status: 403,
      body: { error: "person_not_member", reason: "not_opened" },
    });
    expect(await read("type=contact", readToken("sub-jamais-venue"))).toEqual({
      status: 403,
      body: { error: "person_not_member", reason: "not_opened" },
    });
    await member("sub-fred", "none");
    expect(await read("type=contact", readToken("sub-fred"))).toEqual({
      status: 403,
      body: { error: "person_not_member", reason: "disabled" },
    });
    // Jeton d'envoi (portée exchange) refusé en lecture, expéditeur autre que ProjectLead refusé.
    expect((await read("type=contact", token({ person: "sub-ada" }))).status).toBe(401);
    expect(
      (
        await read(
          "type=contact",
          token({ app: "crmlead", scope: "exchange_read", person: "sub-ada" }),
        )
      ).body,
    ).toEqual({ error: "sender_not_allowed" });
    expect((await read("type=invoice", readToken("sub-ada"))).status).toBe(422);
  });
});

describe("kit : contrôle d'enveloppe et envoi", () => {
  const tok = { app: "projectlead", org: ORG, person: null, person_role: null };
  it("checkEnvelope rend les refus du contrat", () => {
    const allowed = { invoice: ["projectlead"] };
    const e = envelope();
    expect(checkEnvelope(tok, e, allowed, ["projectlead"])).toBeNull();
    expect(checkEnvelope(tok, { ...e, data: "x" }, allowed, [])).toEqual({
      status: 400,
      error: "invalid_envelope",
    });
    expect(checkEnvelope({ ...tok, org: null }, e, allowed, [])).toBeNull();
    expect(checkEnvelope({ ...tok, org: null }, e, allowed, ["projectlead"])).toEqual({
      status: 401,
      error: "org_required",
    });
  });

  it("send : jeton pour l'org de l'enveloppe, adresse de boîte d'une autre origine refusée, redirect: 'error'", async () => {
    forgetExchangeToken();
    const seen: { url: string; init?: RequestInit }[] = [];
    let inbox = "https://evil.test/api/lead-exchange/v1/inbox";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        seen.push({ url, init });
        if (url === `${ERP}/oauth/token`)
          return Response.json({ access_token: "t", expires_in: 900 });
        if (url.endsWith("/.well-known/lead-app.json"))
          return Response.json({ exchange: { inbox } });
        return Response.json({ status: "created" });
      }),
    );
    const target = { app: "crmlead", url: "https://crm.test" };
    const e = { type: "document", org: ORG, source: { id: "d1" }, data: {} };
    await expect(send(target, e)).rejects.toMatchObject({ body: { error: "lead_app_no_inbox" } });
    expect(seen.some((s) => s.url.startsWith("https://evil.test"))).toBe(false);
    inbox = "https://crm.test/api/lead-exchange/v1/inbox";
    expect(await send(target, e)).toEqual({ status: "created" });
    const tokenCall = seen.find((s) => s.url === `${ERP}/oauth/token`);
    const form = new URLSearchParams(String(tokenCall?.init?.body));
    expect(Object.fromEntries(form)).toMatchObject({
      scope: "exchange",
      audience: "crmlead",
      org: ORG,
    });
    expect(
      seen.filter((s) => s.url !== `${ERP}/oauth/token`).every((s) => s.init?.redirect === "error"),
    ).toBe(true);
  });
});

describe("migration 0047 : index unique des contacts reliés", () => {
  it("s'arrête s'il existe des doublons (organization_id, external_ref), sans rien changer", async () => {
    const { orgId } = await company();
    const sqlText = readFileSync("drizzle/0047_contacts_external_unique.sql", "utf8");
    const pg = new Client({ connectionString: process.env.TEST_DATABASE_URL });
    await pg.connect();
    try {
      await pg.query("begin");
      await pg.query("drop index contacts_org_external_idx");
      await pg.query(
        "insert into contacts (organization_id, name, external_ref) values ($1, 'A', 'projectlead:x'), ($1, 'B', 'projectlead:x')",
        [orgId],
      );
      await expect(pg.query(sqlText.replaceAll("--> statement-breakpoint", ""))).rejects.toThrow(
        /1 groupe\(s\) de contacts en double/,
      );
    } finally {
      await pg.query("rollback").catch(() => undefined);
      await pg.end();
    }
    const [idx] = (
      await db.execute<{ indexdef: string }>(
        sql`select indexdef from pg_indexes where indexname = 'contacts_org_external_idx'`,
      )
    ).rows;
    expect(idx?.indexdef).toContain("UNIQUE");
  });
});
