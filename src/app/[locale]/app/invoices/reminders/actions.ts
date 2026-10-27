"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/server/auth/guard";
import { pickLocale } from "@/server/auth/login-cookie";
import { db } from "@/server/db";
import {
  saveReminderSettings,
  sendAllReminders,
  sendReminder,
  waiveCharges,
} from "@/server/reminders";

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
  const { sent, quotaReached } = await sendAllReminders(
    db(),
    { organizationId: session.organization.id, userId: session.user.id },
    today(),
  );
  revalidatePath(`/${locale}/app/invoices`, "layout");
  redirect(`/${locale}/app/invoices/reminders?sent=${sent}${quotaReached ? "&result=quota" : ""}`);
}

/**
 * Réglages des relances : envoi automatique, frais dès la deuxième relance, intérêt moratoire.
 * Formule Pro : en formule gratuite, ils restent visibles mais grisés, et le serveur refuse.
 */
export async function saveReminderSettingsAction(form: FormData) {
  const locale = pickLocale(form.get("locale"));
  const session = await requirePermission(locale, "company");
  const path = `/${locale}/app/invoices/reminders`;
  const result = await saveReminderSettings(
    db(),
    { organizationId: session.organization.id, userId: session.user.id },
    session.organization,
    {
      auto: form.get("auto") === "on",
      fee: String(form.get("fee") ?? ""),
      interest: String(form.get("interest") ?? ""),
    },
  );
  if (result !== "saved") redirect(`${path}?settings=${result}`);
  revalidatePath(path);
  redirect(`${path}?settings=saved`);
}

export async function waiveChargesAction(form: FormData) {
  const locale = pickLocale(form.get("locale"));
  const session = await requirePermission(locale, "billing");
  const id = String(form.get("id") ?? "");
  const result = await waiveCharges(
    db(),
    { organizationId: session.organization.id, userId: session.user.id },
    id,
    today(),
  );
  revalidatePath(`/${locale}/app/invoices`, "layout");
  redirect(`/${locale}/app/invoices/${id}${result === "closed" ? "?error=closed" : "?waived=1"}`);
}
