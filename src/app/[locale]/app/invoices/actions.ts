"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAppSession } from "@/server/auth/guard";
import { pickLocale } from "@/server/auth/login-cookie";
import { db } from "@/server/db";
import {
  convertQuoteToInvoice,
  createInvoice,
  type DocumentKind,
  deleteDraft,
  type InvoiceErrors,
  issueInvoice,
  isVatRegistered,
  parseInvoiceForm,
  setQuoteOutcome,
  updateInvoice,
} from "@/server/invoices";

const kindOf = (form: FormData): DocumentKind =>
  form.get("kind") === "quote" ? "quote" : "invoice";
const section = (kind: DocumentKind) => (kind === "quote" ? "quotes" : "invoices");

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
  const session = await requireAppSession(locale);
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
  });
  if (!parsed.ok) return { status: "invalid", errors: parsed.errors, values, round };
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
  const session = await requireAppSession(locale);
  const id = String(form.get("id") ?? "");
  const path = `/${locale}/app/${section(kindOf(form))}`;
  const result = await issueInvoice(
    db(),
    { organizationId: session.organization.id, userId: session.user.id },
    id,
  );
  revalidatePath(path);
  if (typeof result === "string") redirect(`${path}/${id}?error=${result}`);
  redirect(`${path}/${id}?issued=1`);
}

export async function deleteDraftAction(form: FormData) {
  const locale = pickLocale(form.get("locale"));
  const session = await requireAppSession(locale);
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
  const session = await requireAppSession(locale);
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
  const session = await requireAppSession(locale);
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
