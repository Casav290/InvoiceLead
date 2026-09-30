import { mkdirSync, writeFileSync } from "node:fs";
import { expect, it } from "vitest";
import { buildEch0217 } from "@/countries/ch/ech0217";
import { buildCii } from "@/countries/de/cii";
import type { Invoice, InvoiceLine } from "@/server/db/schema";
import { renderInvoicePdf } from "@/server/invoice-pdf";

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
      "devise-usd",
      invoice({
        currency: "USD",
        fxRate: 0.9091,
        paymentReference: null,
        netCents: 150000,
        vatCents: 28500,
        totalCents: 178500,
      }),
      [line(1, "Consulting", 150000, "normal", 1900)],
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

it("écrit un PDF ZUGFeRD pour veraPDF", async () => {
  mkdirSync(OUT, { recursive: true });
  const inv = invoice({ netCents: 255997, vatCents: 47920, totalCents: 303917 });
  const lines = [
    line(1, "Beratung", 100000, "normal", 1900, "hour", 2500),
    line(2, "Buch", 1999, "reduced", 700, "piece", 3000),
  ];
  const cii = buildCii(inv, lines, "zugferd");
  if (!("xml" in cii)) throw new Error(cii.missing.join());
  const pdf = await renderInvoicePdf(
    inv,
    lines,
    {
      invoice: "Rechnung",
      issueDate: "Rechnungsdatum",
      serviceDate: "Leistungsdatum",
      dueDate: "Zahlbar bis",
      description: "Beschreibung",
      quantity: "Menge",
      unitPrice: "Einzelpreis",
      vat: "USt",
      amount: "Betrag",
      net: "Netto",
      total: "Gesamt",
      vatLine: (rate, base) => `USt ${rate} auf ${base}`,
      payTo: (iban) => `Zahlbar auf ${iban}.`,
      referenceLine: (ref) => `Referenz ${ref}`,
      units: { hour: "Std.", piece: "Stk." },
      scanToPay: "Mit der Banking-App scannen.",
    },
    cii,
  );
  writeFileSync(`${OUT}/zugferd.pdf`, pdf);
});

it("écrit des échantillons Factur-X français (EN 16931)", () => {
  mkdirSync(OUT, { recursive: true });
  const fr = {
    ...sender,
    name: "Atelier Durand SAS",
    street: "Rue de Rivoli",
    postalCode: "75001",
    town: "Paris",
    country: "FR",
    uid: "FR40303265045",
    taxNumber: "30326504500003",
  };
  const client = {
    ...buyer,
    name: "Client SARL",
    postalCode: "69001",
    town: "Lyon",
    country: "FR",
  };
  const cases: [string, Invoice, InvoiceLine[]][] = [
    [
      "fr-taux",
      invoice({
        sender: fr,
        recipient: client,
        netCents: 130000,
        vatCents: 22550,
        totalCents: 152550,
      } as Partial<Invoice>),
      [
        line(1, "Conseil", 100000, "normal", 2000),
        line(2, "Hébergement", 20000, "lodging", 1000),
        line(3, "Livre", 10000, "reduced", 550),
      ],
    ],
    [
      "fr-franchise",
      invoice({
        vatRegistered: false,
        sender: { ...fr, uid: null },
        recipient: client,
        netCents: 50000,
        vatCents: 0,
        totalCents: 50000,
      } as Partial<Invoice>),
      [line(1, "Prestation", 50000, "normal", 0)],
    ],
    [
      "fr-avoir",
      invoice({
        kind: "credit_note",
        number: "G-2026-0002",
        sender: fr,
        recipient: client,
        netCents: 100000,
        vatCents: 20000,
        totalCents: 120000,
      } as Partial<Invoice>),
      [line(1, "Avoir", 100000, "normal", 2000)],
    ],
  ];
  for (const [name, inv, lines] of cases) {
    const r = buildCii(
      inv,
      lines,
      "zugferd",
      inv.kind === "credit_note" ? { number: "2026-0001" } : null,
    );
    expect("xml" in r ? "ok" : r.missing).toBe("ok");
    if ("xml" in r) writeFileSync(`${OUT}/${name}.xml`, r.xml);
  }
});

it("écrit des décomptes eCH-0217 (méthode effective et TDFN)", () => {
  mkdirSync(OUT, { recursive: true });
  const base = {
    uid: "CHE116281710",
    organisationName: "Atelier Muster GmbH",
    periodStart: "2026-01-01",
    periodEnd: "2026-03-31",
    settlement: "agreed" as const,
    netTaxRateBp: null,
    businessReferenceId: "3f6c0e2a-0000-4000-8000-000000000001",
    generatedAt: new Date("2026-04-10T08:00:00Z"),
    productVersion: "1.0",
  };
  const effective = buildEch0217({
    ...base,
    figures: {
      "200": 160000,
      "220": 30000,
      "230": 30000,
      "303": 100000,
      "303t": 8100,
      "313": 30000,
      "313t": 780,
      "399": 8880,
      "400": 810,
      "405": 0,
      "479": 810,
    },
  });
  const tdfn = buildEch0217({
    ...base,
    settlement: "received",
    netTaxRateBp: 620,
    figures: { "200": 108100, "322": 108100, "322t": 6702, "399": 6702, collected: 8100 },
  });
  if (!effective || !tdfn) throw new Error("ech0217");
  writeFileSync(`${OUT}/ech0217-effective.xml`, effective);
  writeFileSync(`${OUT}/ech0217-tdfn.xml`, tdfn);
});
