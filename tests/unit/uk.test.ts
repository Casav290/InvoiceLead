import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { countryPack } from "@/countries";
import { parseCamt } from "@/countries/ch/camt";
import {
  isValidCompanyNumber,
  isValidGbVatNumber,
  isValidUkPostcode,
  vatRateBpGb,
} from "@/countries/gb/vat";
import { mtdDueDate } from "@/countries/gb/vat-return";
import { formatDate } from "@/lib/fiscal-year";
import { formatAmount } from "@/lib/money";
import { vatNumberLabel } from "@/lib/swiss-ids";
import { createFirstFiscalYear, installChart } from "@/server/accounting";
import { attachLeadIdentity } from "@/server/auth/attach";
import { importEntries, validateTransaction } from "@/server/bank";
import { parseCompanyForm, saveCompanySettings } from "@/server/company";
import { createContact, parseContactForm } from "@/server/contacts";
import { accounts, bankTransactions } from "@/server/db/schema";
import { createInvoice, issueInvoice, parseInvoiceForm } from "@/server/invoices";
import { postPending } from "@/server/ledger";
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

const COMPANY = {
  country: "GB",
  legalName: "Harper Studio Ltd",
  legalForm: "ltd",
  street: "Baker Street",
  buildingNumber: "221B",
  postalCode: "NW1 6XE",
  town: "London",
  uid: "GB 980 7806 84",
  taxNumber: "01234567",
  vatRegistered: "on",
  vatSettlement: "agreed",
  iban: "GB82 WEST 1234 5698 7654 32",
  fiscalYearStartMonth: "4",
};

describe("pack Royaume-Uni", () => {
  it("taux, numéro de TVA, Companies House, code postal, formats", () => {
    expect(vatRateBpGb("normal", "2026-03-01")).toBe(2000);
    expect(vatRateBpGb("reduced", "2026-03-01")).toBe(500);
    expect(vatRateBpGb("lodging", "2026-03-01")).toBe(2000);
    expect(isValidGbVatNumber("GB980780684")).toBe(true);
    expect(isValidGbVatNumber("GB980780685")).toBe(false);
    expect(isValidCompanyNumber("SC123456")).toBe(true);
    expect(isValidCompanyNumber("1234")).toBe(false);
    expect(isValidUkPostcode("SW1A 1AA")).toBe(true);
    expect(isValidUkPostcode("12345")).toBe(false);
    expect(formatAmount(123_456_78, "en")).toBe("123,456.78");
    expect(formatDate("2026-09-30", "slash")).toBe("30/09/2026");
    expect(vatNumberLabel("GB980780684", "en")).toBe("VAT No. GB980780684");
    expect(countryPack("GB")).toMatchObject({ currency: "GBP", paymentSlip: "none" });
    expect(mtdDueDate("2026-06-30")).toBe("2026-08-07");
  });

  it("réglages, facture en livres, nominal ledger et déclaration MTD validée sur 2202", async () => {
    const a = await attachLeadIdentity(db, claims());
    const who = { organizationId: a.organization.id, userId: a.user.id };
    const company = parseCompanyForm(form(COMPANY));
    if (!company.ok) throw new Error(JSON.stringify(company.errors));
    expect(company.data).toMatchObject({ uid: "GB980780684", taxNumber: "01234567" });
    expect(await saveCompanySettings(db, who, company.data)).toBe("saved");
    expect(await installChart(db, who, "corporation")).toBe("installed");
    await createFirstFiscalYear(db, who, { start: "2026-01-01", extended: false });

    const c = parseContactForm(
      form({
        kind: "company",
        isCustomer: "on",
        name: "Client Ltd",
        language: "en",
        country: "CH",
        paymentTermDays: "30",
      }),
    );
    if (!c.ok) throw new Error("contact");
    const contact = await createContact(db, who, c.data);
    const r = parseInvoiceForm(
      form({
        contactId: contact.id,
        language: "en",
        issueDate: "2026-02-10",
        "line.description": ["Design", "Children's book"],
        "line.quantity": ["1", "1"],
        "line.unit": ["flat", "piece"],
        "line.unitPrice": ["1000", "100"],
        "line.vatCode": ["normal", "exempt"],
        "line.productId": ["", ""],
      }),
      { vatRegistered: true, country: "GB" },
    );
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    const draft = await createInvoice(db, who, r.data);
    if (typeof draft !== "object" || !draft) throw new Error("brouillon");
    expect(draft).toMatchObject({ currency: "GBP", vatCents: 20000, totalCents: 130000 });
    await issueInvoice(db, who, draft.id);
    await postPending(db, who);

    await importEntries(
      db,
      who,
      parseCamt(
        camt053("GB82WEST12345698765432", [
          {
            id: "A",
            date: "2026-03-05",
            amount: "60.00",
            credit: false,
            party: "BT",
            text: "Broadband",
          },
        ]),
      ).entries,
    );
    const chart = await db
      .select()
      .from(accounts)
      .where(eq(accounts.organizationId, a.organization.id));
    const phone = chart.find((x) => x.number === "7502");
    const [tx] = await db.select().from(bankTransactions);
    await validateTransaction(db, who, tx?.id ?? "", {
      accountId: phone?.id ?? "",
      vatCode: "normal",
    });

    const mtd = await draftVatReturn(db, a.organization.id, "2026-01-01", "2026-03-31");
    expect(mtd.anomalies.filter((x) => x.severity === "block")).toEqual([]);
    expect(mtd.figures).toMatchObject({
      "1": 20000,
      "3": 20000,
      "4": 1000,
      "5": 19000,
      "6": 110000,
      "7": 5000,
    });
    expect(await validateVatReturn(db, who, "2026-01-01", "2026-03-31")).toBe("validated");
  });
});
