import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { createTranslator } from "next-intl";
import { extractText } from "unpdf";
import { describe, expect, it } from "vitest";
import { countryPack, offeredVatCodes } from "@/countries";
import { countryKey, forCountry, germanQuotes } from "@/i18n/country";
import type { Invoice, InvoiceLine, PartySnapshot } from "@/server/db/schema";
import { type DocumentVariant, documentLabels, kindNamespace } from "@/server/document-labels";
import { renderInvoicePdf } from "@/server/invoice-pdf";
import de from "../../messages/de.json";
import en from "../../messages/en.json";
import fr from "../../messages/fr.json";

/**
 * Libellés selon le pays de l'entreprise (src/i18n/country.ts) : une entreprise suisse lit les
 * messages tels quels, une entreprise allemande ne voit ni MWST, ni Offerte, ni Spesen, une entreprise
 * américaine ne voit pas de TVA.
 */

type Tree = { [key: string]: Node };
type Node = string | Node[] | Tree;
const MESSAGES = { de, fr, en } as unknown as Record<"de" | "fr" | "en", Tree>;

function entries(node: Node, prefix = ""): [string, string][] {
  if (typeof node === "string") return [[prefix, node]];
  const pairs = Array.isArray(node)
    ? node.map((v, i) => [String(i), v] as const)
    : Object.entries(node);
  return pairs.flatMap(([key, value]) => entries(value, prefix ? `${prefix}.${key}` : key));
}

/** Clés de base de app.* : ni variantes (…De, …Intl), ni tables par pays (…rate.CH). */
const baseKeys = (lang: "de" | "fr" | "en") =>
  entries(MESSAGES[lang].app as Tree)
    .map(([k]) => k)
    .filter((k) => !/(De|Fr|Gb|Us|Intl)$/.test(k) && !/\.(CH|DE|FR|GB|US)$/.test(k))
    .filter((k) => !/\.(figuresDe|figuresFr|figuresGb|figuresUs|vatCodesUs|vatDe)\./.test(k));

const translator = (lang: "de" | "fr" | "en", country: string, namespace = "app") =>
  forCountry(
    createTranslator({
      locale: lang,
      messages: MESSAGES[lang] as never,
      namespace: namespace as never,
      onError: () => {},
    }) as never,
    country,
  ) as unknown as ((key: string, values?: Record<string, unknown>) => string) & {
    has(key: string): boolean;
    raw(key: string): unknown;
  };

/** Texte qu'une entreprise de ce pays lit pour cette clé (variante, guillemets du pays). */
function shown(lang: "de" | "fr" | "en", country: string, key: string): string {
  const t = translator(lang, country);
  const raw = String(t.raw(key));
  return country === "CH" ? raw : germanQuotes(raw);
}

/**
 * Messages que seules les entreprises suisses voient : champs et contrôles suisses (IDE, QR-IBAN,
 * TDFN), chiffres et dépôt eCH-0217 du décompte AFC, relance avec QR-facture, écran « comptabilité
 * à venir » (tous les pays ont désormais leur comptabilité).
 */
const SWISS_ONLY = [
  "company.fields.uid",
  "company.fields.qrIban",
  "company.hints.qrIban",
  "company.hints.netTaxRate",
  "company.errors.uid",
  "company.errors.uidRequiredForVat",
  "company.errors.ibanIsQr",
  "company.errors.notQrIban",
  "company.errors.netTaxRate",
  "vat.figures.",
  "vat.xmlDownload",
  "vat.xmlNoUid",
  "reminders.subtitle",
  "accountingHome.unavailableBody",
];
const swissOnly = (key: string) => SWISS_ONLY.some((p) => key === p || key.startsWith(p));

describe("libellés d'une entreprise allemande", () => {
  const SWISS = /MWST|Offert|Spesen|Rappen|Treuhand|ESTV|«|»|QR|Beherbergung|verrechn|Verrechn/;

  it("n'ont ni MWST, ni Offerte, ni Spesen, ni guillemets suisses (allemand)", () => {
    const bad = baseKeys("de")
      .filter((k) => !swissOnly(k))
      .map((k): [string, string] => [k, shown("de", "DE", k)])
      .filter(([, v]) => SWISS.test(v));
    expect(bad).toEqual([]);
  });

  it("valent aussi pour la France et le Royaume-Uni en allemand", () => {
    for (const country of ["FR", "GB"]) {
      const bad = baseKeys("de")
        .filter((k) => !swissOnly(k))
        .map((k): [string, string] => [k, shown("de", country, k)])
        .filter(([, v]) => SWISS.test(v));
      expect(bad).toEqual([]);
    }
  });

  it("parlent d'Angeboten, d'Ausgaben, d'USt et de Steuerberatung", () => {
    const t = translator("de", "DE");
    expect(t("nav.quotes")).toBe("Angebote");
    expect(t("nav.expenses")).toBe("Ausgaben");
    expect(t("quotes.new")).toBe("Neues Angebot");
    expect(t("expenses.fields.vat")).toBe("Enthaltene USt");
    expect(t("invoices.net")).toBe("Summe netto");
    expect(t("bills.importHint")).toContain("auf den Cent genau");
    expect(t("team.fiduciaryTitle")).toBe("Steuerberatung");
    expect(t("bank.vat.lodging")).toBe("USt 7 %");
    // Guillemets d'Allemagne, à l'affichage.
    expect(t("recurring.empty")).toContain("„Wiederkehrend machen“");
  });
});

describe("libellés d'une entreprise américaine", () => {
  /**
   * Hors liste : messages d'autres pays (numéros allemands, français et britanniques, XRechnung,
   * onglet USt allemand, export DATEV, mentions des factures allemandes, françaises et britanniques),
   * assujettissement (« collects sales tax » aux États-Unis), TDFN, et champs de TVA des achats,
   * cachés aux États-Unis.
   */
  const OTHER_COUNTRIES = [
    "company.fields.vatRegistered",
    "company.fields.vatMethod",
    "company.fields.frVatId",
    "company.fields.gbVat",
    "company.fields.ustId",
    "company.errors.frVatId",
    "company.errors.gbVat",
    "company.errors.gbVatRequired",
    "company.errors.ustId",
    "company.hints.taxNumber",
    "company.errors.taxIdRequired",
    "invoices.einvoice.",
    "accountingHome.tabs.vat",
    "reports.export.datevHint",
    "vat.anomalies.inputUnderNetTaxRate",
    "bills.fields.vatCode",
    "expenses.fields.vat",
    "invoices.vatCodes.",
    "invoices.document.smallBusinessDe",
    "invoices.document.reverseChargeDe",
    "invoices.document.franchiseFr",
    "invoices.document.reverseChargeFr",
    "invoices.document.outsideEuFr",
    "invoices.document.outsideScopeGb",
  ];
  const skip = (k: string) =>
    swissOnly(k) || OTHER_COUNTRIES.some((p) => k === p || k.startsWith(p));
  const VAT = { en: /\bVAT\b/, fr: /\bTVA\b/, de: /MWST|\bUSt\b|USt-|Umsatzsteuer/ } as const;

  for (const lang of ["en", "fr", "de"] as const)
    it(`ne parlent pas de TVA (${lang})`, () => {
      const bad = baseKeys(lang)
        .filter((k) => !skip(k))
        .map((k): [string, string] => [k, shown(lang, "US", k)])
        .filter(([, v]) => VAT[lang].test(v));
      expect(bad).toEqual([]);
    });

  it("disent sales tax sur l'écran Banque", () => {
    const t = translator("en", "US", "app.bank");
    expect(t("vat.normal")).toBe("Sales tax");
    expect(t("vatLabel")).toBe("Sales tax included");
    expect(translator("fr", "US", "app.bank")("vat.normal")).toBe("Sales tax");
  });
});

describe("libellés d'une entreprise suisse", () => {
  it("sont exactement les messages de base, pour chaque clé et chaque langue", () => {
    for (const lang of ["de", "fr", "en"] as const) {
      const base = createTranslator({
        locale: lang,
        messages: MESSAGES[lang] as never,
        namespace: "app" as never,
      }) as unknown as Parameters<typeof countryKey>[0] & { raw(key: string): unknown };
      const t = translator(lang, "CH");
      for (const key of baseKeys(lang)) {
        expect(countryKey(base, key, "CH")).toBe(key);
        expect(t.raw(key)).toBe(base.raw(key));
      }
    }
  });

  it("gardent MWST, Offerte, Spesen et les guillemets suisses", () => {
    const t = translator("de", "CH");
    expect(t("nav.quotes")).toBe("Offerten");
    expect(t("nav.expenses")).toBe("Spesen");
    expect(t("invoices.net")).toBe("Total exkl. MWST");
    expect(t("bank.vat.lodging")).toBe("MWST Beherbergung");
    expect(t("expenses.fields.vat")).toBe("Enthaltene MWST");
    expect(t("recurring.empty")).toContain("«Wiederkehrend machen»");
  });
});

describe("taux proposés", () => {
  it("sont ceux du pays", () => {
    expect(offeredVatCodes("CH")).toEqual(["normal", "reduced", "lodging", "exempt", "export"]);
    // Allemagne : pas de « Beherbergung » à part, elle suit le taux réduit de 7 %.
    expect(offeredVatCodes("DE")).toEqual(["normal", "reduced", "exempt", "export"]);
    expect(offeredVatCodes("FR")).toEqual(["normal", "lodging", "reduced", "exempt", "export"]);
    expect(offeredVatCodes("US")).toEqual(["normal", "exempt", "export"]);
    // Un code déjà enregistré reste dans la liste.
    expect(offeredVatCodes("DE", "lodging")).toContain("lodging");
  });

  it("portent les taux du pays dans la fiche article", () => {
    const de_ = translator("de", "DE", "app.products");
    expect(offeredVatCodes("DE").map((c) => de_(`vatCodes.${c}`))).toEqual([
      "Regelsatz (19 %)",
      "Ermässigter Satz (7 %)",
      "Steuerfrei",
      "Steuerfrei (Export, innergemeinschaftlich)",
    ]);
    const fr_ = translator("fr", "FR", "app.products");
    expect(fr_("vatCodes.lodging")).toBe("Taux intermédiaire (10 %)");
    expect(translator("de", "CH", "app.products")("vatCodes.lodging")).toBe("Beherbergung (3,8 %)");
  });
});

// --- PDF ------------------------------------------------------------------------------------

const PARTY: Record<string, PartySnapshot> = {
  CH: {
    name: "Atelier Muster GmbH",
    street: "Bahnhofstrasse",
    buildingNumber: "1",
    postalCode: "8001",
    town: "Zürich",
    country: "CH",
    iban: "CH9300762011623852957",
    vatNumber: "CHE-123.456.788 MWST",
  },
  DE: {
    name: "Werkstatt Müller GmbH",
    street: "Friedrichstrasse",
    buildingNumber: "10",
    postalCode: "10117",
    town: "Berlin",
    country: "DE",
    iban: "DE89370400440532013000",
    vatNumber: "USt-IdNr. DE136695976",
  },
  FR: {
    name: "Atelier Dupont SARL",
    street: "Rue de Rivoli",
    buildingNumber: "12",
    postalCode: "75001",
    town: "Paris",
    country: "FR",
    iban: "FR1420041010050500013M02606",
    vatNumber: "TVA FR40303265045",
  },
  US: {
    name: "Smith Studio LLC",
    street: "Main Street",
    buildingNumber: "100",
    postalCode: "10001",
    town: "New York",
    region: "NY",
    country: "US",
  },
};
const RATE = { CH: 810, DE: 1900, FR: 2000, US: 887 } as const;

function document(
  country: keyof typeof RATE,
  language: "de" | "fr" | "en",
  kind: "invoice" | "quote" = "invoice",
): { invoice: Invoice; lines: InvoiceLine[] } {
  const net = 100_000;
  const vat = Math.round((net * RATE[country]) / 10_000);
  const invoice = {
    id: `inv-${country}`,
    organizationId: "org",
    contactId: "contact",
    kind,
    number: kind === "quote" ? "O-2026-0001" : "2026-0001",
    status: "issued",
    sourceQuoteId: null,
    relatedInvoiceId: null,
    language,
    currency: countryPack(country).currency,
    fxRate: null,
    title: null,
    introText: null,
    footerText: null,
    issueDate: "2026-10-24",
    serviceDate: "2026-10-20",
    dueDate: "2026-11-23",
    vatRegistered: true,
    netCents: net,
    vatCents: vat,
    totalCents: net + vat,
    recipient: { ...PARTY[country], name: "Kunde AG", iban: null, vatNumber: null },
    sender: PARTY[country],
    paymentReference: null,
    deposit: false,
  } as unknown as Invoice;
  const lines = [
    {
      id: "l1",
      invoiceId: invoice.id,
      position: 1,
      productId: null,
      description: "Beratung / Conseil / Consulting",
      quantityMilli: 10_000,
      unit: "hour",
      unitPriceCents: 10_000,
      vatCode: "normal",
      vatRateBp: RATE[country],
      netCents: net,
    },
  ] as unknown as InvoiceLine[];
  return { invoice, lines };
}

async function pdfText(
  country: keyof typeof RATE,
  language: "de" | "fr" | "en",
  kind: "invoice" | "quote" = "invoice",
  variant: DocumentVariant | null = null,
) {
  const { invoice: source, lines } = document(country, language, kind);
  const tr = (namespace: string) =>
    createTranslator({
      locale: language,
      messages: MESSAGES[language] as never,
      namespace: namespace as never,
    }) as never;
  const { invoice, labels } = documentLabels({
    source,
    lines,
    related: null,
    variant,
    t: tr("app.invoices.document"),
    tk: tr(kindNamespace(kind)),
    tu: tr("app.invoices.units"),
    poweredBy: false,
  });
  const pdf = await renderInvoicePdf(invoice, lines, labels);
  // Pour relire les PDF à l'œil : COUNTRY_PDF_DIR=/chemin npx vitest run country-labels
  const dir = process.env.COUNTRY_PDF_DIR;
  if (dir) writeFileSync(join(dir, `${kind}-${country}-${language}.pdf`), pdf);
  const { text } = await extractText(new Uint8Array(pdf), { mergePages: true });
  return text;
}

describe("PDF selon le pays", () => {
  it("Allemagne : USt, Summe netto, aucun MWST ni Offerte", async () => {
    const text = await pdfText("DE", "de");
    expect(text).toContain("USt 19 % auf");
    expect(text).toContain("Summe netto");
    expect(text).toContain("Gesamtbetrag EUR");
    expect(text).toContain("24.10.2026");
    expect(text).not.toMatch(/MWST|Offerte|exkl\./);
    const quote = await pdfText("DE", "de", "quote");
    expect(quote).toContain("Angebot O-2026-0001");
    expect(quote).not.toMatch(/MWST|Offerte/);
    const order = await pdfText("DE", "de", "quote", "order");
    expect(order).toContain("Gemäss unserem Angebot O-2026-0001");
  });

  it("États-Unis : sales tax, dates américaines, aucune TVA", async () => {
    const text = await pdfText("US", "en");
    expect(text).toContain("Sales tax 8.87 % on");
    expect(text).toContain("Subtotal");
    expect(text).toContain("10/24/2026");
    expect(text).not.toMatch(/\bVAT\b|MWST|TVA/);
    const german = await pdfText("US", "de");
    expect(german).not.toMatch(/MWST|\bUSt\b/);
  });

  it("France : TVA, dates françaises, mentions obligatoires", async () => {
    const text = await pdfText("FR", "fr");
    expect(text).toMatch(/TVA 20\s?% sur/);
    expect(text).toContain("24/10/2026");
    expect(text).toContain("40 €");
    const german = await pdfText("FR", "de");
    expect(german).not.toMatch(/MWST/);
  });

  it("Suisse : libellés inchangés (MWST, Total exkl. MWST, Offerte)", async () => {
    const text = await pdfText("CH", "de");
    expect(text).toContain("MWST 8.1 % auf");
    expect(text).toContain("Total exkl. MWST");
    expect(text).toContain("Total CHF");
    expect(text).toContain("24.10.2026");
    const quote = await pdfText("CH", "de", "quote");
    expect(quote).toContain("Offerte O-2026-0001");
  });
});
