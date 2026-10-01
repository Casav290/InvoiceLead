import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { buildFec, datevRows } from "@/lib/ledger-export";
import { createFirstFiscalYear, installChart, listFiscalYears } from "@/server/accounting";
import { attachLeadIdentity } from "@/server/auth/attach";
import { parseCompanyForm, saveCompanySettings } from "@/server/company";
import { createContact, parseContactForm } from "@/server/contacts";
import { createInvoice, issueInvoice, parseInvoiceForm } from "@/server/invoices";
import { postPending } from "@/server/ledger";
import { exportEntries } from "@/server/ledger-export";
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

describe("export DATEV depuis le journal", () => {
  it("passe 19 % sur 4400 et 7 % sur 4300, comptes automatiques sans clé", async () => {
    const a = await attachLeadIdentity(db, claims());
    const who = { organizationId: a.organization.id, userId: a.user.id };
    const company = parseCompanyForm(
      form({
        country: "DE",
        legalName: "Werkstatt Müller GmbH",
        legalForm: "gmbh",
        street: "Friedrichstrasse",
        buildingNumber: "10",
        postalCode: "10117",
        town: "Berlin",
        uid: "DE 136 695 976",
        vatRegistered: "on",
        vatSettlement: "agreed",
        iban: "DE89 3704 0044 0532 0130 00",
        fiscalYearStartMonth: "1",
      }),
    );
    if (!company.ok) throw new Error(JSON.stringify(company.errors));
    expect(await saveCompanySettings(db, who, company.data)).toBe("saved");
    await installChart(db, who, "corporation");
    await createFirstFiscalYear(db, who, { start: "2026-01-01", extended: false });
    const contact = parseContactForm(
      form({
        kind: "company",
        isCustomer: "on",
        name: "Kunde GmbH",
        language: "de",
        country: "DE",
      }),
    );
    if (!contact.ok) throw new Error("contact");
    const c = await createContact(db, who, contact.data);
    const parsed = parseInvoiceForm(
      form({
        contactId: c.id,
        language: "de",
        issueDate: "2026-09-30",
        "line.description": ["Beratung", "Fachbuch"],
        "line.quantity": ["10", "1"],
        "line.unit": ["hour", "piece"],
        "line.unitPrice": ["100", "50"],
        "line.vatCode": ["normal", "reduced"],
        "line.productId": ["", ""],
      }),
      { vatRegistered: true, country: "DE" },
    );
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
    const draft = await createInvoice(db, who, parsed.data);
    if (!draft || typeof draft !== "object") throw new Error("brouillon");
    await issueInvoice(db, who, draft.id);
    await postPending(db, who);

    const [year] = await listFiscalYears(db, who.organizationId);
    if (!year) throw new Error("exercice");
    const entries = await exportEntries(db, who.organizationId, year.id);
    expect(entries).toHaveLength(1);
    const rows = datevRows(entries[0] as (typeof entries)[number]);
    expect(rows.map((r) => [r.amountCents, r.side, r.account, r.counter, r.key])).toEqual([
      [119_000, "H", "4400", "1200", ""],
      [5_350, "H", "4300", "1200", ""],
    ]);
    const fec = buildFec(entries).split("\r\n");
    expect(fec[1]).toContain("|1200|");
    expect(fec[1]).toContain("|1243,50|0,00|");
  });
});
