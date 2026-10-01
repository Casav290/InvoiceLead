import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as createContactRoute } from "@/app/api/v1/contacts/route";
import { POST as issueRoute } from "@/app/api/v1/invoices/[id]/issue/route";
import type { ApiCaller } from "@/server/api-keys";
import { attachLeadIdentity } from "@/server/auth/attach";
import { createContact, parseContactForm } from "@/server/contacts";
import { contacts, organizations } from "@/server/db/schema";
import { createInvoice, issueInvoice, parseInvoiceForm } from "@/server/invoices";
import { claims } from "../support/claims";
import { testDb } from "../support/db";
import { setTestEnv } from "../support/env";

/**
 * L'API est réservée à Pro+, dont les allocations sont sans limite : « plan_limit » ne se voit que
 * si la formule change entre le contrôle de la clé et l'action. L'appelant est donc fabriqué ici
 * (entreprise en formule gratuite), pour vérifier que les routes passent par les mêmes contrôles
 * que l'écran.
 */
const caller = vi.hoisted(() => ({ current: null as ApiCaller | null }));
vi.mock("@/server/api-keys", async (original) => ({
  ...(await original<typeof import("@/server/api-keys")>()),
  apiCaller: async () => caller.current ?? "unauthorized",
}));

const t = testDb();
const db = t.database;
beforeAll(() => setTestEnv());
beforeEach(() => t.reset());
afterAll(() => t.close());

function form(values: Record<string, string | string[]>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(values))
    for (const x of Array.isArray(v) ? v : [v]) f.append(k, x);
  return f;
}

async function freeCompany() {
  const a = await attachLeadIdentity(db, claims());
  await db
    .update(organizations)
    .set({
      entitlements: { plan: { rank: 0 } },
      legalName: "Atelier Muster GmbH",
      street: "Bahnhofstrasse",
      postalCode: "8001",
      town: "Zürich",
      iban: "CH9300762011623852957",
      settingsCompletedAt: new Date(),
    })
    .where(eq(organizations.id, a.organization.id));
  const [row] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.id, a.organization.id));
  if (!row) throw new Error("organisation");
  caller.current = { organization: row, userId: a.user.id, keyId: "k" };
  return { organizationId: row.id, userId: a.user.id };
}

function contactData(name: string) {
  const parsed = parseContactForm(
    form({ kind: "company", isCustomer: "on", name, language: "de", country: "CH" }),
  );
  if (!parsed.ok) throw new Error("contact");
  return parsed.data;
}

async function draftFor(who: { organizationId: string; userId: string }, contactId: string) {
  const r = parseInvoiceForm(
    form({
      contactId,
      language: "de",
      issueDate: "2026-03-01",
      "line.description": ["Beratung"],
      "line.quantity": ["1"],
      "line.unit": ["flat"],
      "line.unitPrice": ["100"],
      "line.vatCode": ["normal"],
      "line.productId": [""],
    }),
    { vatRegistered: false },
  );
  if (!r.ok) throw new Error("facture");
  const draft = await createInvoice(db, who, r.data);
  if (typeof draft !== "object" || !draft) throw new Error("brouillon");
  return draft;
}

const post = (url: string, body?: object) =>
  new Request(`https://invoicelead.io${url}`, {
    method: "POST",
    headers: { authorization: "Bearer il_live_test", "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });

describe("API au-delà des allocations", () => {
  it("POST /api/v1/contacts : 403 plan_limit au-delà de 50 contacts", async () => {
    const who = await freeCompany();
    for (let i = 0; i < 49; i++) await createContact(db, who, contactData(`C${i}`));
    const ok = await createContactRoute(
      post("/api/v1/contacts", { name: "Le 50e", language: "de", country: "CH" }),
    );
    expect(ok.status).toBe(201);
    const refused = await createContactRoute(
      post("/api/v1/contacts", { name: "Le 51e", language: "de", country: "CH" }),
    );
    expect(refused.status).toBe(403);
    expect(await refused.json()).toEqual({ error: "plan_limit" });
    const rows = await db
      .select()
      .from(contacts)
      .where(eq(contacts.organizationId, who.organizationId));
    expect(rows).toHaveLength(50);
  });

  it("POST /api/v1/invoices/{id}/issue : 403 plan_limit pour la 11e facture du mois", async () => {
    const who = await freeCompany();
    const contact = await createContact(db, who, contactData("Kunde AG"));
    for (let i = 0; i < 10; i++) {
      const r = await issueInvoice(db, who, (await draftFor(who, contact.id)).id);
      if (typeof r !== "object") throw new Error(r);
    }
    const draft = await draftFor(who, contact.id);
    const res = await issueRoute(post(`/api/v1/invoices/${draft.id}/issue`), {
      params: Promise.resolve({ id: draft.id }),
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "plan_limit" });
  });
});
