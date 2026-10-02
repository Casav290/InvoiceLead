import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, gte, inArray, isNull, lte } from "drizzle-orm";
import { VAT_CODES } from "@/countries/ch/vat";
import { addDays, isIsoDate } from "@/lib/fiscal-year";
import { aiLanguageName, chatJson } from "./ai";
import type { Db } from "./db";
import {
  accounts,
  auditLog,
  bankTransactions,
  organizations,
  type Receipt,
  type ReceiptExtraction,
  receipts,
} from "./db/schema";
import { consumeQuota, refundQuota } from "./plans";
import { getFile, putFile } from "./storage";

type Who = { organizationId: string; userId: string };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const RECEIPT_TYPES: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  // Facture électronique reçue (XRechnung, UBL) : archivée, lue sans IA par les factures fournisseurs.
  "application/xml": "xml",
};
export const MAX_RECEIPT_BYTES = 10_000_000;

export async function uploadReceipt(
  database: Db,
  who: Who,
  file: { name: string; type: string; bytes: Buffer },
): Promise<Receipt | "type" | "size" | "duplicate"> {
  const ext = RECEIPT_TYPES[file.type];
  if (!ext) return "type";
  if (file.bytes.length === 0 || file.bytes.length > MAX_RECEIPT_BYTES) return "size";
  const sha256 = createHash("sha256").update(file.bytes).digest("hex");
  const [existing] = await database
    .select({ id: receipts.id })
    .from(receipts)
    .where(and(eq(receipts.organizationId, who.organizationId), eq(receipts.sha256, sha256)));
  if (existing) return "duplicate";
  const key = `${who.organizationId}/receipts/${randomUUID()}.${ext}`;
  await putFile(database, who.organizationId, key, file.bytes, file.type);
  const [row] = await database
    .insert(receipts)
    .values({
      organizationId: who.organizationId,
      fileKey: key,
      filename: file.name.replace(/[^\p{L}\p{N}._ -]/gu, "_").slice(0, 120) || `receipt.${ext}`,
      contentType: file.type,
      sizeBytes: file.bytes.length,
      sha256,
      uploadedBy: who.userId,
    })
    .returning();
  if (!row) throw new Error("receipt_not_saved");
  await database.insert(auditLog).values({
    organizationId: who.organizationId,
    userId: who.userId,
    action: "receipt.upload",
    entity: "receipt",
    entityId: row.id,
  });
  return row;
}

export async function listReceipts(database: Db, organizationId: string) {
  return database
    .select()
    .from(receipts)
    .where(eq(receipts.organizationId, organizationId))
    .orderBy(desc(receipts.createdAt))
    .limit(300);
}

export async function receiptFile(database: Db, organizationId: string, id: string) {
  if (!UUID.test(id)) return null;
  const [row] = await database
    .select()
    .from(receipts)
    .where(and(eq(receipts.id, id), eq(receipts.organizationId, organizationId)));
  if (!row) return null;
  const file = await getFile(database, organizationId, row.fileKey);
  return file ? { ...file, filename: row.filename } : null;
}

/** Texte d'un PDF « natif » ; vide pour un PDF scanné (qui n'est qu'une image). */
async function pdfText(bytes: Buffer): Promise<string> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const { text } = await extractText(pdf, { mergePages: true });
  return (Array.isArray(text) ? text.join("\n") : text).trim();
}

function toCents(v: unknown): number | null {
  const n =
    typeof v === "number"
      ? v
      : Number(
          String(v ?? "")
            .replace(/['’\s]/g, "")
            .replace(",", "."),
        );
  return Number.isFinite(n) && n >= 0 && n < 100_000_000 ? Math.round(n * 100) : null;
}

/** Lit un justificatif avec l'assistant, puis le rattache au mouvement bancaire qui le paie. */
export async function readReceipt(
  database: Db,
  who: Who,
  id: string,
  language: "de" | "fr" | "en",
): Promise<"read" | ReadFailure> {
  const result = await extractReceipt(database, who, id, language);
  if (typeof result === "string") return result;
  await matchReceipts(database, who, language);
  return "read";
}

/** Lecture impossible : pièce introuvable, illisible, panne de l'IA, ou lectures du mois épuisées. */
export type ReadFailure = "notFound" | "unreadable" | "failed" | "quota";

/**
 * Lit un justificatif avec l'assistant (texte pour un PDF natif, image sinon) et garde ce qui a été
 * lu. Sans rapprochement bancaire : un ticket de note de frais a été payé de la poche de quelqu'un.
 *
 * Chaque lecture par l'IA compte dans les lectures du mois de la formule (Gratuit 20, Pro 50, Pro+
 * 300), qu'elle vienne d'un ticket, de la boîte des justificatifs ou d'une relecture. L'unité est
 * réservée juste avant l'appel à l'IA et rendue si l'IA ne répond pas.
 */
export async function extractReceipt(
  database: Db,
  who: Who,
  id: string,
  language: "de" | "fr" | "en",
  today = new Date().toISOString().slice(0, 10),
): Promise<ReceiptExtraction | ReadFailure> {
  if (!UUID.test(id)) return "notFound";
  const [row] = await database
    .select()
    .from(receipts)
    .where(and(eq(receipts.id, id), eq(receipts.organizationId, who.organizationId)));
  if (!row || row.status === "posted" || row.status === "billed") return "notFound";
  if (row.contentType === "application/xml") return "unreadable";
  const file = await getFile(database, who.organizationId, row.fileKey);
  if (!file) return "notFound";
  const [org] = await database
    .select({
      id: organizations.id,
      country: organizations.country,
      leadPlan: organizations.leadPlan,
      entitlements: organizations.entitlements,
      entitlementsAt: organizations.entitlementsAt,
    })
    .from(organizations)
    .where(eq(organizations.id, who.organizationId));
  if (!org) return "notFound";
  const germany = org.country === "DE";
  const france = org.country === "FR";
  const uk = org.country === "GB";
  const chart = await database
    .select({
      number: accounts.number,
      nameDe: accounts.nameDe,
      type: accounts.type,
      role: accounts.role,
    })
    .from(accounts)
    .where(and(eq(accounts.organizationId, who.organizationId), eq(accounts.active, true)));
  const expenseChart = chart
    .filter((a) => a.type === "expense" || (a.type === "asset" && !a.role))
    .map((a) => `${a.number} ${a.nameDe}`)
    .join("\n");

  const instructions = [
    "You read supplier invoices and receipts (Switzerland, Germany, France, the UK or the US) for bookkeeping.",
    'Answer with JSON only: {"supplier":"...","date":"YYYY-MM-DD","total":"123.45","currency":"CHF","vat":"8.07","vat_code":"normal|reduced|lodging|exempt|null","invoice_number":"...","description":"...","account":"6510","due_date":"YYYY-MM-DD","iban":"CH...","payment_reference":"...","confidence":0.9}',
    "due_date, iban and payment_reference come from the payment terms or the payment slip (Swiss QR-bill payment part, SEPA details): the creditor account, the QR or RF reference. Use null when absent.",
    germany
      ? "total is the amount to pay including VAT. vat is the VAT amount shown (null if none). vat_code: German VAT rate applied (19 % normal, 7 % reduced)."
      : france
        ? "total is the amount to pay including VAT. vat is the VAT amount shown (null if none). vat_code: French VAT rate applied (20 % normal, 10 % lodging, 5.5 % reduced)."
        : uk
          ? "total is the amount to pay including VAT. vat is the VAT amount shown (null if none). vat_code: UK VAT rate applied (20 % normal, 5 % reduced)."
          : "total is the amount to pay including VAT. vat is the VAT amount shown (null if none). vat_code: Swiss VAT rate applied (8.1 % normal, 2.6 % reduced, 3.8 % lodging).",
    `description: a few words in ${aiLanguageName(language)}. account: the best expense account from this chart:`,
    expenseChart,
    "confidence: your probability (0 to 1) that total, date and account are right.",
  ].join("\n");

  let messages: Parameters<typeof chatJson>[0];
  const vision = file.contentType !== "application/pdf";
  if (!vision) {
    let text = "";
    try {
      text = await pdfText(file.bytes);
    } catch (e) {
      console.error("[receipt] PDF illisible", e instanceof Error ? e.message : "inconnu");
    }
    if (text.length < 20) {
      await database.update(receipts).set({ status: "error" }).where(eq(receipts.id, id));
      return "unreadable";
    }
    messages = [
      { role: "system", content: instructions },
      { role: "user", content: text.slice(0, 12_000) },
    ];
  } else {
    messages = [
      { role: "system", content: instructions },
      {
        role: "user",
        content: [
          { type: "text", text: "Read this receipt." },
          {
            type: "image_url",
            image_url: {
              url: `data:${file.contentType};base64,${file.bytes.toString("base64")}`,
            },
          },
        ],
      },
    ];
  }
  // Lecture comptée avant l'appel ; refusée au-delà de l'allocation du mois. Réservation et
  // remboursement tombent sur le même mois, même si l'IA répond après minuit.
  if (!(await consumeQuota(database, org, "aiReads", today)).allowed) return "quota";
  let raw: unknown;
  try {
    raw = await chatJson(messages, vision ? { vision: true } : undefined);
  } catch (e) {
    console.error("[receipt] lecture impossible", e instanceof Error ? e.message : "inconnu");
    await refundQuota(database, org.id, "aiReads", today);
    await database.update(receipts).set({ status: "error" }).where(eq(receipts.id, id));
    return "failed";
  }

  const r = (raw ?? {}) as Record<string, unknown>;
  const str = (v: unknown, max: number) =>
    typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;
  const date = str(r.date, 10);
  const account = str(r.account, 8);
  const due = str(r.due_date, 10);
  const extraction: ReceiptExtraction = {
    supplier: str(r.supplier, 100),
    date: date && isIsoDate(date) ? date : null,
    totalCents: toCents(r.total),
    currency: str(r.currency, 3)?.toUpperCase() ?? "CHF",
    vatCents: r.vat === null ? null : toCents(r.vat),
    vatCode:
      typeof r.vat_code === "string" && (VAT_CODES as readonly string[]).includes(r.vat_code)
        ? r.vat_code
        : null,
    invoiceNumber: str(r.invoice_number, 60),
    description: str(r.description, 200),
    accountNumber: account && chart.some((a) => a.number === account) ? account : null,
    confidence: Math.max(0, Math.min(1, Number(r.confidence) || 0)),
    dueDate: due && isIsoDate(due) ? due : null,
    iban: str(r.iban, 40)?.replace(/\s/g, "").toUpperCase() ?? null,
    paymentReference: str(r.payment_reference, 40),
  };
  await database.update(receipts).set({ extraction, status: "read" }).where(eq(receipts.id, id));
  return extraction;
}

/**
 * Rattache chaque justificatif lu au mouvement bancaire qui le paie (même montant, payé entre 5 jours
 * avant et 60 jours après sa date), et en fait la proposition de ce mouvement.
 */
export async function matchReceipts(database: Db, who: Who, language: "de" | "fr" | "en") {
  const open = await database
    .select()
    .from(receipts)
    .where(
      and(
        eq(receipts.organizationId, who.organizationId),
        eq(receipts.status, "read"),
        isNull(receipts.bankTransactionId),
      ),
    );
  let matched = 0;
  for (const rc of open) {
    const x = rc.extraction;
    if (!x?.totalCents || !x.date) continue;
    const [tx] = await database
      .select()
      .from(bankTransactions)
      .where(
        and(
          eq(bankTransactions.organizationId, who.organizationId),
          eq(bankTransactions.amountCents, -x.totalCents),
          inArray(bankTransactions.status, ["new", "proposed"]),
          gte(bankTransactions.bookingDate, addDays(x.date, -5)),
          lte(bankTransactions.bookingDate, addDays(x.date, 60)),
        ),
      )
      .orderBy(bankTransactions.bookingDate)
      .limit(1);
    if (!tx) continue;
    const [linked] = await database
      .select({ id: receipts.id })
      .from(receipts)
      .where(eq(receipts.bankTransactionId, tx.id));
    if (linked) continue;
    await database
      .update(receipts)
      .set({ bankTransactionId: tx.id, status: "matched" })
      .where(eq(receipts.id, rc.id));
    matched += 1;

    // Le justificatif précise la proposition : fournisseur, compte, TVA effectivement facturée.
    const [account] = x.accountNumber
      ? await database
          .select({ id: accounts.id })
          .from(accounts)
          .where(
            and(
              eq(accounts.organizationId, who.organizationId),
              eq(accounts.number, x.accountNumber),
            ),
          )
      : [];
    const current = tx.proposal?.confidence ?? 0;
    const confidence = Math.min(0.97, Math.max(x.confidence, 0.5) + 0.05);
    if (
      account &&
      (tx.proposal?.kind !== "account" || tx.proposal.source === "ai" || current < confidence)
    ) {
      await database
        .update(bankTransactions)
        .set({
          status: "proposed",
          proposal: {
            kind: "account",
            accountId: account.id,
            vatCode: x.vatCode,
            confidence,
            explanation:
              language === "fr"
                ? `Justificatif de ${x.supplier ?? "fournisseur"}${x.invoiceNumber ? `, facture ${x.invoiceNumber}` : ""}${x.description ? ` : ${x.description}` : ""}.`
                : `Beleg von ${x.supplier ?? "Lieferant"}${x.invoiceNumber ? `, Rechnung ${x.invoiceNumber}` : ""}${x.description ? `: ${x.description}` : ""}.`,
            source: "receipt",
          },
        })
        .where(eq(bankTransactions.id, tx.id));
    }
  }
  return matched;
}
