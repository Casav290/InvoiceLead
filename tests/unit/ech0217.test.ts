import { describe, expect, it } from "vitest";
import { buildEch0217 } from "@/countries/ch/ech0217";

const base = {
  uid: "CHE116281710",
  organisationName: "Atelier & Co GmbH",
  periodStart: "2026-01-01",
  periodEnd: "2026-03-31",
  settlement: "agreed" as const,
  netTaxRateBp: null,
  businessReferenceId: "ref-1",
  generatedAt: new Date("2026-04-10T08:00:00.123Z"),
  productVersion: "1.0",
};

describe("décompte eCH-0217", () => {
  it("méthode effective : chiffre d'affaires, taux, impôt préalable, solde", () => {
    const xml = buildEch0217({
      ...base,
      figures: {
        "200": 160000,
        "220": 30000,
        "303": 100000,
        "313": 30000,
        "399": 8880,
        "400": 810,
        "479": 810,
      },
    });
    expect(xml).toContain("<eCH-0097:uidOrganisationId>116281710</eCH-0097:uidOrganisationId>");
    expect(xml).toContain(
      "<eCH-0217:organisationName>Atelier &amp; Co GmbH</eCH-0217:organisationName>",
    );
    expect(xml).toContain(
      "<eCH-0217:generationTime>2026-04-10T08:00:00Z</eCH-0217:generationTime>",
    );
    expect(xml).toContain("<eCH-0217:formOfReporting>1</eCH-0217:formOfReporting>");
    expect(xml).toContain("<eCH-0217:totalConsideration>1600.00</eCH-0217:totalConsideration>");
    expect(xml).toContain(
      "<eCH-0217:suppliesToForeignCountries>300.00</eCH-0217:suppliesToForeignCountries>",
    );
    expect(xml).toContain(
      "<eCH-0217:taxRate>8.10</eCH-0217:taxRate><eCH-0217:turnover>1000.00</eCH-0217:turnover>",
    );
    expect(xml).toContain(
      "<eCH-0217:taxRate>2.60</eCH-0217:taxRate><eCH-0217:turnover>300.00</eCH-0217:turnover>",
    );
    expect(xml).toContain(
      "<eCH-0217:inputTaxMaterialAndServices>8.10</eCH-0217:inputTaxMaterialAndServices>",
    );
    expect(xml).toContain("<eCH-0217:payableTax>80.70</eCH-0217:payableTax>");
  });

  it("méthode TDFN et contre-prestations reçues ; refuse un numéro qui n'est pas une IDE", () => {
    const xml = buildEch0217({
      ...base,
      settlement: "received",
      netTaxRateBp: 620,
      figures: { "200": 108100, "322": 108100, "399": 6702 },
    });
    expect(xml).toContain("<eCH-0217:formOfReporting>2</eCH-0217:formOfReporting>");
    expect(xml).toContain(
      "<eCH-0217:netTaxRateMethod><eCH-0217:suppliesPerTaxRate><eCH-0217:taxRate>6.20</eCH-0217:taxRate><eCH-0217:turnover>1081.00</eCH-0217:turnover>",
    );
    expect(xml).toContain("<eCH-0217:payableTax>67.02</eCH-0217:payableTax>");
    expect(buildEch0217({ ...base, uid: "DE136695976", figures: {} })).toBeNull();
  });
});
