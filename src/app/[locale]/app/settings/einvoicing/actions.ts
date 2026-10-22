"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/server/auth/guard";
import { pickLocale } from "@/server/auth/login-cookie";
import { db } from "@/server/db";
import { b2brouterFromEnv } from "@/server/einvoicing/b2brouter";
import { registerReception, syncIfStale } from "@/server/einvoicing/reception";

async function guard(form: FormData) {
  const locale = pickLocale(form.get("locale"));
  const session = await requirePermission(locale, "company");
  return {
    locale,
    who: { organizationId: session.organization.id, userId: session.user.id },
    path: `/${locale}/app/settings/einvoicing`,
  };
}

/** Inscription à l'annuaire, seulement avec l'accord coché par la personne. */
export async function registerReceptionAction(form: FormData) {
  const { locale, who, path } = await guard(form);
  if (form.get("consent") !== "on") redirect(`${path}?error=consent`);
  const today = new Date().toISOString().slice(0, 10);
  const code = String(form.get("migrationCode") ?? "").slice(0, 100);
  const result = await registerReception(db(), who, b2brouterFromEnv(), today, code || null);
  revalidatePath(`/${locale}/app/settings`, "layout");
  redirect(typeof result === "string" ? `${path}?error=${result}` : `${path}?registered=1`);
}

/** « Relever maintenant » : au plus une fois par minute. */
export async function syncReceptionAction(form: FormData) {
  const { locale, who, path } = await guard(form);
  const result = await syncIfStale(db(), who.organizationId, b2brouterFromEnv(), 1);
  revalidatePath(`/${locale}/app/accounting`, "layout");
  revalidatePath(path);
  redirect(
    result
      ? `${path}?received=${result.imported + result.stored}${result.error ? "&error=sync" : ""}`
      : `${path}?received=0`,
  );
}
