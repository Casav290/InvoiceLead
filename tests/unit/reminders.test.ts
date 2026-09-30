import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createFirstFiscalYear, installChart } from "@/server/accounting";
import { attachLeadIdentity } from "@/server/auth/attach";
import { createContact, parseContactForm } from "@/server/contacts";
import {
  accounts,
  invoiceReminders,
  journalEntries,
  journalLines,
  organizations,
} from "@/server/db/schema";
import { createInvoice, issueInvoice, parseInvoiceForm } from "@/server/invoices";
import { postPending } from "@/server/ledger";
import { addPayment, invoiceBalance } from "@/server/payments";
import {
  dueReminders,
  lateInterest,
  listReminders,
  runAutoReminders,
  sendReminder,
  waiveCharges,
} from "@/server/reminders";
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
    // Formule gratuite : la première relance seulement.
    expect(await dueReminders(db, who.organizationId, "2026-04-25")).toEqual([]);
    await db
      .update(organizations)
      .set({ leadPlan: "pro", entitlements: { plan: { rank: 1 } } })
      .where(eq(organizations.id, a.organization.id));
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

  it("calcule l'intérêt moratoire simple sur 365 jours", () => {
    expect(lateInterest(100_000, 500, 365)).toBe(5_000);
    expect(lateInterest(50_000, 500, 25)).toBe(171);
    expect(lateInterest(50_000, null, 25)).toBe(0);
    expect(lateInterest(0, 500, 25)).toBe(0);
  });

  it("ajoute frais et intérêts, les comptabilise hors chiffre d'affaires, et y renonce par extourne", async () => {
    const a = await attachLeadIdentity(db, claims());
    const who = { organizationId: a.organization.id, userId: a.user.id };
    await db
      .update(organizations)
      .set({
        leadPlan: "pro",
        entitlements: { plan: { rank: 1 } },
        legalName: "Atelier Muster",
        street: "Bahnhofstrasse",
        postalCode: "8001",
        town: "Zürich",
        iban: "CH9300762011623852957",
        settingsCompletedAt: new Date(),
        reminderFeeCents: 2_000,
        lateInterestBp: 500,
      })
      .where(eq(organizations.id, a.organization.id));
    await installChart(db, who, "corporation");
    // Plan installé avant les frais de rappel : le rôle est posé au premier besoin.
    await db
      .update(accounts)
      .set({ role: null })
      .where(
        and(eq(accounts.organizationId, who.organizationId), eq(accounts.role, "late_charges")),
      );
    await createFirstFiscalYear(db, who, { start: "2026-01-01", extended: false });
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
        "line.productId": [""],
      }),
      { vatRegistered: false },
    );
    if (!r.ok) throw new Error("facture");
    const draft = await createInvoice(db, who, r.data);
    if (typeof draft !== "object" || !draft) throw new Error("brouillon");
    await issueInvoice(db, who, draft.id);
    await postPending(db, who);

    // Première relance : pas de frais, intérêts à 5 % sur 10 jours.
    const [first] = await dueReminders(db, who.organizationId, "2026-04-10");
    expect(first).toMatchObject({
      level: 1,
      feeCents: 0,
      interestCents: 68,
      totalDueCents: 50_068,
    });
    await sendReminder(db, who, draft.id, "2026-04-10", true);
    // Deuxième : frais de 20.–, intérêts courus depuis (25 jours au total).
    const [second] = await dueReminders(db, who.organizationId, "2026-04-25");
    expect(second).toMatchObject({
      level: 2,
      openCents: 50_000,
      feeCents: 2_000,
      interestCents: 171 - 68,
      totalDueCents: 50_000 + 68 + 2_000 + 103,
    });
    await sendReminder(db, who, draft.id, "2026-04-25", true);

    const balance = await invoiceBalance(db, draft.id, 50_000);
    expect(balance.chargesCents).toBe(2_171);
    expect(balance.openCents).toBe(52_171);

    const [late] = await db
      .select()
      .from(accounts)
      .where(
        and(eq(accounts.organizationId, who.organizationId), eq(accounts.role, "late_charges")),
      );
    expect(late?.number).toBe("6950");
    const posted = await db
      .select({ debit: journalLines.debitCents, credit: journalLines.creditCents })
      .from(journalLines)
      .innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
      .where(eq(journalLines.accountId, late?.id ?? ""));
    expect(posted.reduce((s, l) => s + l.credit - l.debit, 0)).toBe(2_171);

    // Le client paie la facture seule : on renonce au reste, les écritures sont extournées.
    await addPayment(db, who, draft.id, {
      paidOn: "2026-04-28",
      amountCents: 50_000,
      method: "bank",
      note: null,
    });
    expect((await invoiceBalance(db, draft.id, 50_000)).openCents).toBe(2_171);
    expect(await waiveCharges(db, who, draft.id, "2026-04-29")).toBe(2_171);
    expect((await invoiceBalance(db, draft.id, 50_000)).openCents).toBe(0);
    const after = await db
      .select({ debit: journalLines.debitCents, credit: journalLines.creditCents })
      .from(journalLines)
      .where(eq(journalLines.accountId, late?.id ?? ""));
    expect(after.reduce((s, l) => s + l.credit - l.debit, 0)).toBe(0);
    const reminders = await db
      .select()
      .from(invoiceReminders)
      .where(eq(invoiceReminders.invoiceId, draft.id));
    expect(reminders.every((x) => x.waivedAt)).toBe(true);
  });

  it("n'envoie automatiquement que pour les entreprises Pro qui l'ont activé", async () => {
    const a = await attachLeadIdentity(db, claims());
    await db
      .update(organizations)
      .set({ reminderAuto: true })
      .where(eq(organizations.id, a.organization.id));
    // Formule gratuite : rien ne part, même activé.
    expect(await runAutoReminders(db, "2026-04-10")).toEqual({ sent: 0 });
  });
});
