import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { CHART_TEMPLATES } from "@/countries/ch/chart-of-accounts";
import { VAT_CODES } from "@/countries/ch/vat";
import { periodsBetween } from "@/countries/ch/vat-return";
import { chartPack } from "@/countries/charts";
import { accountName } from "@/lib/account-name";
import { parseAmountToCents } from "@/lib/amount-input";
import {
  type AccountInput,
  createAccount,
  createFirstFiscalYear,
  getAccount,
  installChart,
  listFiscalYears,
  openNextFiscalYear,
  parseAccountForm,
  updateAccount,
} from "../accounting";
import { aiConfigured } from "../ai";
import { toForm } from "../api";
import {
  approveBill,
  billFromReceipt,
  createBill,
  getBill,
  parseBillForm,
  updateBill,
} from "../bills";
import { closeFiscalYear } from "../closing";
import {
  LEGAL_FORMS,
  parseCompanyForm,
  saveCompanySettings,
  VAT_METHODS,
  VAT_SETTLEMENTS,
} from "../company";
import type { Organization, SupplierBill } from "../db/schema";
import { fiscalYears, organizations, receipts } from "../db/schema";
import { postPending } from "../ledger";
import { featureAccess, quotaAccess } from "../plans";
import { readReceipt } from "../receipts";
import { saveReminderSettings } from "../reminders";
import { listVatReturns, validateVatReturn } from "../vat-return";
import {
  type AssistantContext,
  amountText,
  changes,
  dateField,
  defineOp,
  enumField,
  fail,
  filled,
  formValue,
  moneyField,
  type OpOutcome,
  type SummaryField,
  text,
  who,
} from "./ops-core";

/**
 * Opérations de la comptabilité et des réglages : factures fournisseurs (saisie, modification,
 * approbation, depuis un justificatif), comptabilisation, lecture d'un justificatif, décompte TVA,
 * plan comptable, exercices, réglages de l'entreprise et des relances. Mêmes fonctions et mêmes
 * droits que les actions serveur de ces écrans.
 */

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .describe("YYYY-MM-DD");
const amount = z.union([z.string().max(20), z.number()]);
type Json = Record<string, unknown>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Factures fournisseurs

const billFields = {
  supplierName: z.string().max(140).optional(),
  supplierStreet: z.string().max(70).optional(),
  supplierPostalCode: z.string().max(16).optional(),
  supplierTown: z.string().max(35).optional(),
  supplierCountry: z.string().length(2).optional().describe("ISO country code, e.g. CH, DE"),
  iban: z.string().max(40).optional(),
  bic: z.string().max(11).optional(),
  paymentReference: z.string().max(40).optional(),
  number: z.string().max(60).optional().describe("the supplier's invoice number"),
  issueDate: isoDate.optional(),
  dueDate: isoDate.optional().describe("default 30 days after the issue date"),
  currency: z.enum(["CHF", "EUR", "USD", "GBP"]).optional().describe("default company currency"),
  total: amount.optional().describe("amount to pay, VAT included, in units"),
  vatCode: z.enum(VAT_CODES).optional(),
  accountId: z.string().optional().describe("expense account id from list_accounts"),
  description: z.string().max(200).optional(),
};

const BILL_KEYS = Object.keys(billFields) as (keyof typeof billFields)[];

function billForm(b: SupplierBill): Json {
  return {
    supplierName: b.supplierName,
    supplierStreet: b.supplierStreet ?? "",
    supplierPostalCode: b.supplierPostalCode ?? "",
    supplierTown: b.supplierTown ?? "",
    supplierCountry: b.supplierCountry ?? "",
    iban: b.iban ?? "",
    bic: b.bic ?? "",
    paymentReference: b.paymentReference ?? "",
    number: b.number ?? "",
    issueDate: b.issueDate,
    dueDate: b.dueDate,
    currency: b.currency,
    total: (b.totalCents / 100).toFixed(2),
    vatCode: b.vatCode ?? "",
    accountId: b.accountId ?? "",
    description: b.description ?? "",
  };
}

function billPatch(input: Json): Json {
  const out: Json = {};
  for (const k of BILL_KEYS)
    if (input[k] !== undefined) out[k] = k === "total" ? amountText(input[k]) : formValue(input[k]);
  return out;
}

async function accountLabel(ctx: AssistantContext, id: string | null | undefined) {
  if (!id) return "";
  const a = await getAccount(ctx.database, ctx.organization.id, id);
  if (!a) return "";
  return `${a.number} ${accountName(a, ctx.locale)}`;
}

/**
 * Ce que la carte montre d'une facture fournisseur : tout ce que son formulaire enregistre, dont
 * où ira le paiement (IBAN, BIC, référence) et la devise.
 */
async function billFieldsOf(ctx: AssistantContext, b: SupplierBill): Promise<SummaryField[]> {
  const address = [
    b.supplierStreet ?? "",
    [b.supplierPostalCode, b.supplierTown].filter(Boolean).join(" "),
  ]
    .filter(Boolean)
    .join(", ");
  return filled([
    text("supplier", b.supplierName),
    text("supplierAddress", address),
    { key: "supplierCountry", value: b.supplierCountry ?? "" },
    text("supplierInvoice", b.number),
    dateField("issueDate", b.issueDate),
    dateField("dueDate", b.dueDate),
    text("currency", b.currency),
    moneyField("total", b.totalCents, b.currency),
    enumField("vatCode", b.vatCode),
    text("account", await accountLabel(ctx, b.accountId)),
    text("iban", b.iban),
    text("bic", b.bic),
    text("paymentReference", b.paymentReference),
    text("description", b.description),
  ]);
}

/** Règle de l'action saveBillAction : une facture en devise étrangère est de la formule Pro. */
function currencyAllowed(org: Organization, currency: string, stored?: SupplierBill | null) {
  return (
    currency === org.currency ||
    featureAccess(org, "multiCurrency").allowed ||
    stored?.currency === currency
  );
}

const billOutcome = async (
  ctx: AssistantContext,
  action: string,
  bill: SupplierBill,
  fields?: SummaryField[],
  notes?: string[],
): Promise<OpOutcome> => ({
  ok: true,
  result: {
    action,
    id: bill.id,
    entity: "bill",
    path: `/app/accounting/bills/${bill.id}`,
    label: bill.supplierName,
  },
  summary: {
    action,
    fields: fields ?? (await billFieldsOf(ctx, bill)),
    ...(notes?.length ? { notes } : {}),
  },
  item: { action, label: bill.supplierName, amountCents: bill.totalCents, currency: bill.currency },
});

export const createBillOp = defineOp({
  id: "create_supplier_bill",
  permission: "accounting",
  description:
    "PROPOSE a new supplier bill to pay (supplier, invoice number, dates, amount VAT included, VAT code, expense account, IBAN and payment reference). It stays a draft until approved; nothing is paid.",
  schema: z.object({
    ...billFields,
    supplierName: z.string().min(1).max(140),
    issueDate: isoDate,
    total: amount.describe("amount to pay, VAT included, in units"),
  }),
  refs: { accountId: "account" },
  async run(ctx, input) {
    const parsed = parseBillForm(
      toForm({ currency: ctx.organization.currency, ...billPatch(input) }),
    );
    if (!parsed.ok) return fail(`invalid ${JSON.stringify(parsed.errors)}`);
    if (!currencyAllowed(ctx.organization, parsed.data.currency))
      return fail("plan_multi_currency");
    const bill = await createBill(ctx.database, who(ctx), parsed.data);
    return billOutcome(ctx, "create_supplier_bill", bill);
  },
});

export const updateBillOp = defineOp({
  id: "update_supplier_bill",
  permission: "accounting",
  description:
    "PROPOSE changes to a DRAFT supplier bill (billId from list_supplier_bills): only the fields to change. Approved or paid bills cannot be changed.",
  schema: z.object({ billId: z.string(), ...billFields }),
  refs: { billId: "bill", accountId: "account" },
  async run(ctx, input) {
    const current = await getBill(ctx.database, ctx.organization.id, input.billId);
    if (!current) return fail("bill_not_found");
    if (current.status !== "draft") return fail("not_a_draft");
    const parsed = parseBillForm(toForm({ ...billForm(current), ...billPatch(input) }));
    if (!parsed.ok) return fail(`invalid ${JSON.stringify(parsed.errors)}`);
    if (!currencyAllowed(ctx.organization, parsed.data.currency, current))
      return fail("plan_multi_currency");
    const before = await billFieldsOf(ctx, current);
    const bill = await updateBill(ctx.database, who(ctx), current.id, parsed.data);
    if (!bill) return fail("not_a_draft");
    const after = await billFieldsOf(ctx, bill);
    // Un montant est comparé avec sa devise : le même chiffre dans une autre devise change.
    const old = new Map(before.map((f) => [f.key, f]));
    const same = (a: SummaryField, b?: SummaryField) =>
      !!b && a.value === b.value && (a.currency ?? "") === (b.currency ?? "");
    const changed = after
      .filter((f) => !same(f, old.get(f.key)))
      .map((f) => {
        const was = old.get(f.key);
        return {
          ...f,
          before: was?.value ?? "",
          ...(was?.currency && was.currency !== f.currency ? { beforeCurrency: was.currency } : {}),
        };
      });
    const removed = before
      .filter((f) => !after.some((a) => a.key === f.key))
      .map((f) => ({ ...f, value: "", before: f.value }));
    const fields = [...changed, ...removed];
    if (fields.length === 0) return fail("no_change");
    return billOutcome(ctx, "update_supplier_bill", bill, [
      text("supplier", bill.supplierName),
      ...fields.filter((f) => f.key !== "supplier"),
    ]);
  },
});

export const approveBillOp = defineOp({
  id: "approve_supplier_bill",
  permission: "accounting",
  description:
    "PROPOSE to approve a draft supplier bill or expense claim (billId): it is booked (expense against payables). With dual approval, the first approval only records it and a second person approves. Nobody approves their own expense claim. Approving pays nothing. A bill received through the e-invoicing platform is approved by the user on its page (its acceptance is sent to the platform and the supplier).",
  schema: z.object({ billId: z.string() }),
  refs: { billId: "bill" },
  async run(ctx, input) {
    const bill = await getBill(ctx.database, ctx.organization.id, input.billId);
    if (!bill) return fail("bill_not_found");
    // Reçue par la plateforme agréée : l'approbation y repart (« acceptée », au fournisseur aussi),
    // comme le refus. Envoyer à l'extérieur reste à la personne, sur la page de la facture.
    if (bill.platformRef) return fail("platform_bill_on_screen");
    const approved = await approveBill(ctx.database, who(ctx), bill.id);
    if (typeof approved === "string") return fail(approved);
    const first = approved.status === "draft";
    const fields = await billFieldsOf(ctx, approved);
    return billOutcome(
      ctx,
      "approve_supplier_bill",
      approved,
      [...fields, enumField("billStatus", first ? "firstApproval" : "approved")],
      first ? ["secondApprovalNeeded"] : ["billBooked"],
    );
  },
});

export const billFromReceiptOp = defineOp({
  id: "create_bill_from_receipt",
  permission: "accounting",
  description:
    "PROPOSE a draft supplier bill made from a supporting document already read (receiptId from list_receipts): supplier, amount, dates, IBAN and reference as read.",
  schema: z.object({ receiptId: z.string() }),
  refs: { receiptId: "receipt" },
  async run(ctx, input) {
    const bill = await billFromReceipt(ctx.database, who(ctx), input.receiptId);
    if (bill === "notFound") return fail("receipt_not_found");
    if (bill === "unread") return fail("receipt_not_read");
    if (bill === "exists") return fail("bill_exists_for_receipt");
    return billOutcome(ctx, "create_bill_from_receipt", bill);
  },
});

// Comptabilité

export const postPendingOp = defineOp({
  id: "post_pending_entries",
  permission: "accounting",
  description:
    "PROPOSE to book in the ledger everything issued and not booked yet (invoices, credit notes, payments already recorded, reminder charges), as the 'Book now' button of the books does.",
  schema: z.object({}),
  async run(ctx) {
    const done = await postPending(ctx.database, who(ctx));
    if (done.posted === 0)
      return fail(done.reason ? `nothing_to_post_${done.reason}` : "nothing_to_post");
    return {
      ok: true,
      result: {
        action: "post_pending_entries",
        id: ctx.organization.id,
        entity: "ledger",
        path: "/app/accounting",
        label: String(done.posted),
      },
      summary: {
        action: "post_pending_entries",
        fields: filled([
          text("posted", done.posted),
          done.waiting > 0 ? text("waiting", done.waiting) : null,
          done.reason ? enumField("waitingReason", done.reason) : null,
        ]),
      },
      item: { action: "post_pending_entries", label: String(done.posted) },
    };
  },
});

async function receiptRow(ctx: AssistantContext, id: string) {
  if (!UUID.test(id)) return null;
  const [row] = await ctx.database
    .select()
    .from(receipts)
    .where(and(eq(receipts.id, id), eq(receipts.organizationId, ctx.organization.id)));
  return row ?? null;
}

async function readCheck(ctx: AssistantContext, receiptId: string): Promise<OpOutcome> {
  const row = await receiptRow(ctx, receiptId);
  if (!row || row.status === "posted" || row.status === "billed") return fail("receipt_not_found");
  if (!aiConfigured()) return fail("ai_unavailable");
  if (!(await quotaAccess(ctx.database, ctx.organization, "aiReads")).allowed)
    return fail("plan_limit_ai_reads");
  return {
    ok: true,
    result: {
      action: "read_receipt",
      id: row.id,
      entity: "receipt",
      path: "/app/accounting/receipts",
      label: row.filename,
    },
    summary: {
      action: "read_receipt",
      fields: filled([text("file", row.filename), enumField("receiptStatus", row.status)]),
      notes: ["aiReadCounts"],
    },
    item: { action: "read_receipt", label: row.filename },
  };
}

export const readReceiptOp = defineOp({
  id: "read_receipt",
  permission: "accounting",
  description:
    "PROPOSE to (re)read a supporting document with the reading AI (receiptId from list_receipts): supplier, date, amount and VAT are read and the document is matched to its bank movement. Counts in the plan's monthly AI readings. Not available inside propose_batch.",
  schema: z.object({ receiptId: z.string() }),
  batch: false,
  transactional: false,
  check: (ctx, input) => readCheck(ctx, input.receiptId),
  async run(ctx, input) {
    const checked = await readCheck(ctx, input.receiptId);
    if (!checked.ok) return checked;
    const read = await readReceipt(ctx.database, who(ctx), input.receiptId, ctx.locale);
    if (read !== "read") return fail(read === "quota" ? "plan_limit_ai_reads" : `read_${read}`);
    const row = await receiptRow(ctx, input.receiptId);
    return {
      ...checked,
      summary: {
        action: "read_receipt",
        fields: filled([
          text("file", row?.filename),
          text("supplier", row?.extraction?.supplier),
          dateField("date", row?.extraction?.date),
          row?.extraction?.totalCents
            ? moneyField(
                "total",
                row.extraction.totalCents,
                row.extraction.currency ?? ctx.organization.currency,
              )
            : null,
        ]),
      },
    };
  },
});

/** Périodes du décompte TVA, comme la page : depuis le premier exercice, trimestres (TDFN : semestres). */
export async function vatPeriods(ctx: AssistantContext) {
  const years = await listFiscalYears(ctx.database, ctx.organization.id);
  const firstStart = years.at(-1)?.startDate ?? `${ctx.today.slice(0, 4)}-01-01`;
  const months =
    ctx.organization.country === "CH" && ctx.organization.vatMethod === "net_tax_rate" ? 6 : 3;
  const done = new Set(
    (await listVatReturns(ctx.database, ctx.organization.id)).map((r) => r.periodStart),
  );
  return periodsBetween(firstStart, ctx.today, months)
    .reverse()
    .map((p) => ({ ...p, validated: done.has(p.start) }));
}

export const vatReturnOp = defineOp({
  id: "validate_vat_return",
  permission: "accounting",
  description:
    "PROPOSE to validate the VAT (or US sales tax) return of a period (periodStart from list_vat_periods), as the VAT screen does: figures are frozen, the tax is transferred to the settlement account and the period closes in the ledger. Pro plan. Nothing is filed with the tax authority.",
  schema: z.object({ periodStart: isoDate }),
  async run(ctx, input) {
    if (!featureAccess(ctx.organization, "vatReturn").allowed) return fail("plan_vat_return");
    const period = (await vatPeriods(ctx)).find((p) => p.start === input.periodStart);
    if (!period) return fail("period_not_offered");
    if (period.validated) return fail("already_validated");
    const result = await validateVatReturn(ctx.database, who(ctx), period.start, period.end);
    if (result !== "validated") return fail(result);
    return {
      ok: true,
      result: {
        action: "validate_vat_return",
        id: period.start,
        entity: "vat_return",
        path: `/app/accounting/vat?period=${period.start}`,
        label: `${period.start} – ${period.end}`,
      },
      summary: {
        action: "validate_vat_return",
        fields: [dateField("periodStart", period.start), dateField("periodEnd", period.end)],
        notes: ["vatPeriodCloses", "nothingFiled"],
      },
      item: { action: "validate_vat_return", label: `${period.start} – ${period.end}` },
    };
  },
});

// Plan comptable et exercices

const accountFields = {
  number: z.string().max(10).optional().describe("account number of the country's chart"),
  nameDe: z.string().max(100).optional(),
  nameFr: z.string().max(100).optional(),
  nameEn: z.string().max(100).optional(),
  type: z
    .enum(["asset", "liability", "equity", "revenue", "expense", "closing"])
    .optional()
    .describe("must match the account class"),
  vatCode: z.enum(VAT_CODES).optional(),
  // Désactiver un compte le retire des listes, comme l'archivage d'un contact ou d'un article :
  // l'assistant ne fait que réactiver (docs/ASSISTANT-ACTIONS.md, « interdit : supprimer »).
  active: z
    .literal(true)
    .optional()
    .describe(
      "true reactivates an inactive account; deactivating is done by the user on the screen",
    ),
};

function accountForm(a: AccountInput): Json {
  return {
    number: a.number,
    nameDe: a.nameDe,
    nameFr: a.nameFr,
    nameEn: a.nameEn ?? "",
    type: a.type,
    vatCode: a.vatCode ?? "",
    active: a.active,
  };
}

function accountPatch(input: Json): Json {
  const out: Json = {};
  for (const k of ["number", "nameDe", "nameFr", "nameEn", "type", "vatCode"])
    if (input[k] !== undefined) out[k] = formValue(input[k]);
  if (typeof input.active === "boolean") out.active = input.active;
  return out;
}

const accountView = (a: AccountInput) => ({
  number: a.number,
  nameDe: a.nameDe,
  nameFr: a.nameFr,
  nameEn: a.nameEn ?? "",
  type: a.type,
  vatCode: a.vatCode ?? "",
  active: String(a.active),
});

const ACCOUNT_KEYS = [
  { key: "number" },
  { key: "nameDe" },
  { key: "nameFr" },
  { key: "nameEn" },
  { key: "type", format: "enum" as const },
  { key: "vatCode", format: "enum" as const },
  { key: "active", format: "bool" as const },
];

function saveError(result: string) {
  return result === "numberTaken"
    ? "account_number_taken"
    : result === "systemInactive"
      ? "system_account_stays_active"
      : result;
}

export const createAccountOp = defineOp({
  id: "create_account",
  permission: "setup",
  description:
    "PROPOSE a new account in the chart of accounts (number of the country's chart, name, type matching the class, default VAT code).",
  schema: z.object({
    ...accountFields,
    number: z.string().min(1).max(10),
    type: accountFields.type.unwrap(),
  }),
  async run(ctx, input) {
    const parsed = parseAccountForm(
      toForm({ active: true, ...accountPatch(input) }, ["active"]),
      ctx.organization.country,
    );
    if (!parsed.ok) return fail(`invalid ${JSON.stringify(parsed.errors)}`);
    const created = await createAccount(ctx.database, who(ctx), parsed.data);
    if (!created || typeof created === "string") return fail(saveError(created ?? "not_saved"));
    const v = accountView(parsed.data);
    return {
      ok: true,
      result: {
        action: "create_account",
        id: created.id,
        entity: "account",
        path: "/app/settings/accounts",
        label: `${created.number} ${accountName(created, ctx.locale)}`,
      },
      summary: {
        action: "create_account",
        fields: filled(
          ACCOUNT_KEYS.map((k) => ({
            key: k.key,
            value: String(v[k.key as keyof typeof v] ?? ""),
            ...(k.format ? { format: k.format } : {}),
          })),
        ),
      },
      item: {
        action: "create_account",
        label: `${created.number} ${accountName(created, ctx.locale)}`,
      },
    };
  },
});

export const updateAccountOp = defineOp({
  id: "update_account",
  permission: "setup",
  description:
    "PROPOSE changes to an account of the chart (accountId from list_accounts): names, number, type, default VAT code; active=true reactivates an inactive account. Deactivating an account is done by the user on the chart screen.",
  schema: z.object({ accountId: z.string(), ...accountFields }),
  refs: { accountId: "account" },
  async run(ctx, input) {
    const current = await getAccount(ctx.database, ctx.organization.id, input.accountId);
    if (!current) return fail("account_not_found");
    const currentInput: AccountInput = {
      number: current.number,
      nameDe: current.nameDe,
      nameFr: current.nameFr,
      nameEn: current.nameEn,
      type: current.type as AccountInput["type"],
      vatCode: current.vatCode as AccountInput["vatCode"],
      active: current.active,
    };
    const parsed = parseAccountForm(
      toForm({ ...accountForm(currentInput), ...accountPatch(input) }, ["active"]),
      ctx.organization.country,
    );
    if (!parsed.ok) return fail(`invalid ${JSON.stringify(parsed.errors)}`);
    const fields = changes(accountView(currentInput), accountView(parsed.data), ACCOUNT_KEYS);
    if (fields.length === 0) return fail("no_change");
    const updated = await updateAccount(ctx.database, who(ctx), current.id, parsed.data);
    if (!updated || typeof updated === "string")
      return fail(saveError(updated ?? "account_not_found"));
    return {
      ok: true,
      result: {
        action: "update_account",
        id: updated.id,
        entity: "account",
        path: "/app/settings/accounts",
        label: `${updated.number} ${accountName(updated, ctx.locale)}`,
      },
      summary: {
        action: "update_account",
        fields: fields.some((f) => f.key === "number")
          ? fields
          : [text("account", `${current.number} ${accountName(current, ctx.locale)}`), ...fields],
      },
      item: {
        action: "update_account",
        label: `${updated.number} ${accountName(updated, ctx.locale)}`,
      },
    };
  },
});

export const installChartOp = defineOp({
  id: "install_chart",
  permission: "setup",
  description:
    "PROPOSE to install the country's standard chart of accounts (template sole_proprietorship or corporation), only when the company has no account yet.",
  schema: z.object({ template: z.enum(CHART_TEMPLATES) }),
  async run(ctx, input) {
    const result = await installChart(ctx.database, who(ctx), input.template);
    if (result !== "installed") return fail(result === "exists" ? "chart_exists" : result);
    const count = chartPack(ctx.organization.country).templateAccounts(input.template).length;
    return {
      ok: true,
      result: {
        action: "install_chart",
        id: ctx.organization.id,
        entity: "account",
        path: "/app/settings/accounts",
        label: String(count),
      },
      summary: {
        action: "install_chart",
        fields: [enumField("chartTemplate", input.template), text("accounts", count)],
      },
      item: { action: "install_chart", label: String(count), detail: input.template },
    };
  },
});

const yearOutcome = (
  action: string,
  y: { id: string; startDate: string; endDate: string },
  extra: SummaryField[] = [],
  notes: string[] = [],
): OpOutcome => ({
  ok: true,
  result: {
    action,
    id: y.id,
    entity: "fiscal_year",
    path: "/app/settings/fiscal-years",
    label: `${y.startDate} – ${y.endDate}`,
  },
  summary: {
    action,
    fields: [dateField("periodStart", y.startDate), dateField("periodEnd", y.endDate), ...extra],
    ...(notes.length ? { notes } : {}),
  },
  item: { action, label: `${y.startDate} – ${y.endDate}` },
});

export const openFirstYearOp = defineOp({
  id: "open_first_fiscal_year",
  permission: "setup",
  description:
    "PROPOSE to open the company's first financial year from a start date (extended=true: a first year longer than 12 months, up to the next regular year end).",
  schema: z.object({ start: isoDate, extended: z.boolean().optional() }),
  async run(ctx, input) {
    const year = await createFirstFiscalYear(ctx.database, who(ctx), {
      start: input.start,
      extended: input.extended === true,
    });
    if (typeof year === "string") return fail(year === "exists" ? "fiscal_year_exists" : year);
    return yearOutcome("open_first_fiscal_year", year);
  },
});

export const openNextYearOp = defineOp({
  id: "open_next_fiscal_year",
  permission: "setup",
  description: "PROPOSE to open the financial year that follows the latest one (12 months).",
  schema: z.object({}),
  async run(ctx) {
    const year = await openNextFiscalYear(ctx.database, who(ctx));
    if (typeof year === "string") return fail(year === "none" ? "no_fiscal_year" : year);
    return yearOutcome("open_next_fiscal_year", year);
  },
});

export const closeYearOp = defineOp({
  id: "close_fiscal_year",
  permission: "setup",
  description:
    "PROPOSE to close a financial year (fiscalYearId from list_fiscal_years): the result is booked, the next year opens with the balance sheet carried forward, and the closed year accepts no more entries. Only when the user asks to close the year.",
  schema: z.object({ fiscalYearId: z.string() }),
  refs: { fiscalYearId: "fiscal_year" },
  async run(ctx, input) {
    if (!UUID.test(input.fiscalYearId)) return fail("fiscal_year_not_found");
    const [year] = await ctx.database
      .select()
      .from(fiscalYears)
      .where(
        and(
          eq(fiscalYears.id, input.fiscalYearId),
          eq(fiscalYears.organizationId, ctx.organization.id),
        ),
      );
    if (!year) return fail("fiscal_year_not_found");
    const closed = await closeFiscalYear(ctx.database, who(ctx), year.id);
    if (!closed.ok) return fail(`close_${closed.reason}`);
    return yearOutcome(
      "close_fiscal_year",
      year,
      [moneyField("result", closed.resultCents, ctx.organization.currency)],
      ["yearCloses"],
    );
  },
});

// Réglages

const companyFields = {
  country: z.enum(["CH", "DE", "FR", "GB", "US"]).optional(),
  legalName: z.string().max(120).optional(),
  legalForm: z.enum(LEGAL_FORMS).optional(),
  street: z.string().max(70).optional(),
  buildingNumber: z.string().max(16).optional(),
  postalCode: z.string().max(16).optional(),
  town: z.string().max(35).optional(),
  email: z.string().max(200).optional(),
  phone: z.string().max(40).optional(),
  website: z.string().max(200).optional(),
  uid: z.string().max(40).optional().describe("VAT / UID number"),
  taxNumber: z.string().max(40).optional().describe("Steuernummer, SIRET, company number or EIN"),
  vatRegistered: z.boolean().optional(),
  vatMethod: z.enum(VAT_METHODS).optional(),
  vatSettlement: z.enum(VAT_SETTLEMENTS).optional(),
  netTaxRate: amount.optional().describe("Swiss net tax rate in %, e.g. 6.2"),
  region: z.string().max(2).optional().describe("US state code"),
  salesTaxRate: amount.optional().describe("US combined sales tax rate in %, e.g. 8.25"),
  iban: z.string().max(42).optional(),
  qrIban: z.string().max(42).optional(),
  fiscalYearStartMonth: z.number().int().min(1).max(12).optional(),
};

const COMPANY_KEYS = Object.keys(companyFields) as (keyof typeof companyFields)[];
const COMPANY_FORMATS: Partial<Record<keyof typeof companyFields, SummaryField["format"]>> = {
  vatRegistered: "bool",
  legalForm: "enum",
  vatMethod: "enum",
  vatSettlement: "enum",
  netTaxRate: "percent",
  salesTaxRate: "percent",
};

function companyForm(o: Organization): Json {
  return {
    country: o.country,
    legalName: o.legalName ?? o.name,
    legalForm: o.legalForm ?? "",
    street: o.street ?? "",
    buildingNumber: o.buildingNumber ?? "",
    postalCode: o.postalCode ?? "",
    town: o.town ?? "",
    email: o.email ?? "",
    phone: o.phone ?? "",
    website: o.website ?? "",
    uid: o.uid ?? "",
    taxNumber: o.taxNumber ?? "",
    vatRegistered: o.vatRegistered,
    vatMethod: o.vatMethod ?? "",
    vatSettlement: o.vatSettlement ?? "",
    netTaxRate: o.netTaxRateBp ? String(o.netTaxRateBp / 100) : "",
    region: o.region ?? "",
    salesTaxRate: o.salesTaxRateBp ? String(o.salesTaxRateBp / 100) : "",
    iban: o.iban ?? "",
    qrIban: o.qrIban ?? "",
    fiscalYearStartMonth: String(o.fiscalYearStartMonth),
  };
}

/**
 * Ce que la carte montre de l'entreprise, lu tel qu'il est enregistré : la raison sociale vide reste
 * vide (le formulaire la préremplit avec le nom, et c'est ce nom qui sera écrit), et la devise, que
 * l'enregistrement aligne sur le pays.
 */
const companyView = (o: Organization): Json => {
  const form = companyForm(o);
  return {
    ...form,
    legalName: o.legalName ?? "",
    vatRegistered: String(o.vatRegistered),
    currency: o.currency,
  };
};
const COMPANY_VIEW_KEYS = [...COMPANY_KEYS, "currency" as const];

export const companySettingsOp = defineOp({
  id: "update_company_settings",
  permission: "company",
  description:
    "PROPOSE changes to the company settings (legal name and form, address, e-mail, phone, website, VAT or tax numbers, VAT registration and method, net tax rate, US state and sales tax rate, IBAN, QR-IBAN, first month of the financial year, country): only the fields to change. Same checks as the settings screen; the country no longer changes once a document is issued.",
  schema: z.object(companyFields),
  async run(ctx, input) {
    const current = companyForm(ctx.organization);
    const patch: Json = {};
    for (const k of COMPANY_KEYS) {
      const v = input[k];
      if (v === undefined) continue;
      patch[k] =
        typeof v === "boolean"
          ? v
          : k === "netTaxRate" || k === "salesTaxRate"
            ? amountText(v)
            : formValue(v);
    }
    const parsed = parseCompanyForm(toForm({ ...current, ...patch }, ["vatRegistered"]));
    if (!parsed.ok) return fail(`invalid ${JSON.stringify(parsed.errors)}`);
    const d = parsed.data;
    const saved = await saveCompanySettings(ctx.database, who(ctx), d);
    if (saved === "forbidden") return fail("forbidden_role");
    if (saved !== "saved")
      return fail(saved === "countryLocked" ? "country_locked" : "country_drafts");
    // Ce qui a changé, relu en base dans la transaction : tout ce que l'écran enregistre, y compris
    // ce qu'il en déduit (devise du pays, raison sociale reprise du nom). Rien → refusé (annulé).
    const [stored] = await ctx.database
      .select()
      .from(organizations)
      .where(eq(organizations.id, ctx.organization.id));
    if (!stored) return fail("failed");
    const fields = changes(
      companyView(ctx.organization),
      companyView(stored),
      COMPANY_VIEW_KEYS.map((key) => ({
        key,
        format: COMPANY_FORMATS[key as keyof typeof COMPANY_FORMATS],
      })),
    ).map((f) => ({ ...f, key: `company.${f.key}` }));
    if (fields.length === 0) return fail("no_change");
    const notes = fields.some((f) => f.key === "company.iban" || f.key === "company.qrIban")
      ? ["checkBankDetails"]
      : [];
    return {
      ok: true,
      result: {
        action: "update_company_settings",
        id: ctx.organization.id,
        entity: "company",
        path: "/app/settings/company",
        label: d.legalName,
      },
      summary: {
        action: "update_company_settings",
        fields,
        ...(notes.length ? { notes } : {}),
      },
      item: { action: "update_company_settings", label: d.legalName },
    };
  },
});

export const reminderSettingsOp = defineOp({
  id: "update_reminder_settings",
  permission: "company",
  description:
    "PROPOSE the payment reminder settings: fee from the second reminder (amount in units, 0 = none) and late interest rate in % (0 = none). automaticReminders can only be switched OFF here (switching automatic e-mail reminders on is done by the user on the reminders screen). Pro plan.",
  schema: z.object({
    fee: amount.optional(),
    interestPercent: amount.optional(),
    automaticReminders: z.literal(false).optional(),
  }),
  async run(ctx, input) {
    const org = ctx.organization;
    const percent = (bp: number | null) => (bp ? String(bp / 100) : "");
    const fee =
      input.fee !== undefined ? amountText(input.fee) : (org.reminderFeeCents / 100).toFixed(2);
    const feeCents = fee === "" ? 0 : parseAmountToCents(fee);
    if (feeCents === null) return fail("invalid_fee");
    const rate =
      input.interestPercent !== undefined
        ? amountText(input.interestPercent).replace(",", ".")
        : percent(org.lateInterestBp);
    const interest = rate === "" || Number(rate) === 0 ? "" : rate;
    const auto = input.automaticReminders === false ? false : org.reminderAuto;
    const fields = changes(
      {
        auto: String(org.reminderAuto),
        fee: String(org.reminderFeeCents),
        interest: percent(org.lateInterestBp),
      },
      {
        auto: String(auto),
        fee: String(feeCents),
        interest: interest ? String(Number(interest)) : "",
      },
      [
        { key: "auto", format: "bool" },
        { key: "fee", format: "money", currency: org.currency },
        { key: "interest", format: "percent" },
      ],
    ).map((f) => ({ ...f, key: `reminders.${f.key}` }));
    if (fields.length === 0) return fail("no_change");
    const result = await saveReminderSettings(ctx.database, who(ctx), org, { auto, fee, interest });
    if (result === "plan") return fail("plan_reminder_settings");
    if (result !== "saved") return fail(result === "invalidFee" ? "invalid_fee" : "invalid_rate");
    return {
      ok: true,
      result: {
        action: "update_reminder_settings",
        id: org.id,
        entity: "company",
        path: "/app/invoices/reminders",
        label: "",
      },
      summary: { action: "update_reminder_settings", fields },
      item: { action: "update_reminder_settings", label: "" },
    };
  },
});
