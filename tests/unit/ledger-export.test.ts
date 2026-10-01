import { describe, expect, it } from "vitest";
import {
  buildDatev,
  buildFec,
  datevRows,
  type ExportEntry,
  FEC_COLUMNS,
  fecFilename,
  fecJournal,
} from "@/lib/ledger-export";

const line = (
  accountNumber: string,
  debitCents: number,
  creditCents: number,
  vatRateBp: number | null = null,
  isVat = false,
) => ({
  accountNumber,
  accountName: `Compte ${accountNumber}`,
  debitCents,
  creditCents,
  vatRateBp,
  isVat,
});

// Facture : 1000 à 19 % et 200 à 7 %, contre Forderungen.
const invoice: ExportEntry = {
  number: 1,
  entryDate: "2026-03-05",
  description: "Rechnung 2026-0001 Kunde GmbH",
  sourceType: "invoice",
  recordedOn: "2026-03-05",
  lines: [
    line("1200", 140_400, 0),
    line("4400", 0, 100_000, 1900),
    line("3800", 0, 19_000, 1900, true),
    line("4300", 0, 20_000, 700),
    line("3800", 0, 1_400, 700, true),
  ],
};

// Facture fournisseur : Fortbildung 100 + 19 % Vorsteuer, contre Verbindlichkeiten.
const bill: ExportEntry = {
  number: 2,
  entryDate: "2026-03-07",
  description: "Kreditor / Fournisseur Akademie GmbH",
  sourceType: "bill",
  recordedOn: "2026-03-08",
  lines: [
    line("6821", 10_000, 0, 1900),
    line("1400", 1_900, 0, 1900, true),
    line("3300", 0, 11_900),
  ],
};

describe("export DATEV", () => {
  it("passe la TVA en brut sur les comptes automatiques et par clé BU ailleurs", () => {
    expect(datevRows(invoice)).toEqual([
      expect.objectContaining({
        amountCents: 119_000,
        side: "H",
        account: "4400",
        counter: "1200",
        key: "",
        date: "0503",
      }),
      expect.objectContaining({ amountCents: 21_400, side: "H", account: "4300", counter: "1200" }),
    ]);
    expect(datevRows(bill)).toEqual([
      expect.objectContaining({
        amountCents: 11_900,
        side: "H",
        account: "3300",
        counter: "6821",
        key: "9",
      }),
    ]);
  });

  it("garde le solde de chaque compte", () => {
    const entry: ExportEntry = {
      ...bill,
      lines: [
        line("1800", 6_000, 0),
        line("1600", 4_000, 0),
        line("4830", 0, 9_000),
        line("6960", 0, 1_000),
      ],
    };
    const net = new Map<string, number>();
    for (const r of datevRows(entry)) {
      const signed = r.side === "S" ? r.amountCents : -r.amountCents;
      net.set(r.account, (net.get(r.account) ?? 0) + signed);
      net.set(r.counter, (net.get(r.counter) ?? 0) - signed);
    }
    expect(Object.fromEntries(net)).toEqual({
      "1800": 6_000,
      "1600": 4_000,
      "4830": -9_000,
      "6960": -1_000,
    });
  });

  it("écrit l'en-tête EXTF et des lignes en Windows-1252", () => {
    const file = buildDatev([invoice, bill], {
      consultant: 1001,
      client: 42,
      fiscalYearStart: "2026-01-01",
      from: "2026-01-01",
      to: "2026-12-31",
      createdAt: new Date("2026-10-01T08:00:00.000Z"),
    }).toString("latin1");
    const [header, columns, first, , third] = file.split("\r\n");
    expect(header).toMatch(
      /^"EXTF";700;21;"Buchungsstapel";13;20261001080000000;;"RE";"";"";1001;42;20260101;4;20260101;20261231;/,
    );
    expect(columns).toContain("Gegenkonto (ohne BU-Schlüssel)");
    expect(first).toBe(
      '1190,00;"H";"EUR";;;"";4400;1200;"";0503;"1";"";;"Rechnung 2026-0001 Kunde GmbH"',
    );
    expect(third).toContain(';3300;6821;"9";0703;"2";');
  });
});

describe("FEC", () => {
  it("écrit les dix-huit colonnes, une ligne par mouvement", () => {
    expect(fecJournal("invoice")).toEqual(["VE", "Ventes"]);
    expect(fecJournal("bill")).toEqual(["AC", "Achats"]);
    expect(fecJournal("bank")).toEqual(["BQ", "Banque"]);
    expect(fecJournal("manual")).toEqual(["OD", "Opérations diverses"]);
    const fec = buildFec([bill, invoice]).split("\r\n");
    expect(fec[0]).toBe(FEC_COLUMNS.join("|"));
    expect(fec[0]?.split("|")).toHaveLength(18);
    expect(fec[1]).toBe(
      "VE|Ventes|1|20260305|1200|Compte 1200|||1|20260305|Rechnung 2026-0001 Kunde GmbH|1404,00|0,00|||20260305||",
    );
    expect(fec[6]).toBe(
      "AC|Achats|2|20260307|6821|Compte 6821|||2|20260307|Kreditor / Fournisseur Akademie GmbH|100,00|0,00|||20260308||",
    );
    expect(fec).toHaveLength(10);
    expect(fecFilename("123456789", "2026-12-31")).toBe("123456789FEC20261231.txt");
  });
});
