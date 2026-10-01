"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { VAT_CODES, type VatCode } from "@/countries/ch/vat";
import { aiConfigured } from "@/server/ai";
import { requirePermission } from "@/server/auth/guard";
import { pickLocale } from "@/server/auth/login-cookie";
import { approveReview, runAutopilot, undoAutoPosting } from "@/server/autopilot";
import {
  ignoreTransaction,
  importStatement,
  proposeAll,
  validateConfident,
  validateTransaction,
} from "@/server/bank";
import { deleteRule } from "@/server/booking-rules";
import { db } from "@/server/db";
import { auditLog, organizations } from "@/server/db/schema";
import { postPending } from "@/server/ledger";
import { featureAccess, quotaAccess } from "@/server/plans";
import { matchReceipts, readReceipt, uploadReceipt } from "@/server/receipts";
import { aiReview, draftVatReturn, validateVatReturn } from "@/server/vat-return";
import { flushWebhooks } from "@/server/webhooks";

export async function postPendingAction(form: FormData) {
  const locale = pickLocale(form.get("locale"));
  const session = await requirePermission(locale, "accounting");
  const result = await postPending(db(), {
    organizationId: session.organization.id,
    userId: session.user.id,
  });
  revalidatePath(`/${locale}/app/accounting`);
  const q = new URLSearchParams({ posted: String(result.posted) });
  if (result.reason) q.set("reason", result.reason);
  redirect(`/${locale}/app/accounting?${q}`);
}

/**
 * Import d'un relevé camt. Formule gratuite : un relevé par mois (le pilote automatique compris) ;
 * au-delà, ou pour une demande forgée, le serveur refuse avec « quota ».
 */
export async function importStatementAction(form: FormData) {
  const locale = pickLocale(form.get("locale"));
  const session = await requirePermission(locale, "accounting");
  const who = { organizationId: session.organization.id, userId: session.user.id };
  const file = form.get("statement");
  const path = `/${locale}/app/accounting/bank`;
  if (!(file instanceof File) || file.size === 0 || file.size > 5_000_000)
    redirect(`${path}?error=file`);
  const result = await importStatement(db(), who, await file.text());
  if (typeof result === "string") redirect(`${path}?error=${result}`);
  const proposed = await proposeAll(db(), who, {
    language: locale,
    useAi: aiConfigured(),
  });
  await matchReceipts(db(), who, locale);
  const auto = await runAutopilot(db(), who);
  await flushWebhooks(db(), who.organizationId);
  revalidatePath(path);
  const q = new URLSearchParams({
    imported: String(result.imported),
    duplicates: String(result.duplicates),
  });
  if (auto > 0) q.set("auto", String(auto));
  if (proposed.aiError) q.set("ai", "error");
  redirect(`${path}?${q}`);
}

export async function proposeAction(form: FormData) {
  const locale = pickLocale(form.get("locale"));
  const session = await requirePermission(locale, "accounting");
  const who = { organizationId: session.organization.id, userId: session.user.id };
  const result = await proposeAll(db(), who, { language: locale, useAi: aiConfigured() });
  const auto = await runAutopilot(db(), who);
  await flushWebhooks(db(), who.organizationId);
  revalidatePath(`/${locale}/app/accounting/bank`);
  const q = new URLSearchParams();
  if (result.aiError) q.set("ai", "error");
  if (auto > 0) q.set("auto", String(auto));
  redirect(`/${locale}/app/accounting/bank${q.size > 0 ? `?${q}` : ""}`);
}

export async function validateBankAction(form: FormData) {
  const locale = pickLocale(form.get("locale"));
  const session = await requirePermission(locale, "accounting");
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
  await flushWebhooks(db(), who.organizationId);
  revalidatePath(`/${locale}/app/accounting`, "layout");
  redirect(`/${locale}/app/accounting/bank${result === "posted" ? "" : `?error=${result}`}`);
}

export async function validateConfidentAction(form: FormData) {
  const locale = pickLocale(form.get("locale"));
  const session = await requirePermission(locale, "accounting");
  const posted = await validateConfident(db(), {
    organizationId: session.organization.id,
    userId: session.user.id,
  });
  await flushWebhooks(db(), session.organization.id);
  revalidatePath(`/${locale}/app/accounting`, "layout");
  redirect(`/${locale}/app/accounting/bank?validated=${posted}`);
}

export async function ignoreBankAction(form: FormData) {
  const locale = pickLocale(form.get("locale"));
  const session = await requirePermission(locale, "accounting");
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
  const session = await requirePermission(locale, "accounting");
  await deleteRule(
    db(),
    { organizationId: session.organization.id, userId: session.user.id },
    String(form.get("id") ?? ""),
  );
  revalidatePath(`/${locale}/app/accounting/bank`);
  redirect(`/${locale}/app/accounting/bank`);
}

/**
 * Boîte des justificatifs (et capture du téléphone) : chaque pièce lue par l'IA compte dans les
 * lectures du mois (Gratuit 20, Pro 50, Pro+ 300). Une pièce au-delà de l'allocation est refusée.
 */
export async function uploadReceiptsAction(form: FormData) {
  const locale = pickLocale(form.get("locale"));
  const session = await requirePermission(locale, "accounting");
  const who = { organizationId: session.organization.id, userId: session.user.id };
  const language = locale;
  const files = form.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  const ai = aiConfigured();
  let added = 0;
  let rejected = 0;
  let quota = false;
  let last = "";
  for (const file of files.slice(0, 20)) {
    if (ai && !(await quotaAccess(db(), session.organization, "aiReads")).allowed) {
      rejected += 1;
      quota = true;
      continue;
    }
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
    last = result.id;
    if (ai && (await readReceipt(db(), who, result.id, language)) === "quota") quota = true;
  }
  revalidatePath(`/${locale}/app/accounting`, "layout");
  const q = new URLSearchParams({ added: String(added), rejected: String(rejected) });
  if (quota) q.set("quota", "1");
  // Depuis l'écran de capture du téléphone : on y revient, avec ce qui vient d'être lu.
  if (form.get("from") === "capture") {
    if (last) q.set("last", last);
    redirect(`/${locale}/app/accounting/receipts/capture?${q}`);
  }
  redirect(`/${locale}/app/accounting/receipts?${q}`);
}

/** Lire ou relire une pièce : une lecture du mois, refusée au-delà de l'allocation. */
export async function readReceiptAction(form: FormData) {
  const locale = pickLocale(form.get("locale"));
  const session = await requirePermission(locale, "accounting");
  const result = await readReceipt(
    db(),
    { organizationId: session.organization.id, userId: session.user.id },
    String(form.get("id") ?? ""),
    locale,
  );
  revalidatePath(`/${locale}/app/accounting`, "layout");
  redirect(`/${locale}/app/accounting/receipts${result === "read" ? "" : `?error=${result}`}`);
}

export async function validateVatAction(form: FormData) {
  const locale = pickLocale(form.get("locale"));
  const session = await requirePermission(locale, "accounting");
  const start = String(form.get("start") ?? "");
  const end = String(form.get("end") ?? "");
  if (!featureAccess(session.organization, "vatReturn").allowed)
    redirect(`/${locale}/app/accounting/vat?period=${start}&error=plan`);
  const result = await validateVatReturn(
    db(),
    { organizationId: session.organization.id, userId: session.user.id },
    start,
    end,
  );
  revalidatePath(`/${locale}/app/accounting`, "layout");
  redirect(
    `/${locale}/app/accounting/vat?period=${start}${result === "validated" ? "&validated=1" : `&error=${result}`}`,
  );
}

export type ReviewState = { points?: string[]; failed?: boolean; plan?: boolean; round: number };

/** Relecture du décompte par l'IA : elle fait partie du décompte TVA, donc de la formule Pro. */
export async function reviewVatAction(prev: ReviewState, form: FormData): Promise<ReviewState> {
  const locale = pickLocale(form.get("locale"));
  const session = await requirePermission(locale, "accounting");
  const start = String(form.get("start") ?? "");
  const end = String(form.get("end") ?? "");
  if (!featureAccess(session.organization, "vatReturn").allowed)
    return { plan: true, round: prev.round + 1 };
  try {
    const draft = await draftVatReturn(db(), session.organization.id, start, end);
    const points = await aiReview(db(), session.organization.id, start, end, draft, locale);
    return { points, round: prev.round + 1 };
  } catch (e) {
    console.error("[vat] relecture impossible", e instanceof Error ? e.message : "inconnu");
    return { failed: true, round: prev.round + 1 };
  }
}

/**
 * Active ou coupe le pilote automatique ; à l'activation, il passe tout de suite ce qui est sûr.
 * Ouvert à toutes les formules (le récapitulatif du lundi par e-mail reste dans Pro).
 */
export async function autopilotAction(form: FormData) {
  const locale = pickLocale(form.get("locale"));
  const session = await requirePermission(locale, "setup");
  const who = { organizationId: session.organization.id, userId: session.user.id };
  const path = `/${locale}/app/accounting/review`;
  const on = form.get("autopilot") === "on";
  await db()
    .update(organizations)
    .set({ autopilot: on })
    .where(eq(organizations.id, who.organizationId));
  await db()
    .insert(auditLog)
    .values({
      organizationId: who.organizationId,
      userId: who.userId,
      action: on ? "autopilot.enable" : "autopilot.disable",
      entity: "organization",
      entityId: who.organizationId,
    });
  const auto = on ? await runAutopilot(db(), who) : 0;
  await flushWebhooks(db(), who.organizationId);
  revalidatePath(`/${locale}/app/accounting`, "layout");
  redirect(`${path}?${on ? `enabled=1&auto=${auto}` : "disabled=1"}`);
}

export async function approveReviewAction(form: FormData) {
  const locale = pickLocale(form.get("locale"));
  const session = await requirePermission(locale, "accounting");
  const count = await approveReview(db(), {
    organizationId: session.organization.id,
    userId: session.user.id,
  });
  revalidatePath(`/${locale}/app/accounting`, "layout");
  redirect(`/${locale}/app/accounting/review?approved=${count}`);
}

export async function undoAutoAction(form: FormData) {
  const locale = pickLocale(form.get("locale"));
  const session = await requirePermission(locale, "accounting");
  const result = await undoAutoPosting(
    db(),
    { organizationId: session.organization.id, userId: session.user.id },
    String(form.get("id") ?? ""),
  );
  await flushWebhooks(db(), session.organization.id);
  revalidatePath(`/${locale}/app/accounting`, "layout");
  redirect(
    `/${locale}/app/accounting/review?${result === "undone" ? "undone=1" : `error=${result}`}`,
  );
}
