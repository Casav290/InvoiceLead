import { mkdirSync, writeFileSync } from "node:fs";
import { expect, it } from "vitest";
import { buildCii } from "@/countries/de/cii";
import type { Invoice, InvoiceLine } from "@/server/db/schema";

/**
 * Échantillons XRechnung pour le validateur officiel KoSIT (scripts/validate-xrechnung.sh) :
 * taux mélangés, avoir, petite entreprise (§ 19 UStG), autoliquidation UE, exportation hors UE.
 */
const OUT = process.env.XRECHNUNG_OUT ?? "tmp/xrechnung";

const sender = {
  name: "Werkstatt Müller GmbH",
  street: "Friedrichstrasse",
  buildingNumber: "10",
  postalCode: "10117",
  town: "Berlin",
  country: "DE",
  uid: "DE136695976",
  email: "rechnung@werkstatt.test",
  phone: "+49 30 123456",
  iban: "DE89370400440532013000",
};
const buyer = {
  name: "Kunde GmbH",
  street: "Hauptstrasse",
  buildingNumber: "5",
  postalCode: "80331",
  town: "München",
  country: "DE",
  email: "ap@kunde.test",
};

function invoice(over: Partial<Invoice>): Invoice {
  return {
    id: "x",
    organizationId: "o",
    kind: "invoice",
    status: "issued",
    number: "2026-0007",
    language: "de",
    issueDate: "2026-09-30",
    serviceDate: "2026-09-15",
    dueDate: "2026-10-14",
    currency: "EUR",
    vatRegistered: true,
    introText: null,
    sender,
    recipient: buyer,
    paymentReference: "RF18539007547034",
    ...over,
  } as unknown as Invoice;
}

function line(
  n: number,
  description: string,
  cents: number,
  vatCode: string,
  bp: number,
  unit = "flat",
  milli = 1000,
) {
  return {
    id: `l${n}`,
    position: n,
    description,
    quantityMilli: milli,
    unit,
    unitPriceCents: cents,
    vatCode,
    vatRateBp: bp,
    netCents: Math.round((milli * cents) / 1000),
  } as unknown as InvoiceLine;
}

it("écrit les échantillons XRechnung", () => {
  mkdirSync(OUT, { recursive: true });
  const cases: [string, Invoice, InvoiceLine[]][] = [
    [
      "taux-melanges",
      invoice({ netCents: 255997, vatCents: 47920, totalCents: 303917 }),
      [
        line(1, "Beratung", 100000, "normal", 1900, "hour", 2500),
        line(2, "Buch", 1999, "reduced", 700, "piece", 3000),
      ],
    ],
    [
      "avoir",
      invoice({
        kind: "credit_note",
        number: "G-2026-0001",
        netCents: 100000,
        vatCents: 19000,
        totalCents: 119000,
      }),
      [line(1, "Gutschrift", 100000, "normal", 1900)],
    ],
    [
      "petite-entreprise",
      invoice({
        vatRegistered: false,
        sender: { ...sender, uid: null, taxNumber: "12/345/67890" },
        netCents: 50000,
        vatCents: 0,
        totalCents: 50000,
      } as Partial<Invoice>),
      [line(1, "Leistung", 50000, "normal", 0)],
    ],
    [
      "autoliquidation-ue",
      invoice({
        recipient: {
          ...buyer,
          name: "Client SARL",
          postalCode: "75001",
          town: "Paris",
          country: "FR",
          uid: "FR40303265045",
        },
        netCents: 80000,
        vatCents: 0,
        totalCents: 80000,
      }),
      [line(1, "Software development", 80000, "export", 0)],
    ],
    [
      "export-hors-ue",
      invoice({
        recipient: {
          ...buyer,
          name: "Client AG",
          postalCode: "8001",
          town: "Zürich",
          country: "CH",
        },
        netCents: 80000,
        vatCents: 0,
        totalCents: 80000,
      }),
      [line(1, "Export", 80000, "export", 0)],
    ],
  ];
  for (const [name, inv, lines] of cases) {
    const r = buildCii(
      inv,
      lines,
      "xrechnung",
      inv.kind === "credit_note" ? { number: "2026-0001" } : null,
    );
    expect("xml" in r ? "ok" : r.missing).toBe("ok");
    if ("xml" in r) writeFileSync(`${OUT}/${name}.xml`, r.xml);
  }
});
