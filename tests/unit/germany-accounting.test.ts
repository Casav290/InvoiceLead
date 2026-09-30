import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { parseCamt } from "@/countries/ch/camt";
import { ustvaDueDate } from "@/countries/de/vat-return";
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

const IBAN = "DE89370400440532013000";

describe("comptabilité allemande", () => {
  it("numéros SKR04 : classe 0 admise, types contrôlés par classe", () => {
    const ok = parseAccountForm(form({ number: "0135", nameDe: "Software", type: "asset" }), "DE");
    expect(ok.ok).toBe(true);
    const ch = parseAccountForm(form({ number: "0135", nameDe: "Software", type: "asset" }), "CH");
    expect(!ch.ok && ch.errors.number).toBe("number");
    const bad = parseAccountForm(form({ number: "4400", nameDe: "X", type: "expense" }), "DE");
    expect(!bad.ok && bad.errors.type).toBe("typeForClass");
  });

  it("SKR04, écritures automatiques, banque et UStVA validée sur 3820", async () => {
    const a = await attachLeadIdentity(db, claims());
    const who = { organizationId: a.organization.id, userId: a.user.id };
    await db
      .update(organizations)
      .set({
        country: "DE",
        currency: "EUR",
        vatRegistered: true,
        vatMethod: "effective",
        vatSettlement: "agreed",
        uid: "DE136695976",
        legalName: "Werkstatt Müller GmbH",
        legalForm: "gmbh",
        street: "Friedrichstrasse",
        postalCode: "10117",
        town: "Berlin",
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
      receivable: "1200",
      bank: "1800",
      vat_output: "3800",
      vat_input_material: "1400",
      vat_settlement: "3820",
      revenue_default: "4400",
      equity: "2900",
    });
    expect(byRole.vat_input_invest).toBeUndefined();
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
        language: "de",
        issueDate: "2026-02-10",
        "line.description": ["Beratung", "Buch", "EU-Leistung"],
        "line.quantity": ["1", "1", "1"],
        "line.unit": ["flat", "piece", "flat"],
        "line.unitPrice": ["1000", "100", "500"],
        "line.vatCode": ["normal", "reduced", "export"],
        "line.productId": ["", "", ""],
      }),
      { vatRegistered: true, country: "DE" },
    );
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    const draft = await createInvoice(db, who, r.data);
    if (typeof draft !== "object" || !draft) throw new Error("brouillon");
    expect(draft.totalCents).toBe(100000 + 19000 + 10000 + 700 + 50000);
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
            amount: "119.00",
            credit: false,
            party: "Telekom",
            text: "Internet",
          },
        ]),
      ).entries,
    );
    const internet = chart.find((x) => x.number === "6810");
    const [tx] = await db.select().from(bankTransactions);
    expect(
      await validateTransaction(db, who, tx?.id ?? "", {
        accountId: internet?.id ?? "",
        vatCode: "normal",
      }),
    ).toBeTruthy();

    const ustva = await draftVatReturn(db, a.organization.id, "2026-01-01", "2026-03-31");
    expect(ustva.anomalies.filter((x) => x.severity === "block")).toEqual([]);
    expect(ustva.figures).toMatchObject({
      "81": 100000,
      "81t": 19000,
      "86": 10000,
      "86t": 700,
      "21": 50000,
      "66": 1900,
      "83": 19000 + 700 - 1900,
    });
    expect(ustvaDueDate("2026-03-31")).toBe("2026-04-10");

    expect(await validateVatReturn(db, who, "2026-01-01", "2026-03-31")).toBe("validated");
    const settlement = chart.find((x) => x.number === "3820");
    const lines = await db
      .select()
      .from(journalLines)
      .where(eq(journalLines.accountId, settlement?.id ?? ""));
    expect(lines.reduce((s, l) => s + l.creditCents - l.debitCents, 0)).toBe(17800);
    expect((await verifyChain(db, a.organization.id)).ok).toBe(true);
  });
});
