import { describe, expect, it } from "vitest";
import { countryPack } from "@/countries";
import { frVatIdFromSiren, isValidFrVatId, isValidSiret, vatRateBpFr } from "@/countries/fr/vat";
import { formatAmount } from "@/lib/money";
import { vatNumberLabel } from "@/lib/swiss-ids";
import { parseCompanyForm } from "@/server/company";

function form(values: Record<string, string>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(values)) f.set(k, v);
  return f;
}

const COMPANY = {
  country: "FR",
  legalName: "Atelier Durand SAS",
  legalForm: "sas",
  street: "Rue de Rivoli",
  buildingNumber: "10",
  postalCode: "75001",
  town: "Paris",
  uid: "FR 40 303 265 045",
  taxNumber: "303 265 045 00003",
  vatRegistered: "on",
  vatSettlement: "received",
  iban: "FR76 3000 6000 0112 3456 7890 189",
  fiscalYearStartMonth: "1",
};

describe("pack France", () => {
  it("taux datés, SIREN et SIRET, numéro de TVA, montants à la française", () => {
    expect(vatRateBpFr("normal", "2026-03-01")).toBe(2000);
    expect(vatRateBpFr("lodging", "2026-03-01")).toBe(1000);
    expect(vatRateBpFr("reduced", "2026-03-01")).toBe(550);
    expect(vatRateBpFr("normal", "2013-06-01")).toBe(1960);
    expect(isValidSiret("732829320")).toBe(true);
    expect(isValidSiret("73282932000074")).toBe(true);
    expect(isValidSiret("73282932000075")).toBe(false);
    expect(isValidFrVatId("FR40303265045")).toBe(true);
    expect(isValidFrVatId("FR41303265045")).toBe(false);
    expect(frVatIdFromSiren("303265045")).toBe("FR40303265045");
    expect(formatAmount(123_456_78, "fr")).toBe("123 456,78");
    expect(vatNumberLabel("FR40303265045", "fr")).toBe("N° TVA FR40303265045");
    expect(countryPack("FR")).toMatchObject({ currency: "EUR", amounts: "fr" });
  });

  it("réglages français : SIRET obligatoire, TVA intracommunautaire contrôlée", () => {
    const ok = parseCompanyForm(form(COMPANY));
    if (!ok.ok) throw new Error(JSON.stringify(ok.errors));
    expect(ok.data).toMatchObject({
      country: "FR",
      uid: "FR40303265045",
      taxNumber: "30326504500003",
      vatMethod: "effective",
      vatSettlement: "received",
      qrIban: null,
    });
    const bad = parseCompanyForm(form({ ...COMPANY, taxNumber: "", uid: "FR99303265045" }));
    expect(!bad.ok && bad.errors).toMatchObject({ taxNumber: "siretRequired", uid: "frVatId" });
    const wrongSiret = parseCompanyForm(form({ ...COMPANY, taxNumber: "30326504500004" }));
    expect(!wrongSiret.ok && wrongSiret.errors.taxNumber).toBe("siret");
  });
});
