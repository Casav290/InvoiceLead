"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createFirstFiscalYear, openNextFiscalYear } from "@/server/accounting";
import { requireAppSession } from "@/server/auth/guard";
import { pickLocale } from "@/server/auth/login-cookie";
import { closeFiscalYear } from "@/server/closing";
import { db } from "@/server/db";

export async function openFirstFiscalYearAction(form: FormData) {
  const locale = pickLocale(form.get("locale"));
  const session = await requireAppSession(locale);
  const result = await createFirstFiscalYear(
    db(),
    { organizationId: session.organization.id, userId: session.user.id },
    { start: String(form.get("start") ?? ""), extended: form.get("extended") === "on" },
  );
  const path = `/${locale}/app/settings/fiscal-years`;
  if (result === "invalid") redirect(`${path}?error=date`);
  revalidatePath(path);
  redirect(typeof result === "string" ? path : `${path}?opened=1`);
}

export async function openNextFiscalYearAction(form: FormData) {
  const locale = pickLocale(form.get("locale"));
  const session = await requireAppSession(locale);
  const result = await openNextFiscalYear(db(), {
    organizationId: session.organization.id,
    userId: session.user.id,
  });
  const path = `/${locale}/app/settings/fiscal-years`;
  revalidatePath(path);
  redirect(typeof result === "string" ? path : `${path}?opened=1`);
}

export async function closeFiscalYearAction(form: FormData) {
  const locale = pickLocale(form.get("locale"));
  const session = await requireAppSession(locale);
  const path = `/${locale}/app/settings/fiscal-years`;
  if (form.get("confirm") !== "on") redirect(`${path}?closeError=confirm`);
  const result = await closeFiscalYear(
    db(),
    { organizationId: session.organization.id, userId: session.user.id },
    String(form.get("id") ?? ""),
  );
  revalidatePath(`/${locale}/app`, "layout");
  redirect(result.ok ? `${path}?closed=1` : `${path}?closeError=${result.reason}`);
}
