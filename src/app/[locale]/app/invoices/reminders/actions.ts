"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/server/auth/guard";
import { pickLocale } from "@/server/auth/login-cookie";
import { db } from "@/server/db";
import { sendAllReminders, sendReminder } from "@/server/reminders";

const today = () => new Date().toISOString().slice(0, 10);

export async function sendReminderAction(form: FormData) {
  const locale = pickLocale(form.get("locale"));
  const session = await requirePermission(locale, "billing");
  const result = await sendReminder(
    db(),
    { organizationId: session.organization.id, userId: session.user.id },
    String(form.get("id") ?? ""),
    today(),
    form.get("manual") === "1",
  );
  revalidatePath(`/${locale}/app/invoices`, "layout");
  redirect(`/${locale}/app/invoices/reminders?result=${result}`);
}

export async function sendAllRemindersAction(form: FormData) {
  const locale = pickLocale(form.get("locale"));
  const session = await requirePermission(locale, "billing");
  const { sent } = await sendAllReminders(
    db(),
    { organizationId: session.organization.id, userId: session.user.id },
    today(),
  );
  revalidatePath(`/${locale}/app/invoices`, "layout");
  redirect(`/${locale}/app/invoices/reminders?sent=${sent}`);
}
