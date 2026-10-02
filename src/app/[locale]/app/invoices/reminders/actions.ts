"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { parseAmountToCents } from "@/lib/amount-input";
import { requirePermission } from "@/server/auth/guard";
import { pickLocale } from "@/server/auth/login-cookie";
import { db } from "@/server/db";
import { auditLog, organizations } from "@/server/db/schema";
import { featureAccess } from "@/server/plans";
import { sendAllReminders, sendReminder, waiveCharges } from "@/server/reminders";

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
  if (
    !featureAccess(session.organization, "reminderAuto").allowed ||
    !featureAccess(session.organization, "reminderCharges").allowed
  )
    redirect(`${path}?settings=plan`);
  const fee = String(form.get("fee") ?? "").trim();
  const feeCents = fee === "" ? 0 : parseAmountToCents(fee);
  const rate = String(form.get("interest") ?? "")
    .trim()
    .replace(",", ".");
  const interest = rate === "" ? null : Number(rate);
  if (feeCents === null || feeCents < 0 || feeCents > 100_000)
    redirect(`${path}?settings=invalidFee`);
  if (interest !== null && !(/^\d{1,2}(\.\d{1,3})?$/.test(rate) && interest <= 20))
    redirect(`${path}?settings=invalidRate`);
  await db()
    .update(organizations)
    .set({
      reminderAuto: form.get("auto") === "on",
      reminderFeeCents: feeCents ?? 0,
      lateInterestBp: interest === null || interest === 0 ? null : Math.round(interest * 1000) / 10,
      updatedAt: new Date(),
    })
    .where(eq(organizations.id, session.organization.id));
  await db()
    .insert(auditLog)
    .values({
      organizationId: session.organization.id,
      userId: session.user.id,
      action: "reminders.settings",
      entity: "organization",
      entityId: session.organization.id,
      data: { auto: form.get("auto") === "on", feeCents, interest },
    });
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
