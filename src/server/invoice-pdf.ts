import PDFDocument from "pdfkit";
import QRCode from "qrcode";
import { SwissQRBill } from "swissqrbill/pdf";
import { countryPack } from "@/countries";
import { formatReference } from "@/countries/ch/qr-reference";
import { formatRate } from "@/countries/ch/vat";
import { formatDate } from "@/lib/fiscal-year";
import { computeTotals, formatQuantity } from "@/lib/invoice-math";
import { formatAmount } from "@/lib/money";
import { formatIban } from "@/lib/swiss-ids";
import type { Invoice, InvoiceLine, PartySnapshot } from "./db/schema";

/** Libellés du PDF, dans la langue de la facture. */
export type InvoicePdfLabels = {
  invoice: string;
  issueDate: string;
  serviceDate: string;
  dueDate: string;
  description: string;
  quantity: string;
  unitPrice: string;
  vat: string;
  amount: string;
  net: string;
  total: string;
  vatLine: (rate: string, base: string) => string;
  payTo: (iban: string) => string;
  referenceLine: (reference: string) => string;
  units: Record<string, string>;
  /** Avoir : « Concerne la facture 2026-0001 ». */
  relatedLine?: string;
  /** Formule gratuite : « Créé avec InvoiceLead ». */
  poweredBy?: string;
  /** Mention fiscale du pays, par exemple § 19 UStG pour une petite entreprise allemande. */
  taxNote?: string;
  /** Titre du GiroCode : « Mit Banking-App scannen ». */
  scanToPay?: string;
};

const mm = (v: number) => (v * 72) / 25.4;
const INK = "#1b1a19";
const MUTED = "#67625c";
const LINE = "#cfcac4";
const LEFT = mm(20);
const RIGHT = mm(210 - 20);
const BOTTOM = mm(297 - 20);

function addressLines(p: PartySnapshot): string[] {
  const lines = [p.name];
  if (p.contactPerson) lines.push(p.contactPerson);
  if (p.street) lines.push(`${p.street} ${p.buildingNumber ?? ""}`.trim());
  if (p.postalCode || p.town)
    lines.push(
      `${p.country !== "CH" ? `${p.country}-` : ""}${p.postalCode ?? ""} ${p.town ?? ""}`.trim(),
    );
  return lines;
}

/** Données de la QR-facture, ou null si la facture ne peut pas en porter (montant nul, compte absent). */
export function qrBillData(invoice: Invoice) {
  if (invoice.kind !== "invoice") return null;
  const s = invoice.sender;
  if (countryPack(s?.country).paymentSlip !== "qr-bill") return null;
  const account = s?.qrIban ?? s?.iban;
  if (!s || !account || !s.street || !s.postalCode || !s.town || invoice.totalCents <= 0)
    return null;
  const r = invoice.recipient;
  const debtor =
    r?.street && r.postalCode && r.town
      ? {
          name: r.name,
          address: r.street,
          buildingNumber: r.buildingNumber ?? undefined,
          zip: r.postalCode,
          city: r.town,
          country: r.country,
        }
      : undefined;
  return {
    currency: invoice.currency === "EUR" ? ("EUR" as const) : ("CHF" as const),
    amount: invoice.totalCents / 100,
    creditor: {
      name: s.name,
      address: s.street,
      buildingNumber: s.buildingNumber ?? undefined,
      zip: s.postalCode,
      city: s.town,
      country: s.country,
      account,
    },
    debtor,
    reference: invoice.paymentReference ?? undefined,
    message: `${invoice.language === "fr" ? "Facture" : "Rechnung"} ${invoice.number ?? ""}`.trim(),
  };
}

/**
 * Contenu du GiroCode (EPC069-12, version 002) : virement SEPA en euros prêt à scanner. La référence
 * structurée RF passe dans son champ ; sinon le numéro de facture sert de motif.
 */
export function epcQrPayload(invoice: Invoice): string | null {
  const s = invoice.sender;
  if (invoice.kind !== "invoice" || invoice.currency !== "EUR" || invoice.totalCents <= 0)
    return null;
  if (!s?.iban || countryPack(s.country).paymentSlip !== "epc-qr") return null;
  const amount = (invoice.totalCents / 100).toFixed(2);
  if (invoice.totalCents > 99_999_999_999) return null;
  const reference = invoice.paymentReference?.startsWith("RF") ? invoice.paymentReference : "";
  const text = reference ? "" : `Rechnung ${invoice.number ?? ""}`.trim().slice(0, 140);
  return [
    "BCD",
    "002",
    "1",
    "SCT",
    "",
    s.name.slice(0, 70),
    s.iban.replace(/\s/g, ""),
    `EUR${amount}`,
    "",
    reference,
    text,
  ].join("\n");
}

/** Dessine un QR code en carrés vectoriels (pas d'image), zone de silence comprise. */
function drawQr(doc: PDFKit.PDFDocument, text: string, x: number, y: number, size: number) {
  const qr = QRCode.create(text, { errorCorrectionLevel: "M" });
  const n = qr.modules.size;
  const cell = size / (n + 8);
  doc.save().fillColor("#000000");
  for (let r = 0; r < n; r++)
    for (let c = 0; c < n; c++)
      if (qr.modules.get(r, c)) doc.rect(x + (c + 4) * cell, y + (r + 4) * cell, cell, cell);
  doc.fill().restore();
}

/**
 * PDF A4 de la facture émise : en-tête, adresse dans la fenêtre à droite (enveloppe C5/6 suisse),
 * lignes, récapitulatif TVA par taux, puis la section paiement QR au bas de la dernière page.
 */
export function renderInvoicePdf(
  invoice: Invoice,
  lines: InvoiceLine[],
  labels: InvoicePdfLabels,
): Promise<Buffer> {
  const doc = new PDFDocument({
    size: "A4",
    margins: { top: mm(20), bottom: mm(20), left: LEFT, right: mm(20) },
    info: {
      Title: `${labels.invoice} ${invoice.number ?? ""}`,
      Author: invoice.sender?.name ?? "",
      Creator: "InvoiceLead",
    },
    lang: invoice.language,
  });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  const sender = invoice.sender;
  const recipient = invoice.recipient;
  const style = countryPack(sender?.country).amounts;
  const fmt = (cents: number) => formatAmount(cents, style);
  doc.fillColor(INK);

  // Expéditeur
  if (sender) {
    const [name, ...rest] = addressLines(sender);
    doc
      .font("Helvetica-Bold")
      .fontSize(11)
      .text(name ?? "", LEFT, mm(18));
    doc.font("Helvetica").fontSize(9).fillColor(MUTED);
    for (const l of rest) doc.text(l);
    const contact = [sender.email, sender.phone].filter(Boolean).join("  ·  ");
    if (contact) doc.text(contact);
    if (sender.vatNumber) doc.text(sender.vatNumber);
    doc.fillColor(INK);
  }

  // Destinataire, dans la fenêtre à droite
  if (recipient) {
    const [name, ...rest] = addressLines(recipient);
    doc
      .font("Helvetica-Bold")
      .fontSize(10)
      .text(name ?? "", mm(118), mm(50), { width: mm(72) });
    doc.font("Helvetica").fontSize(10);
    for (const l of rest) doc.text(l, { width: mm(72) });
  }

  // Titre et dates
  doc
    .font("Helvetica-Bold")
    .fontSize(16)
    .text(`${invoice.title || labels.invoice} ${invoice.number ?? ""}`, LEFT, mm(92), {
      width: RIGHT - LEFT,
    });
  doc.moveDown(0.4).font("Helvetica").fontSize(9);
  const meta: [string, string][] = [
    [labels.issueDate, formatDate(invoice.issueDate)],
    [labels.serviceDate, formatDate(invoice.serviceDate)],
  ];
  if (invoice.kind !== "credit_note") meta.push([labels.dueDate, formatDate(invoice.dueDate)]);
  for (const [k, v] of meta) {
    const y = doc.y;
    doc.fillColor(MUTED).text(k, LEFT, y, { width: mm(40) });
    doc.fillColor(INK).text(v, LEFT + mm(40), y);
  }

  if (labels.relatedLine) doc.moveDown(0.4).text(labels.relatedLine, LEFT, doc.y);
  if (invoice.introText) {
    doc
      .moveDown(1)
      .fontSize(10)
      .text(invoice.introText, LEFT, doc.y, { width: RIGHT - LEFT });
  }

  // Lignes
  const withVat = invoice.vatRegistered;
  const cols = {
    amount: { x: RIGHT - mm(26), w: mm(26) },
    vat: { x: RIGHT - mm(26) - mm(16), w: mm(14) },
    price: { x: RIGHT - mm(26) - mm(16) - mm(26), w: mm(24) },
    qty: { x: RIGHT - mm(26) - mm(16) - mm(26) - mm(26), w: mm(24) },
  };
  const descWidth = cols.qty.x - LEFT - mm(3);
  const header = () => {
    const y = doc.y;
    doc.font("Helvetica-Bold").fontSize(8).fillColor(MUTED);
    doc.text(labels.description.toUpperCase(), LEFT, y, { width: descWidth });
    doc.text(labels.quantity.toUpperCase(), cols.qty.x, y, { width: cols.qty.w, align: "right" });
    doc.text(labels.unitPrice.toUpperCase(), cols.price.x, y, {
      width: cols.price.w,
      align: "right",
    });
    if (withVat)
      doc.text(labels.vat.toUpperCase(), cols.vat.x, y, { width: cols.vat.w, align: "right" });
    doc.text(labels.amount.toUpperCase(), cols.amount.x, y, {
      width: cols.amount.w,
      align: "right",
    });
    const after = y + 12;
    doc.moveTo(LEFT, after).lineTo(RIGHT, after).lineWidth(0.8).strokeColor(INK).stroke();
    doc.fillColor(INK).font("Helvetica").fontSize(9);
    doc.y = after + 5;
  };
  doc.moveDown(1.5);
  header();
  for (const l of lines) {
    const h = doc.heightOfString(l.description, { width: descWidth }) + 6;
    if (doc.y + h > BOTTOM) {
      doc.addPage();
      header();
    }
    const y = doc.y;
    doc.text(l.description, LEFT, y, { width: descWidth });
    const unit = labels.units[l.unit] ?? l.unit;
    doc.text(`${formatQuantity(l.quantityMilli)} ${unit}`, cols.qty.x, y, {
      width: cols.qty.w,
      align: "right",
    });
    doc.text(fmt(l.unitPriceCents), cols.price.x, y, {
      width: cols.price.w,
      align: "right",
    });
    if (withVat)
      doc.text(formatRate(l.vatRateBp, invoice.language), cols.vat.x, y, {
        width: cols.vat.w,
        align: "right",
      });
    doc.text(fmt(l.netCents), cols.amount.x, y, { width: cols.amount.w, align: "right" });
    const next = y + h;
    doc
      .moveTo(LEFT, next - 3)
      .lineTo(RIGHT, next - 3)
      .lineWidth(0.5)
      .strokeColor(LINE)
      .stroke();
    doc.y = next;
  }

  // Totaux
  const totals = computeTotals(lines);
  const rows: [string, string, boolean][] = [];
  if (withVat) {
    rows.push([labels.net, fmt(invoice.netCents), false]);
    for (const v of totals.vat.filter((x) => x.rateBp > 0))
      rows.push([
        labels.vatLine(formatRate(v.rateBp, invoice.language), fmt(v.netCents)),
        fmt(v.vatCents),
        false,
      ]);
  }
  rows.push([`${labels.total} ${invoice.currency}`, fmt(invoice.totalCents), true]);
  if (doc.y + rows.length * 14 + 20 > BOTTOM) doc.addPage();
  doc.moveDown(0.5);
  const labelX = RIGHT - mm(95);
  for (const [k, v, strong] of rows) {
    const y = doc.y;
    if (strong) {
      doc.moveTo(labelX, y).lineTo(RIGHT, y).lineWidth(0.8).strokeColor(INK).stroke();
      doc.y = y + 4;
    }
    const ty = doc.y;
    doc.font(strong ? "Helvetica-Bold" : "Helvetica").fontSize(strong ? 11 : 9);
    doc.text(k, labelX, ty, { width: mm(65) });
    doc.text(v, cols.amount.x, ty, { width: cols.amount.w, align: "right" });
    doc.moveDown(0.2);
  }

  doc.font("Helvetica").fontSize(9).fillColor(INK);
  if (invoice.footerText) {
    doc.moveDown(1.5).text(invoice.footerText, LEFT, doc.y, { width: RIGHT - LEFT });
  }
  const account = sender?.qrIban ?? sender?.iban;
  if (account && invoice.kind === "invoice") {
    doc
      .moveDown(1)
      .fillColor(MUTED)
      .text(labels.payTo(formatIban(account)), LEFT, doc.y);
    if (invoice.paymentReference)
      doc.text(labels.referenceLine(formatReference(invoice.paymentReference)));
    doc.fillColor(INK);
  }

  if (labels.taxNote) {
    doc
      .moveDown(1)
      .fontSize(9)
      .fillColor(INK)
      .text(labels.taxNote, LEFT, doc.y, {
        width: RIGHT - LEFT,
      });
  }

  const epc = epcQrPayload(invoice);
  if (epc) {
    const size = mm(32);
    if (doc.y + size + mm(10) > BOTTOM) doc.addPage();
    const top = doc.y + mm(4);
    drawQr(doc, epc, LEFT, top, size);
    if (labels.scanToPay)
      doc
        .fontSize(8)
        .fillColor(MUTED)
        .text(labels.scanToPay, LEFT + size + mm(4), top + mm(4), { width: mm(60) });
    doc.fillColor(INK).fontSize(9);
    doc.y = top + size;
  }

  if (labels.poweredBy) {
    doc.moveDown(1).fontSize(7).fillColor(MUTED).text(labels.poweredBy, LEFT, doc.y);
    doc.fillColor(INK).fontSize(9);
  }

  // Section paiement QR, au bas de la dernière page ou sur une page A4 à elle.
  const data = qrBillData(invoice);
  if (data) {
    const bill = new SwissQRBill(data, {
      language: invoice.language === "fr" ? "FR" : "DE",
    });
    if (!SwissQRBill.isSpaceSufficient(doc)) doc.addPage();
    bill.attachTo(doc);
  }

  doc.end();
  return done;
}
