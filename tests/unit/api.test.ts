import { createHmac } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { toForm } from "@/server/api";
import { apiCaller, createApiKey, revokeApiKey } from "@/server/api-keys";
import { attachLeadIdentity } from "@/server/auth/attach";
import { createContact, parseContactForm } from "@/server/contacts";
import { memberships, organizations, webhookDeliveries } from "@/server/db/schema";
import { createInvoice, issueInvoice, parseInvoiceForm } from "@/server/invoices";
import { addPayment } from "@/server/payments";
import {
  checkWebhookUrl,
  createEndpoint,
  deliverPending,
  privateAddress,
  signPayload,
} from "@/server/webhooks";
import { claims } from "../support/claims";
import { testDb } from "../support/db";
import { setTestEnv } from "../support/env";

const t = testDb();
const db = t.database;
beforeAll(() => setTestEnv());
beforeEach(() => t.reset());
afterAll(() => t.close());

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
  return { a, who: { organizationId: a.organization.id, userId: a.user.id } };
}

describe("clés d'API", () => {
  it("authentifient l'entreprise en Pro+, et plus après révocation ou perte des droits", async () => {
    const { a, who } = await company(2);
    const created = await createApiKey(db, who, "Boutique");
    if (typeof created === "string") throw new Error(created);
    expect(created.key).toMatch(/^il_live_[A-Za-z0-9_-]{40,}$/);
    expect(created.row.prefix).toBe(created.key.slice(0, 12));
    expect(created.row.keyHash).not.toContain(created.key.slice(8));

    const caller = await apiCaller(db, `Bearer ${created.key}`);
    if (typeof caller === "string") throw new Error(caller);
    expect(caller.organization.id).toBe(a.organization.id);
    expect(await apiCaller(db, "Bearer il_live_nimportequoi_nimportequoi")).toBe("unauthorized");
    expect(await apiCaller(db, created.key)).toBe("unauthorized");

    // Formule Pro : l'API n'en fait pas partie.
    await db
      .update(organizations)
      .set({ entitlements: { plan: { rank: 1 } } })
      .where(eq(organizations.id, a.organization.id));
    expect(await apiCaller(db, `Bearer ${created.key}`)).toBe("forbidden");
    await db
      .update(organizations)
      .set({ entitlements: { plan: { rank: 2 } } })
      .where(eq(organizations.id, a.organization.id));

    // La personne qui a créé la clé passe en lecture seule : la clé ne facture plus.
    await db
      .update(memberships)
      .set({ role: "user", appRole: "readonly" })
      .where(eq(memberships.userId, a.user.id));
    expect(await apiCaller(db, `Bearer ${created.key}`)).toBe("forbidden");
    await db
      .update(memberships)
      .set({ role: "admin", appRole: null })
      .where(eq(memberships.userId, a.user.id));

    expect(await revokeApiKey(db, who, created.row.id)).toBe(true);
    expect(await apiCaller(db, `Bearer ${created.key}`)).toBe("unauthorized");
    expect(await createApiKey(db, who, " ")).toBe("invalid");
  });

  it("convertit un corps JSON en formulaire, lignes comprises", () => {
    const f = toForm(
      {
        contactId: "c",
        isCustomer: true,
        isSupplier: false,
        lines: [{ description: "Conseil", unitPrice: 150, vatCode: "normal" }],
      },
      ["isCustomer", "isSupplier"],
    );
    expect(f.get("contactId")).toBe("c");
    expect(f.get("isCustomer")).toBe("on");
    expect(f.get("isSupplier")).toBeNull();
    expect(f.getAll("line.description")).toEqual(["Conseil"]);
    expect(f.getAll("line.quantity")).toEqual(["1"]);
    expect(f.getAll("line.unitPrice")).toEqual(["150"]);
  });
});

describe("webhooks", () => {
  it("refusent les adresses privées ou sans https", () => {
    expect(checkWebhookUrl("https://hooks.example.com/in")).not.toBeNull();
    expect(checkWebhookUrl("http://hooks.example.com/in")).toBeNull();
    expect(checkWebhookUrl("https://localhost/in")).toBeNull();
    expect(checkWebhookUrl("https://127.0.0.1/in")).toBeNull();
    expect(checkWebhookUrl("https://10.1.2.3/in")).toBeNull();
    expect(checkWebhookUrl("https://[::1]/in")).toBeNull();
    expect(checkWebhookUrl("https://user:pw@hooks.example.com/in")).toBeNull();
    expect(checkWebhookUrl("pas une adresse")).toBeNull();
    expect(privateAddress("169.254.169.254")).toBe(true);
    expect(privateAddress("172.20.0.1")).toBe(true);
    expect(privateAddress("::ffff:192.168.1.1")).toBe(true);
    expect(privateAddress("8.8.8.8")).toBe(false);
  });

  it("partent signés à l'émission et au paiement, et sont rejoués après un échec", async () => {
    const { a, who } = await company(2);
    const endpoint = await createEndpoint(db, who, {
      url: "https://203.0.113.10/hook",
      events: ["invoice.issued", "invoice.paid", "payment.created", "inconnu"],
    });
    if (typeof endpoint === "string") throw new Error(endpoint);
    expect(endpoint.secret).toMatch(/^whsec_/);
    expect(await createEndpoint(db, who, { url: "https://203.0.113.10/x", events: [] })).toBe(
      "events",
    );

    const c = parseContactForm(
      toForm({ kind: "company", isCustomer: true, name: "Kunde AG", language: "de" }, [
        "isCustomer",
      ]),
    );
    if (!c.ok) throw new Error(JSON.stringify(c.errors));
    const contact = await createContact(db, who, c.data);
    const r = parseInvoiceForm(
      toForm({
        contactId: contact.id,
        language: "de",
        issueDate: "2026-03-02",
        lines: [{ description: "Beratung", unit: "flat", unitPrice: "500" }],
      }),
      { vatRegistered: false },
    );
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    const draft = await createInvoice(db, who, r.data);
    if (typeof draft !== "object" || !draft) throw new Error("brouillon");
    await issueInvoice(db, who, draft.id);
    await addPayment(db, who, draft.id, {
      paidOn: "2026-03-10",
      amountCents: 50_000,
      method: "bank",
      note: null,
    });

    const queued = await db.select().from(webhookDeliveries);
    expect(queued.map((d) => d.event).sort()).toEqual([
      "invoice.issued",
      "invoice.paid",
      "payment.created",
    ]);

    const received: { headers: Headers; body: string }[] = [];
    let fail = true;
    const fetcher = (async (_url: URL, init: RequestInit) => {
      received.push({ headers: new Headers(init.headers), body: String(init.body) });
      return new Response(null, { status: fail ? 500 : 204 });
    }) as unknown as typeof fetch;
    const now = new Date(Date.now() + 1000);
    expect(await deliverPending(db, { now, fetcher })).toEqual({ delivered: 0, failed: 3 });
    // Rien avant le délai d'une minute, puis livraison.
    expect(await deliverPending(db, { now, fetcher })).toEqual({ delivered: 0, failed: 0 });
    fail = false;
    const later = new Date(now.getTime() + 61_000);
    expect(await deliverPending(db, { now: later, fetcher })).toEqual({ delivered: 3, failed: 0 });

    const last = received[received.length - 1];
    if (!last) throw new Error("rien reçu");
    const body = JSON.parse(last.body) as { id: string; type: string; data: unknown };
    expect(body.id).toBeTruthy();
    const ts = Math.floor(later.getTime() / 1000);
    expect(last.headers.get("InvoiceLead-Signature")).toBe(
      signPayload(endpoint.secret, last.body, ts),
    );
    expect(last.headers.get("InvoiceLead-Signature")).toBe(
      `t=${ts},v1=${createHmac("sha256", endpoint.secret).update(`${ts}.${last.body}`).digest("hex")}`,
    );
    const issued = received.map((x) => JSON.parse(x.body)).find((x) => x.type === "invoice.issued");
    expect(issued.data.invoice).toMatchObject({
      id: draft.id,
      totalCents: 50_000,
      currency: "CHF",
    });
    const rows = await db
      .select()
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.organizationId, a.organization.id));
    expect(rows.every((d) => d.status === "delivered" && d.attempts === 2)).toBe(true);
  });
});
