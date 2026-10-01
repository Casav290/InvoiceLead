import { XMLParser } from "fast-xml-parser";

/**
 * Facture électronique reçue d'un fournisseur, lue sans IA : CII (XRechnung CII, ZUGFeRD,
 * Factur-X) ou UBL (XRechnung UBL, Peppol BIS). Montants en centimes.
 */
export type IncomingInvoice = {
  format: "cii" | "ubl";
  supplierName: string;
  supplierStreet: string | null;
  supplierPostalCode: string | null;
  supplierTown: string | null;
  supplierCountry: string | null;
  supplierVatId: string | null;
  number: string | null;
  issueDate: string;
  dueDate: string | null;
  currency: string;
  totalCents: number;
  vatCents: number;
  /** Taux principal de TVA en pour cent (19, 8.1…), ou null sans TVA. */
  vatPercent: number | null;
  iban: string | null;
  bic: string | null;
  paymentReference: string | null;
  description: string | null;
  creditNote: boolean;
};

const parser = new XMLParser({
  removeNSPrefix: true,
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  parseTagValue: false,
  trimValues: true,
});

type Node = Record<string, unknown>;
const first = (v: unknown): unknown => (Array.isArray(v) ? v[0] : v);
const all = (v: unknown): unknown[] =>
  v === undefined || v === null ? [] : Array.isArray(v) ? v : [v];
function at(node: unknown, ...path: string[]): unknown {
  let cur: unknown = node;
  for (const key of path) {
    cur = first(cur);
    if (!cur || typeof cur !== "object") return undefined;
    cur = (cur as Node)[key];
  }
  return first(cur);
}
function text(v: unknown): string | null {
  const x = first(v);
  if (x === undefined || x === null) return null;
  if (typeof x === "object") return text((x as Node)["#text"]);
  const s = String(x).trim();
  return s === "" ? null : s;
}
function cents(v: unknown): number | null {
  const s = text(v);
  if (s === null) return null;
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}
/** Date CII « 20260930 » (format 102) ou ISO « 2026-09-30 ». */
function isoDate(v: unknown): string | null {
  const s = text(v);
  if (!s) return null;
  const m = /^(\d{4})-?(\d{2})-?(\d{2})/.exec(s);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

function parseCii(doc: Node): IncomingInvoice | null {
  const root = doc.CrossIndustryInvoice;
  if (!root) return null;
  const trade = at(root, "SupplyChainTradeTransaction");
  const agreement = at(trade, "ApplicableHeaderTradeAgreement");
  const seller = at(agreement, "SellerTradeParty");
  const settlement = at(trade, "ApplicableHeaderTradeSettlement");
  const sums = at(settlement, "SpecifiedTradeSettlementHeaderMonetarySummation");
  const currency = text(at(settlement, "InvoiceCurrencyCode")) ?? "EUR";
  // Plusieurs TaxTotalAmount possibles (devise de la facture et devise de TVA) : celui de la facture.
  const taxTotals = all((first(sums) as Node | undefined)?.TaxTotalAmount);
  const tax =
    taxTotals.find((t) => typeof t === "object" && (t as Node)["@currencyID"] === currency) ??
    taxTotals[0];
  const means = at(settlement, "SpecifiedTradeSettlementPaymentMeans");
  const taxes = all((first(settlement) as Node | undefined)?.ApplicableTradeTax);
  const main = taxes
    .map((t) => ({
      rate: Number(text(at(t, "RateApplicablePercent"))),
      amount: cents(at(t, "CalculatedAmount")) ?? 0,
    }))
    .filter((t) => Number.isFinite(t.rate))
    .sort((a, b) => b.amount - a.amount)[0];
  const total = cents(at(sums, "DuePayableAmount")) ?? cents(at(sums, "GrandTotalAmount"));
  const issueDate = isoDate(at(root, "ExchangedDocument", "IssueDateTime", "DateTimeString"));
  const name = text(at(seller, "Name"));
  if (!total || !issueDate || !name) return null;
  const type = text(at(root, "ExchangedDocument", "TypeCode"));
  const vatIds = all((first(seller) as Node | undefined)?.SpecifiedTaxRegistration);
  const vatId =
    vatIds
      .map((r) => ({
        id: text(at(r, "ID")),
        scheme: (first(at(r, "ID")) as Node | undefined)?.["@schemeID"],
      }))
      .find((r) => r.scheme === "VA")?.id ?? null;
  return {
    format: "cii",
    supplierName: name,
    supplierStreet: text(at(seller, "PostalTradeAddress", "LineOne")),
    supplierPostalCode: text(at(seller, "PostalTradeAddress", "PostcodeCode")),
    supplierTown: text(at(seller, "PostalTradeAddress", "CityName")),
    supplierCountry: text(at(seller, "PostalTradeAddress", "CountryID")),
    supplierVatId: vatId,
    number: text(at(root, "ExchangedDocument", "ID")),
    issueDate,
    dueDate: isoDate(
      at(settlement, "SpecifiedTradePaymentTerms", "DueDateDateTime", "DateTimeString"),
    ),
    currency,
    totalCents: Math.abs(total),
    vatCents: Math.abs(cents(tax) ?? 0),
    vatPercent: main && main.rate > 0 ? main.rate : null,
    iban:
      text(at(means, "PayeePartyCreditorFinancialAccount", "IBANID"))?.replace(/\s/g, "") ?? null,
    bic: text(at(means, "PayeeSpecifiedCreditorFinancialInstitution", "BICID")),
    paymentReference: text(at(settlement, "PaymentReference")),
    description: text(
      at(trade, "IncludedSupplyChainTradeLineItem", "SpecifiedTradeProduct", "Name"),
    ),
    creditNote: type === "381",
  };
}

function parseUbl(doc: Node): IncomingInvoice | null {
  const creditNote = !!doc.CreditNote;
  const root = doc.Invoice ?? doc.CreditNote;
  if (!root) return null;
  const party = at(root, "AccountingSupplierParty", "Party");
  const address = at(party, "PostalAddress");
  const means = at(root, "PaymentMeans");
  const currency = text(at(root, "DocumentCurrencyCode")) ?? "EUR";
  const total = cents(at(root, "LegalMonetaryTotal", "PayableAmount"));
  const issueDate = isoDate(at(root, "IssueDate"));
  const name =
    text(at(party, "PartyLegalEntity", "RegistrationName")) ?? text(at(party, "PartyName", "Name"));
  if (!total || !issueDate || !name) return null;
  const subtotals = all((first(at(root, "TaxTotal")) as Node | undefined)?.TaxSubtotal);
  const main = subtotals
    .map((t) => ({
      rate: Number(text(at(t, "TaxCategory", "Percent"))),
      amount: cents(at(t, "TaxAmount")) ?? 0,
    }))
    .filter((t) => Number.isFinite(t.rate))
    .sort((a, b) => b.amount - a.amount)[0];
  return {
    format: "ubl",
    supplierName: name,
    supplierStreet: text(at(address, "StreetName")),
    supplierPostalCode: text(at(address, "PostalZone")),
    supplierTown: text(at(address, "CityName")),
    supplierCountry: text(at(address, "Country", "IdentificationCode")),
    supplierVatId: text(at(party, "PartyTaxScheme", "CompanyID")),
    number: text(at(root, "ID")),
    issueDate,
    dueDate: isoDate(at(root, "DueDate")) ?? isoDate(at(means, "PaymentDueDate")),
    currency,
    totalCents: Math.abs(total),
    vatCents: Math.abs(cents(at(root, "TaxTotal", "TaxAmount")) ?? 0),
    vatPercent: main && main.rate > 0 ? main.rate : null,
    iban: text(at(means, "PayeeFinancialAccount", "ID"))?.replace(/\s/g, "") ?? null,
    bic: text(at(means, "PayeeFinancialAccount", "FinancialInstitutionBranch", "ID")),
    paymentReference: text(at(means, "PaymentID")),
    description:
      text(at(root, "InvoiceLine", "Item", "Name")) ??
      text(at(root, "CreditNoteLine", "Item", "Name")),
    creditNote,
  };
}

/** Lit une facture électronique ; null si ce n'en est pas une, ou si elle est incomplète. */
export function parseIncomingInvoice(xml: string): IncomingInvoice | null {
  let doc: Node;
  try {
    doc = parser.parse(xml) as Node;
  } catch {
    return null;
  }
  return parseCii(doc) ?? parseUbl(doc);
}
