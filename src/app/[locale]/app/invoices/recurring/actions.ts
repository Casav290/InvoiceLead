"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/server/auth/guard";
import { pickLocale } from "@/server/auth/login-cookie";
import { db } from "@/server/db";
import { createRecurring, deleteRecurring, setRecurringActive } from "@/server/recurring";

/**
 * Nouvelle récurrence : formule gratuite, une seule active à la fois (« recurringLimit » au-delà),
 * et pas sur une facture en devise étrangère (« recurringCurrency », multidevise Pro).
 */
export async function createRecurringAction(form: FormData) {
  const locale = pickLocale(form.get("locale"));
  const session = await requirePermission(locale, "billing");
  const id = String(form.get("id") ?? "");
  const result = await createRecurring(
    db(),
    { organizationId: session.organization.id, userId: session.user.id },
    id,
    {
      intervalMonths: Number(form.get("intervalMonths")),
      nextDate: String(form.get("nextDate") ?? ""),
      autoSend: form.get("autoSend") === "on",
    },
  );
  revalidatePath(`/${locale}/app/invoices`, "layout");
  if (result === "planLimit") redirect(`/${locale}/app/invoices/${id}?error=recurringLimit`);
  if (result === "plan") redirect(`/${locale}/app/invoices/${id}?error=recurringCurrency`);
  if (typeof result === "string") redirect(`/${locale}/app/invoices/${id}?error=recurring`);
  redirect(`/${locale}/app/invoices/recurring?created=1`);
}

/** Pause, reprise ou suppression ; reprendre compte comme créer. */
export async function updateRecurringAction(form: FormData) {
  const locale = pickLocale(form.get("locale"));
  const session = await requirePermission(locale, "billing");
  const who = { organizationId: session.organization.id, userId: session.user.id };
  const id = String(form.get("id") ?? "");
  const op = String(form.get("op") ?? "");
  const path = `/${locale}/app/invoices/recurring`;
  const result =
    op === "delete"
      ? await deleteRecurring(db(), who, id)
      : await setRecurringActive(db(), who, id, op === "resume");
  revalidatePath(path);
  redirect(
    result === "planLimit"
      ? `${path}?error=recurringLimit`
      : result === "plan"
        ? `${path}?error=recurringCurrency`
        : path,
  );
}
