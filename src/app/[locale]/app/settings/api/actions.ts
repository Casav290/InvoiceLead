"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createApiKey, revokeApiKey } from "@/server/api-keys";
import { requirePermission } from "@/server/auth/guard";
import { pickLocale } from "@/server/auth/login-cookie";
import { db } from "@/server/db";
import { featureAccess } from "@/server/plans";
import { createEndpoint, disableEndpoint } from "@/server/webhooks";

export type SecretState = { round: number; secret?: string; error?: string };

async function guard(form: FormData) {
  const locale = pickLocale(form.get("locale"));
  const session = await requirePermission(locale, "company");
  const who = { organizationId: session.organization.id, userId: session.user.id };
  return { locale, session, who, allowed: featureAccess(session.organization, "api").allowed };
}

/** Nouvelle clé : rendue une seule fois dans l'état du formulaire, jamais dans l'adresse. */
export async function createApiKeyAction(prev: SecretState, form: FormData): Promise<SecretState> {
  const { locale, who, allowed } = await guard(form);
  const round = prev.round + 1;
  if (!allowed) return { round, error: "plan" };
  const result = await createApiKey(db(), who, String(form.get("name") ?? ""));
  if (typeof result === "string") return { round, error: result };
  revalidatePath(`/${locale}/app/settings/api`);
  return { round, secret: result.key };
}

export async function revokeApiKeyAction(form: FormData) {
  const { locale, who } = await guard(form);
  await revokeApiKey(db(), who, String(form.get("id") ?? ""), "full");
  revalidatePath(`/${locale}/app/settings/api`);
  redirect(`/${locale}/app/settings/api?revoked=1`);
}

export async function createWebhookAction(prev: SecretState, form: FormData): Promise<SecretState> {
  const { locale, who, allowed } = await guard(form);
  const round = prev.round + 1;
  if (!allowed) return { round, error: "plan" };
  const result = await createEndpoint(db(), who, {
    url: String(form.get("url") ?? ""),
    events: form.getAll("events").map(String),
  });
  if (typeof result === "string") return { round, error: result };
  revalidatePath(`/${locale}/app/settings/api`);
  return { round, secret: result.secret };
}

export async function disableWebhookAction(form: FormData) {
  const { locale, who } = await guard(form);
  await disableEndpoint(db(), who, String(form.get("id") ?? ""));
  revalidatePath(`/${locale}/app/settings/api`);
  redirect(`/${locale}/app/settings/api?disabled=1`);
}
