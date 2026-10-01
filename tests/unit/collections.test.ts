import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { attachLeadIdentity } from "@/server/auth/attach";
import {
  classify,
  expectedCollections,
  paymentProfiles,
  reminderSchedule,
} from "@/server/collections";
import { createContact, parseContactForm } from "@/server/contacts";
import { organizations } from "@/server/db/schema";
import { createInvoice, issueInvoice, parseInvoiceForm } from "@/server/invoices";
import { addPayment } from "@/server/payments";
import { dueReminders, sendReminder } from "@/server/reminders";
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

type Who = { organizationId: string; userId: string };

async function setup() {
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
      leadPlan: "pro",
      entitlements: { plan: { rank: 1 } },
    })
    .where(eq(organizations.id, a.organization.id));
  return who;
}

async function customer(who: Who, name: string) {
  const c = parseContactForm(
    form({
      kind: "company",
      isCustomer: "on",
      name,
      language: "de",
      country: "CH",
      paymentTermDays: "30",
    }),
  );
  if (!c.ok) throw new Error("contact");
  return createContact(db, who, c.data);
}

/** Facture de 100.00 émise le jour donné, échéance à 30 jours. */
async function invoice(who: Who, contactId: string, issueDate: string) {
  const r = parseInvoiceForm(
    form({
      contactId,
      language: "de",
      issueDate,
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
  const issued = await issueInvoice(db, who, draft.id);
  if (typeof issued !== "object") throw new Error(issued);
  return issued;
}

async function paidInvoice(who: Who, contactId: string, issueDate: string, paidOn: string) {
  const i = await invoice(who, contactId, issueDate);
  await addPayment(db, who, i.id, { paidOn, amountCents: 10_000, method: "bank", note: null });
  return i;
}

describe("profil de paiement", () => {
  it("classe les clients selon leur historique", () => {
    expect(classify(2, 40, 1)).toBe("unknown");
    expect(classify(3, 20, 0.6)).toBe("late");
    expect(classify(4, 2, 0)).toBe("reliable");
    expect(classify(4, 8, 0.4)).toBe("normal");
    expect(reminderSchedule("reliable")).toEqual([14, 30, 45]);
    expect(reminderSchedule("late")).toEqual([7, 20, 35]);
    expect(reminderSchedule("unknown")).toEqual([10, 25, 40]);
  });

  it("adapte les relances et prévoit les encaissements", async () => {
    const who = await setup();
    const slow = await customer(who, "Lent AG");
    const good = await customer(who, "Sicher AG");
    // Lent AG paie vingt jours après l'échéance (échéances 31.01, 03.03, 31.03).
    await paidInvoice(who, slow.id, "2026-01-01", "2026-02-20");
    await paidInvoice(who, slow.id, "2026-02-01", "2026-03-23");
    await paidInvoice(who, slow.id, "2026-03-01", "2026-04-20");
    // Sicher AG paie à l'échéance.
    await paidInvoice(who, good.id, "2026-01-01", "2026-01-31");
    await paidInvoice(who, good.id, "2026-02-01", "2026-03-03");
    await paidInvoice(who, good.id, "2026-03-01", "2026-03-31");

    const profiles = await paymentProfiles(db, who.organizationId);
    expect(profiles.get(slow.id)).toMatchObject({ paidInvoices: 3, risk: "late", lateShare: 1 });
    expect(profiles.get(slow.id)?.avgDaysLate).toBeCloseTo(20, 0);
    expect(profiles.get(good.id)).toMatchObject({ risk: "reliable", avgDaysLate: 0 });

    // Factures ouvertes, échéance au 31.05.
    const slowOpen = await invoice(who, slow.id, "2026-05-01");
    const goodOpen = await invoice(who, good.id, "2026-05-01");
    expect(slowOpen.dueDate).toBe("2026-05-31");

    // Rappel courtois trois jours avant l'échéance, pour le retardataire seulement.
    expect(await dueReminders(db, who.organizationId, "2026-05-27")).toEqual([]);
    const courtesy = await dueReminders(db, who.organizationId, "2026-05-28");
    expect(courtesy).toHaveLength(1);
    expect(courtesy[0]).toMatchObject({
      invoiceId: slowOpen.id,
      level: 0,
      risk: "late",
      feeCents: 0,
      interestCents: 0,
    });
    expect(await sendReminder(db, who, slowOpen.id, "2026-05-28", true)).toBe("recorded");
    expect(await dueReminders(db, who.organizationId, "2026-05-31")).toEqual([]);

    // Le retardataire est relancé dès sept jours, le bon payeur à quatorze.
    const week = await dueReminders(db, who.organizationId, "2026-06-07");
    expect(week.map((r) => [r.invoiceId, r.level])).toEqual([[slowOpen.id, 1]]);
    const twoWeeks = await dueReminders(db, who.organizationId, "2026-06-14");
    expect(twoWeeks.map((r) => [r.invoiceId, r.level])).toEqual(
      expect.arrayContaining([
        [slowOpen.id, 1],
        [goodOpen.id, 1],
      ]),
    );
    expect(twoWeeks.find((r) => r.invoiceId === goodOpen.id)?.risk).toBe("reliable");

    // Prévision depuis le lundi 18.05 : Sicher AG la semaine du 25.05 (échéance 31.05),
    // Lent AG vingt jours plus tard, le 20.06, dans la semaine du 15.06.
    const forecast = await expectedCollections(db, who.organizationId, "CHF", "2026-05-20");
    const byWeek = Object.fromEntries(
      forecast.weeks.filter((w) => w.expectedCents > 0).map((w) => [w.weekStart, w.expectedCents]),
    );
    expect(byWeek).toEqual({ "2026-05-25": 10_000, "2026-06-15": 10_000 });
    expect(forecast.weeks[0]?.weekStart).toBe("2026-05-18");
    expect(forecast.laterCents).toBe(0);
    // Ce qui est déjà en retard tombe dans la semaine en cours ; au-delà de huit semaines, plus tard.
    const late = await expectedCollections(db, who.organizationId, "CHF", "2026-07-01", 1);
    expect(late.weeks[0]).toMatchObject({ weekStart: "2026-06-29", expectedCents: 20_000 });
    const short = await expectedCollections(db, who.organizationId, "CHF", "2026-05-20", 2);
    expect(short.laterCents).toBe(10_000);
  });
});
