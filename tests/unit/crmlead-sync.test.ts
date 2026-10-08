import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { attachLeadIdentity } from "@/server/auth/attach";
import { decodeHandoff, encodeHandoff, importHandoff } from "@/server/crmlead";
import { deliverCrmlead } from "@/server/crmlead-sync";
import { crmleadOutbox, organizations } from "@/server/db/schema";
import { convertQuoteToInvoice, issueInvoice, setQuoteOutcome } from "@/server/invoices";
import { addPayment } from "@/server/payments";
import { claims } from "../support/claims";
import { testDb } from "../support/db";
import { setTestEnv } from "../support/env";

// Envoi tout de suite, pas après la réponse : le test voit chaque état dans l'ordre.
vi.mock("next/server", () => ({
  after: () => {
    throw new Error("hors requête");
  },
}));

const t = testDb();
const db = t.database;
beforeAll(() => setTestEnv({ LEAD_ID_ISSUER: "https://erp.test", CRMLEAD_URL: "https://crm.test" }));
beforeEach(() => t.reset());
afterEach(() => vi.unstubAllGlobals());
afterAll(() => t.close());

const LEAD = "4f0c2a9e-1b2c-4d3e-8f90-123456789abc";

/** Faux CRMlead : jeton d'application, carte de visite, boîte de réception qui garde les envois. */
let calls: string[] = [];
function fakeCrmlead(status = 200) {
  const received: Record<string, unknown>[] = [];
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: { body?: unknown }) => {
      calls.push(url);
      if (url.endsWith("/oauth/token"))
        return Response.json({ access_token: "tok", token_type: "Bearer", expires_in: 300 });
      if (url.endsWith("/.well-known/lead-app.json"))
        return Response.json({
          exchange: { inbox: "https://crm.test/api/lead-exchange/v1/inbox" },
        });
      if (url.endsWith("/inbox")) {
        received.push(JSON.parse(String(init?.body)));
        return Response.json({ status: "updated" }, { status });
      }
      return new Response("?", { status: 404 });
    }),
  );
  return received;
}

async function setup() {
  const a = await attachLeadIdentity(db, claims());
  const who = { organizationId: a.organization.id, userId: a.user.id };
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
    .where(eq(organizations.id, a.organization.id));
  const handoff = decodeHandoff(
    encodeHandoff({
      v: 1,
      kind: "quote",
      lead: { id: LEAD, title: "Refonte du site" },
      contact: { id: `lead:${LEAD}`, name: "Boulangerie Rochat SA", language: "fr" },
      lines: [{ description: "Refonte du site", quantity: 1, unitPriceCents: 500000 }],
    }),
  );
  if (!handoff) throw new Error("handoff");
  const quote = await importHandoff(db, who, handoff, {
    language: "fr",
    today: "2026-09-30",
    canCreateContact: true,
  });
  if (quote.status === "contactLimit") throw new Error("limit");
  return { who, quoteId: quote.id };
}

describe("états vers CRMlead", () => {
  it("le devis émis, accepté, facturé, puis la facture payée partent vers le lead", async () => {
    const received = fakeCrmlead();
    const { who, quoteId } = await setup();
    // Brouillon : rien ne part.
    expect(await db.select().from(crmleadOutbox)).toEqual([]);

    await issueInvoice(db, who, quoteId);
    await deliverCrmlead(db);
    expect(received.at(-1)).toMatchObject({
      type: "document",
      org: "org-atelier",
      source: { app: "invoicelead", id: quoteId },
      data: { kind: "quote", status: "issued", net_cents: 500000, lead_id: LEAD },
    });
    expect((received.at(-1) as { source: { url: string } }).source.url).toContain(
      `/fr/app/quotes/${quoteId}`,
    );

    await setQuoteOutcome(db, who, quoteId, "accepted");
    await deliverCrmlead(db);
    expect(received.at(-1)).toMatchObject({ data: { kind: "quote", status: "accepted" } });

    const invoice = await convertQuoteToInvoice(db, who, quoteId, "2026-10-01");
    if (typeof invoice !== "object") throw new Error(invoice);
    await deliverCrmlead(db);
    expect(received.at(-1)).toMatchObject({ data: { kind: "quote", status: "invoiced" } });

    const issued = await issueInvoice(db, who, invoice.id);
    if (typeof issued !== "object") throw new Error(issued);
    await deliverCrmlead(db);
    expect(received.at(-1)).toMatchObject({
      source: { id: invoice.id },
      data: { kind: "invoice", status: "issued", lead_id: LEAD },
    });
    await addPayment(db, who, invoice.id, {
      paidOn: "2026-10-05",
      amountCents: issued.totalCents,
      method: "bank",
      note: null,
    });
    await deliverCrmlead(db);
    expect(received.at(-1)).toMatchObject({ data: { kind: "invoice", status: "paid" } });
    const rows = await db.select().from(crmleadOutbox);
    expect(rows.every((r) => r.status === "delivered")).toBe(true);
    // Le jeton vient de l'émetteur des connexions (ERPlead), les envois vont à CRMlead.
    expect(calls.filter((u) => u.endsWith("/oauth/token")).every((u) => u.startsWith("https://erp.test/"))).toBe(true);
    expect(calls.filter((u) => !u.endsWith("/oauth/token")).every((u) => u.startsWith("https://crm.test/"))).toBe(true);
  });

  it("CRMlead injoignable : l'envoi attend et repart ; lead introuvable : abandon", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("panne", { status: 503 })),
    );
    const { who, quoteId } = await setup();
    await issueInvoice(db, who, quoteId);
    await deliverCrmlead(db);
    const [waiting] = await db.select().from(crmleadOutbox);
    expect(waiting).toMatchObject({ status: "pending", attempts: 1 });

    const received = fakeCrmlead(404);
    await db.update(crmleadOutbox).set({ nextAttemptAt: new Date(0) });
    await deliverCrmlead(db);
    expect(received).toHaveLength(1);
    const [gaveUp] = await db.select().from(crmleadOutbox);
    expect(gaveUp).toMatchObject({ status: "failed", attempts: 2 });
  });
});
