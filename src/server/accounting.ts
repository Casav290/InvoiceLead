import { and, asc, desc, eq } from "drizzle-orm";
import {
  type AccountType,
  accountClass,
  type ChartTemplate,
} from "@/countries/ch/chart-of-accounts";
import { VAT_CODES, type VatCode } from "@/countries/ch/vat";
import { chartPack } from "@/countries/charts";
import { firstFiscalYear, isIsoDate, nextFiscalYear } from "@/lib/fiscal-year";
import { canSetUpAccounting } from "./company";
import type { Db } from "./db";
import {
  type Account,
  accounts,
  auditLog,
  type FiscalYear,
  fiscalYears,
  organizations,
} from "./db/schema";

type Who = { organizationId: string; userId: string };

// Plan comptable

export async function listAccounts(database: Db, organizationId: string): Promise<Account[]> {
  return database
    .select()
    .from(accounts)
    .where(eq(accounts.organizationId, organizationId))
    .orderBy(asc(accounts.number));
}

export async function getAccount(
  database: Db,
  organizationId: string,
  id: string,
): Promise<Account | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [row] = await database
    .select()
    .from(accounts)
    .where(and(eq(accounts.id, id), eq(accounts.organizationId, organizationId)))
    .limit(1);
  return row ?? null;
}

/** Installe un modèle de plan comptable, seulement si l'organisation n'a encore aucun compte. */
export async function installChart(
  database: Db,
  who: Who,
  template: ChartTemplate,
): Promise<"installed" | "exists" | "forbidden"> {
  if (!(await canSetUpAccounting(database, who.organizationId, who.userId))) return "forbidden";
  return database.transaction(async (tx) => {
    // Verrou sur l'organisation : deux installations simultanées ne peuvent pas se croiser.
    const [org] = await tx
      .select({ id: organizations.id, country: organizations.country })
      .from(organizations)
      .where(eq(organizations.id, who.organizationId))
      .for("update");
    const [existing] = await tx
      .select({ id: accounts.id })
      .from(accounts)
      .where(eq(accounts.organizationId, who.organizationId))
      .limit(1);
    if (existing) return "exists";
    const rows = chartPack(org?.country).templateAccounts(template);
    await tx.insert(accounts).values(
      rows.map((a) => ({
        organizationId: who.organizationId,
        number: a.number,
        nameDe: a.de,
        nameFr: a.fr,
        type: a.type,
        role: a.role ?? null,
        vatCode: a.vatCode ?? null,
      })),
    );
    await tx.insert(auditLog).values({
      organizationId: who.organizationId,
      userId: who.userId,
      action: "accounts.install",
      entity: "organization",
      entityId: who.organizationId,
      data: { template, count: rows.length },
    });
    return "installed";
  });
}

export type AccountInput = {
  number: string;
  nameDe: string;
  nameFr: string;
  type: AccountType;
  vatCode: VatCode | null;
  active: boolean;
};
export type AccountErrors = Partial<Record<keyof AccountInput, string>>;

const text = (form: FormData, key: string) => String(form.get(key) ?? "").trim();

export function parseAccountForm(
  form: FormData,
  country: string | null = "CH",
): { ok: true; data: AccountInput } | { ok: false; errors: AccountErrors } {
  const errors: AccountErrors = {};
  const number = text(form, "number");
  // Classes 1 à 9 en Suisse ; le SKR04 allemand commence à la classe 0.
  if (!(country === "DE" ? /^\d{4}$/ : /^[1-9]\d{3}$/).test(number)) errors.number = "number";

  // Une seule langue suffit : l'autre reprend le même libellé, à traduire plus tard.
  let nameDe = text(form, "nameDe");
  let nameFr = text(form, "nameFr");
  if (!nameDe && !nameFr) errors.nameDe = "required";
  nameDe ||= nameFr;
  nameFr ||= nameDe;
  if (nameDe.length > 100) errors.nameDe = "tooLong";
  if (nameFr.length > 100) errors.nameFr = "tooLong";

  const type = text(form, "type") as AccountType;
  const allowed = chartPack(country).typesByClass[accountClass(number)] ?? [];
  if (!allowed.includes(type)) errors.type = errors.number ? "required" : "typeForClass";

  const vatRaw = text(form, "vatCode");
  const vatCode = vatRaw === "" ? null : (vatRaw as VatCode);
  if (vatCode && !VAT_CODES.includes(vatCode)) errors.vatCode = "required";

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    data: { number, nameDe, nameFr, type, vatCode, active: form.get("active") === "on" },
  };
}

type SaveResult = Account | "forbidden" | "numberTaken" | "systemInactive" | null;

async function numberTaken(
  database: Db,
  organizationId: string,
  number: string,
  exceptId?: string,
) {
  const [row] = await database
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.organizationId, organizationId), eq(accounts.number, number)))
    .limit(1);
  return !!row && row.id !== exceptId;
}

export async function createAccount(
  database: Db,
  who: Who,
  data: AccountInput,
): Promise<SaveResult> {
  if (!(await canSetUpAccounting(database, who.organizationId, who.userId))) return "forbidden";
  if (await numberTaken(database, who.organizationId, data.number)) return "numberTaken";
  return database.transaction(async (tx) => {
    const [row] = await tx
      .insert(accounts)
      .values({ ...data, organizationId: who.organizationId })
      .returning();
    if (!row) throw new Error("account_not_saved");
    await tx.insert(auditLog).values({
      organizationId: who.organizationId,
      userId: who.userId,
      action: "account.create",
      entity: "account",
      entityId: row.id,
      data: { number: row.number },
    });
    return row;
  });
}

/**
 * Met à jour un compte. Un compte système (avec rôle) reste actif, et garde un type compatible :
 * les écritures automatiques en dépendent.
 */
export async function updateAccount(
  database: Db,
  who: Who,
  id: string,
  data: AccountInput,
): Promise<SaveResult> {
  if (!(await canSetUpAccounting(database, who.organizationId, who.userId))) return "forbidden";
  const current = await getAccount(database, who.organizationId, id);
  if (!current) return null;
  if (current.role && !data.active) return "systemInactive";
  if (await numberTaken(database, who.organizationId, data.number, id)) return "numberTaken";
  return database.transaction(async (tx) => {
    const [row] = await tx
      .update(accounts)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(accounts.id, id), eq(accounts.organizationId, who.organizationId)))
      .returning();
    await tx.insert(auditLog).values({
      organizationId: who.organizationId,
      userId: who.userId,
      action: "account.update",
      entity: "account",
      entityId: id,
      data: { number: data.number, active: data.active },
    });
    return row ?? null;
  });
}

// Exercices comptables

export async function listFiscalYears(database: Db, organizationId: string): Promise<FiscalYear[]> {
  return database
    .select()
    .from(fiscalYears)
    .where(eq(fiscalYears.organizationId, organizationId))
    .orderBy(desc(fiscalYears.startDate));
}

type YearResult = FiscalYear | "forbidden" | "exists" | "invalid" | "none";

async function lockAndLatest(tx: Db, organizationId: string) {
  const [org] = await tx
    .select({ startMonth: organizations.fiscalYearStartMonth })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .for("update");
  const [latest] = await tx
    .select()
    .from(fiscalYears)
    .where(eq(fiscalYears.organizationId, organizationId))
    .orderBy(desc(fiscalYears.startDate))
    .limit(1);
  return { startMonth: org?.startMonth ?? 1, latest: latest ?? null };
}

/** Ouvre le premier exercice, qui peut commencer n'importe quel jour. */
export async function createFirstFiscalYear(
  database: Db,
  who: Who,
  input: { start: string; extended: boolean },
): Promise<YearResult> {
  if (!(await canSetUpAccounting(database, who.organizationId, who.userId))) return "forbidden";
  if (!isIsoDate(input.start)) return "invalid";
  return database.transaction(async (tx) => {
    const { startMonth, latest } = await lockAndLatest(tx as unknown as Db, who.organizationId);
    if (latest) return "exists";
    const year = firstFiscalYear(input.start, startMonth, input.extended);
    return insertYear(tx as unknown as Db, who, year.start, year.end);
  });
}

/** Ouvre l'exercice qui suit le dernier, sur douze mois. */
export async function openNextFiscalYear(database: Db, who: Who): Promise<YearResult> {
  if (!(await canSetUpAccounting(database, who.organizationId, who.userId))) return "forbidden";
  return database.transaction(async (tx) => {
    const { latest } = await lockAndLatest(tx as unknown as Db, who.organizationId);
    if (!latest) return "none";
    const year = nextFiscalYear(latest.endDate);
    return insertYear(tx as unknown as Db, who, year.start, year.end);
  });
}

async function insertYear(tx: Db, who: Who, start: string, end: string): Promise<FiscalYear> {
  const [row] = await tx
    .insert(fiscalYears)
    .values({ organizationId: who.organizationId, startDate: start, endDate: end })
    .returning();
  if (!row) throw new Error("fiscal_year_not_saved");
  await tx.insert(auditLog).values({
    organizationId: who.organizationId,
    userId: who.userId,
    action: "fiscal_year.open",
    entity: "fiscal_year",
    entityId: row.id,
    data: { start, end },
  });
  return row;
}
