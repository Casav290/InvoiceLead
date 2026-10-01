import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { countryPack } from "@/countries";
import { type BankEntry, parseCamt } from "@/countries/ch/camt";
import { VAT_CODES, type VatCode } from "@/countries/ch/vat";
import { chartPack } from "@/countries/charts";
import { roundHalfAwayFromZero } from "@/lib/money";
import { aiLanguageName, chatJson } from "./ai";
import { billProposals, payBillFromBank } from "./bills";
import { counterpartyKey, directionOf, learnRule, ruleConfidence } from "./booking-rules";
import type { Db } from "./db";
import {
  accounts,
  auditLog,
  type BankProposal,
  type BankTransaction,
  bankTransactions,
  bookingRules,
  contacts,
  invoices,
  organizations,
  receipts,
} from "./db/schema";
import { appendEntry, LedgerError, type Posting, postPending, roleAccounts } from "./ledger";
import { addPayment, invoiceBalance } from "./payments";
import { consumeQuota, organizationPlan, refundQuota } from "./plans";

type Who = { organizationId: string; userId: string };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Seuil à partir duquel « Tout valider » reprend une proposition sans la faire relire une à une. */
export const CONFIDENT = 0.9;

export async function importEntries(database: Db, who: Who, entries: BankEntry[]) {
  if (entries.length === 0) return { imported: 0, duplicates: 0 };
  const rows = await database
    .insert(bankTransactions)
    .values(entries.map((e) => ({ ...e, organizationId: who.organizationId })))
    .onConflictDoNothing({ target: [bankTransactions.organizationId, bankTransactions.externalId] })
    .returning({ id: bankTransactions.id });
  await database.insert(auditLog).values({
    organizationId: who.organizationId,
    userId: who.userId,
    action: "bank.import",
    entity: "organization",
    entityId: who.organizationId,
    data: { imported: rows.length, total: entries.length },
  });
  return { imported: rows.length, duplicates: entries.length - rows.length };
}

/**
 * Import d'un relevé camt depuis l'écran de la banque. Une unité de l'allocation du mois (formule
 * gratuite : 1 relevé) est réservée avant la lecture du fichier, et rendue si le fichier est
 * illisible ou n'apporte aucune ligne nouvelle : seul un relevé réellement importé compte.
 */
export async function importStatement(
  database: Db,
  who: Who,
  xml: string,
  today = new Date().toISOString().slice(0, 10),
): Promise<{ imported: number; duplicates: number } | "format" | "quota"> {
  const plan = await organizationPlan(database, who.organizationId);
  if (!plan || !(await consumeQuota(database, plan, "bankImports", today)).allowed) return "quota";
  let entries: BankEntry[];
  try {
    entries = parseCamt(xml).entries;
  } catch {
    await refundQuota(database, plan.id, "bankImports", today);
    return "format";
  }
  const result = await importEntries(database, who, entries).catch(async (e: unknown) => {
    await refundQuota(database, plan.id, "bankImports", today);
    throw e;
  });
  if (result.imported === 0) await refundQuota(database, plan.id, "bankImports", today);
  return result;
}

export async function listBankTransactions(database: Db, organizationId: string) {
  return database
    .select()
    .from(bankTransactions)
    .where(eq(bankTransactions.organizationId, organizationId))
    .orderBy(
      sql`case ${bankTransactions.status} when 'proposed' then 0 when 'new' then 1 else 2 end`,
      desc(bankTransactions.bookingDate),
    )
    .limit(500);
}

type OpenInvoice = {
  id: string;
  number: string;
  customer: string;
  openCents: number;
  reference: string | null;
};

async function openInvoices(database: Db, organizationId: string): Promise<OpenInvoice[]> {
  const rows = await database
    .select({
      id: invoices.id,
      number: invoices.number,
      total: invoices.totalCents,
      reference: invoices.paymentReference,
      customer: contacts.name,
    })
    .from(invoices)
    .innerJoin(contacts, eq(contacts.id, invoices.contactId))
    .where(
      and(
        eq(invoices.organizationId, organizationId),
        eq(invoices.kind, "invoice"),
        eq(invoices.status, "issued"),
        // Le relevé est dans la monnaie de l'entreprise : une facture en devise se solde à la main,
        // avec le cours du jour.
        sql`${invoices.currency} = (select o.currency from organizations o where o.id = ${invoices.organizationId})`,
      ),
    )
    .orderBy(desc(invoices.issueDate))
    .limit(200);
  const result: OpenInvoice[] = [];
  for (const r of rows) {
    const b = await invoiceBalance(database, r.id, r.total);
    if (b.openCents > 0)
      result.push({
        id: r.id,
        number: r.number ?? "",
        customer: r.customer,
        openCents: b.openCents,
        reference: r.reference,
      });
  }
  return result;
}

type AiAnswer = {
  id?: unknown;
  invoice?: unknown;
  account?: unknown;
  vat?: unknown;
  confidence?: unknown;
  explanation?: unknown;
};

/**
 * Prépare une proposition pour chaque mouvement nouveau : d'abord la règle sûre (référence QR ou SCOR
 * d'une facture ouverte), puis l'IA pour le reste. Rien n'est comptabilisé ici.
 */
export async function proposeAll(
  database: Db,
  who: Who,
  options: { language: "de" | "fr" | "en"; useAi: boolean },
): Promise<{ proposed: number; aiError: boolean }> {
  const pending = await database
    .select()
    .from(bankTransactions)
    .where(
      and(
        eq(bankTransactions.organizationId, who.organizationId),
        eq(bankTransactions.status, "new"),
      ),
    )
    .orderBy(asc(bankTransactions.bookingDate))
    .limit(200);
  if (pending.length === 0) return { proposed: 0, aiError: false };
  const open = await openInvoices(database, who.organizationId);
  // Sorties : d'abord les factures fournisseurs approuvées (référence, ou montant et fournisseur).
  const proposals = await billProposals(database, who.organizationId, pending, options.language);

  for (const tx of pending) {
    if (tx.amountCents <= 0 || !tx.reference) continue;
    const match = open.find((i) => i.reference === tx.reference);
    if (match && tx.amountCents <= match.openCents) {
      proposals.set(tx.id, {
        kind: "invoice",
        invoiceId: match.id,
        confidence: 1,
        explanation:
          options.language === "fr"
            ? `Référence de paiement de la facture ${match.number}.`
            : `Zahlungsreferenz der Rechnung ${match.number}.`,
        source: "reference",
      });
    }
  }

  // Règles apprises des validations précédentes : même contrepartie, même sens, même compte.
  const rules = await database
    .select()
    .from(bookingRules)
    .where(eq(bookingRules.organizationId, who.organizationId));
  for (const tx of pending) {
    if (proposals.has(tx.id)) continue;
    const key = counterpartyKey(tx.counterparty);
    const rule = key
      ? rules.find((r) => r.counterpartyKey === key && r.direction === directionOf(tx.amountCents))
      : undefined;
    if (!rule) continue;
    proposals.set(tx.id, {
      kind: "account",
      accountId: rule.accountId,
      vatCode: rule.vatCode,
      confidence: ruleConfidence(rule),
      explanation:
        options.language === "fr"
          ? `Comme les ${rule.hits} fois précédentes pour cette contrepartie.`
          : `Wie die letzten ${rule.hits} Male bei dieser Gegenpartei.`,
      source: "rule",
    });
  }

  let aiError = false;
  const rest = pending.filter((tx) => !proposals.has(tx.id));
  if (options.useAi && rest.length > 0) {
    const chart = await database
      .select()
      .from(accounts)
      .where(and(eq(accounts.organizationId, who.organizationId), eq(accounts.active, true)))
      .orderBy(asc(accounts.number));
    const [org] = await database
      .select({
        vatRegistered: organizations.vatRegistered,
        vatMethod: organizations.vatMethod,
        legalForm: organizations.legalForm,
        country: organizations.country,
      })
      .from(organizations)
      .where(eq(organizations.id, who.organizationId));
    const usable = chart.filter(
      (a) => a.type !== "closing" && a.role !== "bank" && a.role !== "cash",
    );
    for (let i = 0; i < rest.length; i += 20) {
      const batch = rest.slice(i, i + 20);
      try {
        const answer = await askAi(batch, usable, open, {
          language: options.language,
          vatRegistered: !!org?.vatRegistered && org.vatMethod === "effective",
          legalForm: org?.legalForm ?? null,
          country: org?.country ?? "CH",
        });
        for (const [key, a] of answer) {
          const tx = batch[key];
          if (!tx) continue;
          const confidence = Math.max(0, Math.min(1, Number(a.confidence) || 0));
          const explanation = String(a.explanation ?? "").slice(0, 300);
          const invoice =
            typeof a.invoice === "string" ? open.find((o) => o.number === a.invoice) : undefined;
          if (invoice && tx.amountCents > 0 && tx.amountCents <= invoice.openCents) {
            proposals.set(tx.id, {
              kind: "invoice",
              invoiceId: invoice.id,
              confidence,
              explanation,
              source: "ai",
            });
            continue;
          }
          const account =
            typeof a.account === "string" ? usable.find((c) => c.number === a.account) : undefined;
          if (account) {
            const vat =
              typeof a.vat === "string" && (VAT_CODES as readonly string[]).includes(a.vat)
                ? (a.vat as VatCode)
                : null;
            proposals.set(tx.id, {
              kind: "account",
              accountId: account.id,
              vatCode: vat,
              confidence,
              explanation,
              source: "ai",
            });
          }
        }
      } catch (e) {
        aiError = true;
        console.error(
          "[bank] proposition IA impossible",
          e instanceof Error ? e.message : "inconnu",
        );
      }
    }
  }

  for (const [id, proposal] of proposals) {
    await database
      .update(bankTransactions)
      .set({ proposal, status: "proposed" })
      .where(and(eq(bankTransactions.id, id), eq(bankTransactions.status, "new")));
  }
  return { proposed: proposals.size, aiError };
}

async function askAi(
  batch: BankTransaction[],
  chart: { number: string; nameDe: string; nameFr: string; type: string; role: string | null }[],
  open: OpenInvoice[],
  ctx: {
    language: "de" | "fr" | "en";
    vatRegistered: boolean;
    legalForm: string | null;
    country: string;
  },
): Promise<Map<number, AiAnswer>> {
  const germany = ctx.country === "DE";
  const france = ctx.country === "FR";
  const uk = ctx.country === "GB";
  const usa = ctx.country === "US";
  const system = [
    germany
      ? "You are the bookkeeping assistant of a German small business using the DATEV SKR04 chart of accounts."
      : france
        ? "You are the bookkeeping assistant of a French small business using the French PCG chart of accounts."
        : uk
          ? "You are the bookkeeping assistant of a UK small business using a standard UK nominal ledger."
          : usa
            ? "You are the bookkeeping assistant of a US small business using a standard US chart of accounts."
            : "You are the bookkeeping assistant of a Swiss SME using the Swiss KMU chart of accounts.",
    "For each bank transaction, decide EITHER which open customer invoice it pays (incoming money only) OR which account of the chart it must be booked against (the bank side is booked automatically).",
    "Only use invoice numbers and account numbers from the lists given. Never use class 9 accounts.",
    ctx.vatRegistered && !usa
      ? `The company is VAT registered: set vat to the ${germany ? "German VAT code the amount includes (normal 19 %, reduced 7 %)" : france ? "French VAT code the amount includes (normal 20 %, lodging 10 %, reduced 5.5 %)" : uk ? "UK VAT code the amount includes (normal 20 %, reduced 5 %)" : "Swiss VAT code the amount includes (normal, reduced, lodging)"} or null when there is no VAT (bank fees, salaries, social insurance, insurance premiums, taxes, private withdrawals, transfers).`
      : "The company is not VAT registered: always set vat to null.",
    ctx.legalForm === "sole_proprietorship"
      ? "Private withdrawals and deposits of the owner go to the private account."
      : "",
    "Payouts from Stripe or another payment provider settle online payments already recorded: book them against the payment provider clearing account, never against revenue.",
    "confidence is your probability (0 to 1) that the booking is right. Be honest: below 0.6 when unsure.",
    `explanation: one short sentence in ${aiLanguageName(ctx.language)} a non-accountant understands.`,
    'Answer with JSON only: {"results":[{"id":"t1","invoice":null,"account":"6570","vat":"normal","confidence":0.9,"explanation":"..."}]}',
  ]
    .filter(Boolean)
    .join("\n");
  const user = JSON.stringify({
    transactions: batch.map((tx, i) => ({
      id: `t${i + 1}`,
      date: tx.bookingDate,
      amount: (tx.amountCents / 100).toFixed(2),
      direction: tx.amountCents > 0 ? "in" : "out",
      counterparty: tx.counterparty,
      text: tx.text,
      reference: tx.reference,
    })),
    open_invoices: open.slice(0, 100).map((o) => ({
      number: o.number,
      customer: o.customer,
      open: (o.openCents / 100).toFixed(2),
    })),
    chart: chart.map((a) => ({
      number: a.number,
      name: `${a.nameDe} / ${a.nameFr}`,
      type: a.type,
    })),
  });
  const raw = await chatJson([
    { role: "system", content: system },
    { role: "user", content: user },
  ]);
  const results = (raw as { results?: AiAnswer[] })?.results;
  const out = new Map<number, AiAnswer>();
  if (!Array.isArray(results)) return out;
  for (const r of results) {
    const m = /^t(\d+)$/.exec(String(r.id ?? ""));
    if (m) out.set(Number(m[1]) - 1, r);
  }
  return out;
}

/** Postes d'une écriture banque contre compte, TVA incluse dans le montant séparée si besoin. */
export async function bankPostings(
  database: Db,
  organizationId: string,
  tx: BankTransaction,
  accountId: string,
  vatCode: VatCode | null,
): Promise<Posting[]> {
  const roles = await roleAccounts(database, organizationId);
  if (!roles.bank) throw new LedgerError("noChart");
  const [account] = await database
    .select()
    .from(accounts)
    .where(and(eq(accounts.id, accountId), eq(accounts.organizationId, organizationId)));
  if (!account) throw new LedgerError("noAccount");
  const [org] = await database
    .select({
      vatRegistered: organizations.vatRegistered,
      vatMethod: organizations.vatMethod,
      country: organizations.country,
    })
    .from(organizations)
    .where(eq(organizations.id, organizationId));
  const counter = -tx.amountCents;
  // Sales tax américaine : payée sur un achat, elle n'est pas récupérable et reste dans la charge.
  const rate =
    vatCode && org?.vatRegistered && org.vatMethod === "effective" && org.country !== "US"
      ? countryPack(org.country).vatRateBp(vatCode, tx.bookingDate)
      : 0;
  if (rate === 0) {
    return [
      { accountId: roles.bank, amountCents: tx.amountCents },
      { accountId: account.id, amountCents: counter },
    ];
  }
  // TVA comprise dans le montant : montant × taux / (100 % + taux).
  const vat = roundHalfAwayFromZero((counter * rate) / (10_000 + rate)) + 0;
  const net = counter - vat;
  const isRevenue = account.type === "revenue";
  const vatAccount = isRevenue
    ? roles.vat_output
    : roles[chartPack(org?.country).inputVatRole(account)];
  if (!vatAccount) throw new LedgerError("noChart");
  return [
    { accountId: roles.bank, amountCents: tx.amountCents },
    { accountId: account.id, amountCents: net, vatRateBp: rate },
    {
      accountId: vatAccount,
      amountCents: vat,
      vatRateBp: rate,
      vatBaseCents: isRevenue ? -net : net,
    },
  ];
}

export type ValidateResult =
  | "posted"
  | "notFound"
  | "noProposal"
  | "tooHigh"
  | "noChart"
  | "noFiscalYear"
  | "vatPeriodClosed";

/**
 * Validation humaine d'un mouvement : la proposition (ou le choix corrigé) devient une écriture.
 * Un règlement de facture passe par le paiement, qui se comptabilise comme un paiement saisi.
 */
export async function validateTransaction(
  database: Db,
  who: Who,
  id: string,
  override?: { accountId: string; vatCode: VatCode | null },
  /** false : comptabilisation par le pilote automatique, qui n'apprend pas de lui-même. */
  options: { learn?: boolean } = {},
): Promise<ValidateResult> {
  if (!UUID.test(id)) return "notFound";
  const [tx] = await database
    .select()
    .from(bankTransactions)
    .where(
      and(eq(bankTransactions.id, id), eq(bankTransactions.organizationId, who.organizationId)),
    );
  if (!tx || tx.status === "posted" || tx.status === "ignored") return "notFound";
  const proposal: BankProposal | null = override
    ? { kind: "account", ...override, confidence: 1, explanation: "", source: "rule" }
    : tx.proposal;
  if (!proposal) return "noProposal";

  if (proposal.kind === "invoice") {
    const payment = await addPayment(database, who, proposal.invoiceId, {
      paidOn: tx.bookingDate,
      amountCents: tx.amountCents,
      method: "bank",
      note: [tx.counterparty, tx.reference].filter(Boolean).join(" · ").slice(0, 200) || null,
    });
    if (payment === "tooHigh") return "tooHigh";
    if (payment === "notFound") return "notFound";
    await database
      .update(bankTransactions)
      .set({
        status: "posted",
        paymentId: payment.id,
        proposal,
        validatedBy: who.userId,
        validatedAt: new Date(),
      })
      .where(eq(bankTransactions.id, id));
    await postPending(database, who);
    return "posted";
  }

  if (proposal.kind === "bill") {
    // Paiement d'une facture fournisseur : fournisseurs contre banque, la facture est soldée.
    try {
      const entry = await payBillFromBank(database, who, tx, proposal.billId);
      await database
        .update(bankTransactions)
        .set({
          status: "posted",
          journalEntryId: entry.id,
          proposal,
          validatedBy: who.userId,
          validatedAt: new Date(),
        })
        .where(eq(bankTransactions.id, id));
    } catch (e) {
      if (e instanceof LedgerError) {
        if (e.message === "noFiscalYear") return "noFiscalYear";
        if (e.message === "vatPeriodClosed") return "vatPeriodClosed";
        if (e.message === "already") return "notFound";
        return "noChart";
      }
      throw e;
    }
    return "posted";
  }

  try {
    await database.transaction(async (t) => {
      const tdb = t as unknown as Db;
      const [locked] = await t
        .select({ status: bankTransactions.status })
        .from(bankTransactions)
        .where(eq(bankTransactions.id, id))
        .for("update");
      if (locked?.status === "posted") throw new LedgerError("already");
      const entry = await appendEntry(tdb, who, {
        entryDate: tx.bookingDate,
        description: ([tx.counterparty, tx.text].filter(Boolean).join(" · ") || "Bank").slice(
          0,
          200,
        ),
        sourceType: "bank",
        sourceId: tx.id,
        postings: await bankPostings(
          tdb,
          who.organizationId,
          tx,
          proposal.accountId,
          proposal.vatCode as VatCode | null,
        ),
      });
      await t
        .update(bankTransactions)
        .set({
          status: "posted",
          journalEntryId: entry.id,
          proposal,
          validatedBy: who.userId,
          validatedAt: new Date(),
        })
        .where(eq(bankTransactions.id, id));
      // Le justificatif rattaché devient la pièce de cette écriture.
      await t
        .update(receipts)
        .set({ status: "posted", journalEntryId: entry.id })
        .where(eq(receipts.bankTransactionId, id));
    });
  } catch (e) {
    if (e instanceof LedgerError) {
      if (e.message === "noFiscalYear") return "noFiscalYear";
      if (e.message === "vatPeriodClosed") return "vatPeriodClosed";
      if (e.message === "already") return "notFound";
      return "noChart";
    }
    throw e;
  }
  if (options.learn !== false)
    await learnRule(database, who, {
      counterparty: tx.counterparty,
      amountCents: tx.amountCents,
      accountId: proposal.accountId,
      vatCode: proposal.vatCode,
    });
  return "posted";
}

/** « Tout valider » : seulement les propositions sûres ; les autres restent à relire. */
export async function validateConfident(database: Db, who: Who) {
  const rows = await database
    .select()
    .from(bankTransactions)
    .where(
      and(
        eq(bankTransactions.organizationId, who.organizationId),
        eq(bankTransactions.status, "proposed"),
      ),
    )
    .orderBy(asc(bankTransactions.bookingDate));
  let posted = 0;
  for (const r of rows) {
    if ((r.proposal?.confidence ?? 0) < CONFIDENT) continue;
    if ((await validateTransaction(database, who, r.id)) === "posted") posted += 1;
  }
  return posted;
}

export async function ignoreTransaction(database: Db, who: Who, id: string) {
  if (!UUID.test(id)) return false;
  const rows = await database
    .update(bankTransactions)
    .set({ status: "ignored", validatedBy: who.userId, validatedAt: new Date() })
    .where(
      and(
        eq(bankTransactions.id, id),
        eq(bankTransactions.organizationId, who.organizationId),
        inArray(bankTransactions.status, ["new", "proposed"]),
      ),
    )
    .returning({ id: bankTransactions.id });
  return rows.length > 0;
}
