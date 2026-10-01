"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/server/auth/guard";
import { pickLocale } from "@/server/auth/login-cookie";
import { db } from "@/server/db";
import {
  addEntry,
  createProject,
  deleteEntry,
  invoiceProject,
  parseEntryForm,
  parseProjectForm,
  setProjectArchived,
  startTimer,
  stopTimer,
  updateProject,
} from "@/server/time";

async function guard(form: FormData) {
  const locale = pickLocale(form.get("locale"));
  const session = await requirePermission(locale, "billing");
  return {
    locale,
    who: { organizationId: session.organization.id, userId: session.user.id },
    back: String(form.get("back") ?? "") || `/${locale}/app/time`,
  };
}

const safeBack = (locale: string, back: string) =>
  back.startsWith(`/${locale}/app/time`) ? back : `/${locale}/app/time`;

export async function startTimerAction(form: FormData) {
  const { locale, who, back } = await guard(form);
  const result = await startTimer(
    db(),
    who,
    String(form.get("projectId") ?? ""),
    String(form.get("description") ?? "").trim() || null,
  );
  revalidatePath(`/${locale}/app/time`, "layout");
  redirect(`${safeBack(locale, back)}${result === "project" ? "?error=project" : ""}`);
}

export async function stopTimerAction(form: FormData) {
  const { locale, who, back } = await guard(form);
  await stopTimer(db(), who);
  revalidatePath(`/${locale}/app/time`, "layout");
  redirect(`${safeBack(locale, back)}?stopped=1`);
}

export async function addEntryAction(form: FormData) {
  const { locale, who, back } = await guard(form);
  const parsed = parseEntryForm(form);
  const target = safeBack(locale, back);
  if (!parsed.ok) redirect(`${target}?error=${Object.values(parsed.errors)[0] ?? "invalid"}`);
  const result = await addEntry(db(), who, parsed.data);
  revalidatePath(`/${locale}/app/time`, "layout");
  redirect(`${target}?${result === "project" ? "error=project" : "added=1"}`);
}

export async function deleteEntryAction(form: FormData) {
  const { locale, who, back } = await guard(form);
  await deleteEntry(db(), who, String(form.get("id") ?? ""));
  revalidatePath(`/${locale}/app/time`, "layout");
  redirect(safeBack(locale, back));
}

export async function saveProjectAction(form: FormData) {
  const { locale, who } = await guard(form);
  const parsed = parseProjectForm(form);
  const id = String(form.get("id") ?? "");
  const base = `/${locale}/app/time/projects${id ? `/${id}` : ""}`;
  if (!parsed.ok) redirect(`${base}?error=${Object.values(parsed.errors)[0] ?? "invalid"}`);
  const result = id
    ? await updateProject(db(), who, id, parsed.data)
    : await createProject(db(), who, parsed.data);
  if (!result || result === "contact") redirect(`${base}?error=contact`);
  revalidatePath(`/${locale}/app/time`, "layout");
  redirect(`/${locale}/app/time/projects/${result.id}?saved=1`);
}

export async function archiveProjectAction(form: FormData) {
  const { locale, who } = await guard(form);
  const id = String(form.get("id") ?? "");
  await setProjectArchived(db(), who, id, form.get("archived") === "1");
  revalidatePath(`/${locale}/app/time`, "layout");
  redirect(`/${locale}/app/time/projects/${id}`);
}

export async function invoiceProjectAction(form: FormData) {
  const { locale, who } = await guard(form);
  const id = String(form.get("id") ?? "");
  const result = await invoiceProject(db(), who, id, new Date().toISOString().slice(0, 10));
  revalidatePath(`/${locale}/app`, "layout");
  if (typeof result === "string") redirect(`/${locale}/app/time/projects/${id}?error=${result}`);
  redirect(`/${locale}/app/invoices/${result.invoiceId}?saved=1`);
}
