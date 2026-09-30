"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAppSession } from "@/server/auth/guard";
import { pickLocale } from "@/server/auth/login-cookie";
import { db } from "@/server/db";
import { createRecurring, deleteRecurring, setRecurringActive } from "@/server/recurring";

export async function createRecurringAction(form: FormData) {
  const locale = pickLocale(form.get("locale"));
  const session = await requireAppSession(locale);
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
  if (typeof result === "string") redirect(`/${locale}/app/invoices/${id}?error=recurring`);
  redirect(`/${locale}/app/invoices/recurring?created=1`);
}

export async function updateRecurringAction(form: FormData) {
  const locale = pickLocale(form.get("locale"));
  const session = await requireAppSession(locale);
  const who = { organizationId: session.organization.id, userId: session.user.id };
  const id = String(form.get("id") ?? "");
  const op = String(form.get("op") ?? "");
  if (op === "delete") await deleteRecurring(db(), who, id);
  else await setRecurringActive(db(), who, id, op === "resume");
  revalidatePath(`/${locale}/app/invoices/recurring`);
  redirect(`/${locale}/app/invoices/recurring`);
}
