import { and, eq, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { RATE_FIGURES } from "@/countries/ch/vat-return";
import { chatJson } from "./ai";
import type { Db } from "./db";
import {
  accounts,
  auditLog,
  bankTransactions,
  invoiceLines,
  invoices,
  journalEntries,
  journalLines,
  organizations,
  receipts,
  type VatAnomaly,
  type VatFigures,
  vatReturns,
} from "./db/schema";
import { appendEntry, LedgerError, roleAccounts } from "./ledger";

type Who = { organizationId: string; userId: string };

export type VatReturnDraft = {
  figures: VatFigures;
  anomalies: VatAnomaly[];
  /** Base et TVA par taux, pour l'affichage détaillé. */
  rates: { rateBp: number; figure: string; baseCents: number; taxCents: number }[];
};

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Prépare le décompte d'une période à partir du journal (méthode effective, contre-prestations
 * convenues) : chiffre d'affaires, déductions, TVA due par taux, impôt préalable, solde.
 */
export async function draftVatReturn(
  database: Db,
  organizationId: string,
  start: string,
  end: string,
): Promise<VatReturnDraft> {
  if (!ISO.test(start) || !ISO.test(end) || end < start) throw new Error("period");
  const anomalies: VatAnomaly[] = [];
  const [org] = await database
    .select({
      vatRegistered: organizations.vatRegistered,
      vatMethod: organizations.vatMethod,
      vatSettlement: organizations.vatSettlement,
    })
    .from(organizations)
    .where(eq(organizations.id, organizationId));
  if (!org?.vatRegistered) anomalies.push({ code: "notRegistered", severity: "block" });
  else if (org.vatMethod !== "effective") anomalies.push({ code: "netTaxRate", severity: "block" });
  else if (org.vatSettlement === "received")
    anomalies.push({ code: "received", severity: "block" });

  const roles = await roleAccounts(database, organizationId);
  const inPeriod = and(
    eq(journalEntries.organizationId, organizationId),
    gte(journalEntries.entryDate, start),
    lte(journalEntries.entryDate, end),
  );
  const lines = await database
    .select({
      accountId: journalLines.accountId,
      number: accounts.number,
      type: accounts.type,
      debit: journalLines.debitCents,
      credit: journalLines.creditCents,
      rateBp: journalLines.vatRateBp,
      base: journalLines.vatBaseCents,
      sourceType: journalEntries.sourceType,
      sourceId: journalEntries.sourceId,
    })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
    .innerJoin(accounts, eq(accounts.id, journalLines.accountId))
    .where(and(inPeriod, sql`${journalEntries.sourceType} <> 'vat'`));

  // Chiffre d'affaires : produits d'exploitation (classe 3) et annexes (classe 7).
  let turnover = 0;
  let zeroRated = 0;
  const byRate = new Map<number, { base: number; tax: number }>();
  let input400 = 0;
  let input405 = 0;
  for (const l of lines) {
    if (l.type === "revenue" && /^[37]/.test(l.number)) {
      const amount = l.credit - l.debit;
      turnover += amount;
      if (!l.rateBp) zeroRated += amount;
    }
    if (l.accountId === roles.vat_output && l.rateBp) {
      const r = byRate.get(l.rateBp) ?? { base: 0, tax: 0 };
      r.base += l.base ?? 0;
      r.tax += l.credit - l.debit;
      byRate.set(l.rateBp, r);
    }
    if (l.accountId === roles.vat_input_material) input400 += l.debit - l.credit;
    if (l.accountId === roles.vat_input_invest) input405 += l.debit - l.credit;
  }

  // Exportations (exonérées, art. 23 LTVA) : lignes de factures au code « export » de la période.
  const [exports] = await database
    .select({
      net: sql<string>`coalesce(sum(case when ${invoices.kind} = 'credit_note' then -${invoiceLines.netCents} else ${invoiceLines.netCents} end), 0)`,
    })
    .from(invoiceLines)
    .innerJoin(invoices, eq(invoices.id, invoiceLines.invoiceId))
    .where(
      and(
        eq(invoices.organizationId, organizationId),
        inArray(invoices.kind, ["invoice", "credit_note"]),
        eq(invoices.status, "issued"),
        gte(invoices.issueDate, start),
        lte(invoices.issueDate, end),
        eq(invoiceLines.vatCode, "export"),
      ),
    );
  const f220 = Number(exports?.net ?? 0);
  const f230 = zeroRated - f220;
  const f289 = f220 + f230;
  const f299 = turnover - f289;

  const rates = [...byRate.entries()]
    .sort(([a], [b]) => b - a)
    .map(([rateBp, v]) => ({
      rateBp,
      figure: RATE_FIGURES[rateBp] ?? "?",
      baseCents: v.base,
      taxCents: v.tax,
    }));
  const f399 = rates.reduce((s, r) => s + r.taxCents, 0);
  const f479 = input400 + input405;
  const figures: VatFigures = {
    "200": turnover,
    "220": f220,
    "230": f230,
    "289": f289,
    "299": f299,
    "399": f399,
    "400": input400,
    "405": input405,
    "479": f479,
    "500": Math.max(0, f399 - f479),
    "510": Math.max(0, f479 - f399),
  };
  for (const r of rates) figures[r.figure] = r.baseCents;

  // Contrôles de cohérence.
  const basesTotal = rates.reduce((s, r) => s + r.baseCents, 0);
  if (Math.abs(basesTotal - f299) > 100)
    anomalies.push({ code: "baseMismatch", severity: "warn", detail: String(basesTotal - f299) });
  const pendingBank = await database
    .select({ n: sql<number>`count(*)::int` })
    .from(bankTransactions)
    .where(
      and(
        eq(bankTransactions.organizationId, organizationId),
        inArray(bankTransactions.status, ["new", "proposed"]),
        gte(bankTransactions.bookingDate, start),
        lte(bankTransactions.bookingDate, end),
      ),
    );
  if ((pendingBank[0]?.n ?? 0) > 0)
    anomalies.push({ code: "pendingBank", severity: "block", count: pendingBank[0]?.n });
  const unposted = await database
    .select({ n: sql<number>`count(*)::int` })
    .from(invoices)
    .where(
      and(
        eq(invoices.organizationId, organizationId),
        inArray(invoices.kind, ["invoice", "credit_note"]),
        eq(invoices.status, "issued"),
        isNull(invoices.journalEntryId),
        gte(invoices.issueDate, start),
        lte(invoices.issueDate, end),
      ),
    );
  if ((unposted[0]?.n ?? 0) > 0)
    anomalies.push({ code: "unposted", severity: "block", count: unposted[0]?.n });
  // Impôt préalable déduit sans justificatif rattaché : l'AFC peut le refuser.
  const withoutReceipt = await database
    .select({ n: sql<number>`count(distinct ${journalEntries.id})::int` })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
    .leftJoin(receipts, eq(receipts.journalEntryId, journalEntries.id))
    .where(
      and(
        inPeriod,
        eq(journalEntries.sourceType, "bank"),
        or(
          roles.vat_input_material
            ? eq(journalLines.accountId, roles.vat_input_material)
            : sql`false`,
          roles.vat_input_invest ? eq(journalLines.accountId, roles.vat_input_invest) : sql`false`,
        ),
        isNull(receipts.id),
      ),
    );
  if ((withoutReceipt[0]?.n ?? 0) > 0)
    anomalies.push({ code: "inputWithoutReceipt", severity: "warn", count: withoutReceipt[0]?.n });
  const [overlap] = await database
    .select({ id: vatReturns.id })
    .from(vatReturns)
    .where(
      and(
        eq(vatReturns.organizationId, organizationId),
        lte(vatReturns.periodStart, end),
        gte(vatReturns.periodEnd, start),
      ),
    );
  if (overlap) anomalies.push({ code: "alreadyValidated", severity: "block" });

  return { figures, anomalies, rates };
}

export async function listVatReturns(database: Db, organizationId: string) {
  return database.select().from(vatReturns).where(eq(vatReturns.organizationId, organizationId));
}

/**
 * Relecture par l'assistant : il reçoit les chiffres et les principales dépenses de la période, et
 * signale ce qui mérite un coup d'œil humain. Ses remarques n'empêchent jamais la validation.
 */
export async function aiReview(
  database: Db,
  organizationId: string,
  start: string,
  end: string,
  draft: VatReturnDraft,
  language: "de" | "fr",
): Promise<string[]> {
  const expenses = await database
    .select({
      date: journalEntries.entryDate,
      text: journalEntries.description,
      account: accounts.number,
      name: accounts.nameDe,
      amount: journalLines.debitCents,
      rate: journalLines.vatRateBp,
    })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
    .innerJoin(accounts, eq(accounts.id, journalLines.accountId))
    .where(
      and(
        eq(journalEntries.organizationId, organizationId),
        gte(journalEntries.entryDate, start),
        lte(journalEntries.entryDate, end),
        eq(accounts.type, "expense"),
        sql`${journalLines.debitCents} > 0`,
      ),
    )
    .orderBy(sql`${journalLines.debitCents} desc`)
    .limit(40);
  const raw = await chatJson([
    {
      role: "system",
      content: [
        "You review a Swiss SME VAT return (effective method) before a human validates it.",
        "Point out only concrete, checkable issues: expenses booked without input VAT that usually carry Swiss VAT, input VAT on items that are exempt (insurance, salaries, bank fees, taxes), unusual amounts, possible private expenses.",
        `Write at most 5 short points in ${language === "fr" ? "French" : "Swiss German (no ß)"}, understandable by a non-accountant.`,
        'Answer JSON only: {"points":["..."]}. Return {"points":[]} when nothing stands out.',
      ].join("\n"),
    },
    {
      role: "user",
      content: JSON.stringify({
        period: { start, end },
        figures: Object.fromEntries(
          Object.entries(draft.figures).map(([k, v]) => [k, (v / 100).toFixed(2)]),
        ),
        expenses: expenses.map((e) => ({
          date: e.date,
          text: e.text,
          account: `${e.account} ${e.name}`,
          amount: (e.amount / 100).toFixed(2),
          vat_rate: e.rate ? `${e.rate / 100} %` : null,
        })),
      }),
    },
  ]);
  const points = (raw as { points?: unknown })?.points;
  return Array.isArray(points)
    ? points
        .filter((p): p is string => typeof p === "string")
        .slice(0, 5)
        .map((p) => p.slice(0, 400))
    : [];
}

export type ValidateVatResult = "validated" | "blocked" | "noFiscalYear" | "noChart";

/**
 * Validation humaine : les chiffres sont figés, la TVA due et l'impôt préalable sont virés sur le
 * compte de décompte TVA (2201) à la fin de la période, et la période se ferme au journal.
 */
export async function validateVatReturn(
  database: Db,
  who: Who,
  start: string,
  end: string,
): Promise<ValidateVatResult> {
  const draft = await draftVatReturn(database, who.organizationId, start, end);
  if (draft.anomalies.some((a) => a.severity === "block")) return "blocked";
  const roles = await roleAccounts(database, who.organizationId);
  if (
    !roles.vat_output ||
    !roles.vat_settlement ||
    !roles.vat_input_material ||
    !roles.vat_input_invest
  )
    return "noChart";
  const f = draft.figures;
  const net = (f["399"] ?? 0) - (f["479"] ?? 0);
  try {
    await database.transaction(async (tx) => {
      const tdb = tx as unknown as Db;
      let entryId: string | null = null;
      const postings = [
        { accountId: roles.vat_output ?? "", amountCents: f["399"] ?? 0 },
        { accountId: roles.vat_input_material ?? "", amountCents: -(f["400"] ?? 0) },
        { accountId: roles.vat_input_invest ?? "", amountCents: -(f["405"] ?? 0) },
        { accountId: roles.vat_settlement ?? "", amountCents: -net },
      ];
      if (postings.filter((p) => p.amountCents !== 0).length >= 2) {
        const entry = await appendEntry(tdb, who, {
          entryDate: end,
          description: `MWST-Abrechnung / Décompte TVA ${start} – ${end}`,
          sourceType: "vat",
          postings,
        });
        entryId = entry.id;
      }
      await tx.insert(vatReturns).values({
        organizationId: who.organizationId,
        periodStart: start,
        periodEnd: end,
        figures: f,
        anomalies: draft.anomalies,
        journalEntryId: entryId,
        validatedBy: who.userId,
      });
      await tx.insert(auditLog).values({
        organizationId: who.organizationId,
        userId: who.userId,
        action: "vat_return.validate",
        entity: "organization",
        entityId: who.organizationId,
        data: { start, end, payable: f["500"], credit: f["510"] },
      });
    });
  } catch (e) {
    if (e instanceof LedgerError) return e.message === "noFiscalYear" ? "noFiscalYear" : "noChart";
    throw e;
  }
  return "validated";
}
