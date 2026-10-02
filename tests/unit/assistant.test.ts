import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { apiCaller, createApiKey } from "@/server/api-keys";
import { askAssistant, bookFacts } from "@/server/assistant";
import { attachLeadIdentity } from "@/server/auth/attach";
import { createContact, parseContactForm } from "@/server/contacts";
import { organizations } from "@/server/db/schema";
import { createInvoice, issueInvoice, parseInvoiceForm } from "@/server/invoices";
import { handleMcp } from "@/server/mcp";
import { claims } from "../support/claims";
import { testDb } from "../support/db";
import { setTestEnv } from "../support/env";

const t = testDb();
const db = t.database;
beforeAll(() => setTestEnv({ AI_API_KEY: "test", AI_BASE_URL: "https://ai.test/v4" }));
beforeEach(() => t.reset());
afterEach(() => vi.unstubAllGlobals());
afterAll(() => t.close());

function form(values: Record<string, string | string[]>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(values))
    for (const x of Array.isArray(v) ? v : [v]) f.append(k, x);
  return f;
}

async function setup(rank = 2) {
  const a = await attachLeadIdentity(db, claims());
  const who = { organizationId: a.organization.id, userId: a.user.id };
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
  const c = parseContactForm(
    form({ kind: "company", isCustomer: "on", name: "Kunde AG", language: "de", country: "CH" }),
  );
  if (!c.ok) throw new Error("contact");
  const contact = await createContact(db, who, c.data);
  const r = parseInvoiceForm(
    form({
      contactId: contact.id,
      language: "de",
      issueDate: "2026-02-01",
      "line.description": ["Beratung"],
      "line.unit": ["flat"],
      "line.quantity": ["1"],
      "line.unitPrice": ["800"],
      "line.productId": [""],
    }),
    { vatRegistered: false },
  );
  if (!r.ok) throw new Error("facture");
  const draft = await createInvoice(db, who, r.data);
  if (typeof draft !== "object" || !draft) throw new Error("brouillon");
  await issueInvoice(db, who, draft.id);
  return { who, contact, invoiceId: draft.id };
}

describe("assistant", () => {
  it("calcule l'instantané des livres sans IA", async () => {
    const { who } = await setup();
    const facts = await bookFacts(db, who.organizationId, "2026-04-01");
    expect(facts.company).toMatchObject({ name: "Atelier Muster GmbH", currency: "CHF" });
    expect(facts.receivables.openTotal).toBe(800);
    expect(facts.receivables.overdueTotal).toBe(800);
    expect(facts.receivables.openInvoices[0]).toMatchObject({ customer: "Kunde AG", open: 800 });
    expect(facts.revenueByMonth).toEqual([{ month: "2026-02", net: 800 }]);
    expect(facts.topCustomersLast12Months).toEqual([{ customer: "Kunde AG", net: 800 }]);
  });

  it("répond à partir des chiffres seulement et filtre les liens", async () => {
    const { who } = await setup();
    let sent = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: { body: string }) => {
        sent = init.body;
        return Response.json({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  answer: "Kunde AG schuldet CHF 800.00.",
                  links: ["invoices", "drop_table"],
                }),
              },
            },
          ],
        });
      }),
    );
    const result = await askAssistant(db, who, "Wer schuldet mir Geld?", "de", "2026-04-01");
    expect(result).toEqual({ answer: "Kunde AG schuldet CHF 800.00.", links: ["invoices"] });
    const payload = JSON.parse(JSON.parse(sent).messages[1].content);
    expect(payload.question).toBe("Wer schuldet mir Geld?");
    expect(payload.facts.receivables.openTotal).toBe(800);
    expect(await askAssistant(db, who, "   ", "de")).toBe("empty");
  });
});

describe("serveur MCP", () => {
  it("s'initialise, liste ses outils, lit et prépare sans émettre", async () => {
    const { who, contact } = await setup();
    const key = await createApiKey(db, who, "Claude");
    if (typeof key === "string") throw new Error(key);
    const caller = await apiCaller(db, `Bearer ${key.key}`, "mcp");
    if (typeof caller === "string") throw new Error(caller);
    const rpc = (method: string, params?: object, id: number | undefined = 1) =>
      handleMcp(caller, { jsonrpc: "2.0", id, method, params });

    const init = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {} });
    expect(init.body).toMatchObject({
      result: { protocolVersion: "2025-06-18", serverInfo: { name: "invoicelead" } },
    });
    expect(
      (await handleMcp(caller, { jsonrpc: "2.0", method: "notifications/initialized" })).status,
    ).toBe(202);
    const list = (await rpc("tools/list")).body as {
      result: { tools: { name: string; annotations: { readOnlyHint: boolean } }[] };
    };
    const names = list.result.tools.map((x) => x.name);
    expect(names).toContain("get_books_summary");
    expect(
      list.result.tools.find((x) => x.name === "issue_invoice")?.annotations.readOnlyHint,
    ).toBe(false);

    const summary = (await rpc("tools/call", { name: "get_books_summary", arguments: {} }))
      .body as {
      result: { structuredContent: { receivables: { openTotal: number } } };
    };
    expect(summary.result.structuredContent.receivables.openTotal).toBe(800);

    const draft = await rpc("tools/call", {
      name: "create_invoice_draft",
      arguments: {
        contactId: contact.id,
        lines: [{ description: "Workshop", unit: "day", quantity: "2", unitPrice: "900" }],
      },
    });
    expect(draft.wrote).toBe(true);
    expect(draft.body).toMatchObject({
      result: { isError: false, structuredContent: { status: "draft", totalCents: 180_000 } },
    });
    const bad = await rpc("tools/call", {
      name: "create_invoice_draft",
      arguments: { contactId: contact.id, lines: [] },
    });
    expect(bad.body).toMatchObject({ result: { isError: true } });
    expect((await rpc("tools/call", { name: "drop_everything" })).body).toMatchObject({
      error: { code: -32602 },
    });
    expect((await rpc("resources/list")).body).toMatchObject({ error: { code: -32601 } });
  });
});
