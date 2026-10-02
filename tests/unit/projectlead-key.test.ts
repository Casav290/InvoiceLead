import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { POST as mcpRoute } from "@/app/api/mcp/route";
import { POST as createContactRoute, GET as listContactsRoute } from "@/app/api/v1/contacts/route";
import { POST as issueRoute } from "@/app/api/v1/invoices/[id]/issue/route";
import { POST as payRoute } from "@/app/api/v1/invoices/[id]/payments/route";
import { GET as pdfRoute } from "@/app/api/v1/invoices/[id]/pdf/route";
import { GET as getInvoiceRoute } from "@/app/api/v1/invoices/[id]/route";
import { POST as createInvoiceRoute, GET as listInvoicesRoute } from "@/app/api/v1/invoices/route";
import {
  type ApiEndpoint,
  apiCaller,
  createApiKey,
  createProjectLeadKey,
  listApiKeys,
  PROJECTLEAD_ENDPOINTS,
  revokeApiKey,
  scopeAllows,
} from "@/server/api-keys";
import { attachLeadIdentity } from "@/server/auth/attach";
import { invoices, organizations } from "@/server/db/schema";
import { quotaAccess } from "@/server/plans";
import { claims } from "../support/claims";
import { testDb } from "../support/db";
import { setTestEnv } from "../support/env";

/**
 * La clé « Relier ProjectLead » (toutes les formules) n'ouvre que ce que ProjectLead appelle :
 * lire et créer des contacts, créer des brouillons de factures (ProjectLead,
 * server/lib/invoicelead.ts). Tout le reste est refusé par le serveur, route par route. L'API
 * complète reste en Pro+.
 */
const t = testDb();
const db = t.database;
beforeAll(() => setTestEnv());
beforeEach(() => t.reset());
afterAll(() => t.close());

const ALL: ApiEndpoint[] = [
  "contacts.list",
  "contacts.create",
  "invoices.list",
  "invoices.get",
  "invoices.createDraft",
  "quotes.createDraft",
  "invoices.issue",
  "invoices.pay",
  "invoices.pdf",
  "mcp",
];

/** Entreprise prête à facturer, dans la formule donnée (0 Gratuit, 1 Pro, 2 Pro+). */
async function company(rank: number) {
  const a = await attachLeadIdentity(db, claims());
  await db
    .update(organizations)
    .set({
      hasAccess: true,
      entitlements: { plan: { rank } },
      legalName: "Atelier Muster GmbH",
      street: "Bahnhofstrasse",
      postalCode: "8001",
      town: "Zürich",
      iban: "CH9300762011623852957",
      settingsCompletedAt: new Date(),
    })
    .where(eq(organizations.id, a.organization.id));
  const [org] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.id, a.organization.id));
  if (!org) throw new Error("organisation");
  return { org, who: { organizationId: org.id, userId: a.user.id } };
}

const request = (key: string, method: string, path: string, body?: object) =>
  new Request(`https://invoicelead.io${path}`, {
    method,
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
const params = (id: string) => ({ params: Promise.resolve({ id }) });

/** Ce que ProjectLead envoie pour le brouillon du mois (createDraftInvoice). */
const draftBody = (contactId: string, n = 1) => ({
  contactId,
  language: "fr",
  title: `Projet Site web, septembre ${n}`,
  serviceDate: "2026-09-30",
  currency: "CHF",
  lines: [
    {
      description: "Maquette",
      quantity: "12.50",
      unit: "hour",
      unitPrice: "150.00",
      vatCode: "normal",
    },
  ],
});

describe("portée de la clé ProjectLead", () => {
  it("n'ouvre que la liste et la création des contacts et les brouillons de factures", () => {
    expect([...PROJECTLEAD_ENDPOINTS].sort()).toEqual([
      "contacts.create",
      "contacts.list",
      "invoices.createDraft",
    ]);
    for (const endpoint of ALL) {
      expect(scopeAllows("full", endpoint)).toBe(true);
      expect(scopeAllows("projectlead", endpoint)).toBe(PROJECTLEAD_ENDPOINTS.includes(endpoint));
      // Une portée inconnue (base modifiée à la main) n'ouvre rien.
      expect(scopeAllows("admin", endpoint)).toBe(false);
    }
  });
});

describe("clé ProjectLead", () => {
  it("se crée en formule gratuite, nommée ProjectLead, et se révoque à part des clés d'API", async () => {
    const { org, who } = await company(0);
    const created = await createProjectLeadKey(db, who);
    if (typeof created === "string") throw new Error(created);
    expect(created.key).toMatch(/^il_live_[A-Za-z0-9_-]{40,}$/);
    expect(created.row).toMatchObject({ name: "ProjectLead", scope: "projectlead" });
    expect(created.row.keyHash).not.toContain(created.key.slice(8));
    expect(await listApiKeys(db, org.id, "projectlead")).toHaveLength(1);
    // La page API (clés complètes) ne la montre pas.
    expect(await listApiKeys(db, org.id)).toHaveLength(0);

    // Trois clés ProjectLead actives au plus, sans toucher au plafond des clés d'API.
    await createProjectLeadKey(db, who);
    await createProjectLeadKey(db, who);
    expect(await createProjectLeadKey(db, who)).toBe("tooMany");

    // Révoquée comme clé d'API complète : refusé ; comme clé ProjectLead : faite.
    expect(await revokeApiKey(db, who, created.row.id, "full")).toBe(false);
    expect(await apiCaller(db, `Bearer ${created.key}`, "contacts.list")).toMatchObject({
      scope: "projectlead",
    });
    expect(await revokeApiKey(db, who, created.row.id, "projectlead")).toBe(true);
    expect(await apiCaller(db, `Bearer ${created.key}`, "contacts.list")).toBe("unauthorized");
  });

  it("en formule gratuite : passe sur ses trois points d'accès, refusée partout ailleurs ; une clé complète est refusée", async () => {
    const { who } = await company(0);
    const pl = await createProjectLeadKey(db, who);
    const full = await createApiKey(db, who, "Boutique");
    if (typeof pl === "string" || typeof full === "string") throw new Error("clé");
    for (const endpoint of ALL) {
      const caller = await apiCaller(db, `Bearer ${pl.key}`, endpoint);
      if (PROJECTLEAD_ENDPOINTS.includes(endpoint))
        expect(caller).toMatchObject({ scope: "projectlead", userId: who.userId });
      else expect(caller).toBe("forbidden");
      // L'API complète reste Pro+ : la clé d'une entreprise en formule gratuite ne passe nulle part.
      expect(await apiCaller(db, `Bearer ${full.key}`, endpoint)).toBe("forbidden");
    }
  });

  it("garde les règles des autres clés : accès à InvoiceLead et droit de facturer de la personne", async () => {
    const { org, who } = await company(0);
    const pl = await createProjectLeadKey(db, who);
    if (typeof pl === "string") throw new Error(pl);
    await db.update(organizations).set({ hasAccess: false }).where(eq(organizations.id, org.id));
    expect(await apiCaller(db, `Bearer ${pl.key}`, "contacts.list")).toBe("forbidden");
  });

  it("par les routes : contacts et brouillons passent, lecture, émission, paiement, PDF, devis et MCP sont refusés", async () => {
    const { org, who } = await company(0);
    const pl = await createProjectLeadKey(db, who);
    if (typeof pl === "string") throw new Error(pl);
    const key = pl.key;

    // L'essai de la clé par ProjectLead, puis la recherche et la création d'un client.
    const listed = await listContactsRoute(request(key, "GET", "/api/v1/contacts?q="));
    expect(listed.status).toBe(200);
    const created = await createContactRoute(
      request(key, "POST", "/api/v1/contacts", {
        kind: "company",
        name: "Client Projet SA",
        email: "compta@client-projet.test",
        country: "CH",
        language: "fr",
      }),
    );
    expect(created.status).toBe(201);
    const contactId = ((await created.json()) as { data: { id: string } }).data.id;
    const found = await listContactsRoute(
      request(key, "GET", "/api/v1/contacts?q=Client%20Projet"),
    );
    expect(((await found.json()) as { data: { id: string }[] }).data.map((c) => c.id)).toEqual([
      contactId,
    ]);

    const draft = await createInvoiceRoute(
      request(key, "POST", "/api/v1/invoices", draftBody(contactId)),
    );
    expect(draft.status).toBe(201);
    const invoice = ((await draft.json()) as { data: { id: string; status: string } }).data;
    expect(invoice.status).toBe("draft");

    const forbidden = { error: "forbidden" };
    const quote = await createInvoiceRoute(
      request(key, "POST", "/api/v1/invoices", { ...draftBody(contactId), kind: "quote" }),
    );
    expect(quote.status).toBe(403);
    expect(await quote.json()).toEqual(forbidden);
    const refused = [
      await listInvoicesRoute(request(key, "GET", "/api/v1/invoices")),
      await getInvoiceRoute(
        request(key, "GET", `/api/v1/invoices/${invoice.id}`),
        params(invoice.id),
      ),
      await issueRoute(
        request(key, "POST", `/api/v1/invoices/${invoice.id}/issue`),
        params(invoice.id),
      ),
      await payRoute(
        request(key, "POST", `/api/v1/invoices/${invoice.id}/payments`, { amount: "10.00" }),
        params(invoice.id),
      ),
      await pdfRoute(request(key, "GET", `/api/v1/invoices/${invoice.id}/pdf`), params(invoice.id)),
    ];
    for (const res of refused) {
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual(forbidden);
    }
    const mcp = await mcpRoute(
      request(key, "POST", "/api/mcp", { jsonrpc: "2.0", id: 1, method: "tools/list" }),
    );
    expect(mcp.status).toBe(403);

    // Rien n'a été émis, aucun devis n'a été créé.
    const rows = await db.select().from(invoices).where(eq(invoices.organizationId, org.id));
    expect(rows.map((r) => [r.kind, r.status])).toEqual([["invoice", "draft"]]);
  });

  it("les brouillons ne comptent pas dans les 10 factures gratuites du mois", async () => {
    const { org, who } = await company(0);
    const pl = await createProjectLeadKey(db, who);
    if (typeof pl === "string") throw new Error(pl);
    const created = await createContactRoute(
      request(pl.key, "POST", "/api/v1/contacts", {
        name: "Client SA",
        country: "CH",
        language: "fr",
      }),
    );
    const contactId = ((await created.json()) as { data: { id: string } }).data.id;
    for (let n = 1; n <= 12; n++) {
      const res = await createInvoiceRoute(
        request(pl.key, "POST", "/api/v1/invoices", draftBody(contactId, n)),
      );
      expect(res.status).toBe(201);
    }
    const drafts = await db
      .select()
      .from(invoices)
      .where(and(eq(invoices.organizationId, org.id), eq(invoices.status, "draft")));
    expect(drafts).toHaveLength(12);
    expect(await quotaAccess(db, org, "invoices")).toMatchObject({
      used: 0,
      limit: 10,
      allowed: true,
    });
  });
});
