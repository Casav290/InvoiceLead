import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createFirstFiscalYear, installChart } from "@/server/accounting";
import { attachLeadIdentity } from "@/server/auth/attach";
import { createContact, parseContactForm } from "@/server/contacts";
import { invoices, organizations, recurringInvoices } from "@/server/db/schema";
import { createInvoice, issueInvoice, listInvoices, parseInvoiceForm } from "@/server/invoices";
import { addMonths, createRecurring, runRecurring, setRecurringActive } from "@/server/recurring";
import { claims } from "../support/claims";
import { testDb } from "../support/db";
import { setTestEnv } from "../support/env";

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

describe("factures récurrentes", () => {
  it("avancent d'un nombre de mois en gardant la fin de mois", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2026-11-15", 3)).toBe("2027-02-15");
    expect(addMonths("2024-02-29", 12)).toBe("2025-02-28");
  });

  it("créent la facture échue, l'émettent et l'envoient si demandé, puis avancent l'échéance", async () => {
    const a = await attachLeadIdentity(db, claims());
    const who = { organizationId: a.organization.id, userId: a.user.id };
    await db
      .update(organizations)
      .set({
        legalName: "Atelier Muster",
        street: "Bahnhofstrasse",
        postalCode: "8001",
        town: "Zürich",
        iban: "CH9300762011623852957",
        settingsCompletedAt: new Date(),
      })
      .where(eq(organizations.id, a.organization.id));
    await installChart(db, who, "sole_proprietorship");
    await createFirstFiscalYear(db, who, { start: "2026-01-01", extended: false });
    const c = parseContactForm(
      form({
        kind: "company",
        isCustomer: "on",
        name: "Abo AG",
        language: "de",
        country: "CH",
        paymentTermDays: "30",
      }),
    );
    if (!c.ok) throw new Error("contact");
    const contact = await createContact(db, who, c.data);
    const r = parseInvoiceForm(
      form({
        contactId: contact.id,
        language: "de",
        issueDate: "2026-01-31",
        "line.description": ["Wartung"],
        "line.quantity": ["1"],
        "line.unit": ["month"],
        "line.unitPrice": ["90"],
        "line.vatCode": ["normal"],
        "line.productId": [""],
      }),
      { vatRegistered: false },
    );
    if (!r.ok) throw new Error("facture");
    const model = await createInvoice(db, who, r.data);
    if (typeof model !== "object" || !model) throw new Error("brouillon");
    await issueInvoice(db, who, model.id);

    const monthly = await createRecurring(db, who, model.id, {
      intervalMonths: 1,
      nextDate: "2026-02-28",
      autoSend: true,
    });
    if (typeof monthly !== "object") throw new Error(monthly);
    expect(
      await createRecurring(db, who, model.id, {
        intervalMonths: 2,
        nextDate: "2026-02-28",
        autoSend: false,
      }),
    ).toBe("invalid");

    const send = vi.fn(async () => true);
    expect(await runRecurring(db, "2026-02-27", send)).toEqual({
      created: 0,
      issued: 0,
      sent: 0,
      failed: 0,
    });
    expect(await runRecurring(db, "2026-02-28", send)).toEqual({
      created: 1,
      issued: 1,
      sent: 1,
      failed: 0,
    });
    expect(send).toHaveBeenCalledOnce();
    const [after] = await db.select().from(recurringInvoices);
    expect(after?.nextDate).toBe("2026-03-28");
    const created = await db
      .select()
      .from(invoices)
      .where(eq(invoices.id, after?.lastInvoiceId ?? ""));
    expect(created[0]).toMatchObject({
      status: "issued",
      number: "2026-0002",
      issueDate: "2026-02-28",
      totalCents: 9000,
    });
    expect(created[0]?.journalEntryId).not.toBeNull();

    await setRecurringActive(db, who, monthly.id, false);
    expect((await runRecurring(db, "2026-04-01", send)).created).toBe(0);
    expect(await listInvoices(db, who.organizationId)).toHaveLength(2);
  });
});
