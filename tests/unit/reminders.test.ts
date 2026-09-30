import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { attachLeadIdentity } from "@/server/auth/attach";
import { createContact, parseContactForm } from "@/server/contacts";
import { organizations } from "@/server/db/schema";
import { createInvoice, issueInvoice, parseInvoiceForm } from "@/server/invoices";
import { addPayment } from "@/server/payments";
import { dueReminders, listReminders, sendReminder } from "@/server/reminders";
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

describe("relances", () => {
  it("montent de niveau selon le retard, s'arrêtent au paiement et restent propres à l'organisation", async () => {
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
    const c = parseContactForm(
      form({
        kind: "company",
        isCustomer: "on",
        name: "Kunde AG",
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
        issueDate: "2026-03-01",
        "line.description": ["Beratung"],
        "line.quantity": ["1"],
        "line.unit": ["flat"],
        "line.unitPrice": ["500"],
        "line.vatCode": ["normal"],
        "line.productId": [""],
      }),
      { vatRegistered: false },
    );
    if (!r.ok) throw new Error("facture");
    const draft = await createInvoice(db, who, r.data);
    if (typeof draft !== "object" || !draft) throw new Error("brouillon");
    const invoice = await issueInvoice(db, who, draft.id);
    if (typeof invoice !== "object") throw new Error(invoice);
    expect(invoice.dueDate).toBe("2026-03-31");

    expect(await dueReminders(db, who.organizationId, "2026-04-09")).toEqual([]);
    const [first] = await dueReminders(db, who.organizationId, "2026-04-10");
    expect(first).toMatchObject({ level: 1, daysLate: 10, openCents: 50_000, email: null });
    expect(await sendReminder(db, who, invoice.id, "2026-04-10")).toBe("noEmail");
    expect(await sendReminder(db, who, invoice.id, "2026-04-10", true)).toBe("recorded");
    expect(await dueReminders(db, who.organizationId, "2026-04-24")).toEqual([]);
    expect((await dueReminders(db, who.organizationId, "2026-04-25"))[0]?.level).toBe(2);

    const b = await attachLeadIdentity(
      db,
      claims({ sub: "sub-b", email: "b@autre.test", org: "org-b" }),
    );
    const whoB = { organizationId: b.organization.id, userId: b.user.id };
    expect(await sendReminder(db, whoB, invoice.id, "2026-04-25", true)).toBe("notDue");

    await addPayment(db, who, invoice.id, {
      paidOn: "2026-04-20",
      amountCents: 50_000,
      method: "bank",
      note: null,
    });
    expect(await dueReminders(db, who.organizationId, "2026-05-30")).toEqual([]);
    expect(
      (await listReminders(db, who.organizationId, invoice.id)).map((x) => [x.level, x.channel]),
    ).toEqual([[1, "manual"]]);
  });
});
