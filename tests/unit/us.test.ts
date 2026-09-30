import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { countryPack } from "@/countries";
import { formatRate } from "@/countries/ch/vat";
import { salesTaxDueDate } from "@/countries/us/sales-tax-report";
import { isValidEin, isValidZip } from "@/countries/us/tax";
import { addressLines } from "@/lib/address";
import { formatDate } from "@/lib/fiscal-year";
import { createFirstFiscalYear, installChart } from "@/server/accounting";
import { attachLeadIdentity } from "@/server/auth/attach";
import { parseCompanyForm, saveCompanySettings } from "@/server/company";
import { createContact, parseContactForm } from "@/server/contacts";
import { accounts, journalLines } from "@/server/db/schema";
import { createInvoice, getInvoice, issueInvoice, parseInvoiceForm } from "@/server/invoices";
import { postPending } from "@/server/ledger";
import { draftVatReturn, validateVatReturn } from "@/server/vat-return";
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

const COMPANY = {
  country: "US",
  legalName: "Lone Star Design LLC",
  legalForm: "llc",
  street: "Congress Avenue",
  buildingNumber: "500",
  postalCode: "78701",
  town: "Austin",
  region: "tx",
  taxNumber: "12 3456789",
  vatRegistered: "on",
  vatSettlement: "agreed",
  salesTaxRate: "8.875",
  fiscalYearStartMonth: "1",
};

describe("pack États-Unis", () => {
  it("EIN, ZIP, taux à trois décimales, dates et adresses américaines", () => {
    expect(isValidEin("12-3456789")).toBe(true);
    expect(isValidEin("07-3456789")).toBe(false);
    expect(isValidZip("78701")).toBe(true);
    expect(isValidZip("78701-1234")).toBe(true);
    expect(isValidZip("7870")).toBe(false);
    expect(countryPack("US").vatRateBp("normal", "2026-01-01", 887.5)).toBe(887.5);
    expect(countryPack("US").vatRateBp("exempt", "2026-01-01", 887.5)).toBe(0);
    expect(formatRate(887.5, "en")).toMatch(/^8\.875\s%$/u);
    expect(formatDate("2026-09-30", "us")).toBe("09/30/2026");
    expect(salesTaxDueDate("2026-09-30")).toBe("2026-10-20");
    expect(
      addressLines(
        {
          name: "Lone Star Design LLC",
          street: "Congress Avenue",
          buildingNumber: "500",
          postalCode: "78701",
          town: "Austin",
          region: "TX",
          country: "US",
        },
        "CH",
        "en",
      ),
    ).toEqual(["Lone Star Design LLC", "500 Congress Avenue", "Austin, TX 78701", "United States"]);
  });

  it("facture à 8,875 %, sales tax non récupérable, relevé validé sur 2210", async () => {
    const a = await attachLeadIdentity(db, claims());
    const who = { organizationId: a.organization.id, userId: a.user.id };
    const company = parseCompanyForm(form(COMPANY));
    if (!company.ok) throw new Error(JSON.stringify(company.errors));
    expect(company.data).toMatchObject({
      region: "TX",
      taxNumber: "12-3456789",
      salesTaxRateBp: 887.5,
      uid: null,
      iban: null,
    });
    expect(parseCompanyForm(form({ ...COMPANY, iban: "CH9300762011623852957" })).ok).toBe(false);
    expect(await saveCompanySettings(db, who, company.data)).toBe("saved");
    expect(await installChart(db, who, "sole_proprietorship")).toBe("installed");
    await createFirstFiscalYear(db, who, { start: "2026-01-01", extended: false });

    const c = parseContactForm(
      form({
        kind: "company",
        isCustomer: "on",
        name: "Client Inc",
        language: "en",
        country: "US",
        street: "Main Street",
        buildingNumber: "1",
        postalCode: "10001",
        town: "New York",
        region: "NY",
        paymentTermDays: "30",
      }),
    );
    if (!c.ok) throw new Error(JSON.stringify(c.errors));
    const contact = await createContact(db, who, c.data);
    const r = parseInvoiceForm(
      form({
        contactId: contact.id,
        language: "en",
        issueDate: "2026-02-10",
        "line.description": ["Design", "Resale item"],
        "line.quantity": ["1", "1"],
        "line.unit": ["flat", "piece"],
        "line.unitPrice": ["1000", "200"],
        "line.vatCode": ["normal", "exempt"],
        "line.productId": ["", ""],
      }),
      { vatRegistered: true, country: "US" },
    );
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    const draft = await createInvoice(db, who, r.data);
    if (typeof draft !== "object" || !draft) throw new Error("brouillon");
    expect(draft).toMatchObject({
      currency: "USD",
      netCents: 120000,
      vatCents: 8875,
      totalCents: 128875,
    });
    await issueInvoice(db, who, draft.id);
    const issued = await getInvoice(db, a.organization.id, draft.id);
    expect(issued?.invoice.sender).toMatchObject({ region: "TX", taxNumber: "12-3456789" });
    expect(issued?.lines[0]?.vatRateBp).toBe(887.5);
    await postPending(db, who);

    const report = await draftVatReturn(db, a.organization.id, "2026-01-01", "2026-03-31");
    expect(report.anomalies.filter((x) => x.severity === "block")).toEqual([]);
    expect(report.figures).toMatchObject({
      S1: 120000,
      S2: 20000,
      S3: 100000,
      S3t: 8875,
      S4: 8875,
    });
    expect(await validateVatReturn(db, who, "2026-01-01", "2026-03-31")).toBe("validated");
    const chart = await db
      .select()
      .from(accounts)
      .where(eq(accounts.organizationId, a.organization.id));
    const due = chart.find((x) => x.number === "2210");
    const lines = await db
      .select()
      .from(journalLines)
      .where(eq(journalLines.accountId, due?.id ?? ""));
    expect(lines.reduce((s, l) => s + l.creditCents - l.debitCents, 0)).toBe(8875);
  });
});
