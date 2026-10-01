import { and, asc, eq, inArray } from "drizzle-orm";
import type { ExportEntry } from "@/lib/ledger-export";
import type { Db } from "./db";
import { accounts, journalEntries, journalLines } from "./db/schema";

/** Écritures d'un exercice, dans l'ordre, avec leurs lignes, pour les exports DATEV et FEC. */
export async function exportEntries(
  database: Db,
  organizationId: string,
  fiscalYearId: string,
): Promise<ExportEntry[]> {
  const entries = await database
    .select()
    .from(journalEntries)
    .where(
      and(
        eq(journalEntries.organizationId, organizationId),
        eq(journalEntries.fiscalYearId, fiscalYearId),
      ),
    )
    .orderBy(asc(journalEntries.number));
  if (entries.length === 0) return [];
  const lines = await database
    .select({
      entryId: journalLines.entryId,
      accountNumber: accounts.number,
      accountName: accounts.nameFr,
      debitCents: journalLines.debitCents,
      creditCents: journalLines.creditCents,
      vatRateBp: journalLines.vatRateBp,
      vatBaseCents: journalLines.vatBaseCents,
      role: accounts.role,
    })
    .from(journalLines)
    .innerJoin(accounts, eq(accounts.id, journalLines.accountId))
    .where(
      inArray(
        journalLines.entryId,
        entries.map((e) => e.id),
      ),
    )
    .orderBy(asc(journalLines.position));
  const byEntry = new Map<string, ExportEntry["lines"]>();
  for (const l of lines)
    byEntry.set(l.entryId, [
      ...(byEntry.get(l.entryId) ?? []),
      {
        accountNumber: l.accountNumber,
        accountName: l.accountName,
        debitCents: l.debitCents,
        creditCents: l.creditCents,
        vatRateBp: l.vatRateBp,
        isVat: l.vatBaseCents !== null,
        vatSide:
          l.role === "vat_output" ? "output" : l.role?.startsWith("vat_input") ? "input" : null,
      },
    ]);
  return entries.map((e) => ({
    number: e.number,
    entryDate: e.entryDate,
    description: e.description,
    sourceType: e.sourceType,
    recordedOn: e.createdAt.toISOString().slice(0, 10),
    lines: byEntry.get(e.id) ?? [],
  }));
}
