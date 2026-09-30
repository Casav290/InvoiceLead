import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { parseCamt } from "@/countries/ch/camt";
import { ca3DueDate } from "@/countries/fr/vat-return";
import { createFirstFiscalYear, installChart, parseAccountForm } from "@/server/accounting";
import { attachLeadIdentity } from "@/server/auth/attach";
import { importEntries, validateTransaction } from "@/server/bank";
import { createContact, parseContactForm } from "@/server/contacts";
import { accounts, bankTransactions, journalLines, organizations } from "@/server/db/schema";
import { createInvoice, issueInvoice, parseInvoiceForm } from "@/server/invoices";
import { postPending, verifyChain } from "@/server/ledger";
import { draftVatReturn, validateVatReturn } from "@/server/vat-return";
import { camt053 } from "../support/camt";
import { claims } from "../support/claims";
import { testDb } from "../support/db";
import { setTestEnv } from "../support/env";

const t = testDb();
const db = t.database;
setTestEnv();
beforeEach(() => t.reset());
afterAll(() => t.close());

function form(values: Record<string, string | string[]>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(values))
    for (const x of Array.isArray(v) ? v : [v]) f.append(k, x);
  return f;
}

const IBAN = "FR7630006000011234567890189";

describe("comptabilité française", () => {
  it("numéros PCG : six chiffres, classe 8 pour les comptes spéciaux", () => {
    const ok = parseAccountForm(
      form({ number: "622600", nameFr: "Honoraires", type: "expense" }),
      "FR",
    );
    expect(ok.ok).toBe(true);
    const ch = parseAccountForm(
      form({ number: "622600", nameFr: "Honoraires", type: "expense" }),
      "CH",
    );
    expect(!ch.ok && ch.errors.number).toBe("number");
    const bad = parseAccountForm(form({ number: "706100", nameFr: "X", type: "expense" }), "FR");
    expect(!bad.ok && bad.errors.type).toBe("typeForClass");
  });

  it("PCG, écritures automatiques, banque et CA3 validée sur 445510", async () => {
    const a = await attachLeadIdentity(db, claims());
    const who = { organizationId: a.organization.id, userId: a.user.id };
    await db
      .update(organizations)
      .set({
        country: "FR",
        currency: "EUR",
        vatRegistered: true,
        vatMethod: "effective",
        vatSettlement: "agreed",
        uid: "FR40303265045",
        taxNumber: "30326504500003",
        legalName: "Atelier Durand SAS",
        legalForm: "sas",
        street: "Rue de Rivoli",
        postalCode: "75001",
        town: "Paris",
        iban: IBAN,
        settingsCompletedAt: new Date(),
      })
      .where(eq(organizations.id, a.organization.id));
    expect(await installChart(db, who, "corporation")).toBe("installed");
    const chart = await db
      .select()
      .from(accounts)
      .where(eq(accounts.organizationId, a.organization.id));
    const byRole = Object.fromEntries(chart.filter((x) => x.role).map((x) => [x.role, x.number]));
    expect(byRole).toMatchObject({
      receivable: "411000",
      bank: "512000",
      vat_output: "445710",
      vat_input_material: "445660",
      vat_input_invest: "445620",
      vat_settlement: "445510",
      revenue_default: "706000",
      equity: "101300",
    });
    await createFirstFiscalYear(db, who, { start: "2026-01-01", extended: false });

    const c = parseContactForm(
      form({
        kind: "company",
        isCustomer: "on",
        name: "Kunde GmbH",
        language: "de",
        country: "DE",
        paymentTermDays: "14",
      }),
    );
    if (!c.ok) throw new Error("contact");
    const contact = await createContact(db, who, c.data);
    const r = parseInvoiceForm(
      form({
        contactId: contact.id,
        language: "fr",
        issueDate: "2026-02-10",
        "line.description": ["Conseil", "Livre", "Prestation UE"],
        "line.quantity": ["1", "1", "1"],
        "line.unit": ["flat", "piece", "flat"],
        "line.unitPrice": ["1000", "100", "500"],
        "line.vatCode": ["normal", "reduced", "export"],
        "line.productId": ["", "", ""],
      }),
      { vatRegistered: true, country: "FR" },
    );
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    const draft = await createInvoice(db, who, r.data);
    if (typeof draft !== "object" || !draft) throw new Error("brouillon");
    expect(draft.totalCents).toBe(100000 + 20000 + 10000 + 550 + 50000);
    await issueInvoice(db, who, draft.id);
    await postPending(db, who);

    await importEntries(
      db,
      who,
      parseCamt(
        camt053(IBAN, [
          {
            id: "A",
            date: "2026-03-05",
            amount: "120.00",
            credit: false,
            party: "Orange",
            text: "Internet",
          },
        ]),
      ).entries,
    );
    const internet = chart.find((x) => x.number === "626000");
    const [tx] = await db.select().from(bankTransactions);
    expect(
      await validateTransaction(db, who, tx?.id ?? "", {
        accountId: internet?.id ?? "",
        vatCode: "normal",
      }),
    ).toBeTruthy();

    const ca3 = await draftVatReturn(db, a.organization.id, "2026-01-01", "2026-03-31");
    expect(ca3.anomalies.filter((x) => x.severity === "block")).toEqual([]);
    expect(ca3.anomalies.map((x) => x.code)).toContain("exportsSplit");
    expect(ca3.figures).toMatchObject({
      A1: 110000,
      E2: 50000,
      "08": 100000,
      "08t": 20000,
      "09": 10000,
      "09t": 550,
      "16": 20550,
      "20": 2000,
      "23": 2000,
      "28": 18550,
    });
    expect(ca3DueDate("2026-03-31")).toBe("2026-04-15");

    expect(await validateVatReturn(db, who, "2026-01-01", "2026-03-31")).toBe("validated");
    const settlement = chart.find((x) => x.number === "445510");
    const lines = await db
      .select()
      .from(journalLines)
      .where(eq(journalLines.accountId, settlement?.id ?? ""));
    expect(lines.reduce((s, l) => s + l.creditCents - l.debitCents, 0)).toBe(18550);
    expect((await verifyChain(db, a.organization.id)).ok).toBe(true);
  });
});
