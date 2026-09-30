import { and, asc, eq, sql } from "drizzle-orm";
import type { Db } from "./db";
import { accounts, type BookingRule, bookingRules } from "./db/schema";

type Who = { organizationId: string; userId: string };

/**
 * Clé d'une contrepartie : minuscules, sans accents, sans forme juridique ni ponctuation.
 * « Swisscom (Schweiz) AG » et « SWISSCOM SCHWEIZ AG » donnent la même clé.
 */
export function counterpartyKey(name: string | null): string | null {
  if (!name) return null;
  const key = name
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(ag|sa|gmbh|sarl|sagl|ltd|inc|kg|cie|co|und|et|the)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return key.length >= 3 ? key : null;
}

export const directionOf = (amountCents: number) => (amountCents > 0 ? "in" : "out");

/** Retient (ou renforce) la règle d'une contrepartie après une validation humaine. */
export async function learnRule(
  database: Db,
  who: Who,
  input: {
    counterparty: string | null;
    amountCents: number;
    accountId: string;
    vatCode: string | null;
  },
) {
  const key = counterpartyKey(input.counterparty);
  if (!key || !input.counterparty) return;
  await database
    .insert(bookingRules)
    .values({
      organizationId: who.organizationId,
      counterpartyKey: key,
      counterpartyLabel: input.counterparty.slice(0, 100),
      direction: directionOf(input.amountCents),
      accountId: input.accountId,
      vatCode: input.vatCode,
      updatedBy: who.userId,
    })
    .onConflictDoUpdate({
      target: [bookingRules.organizationId, bookingRules.counterpartyKey, bookingRules.direction],
      // Même compte : la règle se renforce. Autre compte : la correction la remplace.
      set: {
        hits: sql`case when ${bookingRules.accountId} = excluded.account_id and ${bookingRules.vatCode} is not distinct from excluded.vat_code then ${bookingRules.hits} + 1 else 1 end`,
        accountId: sql`excluded.account_id`,
        vatCode: sql`excluded.vat_code`,
        counterpartyLabel: sql`excluded.counterparty_label`,
        updatedBy: who.userId,
        updatedAt: new Date(),
      },
    });
}

export async function listRules(database: Db, organizationId: string) {
  return database
    .select({
      rule: bookingRules,
      number: accounts.number,
      nameDe: accounts.nameDe,
      nameFr: accounts.nameFr,
    })
    .from(bookingRules)
    .innerJoin(accounts, eq(accounts.id, bookingRules.accountId))
    .where(eq(bookingRules.organizationId, organizationId))
    .orderBy(asc(bookingRules.counterpartyLabel));
}

export async function deleteRule(database: Db, who: Who, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return false;
  const rows = await database
    .delete(bookingRules)
    .where(and(eq(bookingRules.id, id), eq(bookingRules.organizationId, who.organizationId)))
    .returning({ id: bookingRules.id });
  return rows.length > 0;
}

/** Certitude d'une règle : 90 % à la première validation, puis de plus en plus sûre. */
export const ruleConfidence = (rule: Pick<BookingRule, "hits">) =>
  Math.min(0.99, 0.88 + 0.03 * rule.hits);
