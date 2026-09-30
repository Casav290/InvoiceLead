import { RATE_FIGURES } from "./vat-return";

/**
 * Décompte TVA au format eCH-0217 v1.0 (e-TVA), pour le dépôt sur le portail AFC ePortal. Produit à
 * partir d'un décompte validé : méthode effective (taux par chiffre du formulaire, impôt préalable
 * 400 et 405) ou TDFN (taux net accordé par l'AFC). Schéma dans docs/ech-0217/.
 */
export type Ech0217Input = {
  uid: string;
  organisationName: string;
  periodStart: string;
  periodEnd: string;
  /** Contre-prestations convenues (1) ou reçues (2). */
  settlement: "agreed" | "received";
  netTaxRateBp: number | null;
  figures: Record<string, number>;
  businessReferenceId: string;
  generatedAt: Date;
  productVersion: string;
};

const NET_FIGURES = ["322", "332", "321", "331"];

const esc = (v: string) =>
  v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const amount = (cents: number) => (cents / 100).toFixed(2);
const rate = (bp: number) => (bp / 100).toFixed(2);
const el = (name: string, value: string) => `<eCH-0217:${name}>${value}</eCH-0217:${name}>`;

/** Rend le XML, ou null si l'IDE n'est pas un numéro CHE valable pour ce format. */
export function buildEch0217(input: Ech0217Input): string | null {
  const m = /^CHE(\d{9})$/.exec(input.uid);
  if (!m?.[1]) return null;
  const f = input.figures;
  const net = NET_FIGURES.some((code) => code in f);

  const optional = (name: string, cents: number | undefined) =>
    cents ? el(name, amount(cents)) : "";

  const turnover = [
    el("totalConsideration", amount(f["200"] ?? 0)),
    optional("suppliesToForeignCountries", f["220"]),
    optional("suppliesExemptFromTax", f["230"]),
  ].join("");

  let method: string;
  let payable: number;
  if (net) {
    const code = NET_FIGURES.find((c) => c in f) ?? "322";
    method = `<eCH-0217:netTaxRateMethod><eCH-0217:suppliesPerTaxRate>${el("taxRate", rate(input.netTaxRateBp ?? 0))}${el("turnover", amount(f[code] ?? 0))}</eCH-0217:suppliesPerTaxRate></eCH-0217:netTaxRateMethod>`;
    payable = f["399"] ?? 0;
  } else {
    const perRate = Object.entries(RATE_FIGURES)
      .filter(([, code]) => (f[code] ?? 0) !== 0)
      .map(
        ([bp, code]) =>
          `<eCH-0217:suppliesPerTaxRate>${el("taxRate", rate(Number(bp)))}${el("turnover", amount(f[code] ?? 0))}</eCH-0217:suppliesPerTaxRate>`,
      )
      .join("");
    method = `<eCH-0217:effectiveReportingMethod>${el("grossOrNet", "1")}${perRate}${optional("inputTaxMaterialAndServices", f["400"])}${optional("inputTaxInvestments", f["405"])}</eCH-0217:effectiveReportingMethod>`;
    payable = (f["399"] ?? 0) - (f["479"] ?? 0);
  }

  const generation = input.generatedAt.toISOString().replace(/\.\d{3}Z$/, "Z");
  return `<?xml version="1.0" encoding="UTF-8"?>
<eCH-0217:VATDeclaration xmlns:eCH-0217="http://www.ech.ch/xmlns/eCH-0217/1" xmlns:eCH-0097="http://www.ech.ch/xmlns/eCH-0097/3" xmlns:eCH-0058="http://www.ech.ch/xmlns/eCH-0058/5"><eCH-0217:generalInformation><eCH-0217:uid><eCH-0097:uidOrganisationIdCategorie>CHE</eCH-0097:uidOrganisationIdCategorie><eCH-0097:uidOrganisationId>${m[1]}</eCH-0097:uidOrganisationId></eCH-0217:uid>${el("organisationName", esc(input.organisationName.slice(0, 255)))}${el("generationTime", generation)}${el("reportingPeriodFrom", input.periodStart)}${el("reportingPeriodTill", input.periodEnd)}${el("typeOfSubmission", "1")}${el("formOfReporting", input.settlement === "received" ? "2" : "1")}${el("businessReferenceId", esc(input.businessReferenceId.slice(0, 50)))}<eCH-0217:sendingApplication><eCH-0058:manufacturer>InvoiceLead</eCH-0058:manufacturer><eCH-0058:product>InvoiceLead</eCH-0058:product><eCH-0058:productVersion>${esc(input.productVersion.slice(0, 10))}</eCH-0058:productVersion></eCH-0217:sendingApplication></eCH-0217:generalInformation><eCH-0217:turnoverComputation>${turnover}</eCH-0217:turnoverComputation>${method}${el("payableTax", amount(payable))}</eCH-0217:VATDeclaration>
`;
}
