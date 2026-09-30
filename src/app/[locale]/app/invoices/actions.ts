"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAppSession } from "@/server/auth/guard";
import { pickLocale } from "@/server/auth/login-cookie";
import { db } from "@/server/db";
import {
  createInvoice,
  deleteDraft,
  type InvoiceErrors,
  issueInvoice,
  isVatRegistered,
  parseInvoiceForm,
  updateInvoice,
} from "@/server/invoices";

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
    ? await updateInvoice(db(), who, id, parsed.data)
    : await createInvoice(db(), who, parsed.data);
  if (result === null || result === "notDraft") return { status: "notFound", round };
  if (result === "contact")
    return { status: "invalid", errors: { contactId: "required" }, values, round };
  revalidatePath(`/${locale}/app/invoices`);
  redirect(`/${locale}/app/invoices/${result.id}?saved=1`);
}

export async function issueInvoiceAction(form: FormData) {
  const locale = pickLocale(form.get("locale"));
  const session = await requireAppSession(locale);
  const id = String(form.get("id") ?? "");
  const result = await issueInvoice(
    db(),
    { organizationId: session.organization.id, userId: session.user.id },
    id,
  );
  revalidatePath(`/${locale}/app/invoices`);
  if (typeof result === "string") redirect(`/${locale}/app/invoices/${id}?error=${result}`);
  redirect(`/${locale}/app/invoices/${id}?issued=1`);
}

export async function deleteDraftAction(form: FormData) {
  const locale = pickLocale(form.get("locale"));
  const session = await requireAppSession(locale);
  await deleteDraft(
    db(),
    { organizationId: session.organization.id, userId: session.user.id },
    String(form.get("id") ?? ""),
  );
  revalidatePath(`/${locale}/app/invoices`);
  redirect(`/${locale}/app/invoices?deleted=1`);
}
