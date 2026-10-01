"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/server/auth/guard";
import { pickLocale } from "@/server/auth/login-cookie";
import {
  archiveContact,
  type ContactErrors,
  createContact,
  parseContactForm,
  updateContact,
} from "@/server/contacts";
import { db } from "@/server/db";
import { quotaAccess } from "@/server/plans";

export type ContactFormState = {
  status: "idle" | "invalid" | "notFound" | "planLimit";
  errors?: ContactErrors;
  values?: Record<string, string>;
  round: number;
};

export async function saveContact(
  prev: ContactFormState,
  form: FormData,
): Promise<ContactFormState> {
  const locale = pickLocale(form.get("locale"));
  const session = await requirePermission(locale, "billing");
  const who = { organizationId: session.organization.id, userId: session.user.id };
  const id = String(form.get("id") ?? "");
  const values = Object.fromEntries(
    [...form.entries()].filter(([k]) => !k.startsWith("$")).map(([k, v]) => [k, String(v)]),
  );
  const round = prev.round + 1;
  const parsed = parseContactForm(form);
  if (!parsed.ok) return { status: "invalid", errors: parsed.errors, values, round };
  if (id) {
    if (!(await updateContact(db(), who, id, parsed.data))) return { status: "notFound", round };
  } else {
    if (!(await quotaAccess(db(), session.organization, "contacts")).allowed)
      return { status: "planLimit", values, round };
    await createContact(db(), who, parsed.data);
  }
  revalidatePath(`/${locale}/app/contacts`);
  redirect(`/${locale}/app/contacts?saved=1`);
}

export async function archiveContactAction(form: FormData) {
  const locale = pickLocale(form.get("locale"));
  const session = await requirePermission(locale, "billing");
  await archiveContact(
    db(),
    { organizationId: session.organization.id, userId: session.user.id },
    String(form.get("id") ?? ""),
  );
  revalidatePath(`/${locale}/app/contacts`);
  redirect(`/${locale}/app/contacts?archived=1`);
}
