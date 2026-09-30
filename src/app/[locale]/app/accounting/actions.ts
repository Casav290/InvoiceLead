"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { parseCamt } from "@/countries/ch/camt";
import { VAT_CODES, type VatCode } from "@/countries/ch/vat";
import { aiConfigured } from "@/server/ai";
import { requireAppSession } from "@/server/auth/guard";
import { pickLocale } from "@/server/auth/login-cookie";
import {
  ignoreTransaction,
  importEntries,
  proposeAll,
  validateConfident,
  validateTransaction,
} from "@/server/bank";
import { deleteRule } from "@/server/booking-rules";
import { db } from "@/server/db";
import { postPending } from "@/server/ledger";
import { matchReceipts, readReceipt, uploadReceipt } from "@/server/receipts";

export async function postPendingAction(form: FormData) {
  const locale = pickLocale(form.get("locale"));
  const session = await requireAppSession(locale);
  const result = await postPending(db(), {
    organizationId: session.organization.id,
    userId: session.user.id,
  });
  revalidatePath(`/${locale}/app/accounting`);
  const q = new URLSearchParams({ posted: String(result.posted) });
  if (result.reason) q.set("reason", result.reason);
  redirect(`/${locale}/app/accounting?${q}`);
}

export async function importStatementAction(form: FormData) {
  const locale = pickLocale(form.get("locale"));
  const session = await requireAppSession(locale);
  const who = { organizationId: session.organization.id, userId: session.user.id };
  const file = form.get("statement");
  const path = `/${locale}/app/accounting/bank`;
  if (!(file instanceof File) || file.size === 0 || file.size > 5_000_000)
    redirect(`${path}?error=file`);
  let statement: ReturnType<typeof parseCamt>;
  try {
    statement = parseCamt(await file.text());
  } catch {
    redirect(`${path}?error=format`);
  }
  const result = await importEntries(db(), who, statement.entries);
  const proposed = await proposeAll(db(), who, {
    language: locale === "fr" ? "fr" : "de",
    useAi: aiConfigured(),
  });
  await matchReceipts(db(), who, locale === "fr" ? "fr" : "de");
  revalidatePath(path);
  const q = new URLSearchParams({
    imported: String(result.imported),
    duplicates: String(result.duplicates),
  });
  if (proposed.aiError) q.set("ai", "error");
  redirect(`${path}?${q}`);
}

export async function proposeAction(form: FormData) {
  const locale = pickLocale(form.get("locale"));
  const session = await requireAppSession(locale);
  const result = await proposeAll(
    db(),
    { organizationId: session.organization.id, userId: session.user.id },
    { language: locale === "fr" ? "fr" : "de", useAi: aiConfigured() },
  );
  revalidatePath(`/${locale}/app/accounting/bank`);
  redirect(`/${locale}/app/accounting/bank${result.aiError ? "?ai=error" : ""}`);
}

export async function validateBankAction(form: FormData) {
  const locale = pickLocale(form.get("locale"));
  const session = await requireAppSession(locale);
  const who = { organizationId: session.organization.id, userId: session.user.id };
  const id = String(form.get("id") ?? "");
  const accountId = String(form.get("accountId") ?? "");
  const vat = String(form.get("vatCode") ?? "");
  const override = accountId
    ? {
        accountId,
        vatCode: (VAT_CODES as readonly string[]).includes(vat) ? (vat as VatCode) : null,
      }
    : undefined;
  const result = await validateTransaction(db(), who, id, override);
  revalidatePath(`/${locale}/app/accounting`, "layout");
  redirect(`/${locale}/app/accounting/bank${result === "posted" ? "" : `?error=${result}`}`);
}

export async function validateConfidentAction(form: FormData) {
  const locale = pickLocale(form.get("locale"));
  const session = await requireAppSession(locale);
  const posted = await validateConfident(db(), {
    organizationId: session.organization.id,
    userId: session.user.id,
  });
  revalidatePath(`/${locale}/app/accounting`, "layout");
  redirect(`/${locale}/app/accounting/bank?validated=${posted}`);
}

export async function ignoreBankAction(form: FormData) {
  const locale = pickLocale(form.get("locale"));
  const session = await requireAppSession(locale);
  await ignoreTransaction(
    db(),
    { organizationId: session.organization.id, userId: session.user.id },
    String(form.get("id") ?? ""),
  );
  revalidatePath(`/${locale}/app/accounting/bank`);
  redirect(`/${locale}/app/accounting/bank`);
}

export async function deleteRuleAction(form: FormData) {
  const locale = pickLocale(form.get("locale"));
  const session = await requireAppSession(locale);
  await deleteRule(
    db(),
    { organizationId: session.organization.id, userId: session.user.id },
    String(form.get("id") ?? ""),
  );
  revalidatePath(`/${locale}/app/accounting/bank`);
  redirect(`/${locale}/app/accounting/bank`);
}

export async function uploadReceiptsAction(form: FormData) {
  const locale = pickLocale(form.get("locale"));
  const session = await requireAppSession(locale);
  const who = { organizationId: session.organization.id, userId: session.user.id };
  const language = locale === "fr" ? "fr" : "de";
  const files = form.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  let added = 0;
  let rejected = 0;
  for (const file of files.slice(0, 20)) {
    const result = await uploadReceipt(db(), who, {
      name: file.name,
      type: file.type,
      bytes: Buffer.from(await file.arrayBuffer()),
    });
    if (typeof result === "string") {
      rejected += 1;
      continue;
    }
    added += 1;
    if (aiConfigured()) await readReceipt(db(), who, result.id, language);
  }
  revalidatePath(`/${locale}/app/accounting`, "layout");
  redirect(`/${locale}/app/accounting/receipts?added=${added}&rejected=${rejected}`);
}

export async function readReceiptAction(form: FormData) {
  const locale = pickLocale(form.get("locale"));
  const session = await requireAppSession(locale);
  const result = await readReceipt(
    db(),
    { organizationId: session.organization.id, userId: session.user.id },
    String(form.get("id") ?? ""),
    locale === "fr" ? "fr" : "de",
  );
  revalidatePath(`/${locale}/app/accounting`, "layout");
  redirect(`/${locale}/app/accounting/receipts${result === "read" ? "" : `?error=${result}`}`);
}
