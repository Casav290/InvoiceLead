import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createFirstFiscalYear, installChart, listFiscalYears } from "@/server/accounting";
import { attachLeadIdentity } from "@/server/auth/attach";
import { closeFiscalYear, closingChecks } from "@/server/closing";
import { createContact, parseContactForm } from "@/server/contacts";
import { organizations } from "@/server/db/schema";
import { createInvoice, issueInvoice, parseInvoiceForm } from "@/server/invoices";
import { postPending, verifyChain } from "@/server/ledger";
import { addPayment } from "@/server/payments";
import { accountBalances, balanceSheet, incomeStatement } from "@/server/reports";
import { claims } from "../support/claims";
import { testDb } from "../support/db";

const t = testDb();
const db = t.database;
beforeEach(() => t.reset());
afterAll(() => t.close());

function form(values: Record<string, string | string[]>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(values))
    for (const x of Array.isArray(v) ? v : [v]) f.append(k, x);
  return f;
}

describe("clôture de l'exercice", () => {
  it("vire le résultat au capital, ouvre l'exercice suivant avec les soldes et ferme l'exercice", async () => {
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
    await installChart(db, who, "corporation");
    await createFirstFiscalYear(db, who, { start: "2025-01-01", extended: false });
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
    const invoiceOn = async (date: string) => {
      const r = parseInvoiceForm(
        form({
          contactId: contact.id,
          language: "de",
          issueDate: date,
          "line.description": ["Beratung"],
          "line.quantity": ["1"],
          "line.unit": ["flat"],
          "line.unitPrice": ["1000"],
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
    };
    const invoice = await invoiceOn("2025-06-10");
    await addPayment(db, who, invoice.id, {
      paidOn: "2025-07-01",
      amountCents: 40_000,
      method: "bank",
      note: null,
    });
    await postPending(db, who);

    const [y2025] = await listFiscalYears(db, who.organizationId);
    expect(await closingChecks(db, who.organizationId, y2025?.id ?? "")).toEqual([]);
    const closed = await closeFiscalYear(db, who, y2025?.id ?? "");
    expect(closed).toMatchObject({ ok: true, resultCents: 100_000 });

    const years = await listFiscalYears(db, who.organizationId);
    expect(years.map((y) => [y.startDate, y.status])).toEqual([
      ["2026-01-01", "open"],
      ["2025-01-01", "closed"],
    ]);

    // Les rapports de 2025 restent lisibles et équilibrés malgré l'écriture de clôture.
    const b2025 = await accountBalances(db, who.organizationId, y2025?.id ?? "");
    const r2025 = incomeStatement(b2025);
    expect(r2025.resultCents).toBe(100_000);
    expect(balanceSheet(b2025, r2025.resultCents).balanced).toBe(true);

    // 2026 s'ouvre avec banque 400.00, débiteurs 600.00 et le bénéfice 1'000.00 au capital.
    const b2026 = await accountBalances(db, who.organizationId, years[0]?.id ?? "");
    const byNumber = Object.fromEntries(b2026.map((b) => [b.account.number, b.balanceCents]));
    expect(byNumber).toEqual({ "1020": 40_000, "1100": 60_000, "2979": 100_000 });
    const r2026 = incomeStatement(b2026);
    expect(r2026.resultCents).toBe(0);
    expect(balanceSheet(b2026, 0)).toMatchObject({ assetsCents: 100_000, balanced: true });

    // Plus rien ne se comptabilise dans l'exercice clos.
    await invoiceOn("2025-12-20");
    expect(await postPending(db, who)).toMatchObject({
      posted: 0,
      waiting: 1,
      reason: "noFiscalYear",
    });
    expect(await closeFiscalYear(db, who, y2025?.id ?? "")).toEqual({
      ok: false,
      reason: "alreadyClosed",
    });
    expect(await verifyChain(db, who.organizationId)).toMatchObject({ ok: true, count: 4 });
  });
});
