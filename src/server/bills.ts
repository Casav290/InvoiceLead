import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { countryPack } from "@/countries";
import { VAT_CODES, type VatCode } from "@/countries/ch/vat";
import { chartPack } from "@/countries/charts";
import { parseAmountToCents } from "@/lib/amount-input";
import { CURRENCIES, toHome } from "@/lib/currencies";
import { type IncomingInvoice, parseIncomingInvoice } from "@/lib/einvoice-in";
import { addDays, isIsoDate } from "@/lib/fiscal-year";
import { roundHalfAwayFromZero } from "@/lib/money";
import { buildPain001, referenceKind } from "@/lib/pain001";
import { counterpartyKey, learnRule } from "./booking-rules";
import type { Db } from "./db";
import {
  accounts,
  auditLog,
  type BankProposal,
  type BankTransaction,
  bookingRules,
  organizations,
  receipts,
  type SupplierBill,
  supplierBills,
} from "./db/schema";
import { fetchFxRate } from "./fx";
import { appendEntry, LedgerError, type Posting, roleAccounts } from "./ledger";
import { uploadReceipt } from "./receipts";

type Who = { organizationId: string; userId: string };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IBAN = /^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/;

export type BillInput = {
  supplierName: string;
  supplierStreet: string | null;
  supplierPostalCode: string | null;
  supplierTown: string | null;
  supplierCountry: string | null;
  iban: string | null;
  bic: string | null;
  paymentReference: string | null;
  number: string | null;
  issueDate: string;
  dueDate: string;
  currency: string;
  totalCents: number;
  vatCode: VatCode | null;
  accountId: string | null;
  description: string | null;
};

const text = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const opt = (v: string) => (v === "" ? null : v);

/** IBAN valide (clé modulo 97), sans espaces et en majuscules ; null sinon. */
export function normalizeIban(value: string | null | undefined): string | null {
  const v = (value ?? "").replace(/\s/g, "").toUpperCase();
  if (!IBAN.test(v)) return null;
  const moved = `${v.slice(4)}${v.slice(0, 4)}`.replace(/[A-Z]/g, (c) =>
    String(c.charCodeAt(0) - 55),
  );
  let rest = 0;
  for (const d of moved) rest = (rest * 10 + Number(d)) % 97;
  return rest === 1 ? v : null;
}

export function parseBillForm(
  form: FormData,
): { ok: true; data: BillInput } | { ok: false; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const supplierName = text(form, "supplierName");
  if (!supplierName) errors.supplierName = "required";
  else if (supplierName.length > 140) errors.supplierName = "tooLong";
  const issueDate = text(form, "issueDate");
  if (!isIsoDate(issueDate)) errors.issueDate = "date";
  const dueDate = text(form, "dueDate") || (isIsoDate(issueDate) ? addDays(issueDate, 30) : "");
  if (!isIsoDate(dueDate)) errors.dueDate = "date";
  const totalCents = parseAmountToCents(text(form, "total"));
  if (!totalCents || totalCents <= 0) errors.total = "amount";
  const currency = text(form, "currency") || "CHF";
  if (!(CURRENCIES as readonly string[]).includes(currency)) errors.currency = "required";
  const ibanText = text(form, "iban");
  const iban = ibanText ? normalizeIban(ibanText) : null;
  if (ibanText && !iban) errors.iban = "iban";
  const vat = text(form, "vatCode");
  const vatCode = vat && (VAT_CODES as readonly string[]).includes(vat) ? (vat as VatCode) : null;
  const accountId = text(form, "accountId");
  const country = text(form, "supplierCountry").toUpperCase();
  if (country && !/^[A-Z]{2}$/.test(country)) errors.supplierCountry = "required";
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    data: {
      supplierName,
      supplierStreet: opt(text(form, "supplierStreet")),
      supplierPostalCode: opt(text(form, "supplierPostalCode")),
      supplierTown: opt(text(form, "supplierTown")),
      supplierCountry: opt(country),
      iban,
      bic: opt(text(form, "bic").replace(/\s/g, "").toUpperCase()),
      paymentReference: opt(text(form, "paymentReference")),
      number: opt(text(form, "number")),
      issueDate,
      dueDate,
      currency,
      totalCents: totalCents ?? 0,
      vatCode,
      accountId: UUID.test(accountId) ? accountId : null,
      description: opt(text(form, "description").slice(0, 200)),
    },
  };
}

/** Compte de charge appris pour ce fournisseur (règle bancaire des sorties), s'il existe. */
async function learnedAccount(database: Db, organizationId: string, supplier: string) {
  const key = counterpartyKey(supplier);
  if (!key) return null;
  const [rule] = await database
    .select({ accountId: bookingRules.accountId, vatCode: bookingRules.vatCode })
    .from(bookingRules)
    .where(
      and(
        eq(bookingRules.organizationId, organizationId),
        eq(bookingRules.counterpartyKey, key),
        eq(bookingRules.direction, "out"),
      ),
    );
  return rule ?? null;
}

export async function createBill(
  database: Db,
  who: Who,
  data: BillInput,
  origin: { source?: "manual" | "receipt" | "einvoice"; receiptId?: string | null } = {},
): Promise<SupplierBill> {
  const learned = data.accountId
    ? null
    : await learnedAccount(database, who.organizationId, data.supplierName);
  const [row] = await database
    .insert(supplierBills)
    .values({
      ...data,
      accountId: data.accountId ?? learned?.accountId ?? null,
      vatCode: data.vatCode ?? (learned?.vatCode as VatCode | null) ?? null,
      organizationId: who.organizationId,
      source: origin.source ?? "manual",
      receiptId: origin.receiptId ?? null,
      createdBy: who.userId,
    })
    .returning();
  if (!row) throw new Error("bill_not_saved");
  await database.insert(auditLog).values({
    organizationId: who.organizationId,
    userId: who.userId,
    action: "bill.create",
    entity: "bill",
    entityId: row.id,
    data: { source: row.source, totalCents: row.totalCents },
  });
  return row;
}

export async function updateBill(
  database: Db,
  who: Who,
  id: string,
  data: BillInput,
): Promise<SupplierBill | null> {
  if (!UUID.test(id)) return null;
  const [row] = await database
    .update(supplierBills)
    .set({ ...data, firstApprovedBy: null, updatedAt: new Date() })
    .where(
      and(
        eq(supplierBills.id, id),
        eq(supplierBills.organizationId, who.organizationId),
        eq(supplierBills.status, "draft"),
      ),
    )
    .returning();
  return row ?? null;
}

export async function deleteBill(database: Db, who: Who, id: string): Promise<boolean> {
  if (!UUID.test(id)) return false;
  const [row] = await database
    .delete(supplierBills)
    .where(
      and(
        eq(supplierBills.id, id),
        eq(supplierBills.organizationId, who.organizationId),
        eq(supplierBills.status, "draft"),
      ),
    )
    .returning();
  if (!row) return false;
  if (row.receiptId)
    await database
      .update(receipts)
      .set({ status: "read" })
      .where(and(eq(receipts.id, row.receiptId), eq(receipts.status, "billed")));
  return true;
}

export async function listBills(database: Db, organizationId: string) {
  return database
    .select()
    .from(supplierBills)
    .where(eq(supplierBills.organizationId, organizationId))
    .orderBy(
      sql`case ${supplierBills.status} when 'draft' then 0 when 'approved' then 1 when 'scheduled' then 2 else 3 end`,
      asc(supplierBills.dueDate),
    )
    .limit(500);
}

export async function getBill(database: Db, organizationId: string, id: string) {
  if (!UUID.test(id)) return null;
  const [row] = await database
    .select()
    .from(supplierBills)
    .where(and(eq(supplierBills.id, id), eq(supplierBills.organizationId, organizationId)));
  return row ?? null;
}

/** Facture à payer depuis un justificatif lu : fournisseur, montant, échéance, compte du créancier. */
export async function billFromReceipt(
  database: Db,
  who: Who,
  receiptId: string,
): Promise<SupplierBill | "notFound" | "unread" | "exists"> {
  if (!UUID.test(receiptId)) return "notFound";
  const [rc] = await database
    .select()
    .from(receipts)
    .where(and(eq(receipts.id, receiptId), eq(receipts.organizationId, who.organizationId)));
  if (!rc) return "notFound";
  const x = rc.extraction;
  if (!x?.totalCents || !x.date) return "unread";
  const [existing] = await database
    .select({ id: supplierBills.id })
    .from(supplierBills)
    .where(eq(supplierBills.receiptId, receiptId));
  if (existing) return "exists";
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
  const bill = await createBill(
    database,
    who,
    {
      supplierName: x.supplier ?? rc.filename,
      supplierStreet: null,
      supplierPostalCode: null,
      supplierTown: null,
      supplierCountry: null,
      iban: normalizeIban(x.iban),
      bic: null,
      paymentReference: x.paymentReference ?? null,
      number: x.invoiceNumber,
      issueDate: x.date,
      dueDate: x.dueDate && isIsoDate(x.dueDate) ? x.dueDate : addDays(x.date, 30),
      currency:
        x.currency && (CURRENCIES as readonly string[]).includes(x.currency) ? x.currency : "CHF",
      totalCents: x.totalCents,
      vatCode: (x.vatCode as VatCode | null) ?? null,
      accountId: account?.id ?? null,
      description: x.description,
    },
    { source: "receipt", receiptId },
  );
  // Le justificatif passe par la facture : il n'est plus rattaché seul à un mouvement bancaire.
  await database
    .update(receipts)
    .set({ status: "billed", bankTransactionId: null })
    .where(eq(receipts.id, receiptId));
  return bill;
}

/** Code TVA du pays de l'entreprise dont le taux, à cette date, est celui de la facture reçue. */
function vatCodeFor(country: string, percent: number | null, date: string): VatCode | null {
  if (!percent) return null;
  const pack = countryPack(country);
  for (const code of ["normal", "reduced", "lodging"] as const) {
    try {
      if (Math.abs(pack.vatRateBp(code, date) - percent * 100) < 1) return code;
    } catch {
      // pas de taux connu à cette date
    }
  }
  return null;
}

/** Fichier XML d'une e-facture, ou celui joint à un PDF ZUGFeRD / Factur-X. */
export async function einvoiceXml(file: { type: string; bytes: Buffer }): Promise<string | null> {
  if (file.type === "application/xml" || file.type === "text/xml")
    return file.bytes.toString("utf8");
  if (file.type !== "application/pdf") return null;
  try {
    const { getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(new Uint8Array(file.bytes));
    const attachments = await pdf.getAttachments();
    if (!attachments) return null;
    // Selon la version de pdf.js : un objet ou une Map, nom du fichier → contenu.
    const raw = attachments as unknown;
    const entries: [string, { content?: Uint8Array | null; filename?: string }][] =
      raw instanceof Map ? [...raw.entries()] : Object.entries(raw as Record<string, never>);
    for (const [name, a] of entries) {
      const filename = (a.filename ?? name).toLowerCase();
      if (filename.endsWith(".xml") && a.content) return Buffer.from(a.content).toString("utf8");
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Importe une facture électronique reçue (XML, ou PDF avec XML joint) : lue sans IA, archivée comme
 * justificatif, et devenue facture à payer. Un avoir du fournisseur n'est pas une facture à payer.
 */
export async function importEInvoice(
  database: Db,
  who: Who,
  file: { name: string; type: string; bytes: Buffer },
): Promise<SupplierBill | "notEInvoice" | "creditNote" | "duplicate" | "type" | "size"> {
  const xml = await einvoiceXml(file);
  const parsed: IncomingInvoice | null = xml ? parseIncomingInvoice(xml) : null;
  if (!parsed) return "notEInvoice";
  if (parsed.creditNote) return "creditNote";
  const stored = await uploadReceipt(database, who, {
    name: file.name,
    type: file.type === "text/xml" ? "application/xml" : file.type,
    bytes: file.bytes,
  });
  if (typeof stored === "string") return stored;
  const [org] = await database
    .select({ country: organizations.country })
    .from(organizations)
    .where(eq(organizations.id, who.organizationId));
  const vatCode = vatCodeFor(org?.country ?? "CH", parsed.vatPercent, parsed.issueDate);
  await database
    .update(receipts)
    .set({
      status: "billed",
      extraction: {
        supplier: parsed.supplierName,
        date: parsed.issueDate,
        totalCents: parsed.totalCents,
        currency: parsed.currency,
        vatCents: parsed.vatCents,
        vatCode,
        invoiceNumber: parsed.number,
        description: parsed.description,
        accountNumber: null,
        confidence: 1,
        dueDate: parsed.dueDate,
        iban: parsed.iban,
        paymentReference: parsed.paymentReference,
      },
    })
    .where(eq(receipts.id, stored.id));
  return createBill(
    database,
    who,
    {
      supplierName: parsed.supplierName.slice(0, 140),
      supplierStreet: parsed.supplierStreet,
      supplierPostalCode: parsed.supplierPostalCode,
      supplierTown: parsed.supplierTown,
      supplierCountry: parsed.supplierCountry,
      iban: normalizeIban(parsed.iban),
      bic: parsed.bic,
      paymentReference: parsed.paymentReference,
      number: parsed.number,
      issueDate: parsed.issueDate,
      dueDate: parsed.dueDate ?? addDays(parsed.issueDate, 30),
      currency: (CURRENCIES as readonly string[]).includes(parsed.currency)
        ? parsed.currency
        : "EUR",
      totalCents: parsed.totalCents,
      vatCode,
      accountId: null,
      description: parsed.description,
    },
    { source: "einvoice", receiptId: stored.id },
  );
}

/** Écriture d'une facture approuvée : charge et impôt préalable contre fournisseurs, en monnaie de l'entreprise. */
async function billPostings(
  database: Db,
  bill: SupplierBill,
  fxRate: number | null,
): Promise<Posting[]> {
  const roles = await roleAccounts(database, bill.organizationId);
  if (!roles.payable || !bill.accountId) throw new LedgerError("noChart");
  const [account] = await database
    .select()
    .from(accounts)
    .where(and(eq(accounts.id, bill.accountId), eq(accounts.organizationId, bill.organizationId)));
  if (!account) throw new LedgerError("noAccount");
  const [org] = await database
    .select({
      vatRegistered: organizations.vatRegistered,
      vatMethod: organizations.vatMethod,
      country: organizations.country,
    })
    .from(organizations)
    .where(eq(organizations.id, bill.organizationId));
  const total = toHome(bill.totalCents, fxRate);
  const rate =
    bill.vatCode && org?.vatRegistered && org.vatMethod === "effective" && org.country !== "US"
      ? countryPack(org.country).vatRateBp(bill.vatCode as VatCode, bill.issueDate)
      : 0;
  if (rate === 0)
    return [
      { accountId: account.id, amountCents: total },
      { accountId: roles.payable, amountCents: -total },
    ];
  const vat = roundHalfAwayFromZero((total * rate) / (10_000 + rate)) + 0;
  const net = total - vat;
  const vatAccount = roles[chartPack(org?.country).inputVatRole(account)];
  if (!vatAccount) throw new LedgerError("noChart");
  return [
    { accountId: account.id, amountCents: net, vatRateBp: rate },
    { accountId: vatAccount, amountCents: vat, vatRateBp: rate, vatBaseCents: net },
    { accountId: roles.payable, amountCents: -total },
  ];
}

export type ApproveResult =
  | SupplierBill
  | "notFound"
  | "noAccount"
  | "sameApprover"
  | "fxRate"
  | "noChart"
  | "noFiscalYear"
  | "vatPeriodClosed";

/**
 * Approuve une facture fournisseur. Avec la double validation, il faut deux personnes différentes ;
 * la seconde approbation comptabilise la facture (charge contre fournisseurs) et apprend le compte.
 */
export async function approveBill(
  database: Db,
  who: Who,
  id: string,
  fetcher?: typeof fetch,
): Promise<ApproveResult> {
  const bill = await getBill(database, who.organizationId, id);
  if (bill?.status !== "draft") return "notFound";
  if (!bill.accountId) return "noAccount";
  const [org] = await database
    .select({ dualApproval: organizations.dualApproval, currency: organizations.currency })
    .from(organizations)
    .where(eq(organizations.id, who.organizationId));
  if (org?.dualApproval && !bill.firstApprovedBy) {
    const [first] = await database
      .update(supplierBills)
      .set({ firstApprovedBy: who.userId, updatedAt: new Date() })
      .where(and(eq(supplierBills.id, id), eq(supplierBills.status, "draft")))
      .returning();
    await database.insert(auditLog).values({
      organizationId: who.organizationId,
      userId: who.userId,
      action: "bill.approve_first",
      entity: "bill",
      entityId: id,
    });
    return first ?? "notFound";
  }
  if (org?.dualApproval && bill.firstApprovedBy === who.userId) return "sameApprover";
  let fxRate: number | null = null;
  if (bill.currency !== org?.currency) {
    fxRate = await fetchFxRate(bill.currency, org?.currency ?? "CHF", bill.issueDate, fetcher);
    if (!fxRate) return "fxRate";
  }
  try {
    const approved = await database.transaction(async (tx) => {
      const tdb = tx as unknown as Db;
      const [locked] = await tx
        .select()
        .from(supplierBills)
        .where(eq(supplierBills.id, id))
        .for("update");
      if (locked?.status !== "draft") throw new LedgerError("already");
      const entry = await appendEntry(tdb, who, {
        entryDate: bill.issueDate,
        description:
          `Kreditor / Fournisseur ${bill.supplierName}${bill.number ? ` ${bill.number}` : ""}`.slice(
            0,
            200,
          ),
        sourceType: "bill",
        sourceId: bill.id,
        postings: await billPostings(tdb, bill, fxRate),
      });
      const [row] = await tx
        .update(supplierBills)
        .set({
          status: "approved",
          fxRate,
          approvedBy: who.userId,
          approvedAt: new Date(),
          journalEntryId: entry.id,
          updatedAt: new Date(),
        })
        .where(eq(supplierBills.id, id))
        .returning();
      if (bill.receiptId)
        await tx
          .update(receipts)
          .set({ journalEntryId: entry.id })
          .where(eq(receipts.id, bill.receiptId));
      await tx.insert(auditLog).values({
        organizationId: who.organizationId,
        userId: who.userId,
        action: "bill.approve",
        entity: "bill",
        entityId: id,
        data: { totalCents: bill.totalCents },
      });
      return row;
    });
    if (!approved) return "notFound";
    await learnRule(database, who, {
      counterparty: bill.supplierName,
      amountCents: -bill.totalCents,
      accountId: bill.accountId,
      vatCode: bill.vatCode,
    });
    return approved;
  } catch (e) {
    if (e instanceof LedgerError) {
      if (e.message === "noFiscalYear") return "noFiscalYear";
      if (e.message === "vatPeriodClosed") return "vatPeriodClosed";
      if (e.message === "already") return "notFound";
      return "noChart";
    }
    throw e;
  }
}

/**
 * Fichier pain.001 des factures approuvées choisies (toutes par défaut), à charger dans l'e-banking.
 * Chaque facture passe à « paiement transmis » ; elle sera soldée quand le relevé montrera le débit.
 */
export async function exportPayments(
  database: Db,
  who: Who,
  ids: string[] | null,
  today = new Date().toISOString().slice(0, 10),
): Promise<{ xml: string; count: number } | "none" | "noIban"> {
  const [org] = await database
    .select()
    .from(organizations)
    .where(eq(organizations.id, who.organizationId));
  const debtorIban = normalizeIban(org?.iban);
  if (!org || !debtorIban) return "noIban";
  const rows = await database
    .select()
    .from(supplierBills)
    .where(
      and(
        eq(supplierBills.organizationId, who.organizationId),
        eq(supplierBills.status, "approved"),
        ...(ids
          ? [
              inArray(
                supplierBills.id,
                ids.filter((i) => UUID.test(i)),
              ),
            ]
          : []),
      ),
    )
    .orderBy(asc(supplierBills.dueDate));
  const payable = rows.filter((b) => normalizeIban(b.iban));
  if (payable.length === 0) return "none";
  const stamp = new Date();
  const xml = buildPain001({
    messageId: `IL-${stamp.toISOString().replace(/\D/g, "").slice(0, 14)}`,
    createdAt: stamp,
    debtorName: org.legalName ?? org.name,
    debtorIban,
    debtorCountry: org.country,
    payments: payable.map((b) => ({
      id: b.id.replace(/-/g, "").slice(0, 32),
      amountCents: b.totalCents,
      currency: b.currency,
      executionDate: b.dueDate < today ? today : b.dueDate,
      creditorName: b.supplierName,
      creditorStreet: b.supplierStreet,
      creditorPostalCode: b.supplierPostalCode,
      creditorTown: b.supplierTown,
      creditorCountry: b.supplierCountry,
      iban: normalizeIban(b.iban) ?? "",
      bic: b.bic,
      reference: b.paymentReference,
      message: b.number ? `${b.number}` : null,
    })),
  });
  await database
    .update(supplierBills)
    .set({ status: "scheduled", exportedAt: stamp, updatedAt: stamp })
    .where(
      inArray(
        supplierBills.id,
        payable.map((b) => b.id),
      ),
    );
  await database.insert(auditLog).values({
    organizationId: who.organizationId,
    userId: who.userId,
    action: "bill.export",
    entity: "organization",
    entityId: who.organizationId,
    data: { count: payable.length },
  });
  return { xml, count: payable.length };
}

/** Écriture du paiement : fournisseurs contre banque (ou caisse), écart de change compris. */
async function paymentPostings(
  database: Db,
  bill: SupplierBill,
  paidHomeCents: number,
  money: "bank" | "cash",
): Promise<Posting[]> {
  const roles = await roleAccounts(database, bill.organizationId);
  const account = money === "cash" ? roles.cash : roles.bank;
  if (!account || !roles.payable) throw new LedgerError("noChart");
  const due = toHome(bill.totalCents, bill.fxRate);
  const diff = paidHomeCents - due;
  const exchange =
    diff < 0 ? (roles.exchange_gain ?? roles.exchange_difference) : roles.exchange_difference;
  if (diff !== 0 && !exchange) throw new LedgerError("noChart");
  return [
    { accountId: roles.payable, amountCents: due },
    { accountId: account, amountCents: -paidHomeCents },
    ...(diff !== 0 && exchange ? [{ accountId: exchange, amountCents: diff }] : []),
  ];
}

async function settle(
  database: Db,
  who: Who,
  bill: SupplierBill,
  paidOn: string,
  paidHomeCents: number,
  money: "bank" | "cash",
  bankTransactionId: string | null,
) {
  return database.transaction(async (tx) => {
    const tdb = tx as unknown as Db;
    const [locked] = await tx
      .select()
      .from(supplierBills)
      .where(eq(supplierBills.id, bill.id))
      .for("update");
    if (!locked || !["approved", "scheduled"].includes(locked.status))
      throw new LedgerError("already");
    const entry = await appendEntry(tdb, who, {
      entryDate: paidOn,
      description: `Zahlung Kreditor / Paiement fournisseur ${bill.supplierName}`.slice(0, 200),
      sourceType: "bill_payment",
      sourceId: bill.id,
      postings: await paymentPostings(tdb, locked, paidHomeCents, money),
    });
    await tx
      .update(supplierBills)
      .set({
        status: "paid",
        paidOn,
        paymentEntryId: entry.id,
        bankTransactionId,
        updatedAt: new Date(),
      })
      .where(eq(supplierBills.id, bill.id));
    await tx.insert(auditLog).values({
      organizationId: who.organizationId,
      userId: who.userId,
      action: "bill.paid",
      entity: "bill",
      entityId: bill.id,
      data: { paidOn, amountCents: paidHomeCents },
    });
    return entry;
  });
}

/** Paiement noté à la main (caisse, ou banque sans relevé importé), au cours de la facture. */
export async function markBillPaid(
  database: Db,
  who: Who,
  id: string,
  paidOn: string,
  money: "bank" | "cash",
): Promise<"paid" | "notFound" | "noChart" | "noFiscalYear" | "vatPeriodClosed"> {
  const bill = await getBill(database, who.organizationId, id);
  if (!bill || !["approved", "scheduled"].includes(bill.status) || !isIsoDate(paidOn))
    return "notFound";
  try {
    await settle(database, who, bill, paidOn, toHome(bill.totalCents, bill.fxRate), money, null);
    return "paid";
  } catch (e) {
    if (e instanceof LedgerError) {
      if (e.message === "noFiscalYear") return "noFiscalYear";
      if (e.message === "vatPeriodClosed") return "vatPeriodClosed";
      if (e.message === "already") return "notFound";
      return "noChart";
    }
    throw e;
  }
}

/** Débit du relevé reconnu comme le paiement d'une facture fournisseur : la facture est soldée. */
export async function payBillFromBank(database: Db, who: Who, tx: BankTransaction, billId: string) {
  const bill = await getBill(database, who.organizationId, billId);
  if (!bill || !["approved", "scheduled"].includes(bill.status)) throw new LedgerError("already");
  return settle(database, who, bill, tx.bookingDate, -tx.amountCents, "bank", tx.id);
}

const compactRef = (v: string | null) => (v ?? "").replace(/\s/g, "").toUpperCase();

/**
 * Propositions de paiement fournisseur pour les sorties du relevé : même référence de paiement
 * (sûre), ou même montant chez le même fournisseur pour une facture dans la monnaie du compte.
 */
export async function billProposals(
  database: Db,
  organizationId: string,
  pending: BankTransaction[],
  language: "de" | "fr" | "en",
): Promise<Map<string, BankProposal>> {
  const out = new Map<string, BankProposal>();
  const outgoing = pending.filter((t) => t.amountCents < 0);
  if (outgoing.length === 0) return out;
  const open = await database
    .select()
    .from(supplierBills)
    .where(
      and(
        eq(supplierBills.organizationId, organizationId),
        inArray(supplierBills.status, ["approved", "scheduled"]),
        isNull(supplierBills.bankTransactionId),
      ),
    )
    .orderBy(desc(supplierBills.dueDate));
  const used = new Set<string>();
  const say = (fr: string, de: string, en: string) =>
    language === "fr" ? fr : language === "en" ? en : de;
  for (const t of outgoing) {
    const ref = compactRef(t.reference);
    const byRef = ref
      ? open.find(
          (b) =>
            !used.has(b.id) &&
            referenceKind(b.paymentReference) &&
            compactRef(b.paymentReference) === ref,
        )
      : undefined;
    const byAmount =
      byRef ??
      open.find(
        (b) =>
          !used.has(b.id) &&
          b.currency === t.currency &&
          b.totalCents === -t.amountCents &&
          counterpartyKey(b.supplierName) !== null &&
          counterpartyKey(b.supplierName) === counterpartyKey(t.counterparty),
      );
    const bill = byRef ?? byAmount;
    if (!bill) continue;
    used.add(bill.id);
    out.set(t.id, {
      kind: "bill",
      billId: bill.id,
      confidence: byRef ? 1 : 0.97,
      source: byRef ? "reference" : "ai",
      explanation: byRef
        ? say(
            `Référence de paiement de la facture ${bill.number ?? ""} de ${bill.supplierName}.`,
            `Zahlungsreferenz der Rechnung ${bill.number ?? ""} von ${bill.supplierName}.`,
            `Payment reference of invoice ${bill.number ?? ""} from ${bill.supplierName}.`,
          )
        : say(
            `Même montant que la facture ${bill.number ?? ""} de ${bill.supplierName}.`,
            `Gleicher Betrag wie die Rechnung ${bill.number ?? ""} von ${bill.supplierName}.`,
            `Same amount as invoice ${bill.number ?? ""} from ${bill.supplierName}.`,
          ),
    });
  }
  return out;
}
