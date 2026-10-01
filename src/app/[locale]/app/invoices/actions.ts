"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requirePermission } from "@/server/auth/guard";
import { pickLocale } from "@/server/auth/login-cookie";
import { db } from "@/server/db";
import {
  convertQuoteToInvoice,
  createCreditNote,
  createDepositInvoice,
  createInvoice,
  type DocumentKind,
  deleteDraft,
  documentLanguage,
  type InvoiceErrors,
  issueInvoice,
  isVatRegistered,
  parseInvoiceForm,
  setQuoteOutcome,
  updateInvoice,
} from "@/server/invoices";
import { postPending } from "@/server/ledger";
import { addPayment, deletePayment, parsePaymentForm } from "@/server/payments";
import { hasFeature, limitReached } from "@/server/plans";
import { flushWebhooks } from "@/server/webhooks";

/** Comptabilise ce qui peut l'être ; une panne ici ne doit jamais bloquer la facturation. */
async function postQuietly(who: { organizationId: string; userId: string }) {
  try {
    await postPending(db(), who);
  } catch (e) {
    console.error("[ledger] comptabilisation reportée", e instanceof Error ? e.message : "inconnu");
  }
}

import { parseSendForm, sendDocument } from "@/server/send";
import { enableShareLink, shareUrl } from "@/server/sharing";

const kindOf = (form: FormData): DocumentKind => {
  const k = form.get("kind");
  return k === "quote" || k === "credit_note" ? k : "invoice";
};
const section = (kind: DocumentKind) =>
  kind === "quote" ? "quotes" : kind === "credit_note" ? "credit-notes" : "invoices";

export type InvoiceFormState = {
  status: "idle" | "invalid" | "notFound";
  errors?: InvoiceErrors;
  values?: Record<string, string | string[]>;
  round: number;
};

const LINE_FIELDS = ["description", "quantity", "unit", "unitPrice", "vatCode", "productId"];

export async function saveInvoice(
  prev: InvoiceFormState,
  form: FormData,
): Promise<InvoiceFormState> {
  const locale = pickLocale(form.get("locale"));
  const session = await requirePermission(locale, "billing");
  const who = { organizationId: session.organization.id, userId: session.user.id };
  const id = String(form.get("id") ?? "");
  const kind = kindOf(form);
  const values: Record<string, string | string[]> = {};
  for (const [k] of form.entries()) {
    if (k.startsWith("$")) continue;
    values[k] = k.startsWith("line.") ? form.getAll(k).map(String) : String(form.get(k));
  }
  for (const f of LINE_FIELDS) values[`line.${f}`] ??= [];
  const round = prev.round + 1;
  const parsed = parseInvoiceForm(form, {
    vatRegistered: await isVatRegistered(db(), who.organizationId),
    country: session.organization.country,
  });
  if (!parsed.ok) return { status: "invalid", errors: parsed.errors, values, round };
  // Facturer dans une autre devise que celle de l'entreprise fait partie de la formule Pro.
  if (
    parsed.data.currency &&
    parsed.data.currency !== session.organization.currency &&
    !hasFeature(session.organization, "multiCurrency")
  )
    return { status: "invalid", errors: { currency: "plan" }, values, round };
  const result = id
    ? await updateInvoice(db(), who, id, parsed.data, kind)
    : await createInvoice(db(), who, parsed.data, kind);
  if (result === null || result === "notDraft") return { status: "notFound", round };
  if (result === "contact")
    return { status: "invalid", errors: { contactId: "required" }, values, round };
  revalidatePath(`/${locale}/app/${section(kind)}`);
  redirect(`/${locale}/app/${section(kind)}/${result.id}?saved=1`);
}

export async function issueInvoiceAction(form: FormData) {
  const locale = pickLocale(form.get("locale"));
  const session = await requirePermission(locale, "billing");
  const id = String(form.get("id") ?? "");
  const path = `/${locale}/app/${section(kindOf(form))}`;
  if (kindOf(form) === "invoice" && (await limitReached(db(), session.organization, "invoice")))
    redirect(`${path}/${id}?error=planLimit`);
  const result = await issueInvoice(
    db(),
    { organizationId: session.organization.id, userId: session.user.id },
    id,
  );
  revalidatePath(path);
  if (typeof result === "string") redirect(`${path}/${id}?error=${result}`);
  await postQuietly({ organizationId: session.organization.id, userId: session.user.id });
  await flushWebhooks(db(), session.organization.id);
  redirect(`${path}/${id}?issued=1`);
}

export async function deleteDraftAction(form: FormData) {
  const locale = pickLocale(form.get("locale"));
  const session = await requirePermission(locale, "billing");
  await deleteDraft(
    db(),
    { organizationId: session.organization.id, userId: session.user.id },
    String(form.get("id") ?? ""),
  );
  const path = `/${locale}/app/${section(kindOf(form))}`;
  revalidatePath(path);
  redirect(`${path}?deleted=1`);
}

export async function quoteOutcomeAction(form: FormData) {
  const locale = pickLocale(form.get("locale"));
  const session = await requirePermission(locale, "billing");
  const id = String(form.get("id") ?? "");
  const outcome = form.get("outcome") === "declined" ? "declined" : "accepted";
  await setQuoteOutcome(
    db(),
    { organizationId: session.organization.id, userId: session.user.id },
    id,
    outcome,
  );
  revalidatePath(`/${locale}/app/quotes`);
  redirect(`/${locale}/app/quotes/${id}`);
}

export async function convertQuoteAction(form: FormData) {
  const locale = pickLocale(form.get("locale"));
  const session = await requirePermission(locale, "billing");
  const id = String(form.get("id") ?? "");
  const result = await convertQuoteToInvoice(
    db(),
    { organizationId: session.organization.id, userId: session.user.id },
    id,
    new Date().toISOString().slice(0, 10),
  );
  revalidatePath(`/${locale}/app/quotes`);
  revalidatePath(`/${locale}/app/invoices`);
  if (typeof result === "string") redirect(`/${locale}/app/quotes/${id}?error=${result}`);
  redirect(`/${locale}/app/invoices/${result.id}?converted=1`);
}

export async function depositInvoiceAction(form: FormData) {
  const locale = pickLocale(form.get("locale"));
  const session = await requirePermission(locale, "billing");
  const id = String(form.get("id") ?? "");
  const percent = Number(String(form.get("percent") ?? "").replace(",", "."));
  const result = await createDepositInvoice(
    db(),
    { organizationId: session.organization.id, userId: session.user.id },
    id,
    percent,
    new Date().toISOString().slice(0, 10),
  );
  revalidatePath(`/${locale}/app/quotes/${id}`);
  if (typeof result === "string") redirect(`/${locale}/app/quotes/${id}?error=${result}`);
  revalidatePath(`/${locale}/app/invoices`);
  redirect(`/${locale}/app/invoices/${result.id}?saved=1`);
}

export async function createCreditNoteAction(form: FormData) {
  const locale = pickLocale(form.get("locale"));
  const session = await requirePermission(locale, "billing");
  const id = String(form.get("id") ?? "");
  const result = await createCreditNote(
    db(),
    { organizationId: session.organization.id, userId: session.user.id },
    id,
    new Date().toISOString().slice(0, 10),
  );
  if (typeof result === "string") redirect(`/${locale}/app/invoices/${id}?error=${result}`);
  revalidatePath(`/${locale}/app/credit-notes`);
  redirect(`/${locale}/app/credit-notes/${result.id}?saved=1`);
}

export type PaymentFormState = {
  status: "idle" | "invalid" | "tooHigh";
  errors?: Record<string, string>;
  values?: Record<string, string>;
  round: number;
};

export async function addPaymentAction(
  prev: PaymentFormState,
  form: FormData,
): Promise<PaymentFormState> {
  const locale = pickLocale(form.get("locale"));
  const session = await requirePermission(locale, "billing");
  const id = String(form.get("id") ?? "");
  const values = Object.fromEntries(
    [...form.entries()].filter(([k]) => !k.startsWith("$")).map(([k, v]) => [k, String(v)]),
  );
  const round = prev.round + 1;
  const parsed = parsePaymentForm(form);
  if (!parsed.ok) return { status: "invalid", errors: parsed.errors, values, round };
  const result = await addPayment(
    db(),
    { organizationId: session.organization.id, userId: session.user.id },
    id,
    parsed.data,
  );
  if (result === "tooHigh") return { status: "tooHigh", values, round };
  if (result === "notFound") return { status: "invalid", values, round };
  await postQuietly({ organizationId: session.organization.id, userId: session.user.id });
  await flushWebhooks(db(), session.organization.id);
  revalidatePath(`/${locale}/app/invoices`);
  redirect(`/${locale}/app/invoices/${id}?paid=1`);
}

export async function deletePaymentAction(form: FormData) {
  const locale = pickLocale(form.get("locale"));
  const session = await requirePermission(locale, "billing");
  const id = String(form.get("id") ?? "");
  const result = await deletePayment(
    db(),
    { organizationId: session.organization.id, userId: session.user.id },
    String(form.get("paymentId") ?? ""),
  );
  revalidatePath(`/${locale}/app/invoices`);
  redirect(`/${locale}/app/invoices/${id}${result === "closed" ? "?error=closed" : ""}`);
}

export type SendFormState = {
  status: "idle" | "invalid" | "sent" | "notConfigured" | "failed" | "notFound";
  errors?: Record<string, string>;
  values?: Record<string, string>;
  round: number;
};

export async function sendDocumentAction(
  prev: SendFormState,
  form: FormData,
): Promise<SendFormState> {
  const locale = pickLocale(form.get("locale"));
  const session = await requirePermission(locale, "billing");
  const id = String(form.get("id") ?? "");
  const values = Object.fromEntries(
    [...form.entries()].filter(([k]) => !k.startsWith("$")).map(([k, v]) => [k, String(v)]),
  );
  const round = prev.round + 1;
  const parsed = parseSendForm(form);
  if (!parsed.ok) return { status: "invalid", errors: parsed.errors, values, round };
  const language = documentLanguage(form.get("language"));
  const t = await getTranslations({ locale: language, namespace: "app.invoices.email" });
  const result = await sendDocument(
    db(),
    { organizationId: session.organization.id, userId: session.user.id },
    id,
    parsed.data,
    t("linkLabel"),
  );
  revalidatePath(`/${locale}/app`, "layout");
  return { status: result, values: result === "sent" ? undefined : values, round };
}

export type LinkState = { url?: string; round: number };

export async function shareLinkAction(prev: LinkState, form: FormData): Promise<LinkState> {
  const locale = pickLocale(form.get("locale"));
  const session = await requirePermission(locale, "billing");
  const id = String(form.get("id") ?? "");
  const token = await enableShareLink(db(), session.organization.id, id);
  const language = documentLanguage(form.get("language"));
  return { url: token ? shareUrl(language, token) : undefined, round: prev.round + 1 };
}
