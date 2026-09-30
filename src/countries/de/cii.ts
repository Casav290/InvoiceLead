import { computeTotals } from "@/lib/invoice-math";
import type { Invoice, InvoiceLine } from "@/server/db/schema";

/**
 * Facture électronique allemande au format CII (UN/CEFACT Cross Industry Invoice), conforme à la
 * norme EN 16931 : XML seul pour XRechnung, ou intégré au PDF/A-3 pour ZUGFeRD (profil EN 16931).
 * À faire passer par le validateur KoSIT avant l'ouverture en Allemagne.
 */
export type CiiProfile = "xrechnung" | "zugferd";

const GUIDELINE: Record<CiiProfile, string> = {
  xrechnung: "urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0",
  zugferd: "urn:cen.eu:en16931:2017",
};

/** Unités UN/ECE (recommandation 20). */
const UNIT_CODES: Record<string, string> = {
  hour: "HUR",
  day: "DAY",
  piece: "H87",
  flat: "LS",
  km: "KMT",
  month: "MON",
};

const EU = new Set(
  "AT BE BG CY CZ DE DK EE ES FI FR GR HR HU IE IT LT LU LV MT NL PL PT RO SE SI SK".split(" "),
);

const esc = (v: string) =>
  v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const money = (cents: number) => (Math.abs(cents) / 100).toFixed(2);
const qty = (milli: number) => (milli / 1000).toFixed(3).replace(/\.?0+$/, "");
const date = (iso: string) =>
  `<udt:DateTimeString format="102">${iso.replaceAll("-", "")}</udt:DateTimeString>`;
const rate = (bp: number) => (bp / 100).toFixed(2).replace(/\.?0+$/, "") || "0";

type Category = { code: "S" | "E" | "AE" | "G"; reason?: string };

function categoryOf(line: InvoiceLine, invoice: Invoice): Category {
  if (!invoice.vatRegistered) return { code: "E", reason: "Kleinunternehmer gemäß § 19 UStG" };
  if (line.vatCode === "exempt") return { code: "E", reason: "Steuerfreie Leistung (§ 4 UStG)" };
  if (line.vatCode === "export") {
    return EU.has(invoice.recipient?.country ?? "")
      ? { code: "AE", reason: "Steuerschuldnerschaft des Leistungsempfängers" }
      : { code: "G", reason: "Ausfuhr in ein Drittland" };
  }
  return { code: "S" };
}

/** Champs obligatoires absents pour le profil demandé (clés de messages). */
export function missingForCii(
  invoice: Invoice,
  lines: InvoiceLine[],
  profile: CiiProfile,
): string[] {
  const s = invoice.sender;
  const r = invoice.recipient;
  const missing: string[] = [];
  if (!invoice.number) missing.push("number");
  if (!s?.street || !s.postalCode || !s.town) missing.push("sellerAddress");
  // USt-IdNr. ou Steuernummer : l'une des deux figure sur toute facture allemande (BR-DE-16).
  if (!s?.uid && !s?.taxNumber) missing.push("sellerTaxId");
  if (!r?.postalCode || !r.town) missing.push("buyerAddress");
  // Autoliquidation (catégorie AE) : l'USt-IdNr. du client est obligatoire (BR-AE-2).
  if (
    invoice.vatRegistered &&
    EU.has(r?.country ?? "") &&
    invoice.recipient?.country !== undefined &&
    !r?.uid &&
    lines.some((l) => l.vatCode === "export")
  )
    missing.push("buyerVatId");
  if (profile === "xrechnung") {
    // XRechnung : contact du vendeur complet et adresses électroniques des deux parties.
    if (!s?.email) missing.push("sellerEmail");
    if (!s?.iban) missing.push("sellerIban");
    if (!s?.phone) missing.push("sellerPhone");
    if (!r?.email) missing.push("buyerEmail");
  }
  return missing;
}

function party(
  tag: "SellerTradeParty" | "BuyerTradeParty",
  p: NonNullable<Invoice["sender"]>,
  withContact: boolean,
): string {
  const address = [
    p.postalCode ? `<ram:PostcodeCode>${esc(p.postalCode)}</ram:PostcodeCode>` : "",
    p.street
      ? `<ram:LineOne>${esc(`${p.street} ${p.buildingNumber ?? ""}`.trim())}</ram:LineOne>`
      : "",
    p.town ? `<ram:CityName>${esc(p.town)}</ram:CityName>` : "",
    `<ram:CountryID>${esc(p.country)}</ram:CountryID>`,
  ].join("");
  const contact = withContact
    ? `<ram:DefinedTradeContact><ram:PersonName>${esc(p.contactPerson || p.name)}</ram:PersonName>${
        p.phone
          ? `<ram:TelephoneUniversalCommunication><ram:CompleteNumber>${esc(p.phone)}</ram:CompleteNumber></ram:TelephoneUniversalCommunication>`
          : ""
      }${
        p.email
          ? `<ram:EmailURIUniversalCommunication><ram:URIID>${esc(p.email)}</ram:URIID></ram:EmailURIUniversalCommunication>`
          : ""
      }</ram:DefinedTradeContact>`
    : "";
  const uri = p.email
    ? `<ram:URIUniversalCommunication><ram:URIID schemeID="EM">${esc(p.email)}</ram:URIID></ram:URIUniversalCommunication>`
    : "";
  const vatId = p.uid && /^[A-Z]{2}/.test(p.uid) ? p.uid : null;
  const tax = [
    vatId
      ? `<ram:SpecifiedTaxRegistration><ram:ID schemeID="VA">${esc(vatId)}</ram:ID></ram:SpecifiedTaxRegistration>`
      : "",
    p.taxNumber
      ? `<ram:SpecifiedTaxRegistration><ram:ID schemeID="FC">${esc(p.taxNumber)}</ram:ID></ram:SpecifiedTaxRegistration>`
      : "",
  ].join("");
  // Sans USt-IdNr., la Steuernummer sert aussi d'identifiant du vendeur (BR-CO-26).
  const id =
    tag === "SellerTradeParty" && !vatId && p.taxNumber
      ? `<ram:ID>${esc(p.taxNumber)}</ram:ID>`
      : "";
  return `<ram:${tag}>${id}<ram:Name>${esc(p.name)}</ram:Name>${contact}<ram:PostalTradeAddress>${address}</ram:PostalTradeAddress>${uri}${tax}</ram:${tag}>`;
}

/** XML CII de la pièce émise, ou la liste des champs manquants. */
export function buildCii(
  invoice: Invoice,
  lines: InvoiceLine[],
  profile: CiiProfile,
  related?: { number: string | null } | null,
): { xml: string } | { missing: string[] } {
  const missing = missingForCii(invoice, lines, profile);
  if (missing.length > 0 || !invoice.sender || !invoice.recipient) return { missing };
  const creditNote = invoice.kind === "credit_note";
  const currency = invoice.currency;

  const items = lines
    .map((l, i) => {
      const c = categoryOf(l, invoice);
      const pct = c.code === "S" ? rate(l.vatRateBp) : "0";
      return `<ram:IncludedSupplyChainTradeLineItem><ram:AssociatedDocumentLineDocument><ram:LineID>${i + 1}</ram:LineID></ram:AssociatedDocumentLineDocument><ram:SpecifiedTradeProduct><ram:Name>${esc(l.description)}</ram:Name></ram:SpecifiedTradeProduct><ram:SpecifiedLineTradeAgreement><ram:NetPriceProductTradePrice><ram:ChargeAmount>${money(l.unitPriceCents)}</ram:ChargeAmount></ram:NetPriceProductTradePrice></ram:SpecifiedLineTradeAgreement><ram:SpecifiedLineTradeDelivery><ram:BilledQuantity unitCode="${UNIT_CODES[l.unit] ?? "C62"}">${qty(Math.abs(l.quantityMilli))}</ram:BilledQuantity></ram:SpecifiedLineTradeDelivery><ram:SpecifiedLineTradeSettlement><ram:ApplicableTradeTax><ram:TypeCode>VAT</ram:TypeCode><ram:CategoryCode>${c.code}</ram:CategoryCode><ram:RateApplicablePercent>${pct}</ram:RateApplicablePercent></ram:ApplicableTradeTax><ram:SpecifiedTradeSettlementLineMonetarySummation><ram:LineTotalAmount>${money(l.netCents)}</ram:LineTotalAmount></ram:SpecifiedTradeSettlementLineMonetarySummation></ram:SpecifiedLineTradeSettlement></ram:IncludedSupplyChainTradeLineItem>`;
    })
    .join("");

  // Ventilation par catégorie et taux : bases et TVA arrondie par taux, comme la facture.
  const groups = new Map<string, { c: Category; bp: number; base: number }>();
  for (const l of lines) {
    const c = categoryOf(l, invoice);
    const bp = c.code === "S" ? l.vatRateBp : 0;
    const key = `${c.code}:${bp}`;
    const g = groups.get(key) ?? { c, bp, base: 0 };
    g.base += l.netCents;
    groups.set(key, g);
  }
  const vatByRate = new Map(computeTotals(lines).vat.map((v) => [v.rateBp, v.vatCents]));
  const taxes = [...groups.values()]
    .map((g) => {
      const tax = g.c.code === "S" ? (vatByRate.get(g.bp) ?? 0) : 0;
      const reason = g.c.reason
        ? `<ram:ExemptionReason>${esc(g.c.reason)}</ram:ExemptionReason>`
        : "";
      return `<ram:ApplicableTradeTax><ram:CalculatedAmount>${money(tax)}</ram:CalculatedAmount><ram:TypeCode>VAT</ram:TypeCode>${reason}<ram:BasisAmount>${money(g.base)}</ram:BasisAmount><ram:CategoryCode>${g.c.code}</ram:CategoryCode><ram:RateApplicablePercent>${rate(g.bp) || "0"}</ram:RateApplicablePercent></ram:ApplicableTradeTax>`;
    })
    .join("");

  const s = invoice.sender;
  const payment = s.iban
    ? `<ram:SpecifiedTradeSettlementPaymentMeans><ram:TypeCode>58</ram:TypeCode><ram:PayeePartyCreditorFinancialAccount><ram:IBANID>${esc(s.iban)}</ram:IBANID></ram:PayeePartyCreditorFinancialAccount></ram:SpecifiedTradeSettlementPaymentMeans>`
    : "";
  // Un avoir aussi porte des conditions (BR-CO-25) : le montant est remboursé ou imputé.
  const terms = creditNote
    ? "<ram:SpecifiedTradePaymentTerms><ram:Description>Gutschrift: Betrag wird erstattet oder verrechnet.</ram:Description></ram:SpecifiedTradePaymentTerms>"
    : invoice.dueDate
      ? `<ram:SpecifiedTradePaymentTerms><ram:DueDateDateTime>${date(invoice.dueDate)}</ram:DueDateDateTime></ram:SpecifiedTradePaymentTerms>`
      : "";
  const preceding =
    creditNote && related?.number
      ? `<ram:InvoiceReferencedDocument><ram:IssuerAssignedID>${esc(related.number)}</ram:IssuerAssignedID></ram:InvoiceReferencedDocument>`
      : "";

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rsm:CrossIndustryInvoice xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100" xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100" xmlns:qdt="urn:un:unece:uncefact:data:standard:QualifiedDataType:100" xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100"><rsm:ExchangedDocumentContext><ram:BusinessProcessSpecifiedDocumentContextParameter><ram:ID>urn:fdc:peppol.eu:2017:poacc:billing:01:1.0</ram:ID></ram:BusinessProcessSpecifiedDocumentContextParameter><ram:GuidelineSpecifiedDocumentContextParameter><ram:ID>${GUIDELINE[profile]}</ram:ID></ram:GuidelineSpecifiedDocumentContextParameter></rsm:ExchangedDocumentContext><rsm:ExchangedDocument><ram:ID>${esc(invoice.number ?? "")}</ram:ID><ram:TypeCode>${creditNote ? "381" : "380"}</ram:TypeCode><ram:IssueDateTime>${date(invoice.issueDate)}</ram:IssueDateTime>${
    invoice.introText
      ? `<ram:IncludedNote><ram:Content>${esc(invoice.introText)}</ram:Content></ram:IncludedNote>`
      : ""
  }</rsm:ExchangedDocument><rsm:SupplyChainTradeTransaction>${items}<ram:ApplicableHeaderTradeAgreement><ram:BuyerReference>${esc(invoice.number ?? "")}</ram:BuyerReference>${party("SellerTradeParty", s, profile === "xrechnung" || !!s.email)}${party("BuyerTradeParty", invoice.recipient, false)}</ram:ApplicableHeaderTradeAgreement><ram:ApplicableHeaderTradeDelivery><ram:ActualDeliverySupplyChainEvent><ram:OccurrenceDateTime>${date(invoice.serviceDate)}</ram:OccurrenceDateTime></ram:ActualDeliverySupplyChainEvent></ram:ApplicableHeaderTradeDelivery><ram:ApplicableHeaderTradeSettlement>${
    invoice.paymentReference
      ? `<ram:PaymentReference>${esc(invoice.paymentReference)}</ram:PaymentReference>`
      : ""
  }<ram:InvoiceCurrencyCode>${currency}</ram:InvoiceCurrencyCode>${payment}${taxes}${terms}<ram:SpecifiedTradeSettlementHeaderMonetarySummation><ram:LineTotalAmount>${money(invoice.netCents)}</ram:LineTotalAmount><ram:TaxBasisTotalAmount>${money(invoice.netCents)}</ram:TaxBasisTotalAmount><ram:TaxTotalAmount currencyID="${currency}">${money(invoice.vatCents)}</ram:TaxTotalAmount><ram:GrandTotalAmount>${money(invoice.totalCents)}</ram:GrandTotalAmount><ram:DuePayableAmount>${money(invoice.totalCents)}</ram:DuePayableAmount></ram:SpecifiedTradeSettlementHeaderMonetarySummation>${preceding}</ram:ApplicableHeaderTradeSettlement></rsm:SupplyChainTradeTransaction></rsm:CrossIndustryInvoice>
`;
  return { xml };
}
