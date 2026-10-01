import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { attachLeadIdentity } from "@/server/auth/attach";
import { createContact, parseContactForm } from "@/server/contacts";
import { dashboardFigures, lastTwelveMonths } from "@/server/dashboard";
import { organizations } from "@/server/db/schema";
import {
  createCreditNote,
  createInvoice,
  issueInvoice,
  parseInvoiceForm,
  setQuoteOutcome,
} from "@/server/invoices";
import { addPayment } from "@/server/payments";
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

/** Pièce de 100.00 HT émise le jour donné (facture à 30 jours, ou devis). */
async function invoice(
  who: Who,
  contactId: string,
  issueDate: string,
  kind: "invoice" | "quote" = "invoice",
) {
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
  const draft = await createInvoice(db, who, r.data, kind);
  if (typeof draft !== "object" || !draft) throw new Error("brouillon");
  const issued = await issueInvoice(db, who, draft.id);
  if (typeof issued !== "object") throw new Error(issued);
  return issued;
}

describe("tableau de bord", () => {
  it("compte les douze derniers mois", () => {
    const m = lastTwelveMonths("2026-03-15");
    expect(m).toHaveLength(12);
    expect(m[0]).toBe("2025-04");
    expect(m[11]).toBe("2026-03");
  });

  it("rend le chiffre d'affaires, l'encours, les retards et les devis", async () => {
    const who = await setup();
    const c = await customer(who, "Kunde AG");
    const today = "2026-06-15";
    // Mai : deux factures, l'une payée en juin ; un avoir sur l'autre en juin.
    const paid = await invoice(who, c.id, "2026-05-02");
    const credited = await invoice(who, c.id, "2026-05-03");
    await addPayment(db, who, paid.id, {
      paidOn: "2026-06-02",
      amountCents: 10_000,
      method: "bank",
      note: null,
    });
    // Juin : une facture ouverte pas encore échue.
    await invoice(who, c.id, "2026-06-10");
    // Avril : une facture en retard (échéance 01.05).
    const late = await invoice(who, c.id, "2026-04-01");
    const note = await createCreditNote(db, who, credited.id, "2026-06-05");
    if (typeof note !== "object") throw new Error("avoir");
    await issueInvoice(db, who, note.id);

    // Devis : un en cours, un accepté, un refusé.
    await invoice(who, c.id, "2026-06-01", "quote");
    const yes = await invoice(who, c.id, "2026-05-20", "quote");
    const no = await invoice(who, c.id, "2026-05-21", "quote");
    await setQuoteOutcome(db, who, yes.id, "accepted");
    await setQuoteOutcome(db, who, no.id, "declined");

    const f = await dashboardFigures(db, who.organizationId, today);
    expect(f.currency).toBe("CHF");
    expect(f.months.find((m) => m.month === "2026-05")?.netCents).toBe(20_000);
    expect(f.months.find((m) => m.month === "2026-04")?.netCents).toBe(10_000);
    // Juin : une facture de 100, moins l'avoir de 100.
    expect(f.revenueMonthCents).toBe(0);
    expect(f.revenuePrevMonthCents).toBe(20_000);
    expect(f.revenueYearCents).toBe(30_000);
    expect(f.invoicesMonth).toBe(1);
    expect(f.collectedMonthCents).toBe(10_000);
    // Ouvertes : juin et avril ; celle d'avril est en retard.
    expect(f.open).toEqual({ count: 2, cents: 20_000 });
    expect(f.overdue).toEqual({ count: 1, cents: 10_000 });
    expect(f.overdueList[0]).toMatchObject({ id: late.id, daysLate: 45, openCents: 10_000 });
    expect(f.quotesOpen).toEqual({ count: 1, cents: 10_000 });
    expect(f.quotesAccepted).toEqual({ count: 1, cents: 10_000 });
    expect(f.acceptanceRate).toBe(0.5);
    expect(f.quotesList).toHaveLength(1);
    expect(f.billsToPay.count).toBe(0);
  });

  it("reste à zéro pour une entreprise neuve", async () => {
    const who = await setup();
    const f = await dashboardFigures(db, who.organizationId, "2026-06-15");
    expect(f.revenueYearCents).toBe(0);
    expect(f.open.count).toBe(0);
    expect(f.acceptanceRate).toBeNull();
    expect(f.months).toHaveLength(12);
  });
});
