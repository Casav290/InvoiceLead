"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createProjectLeadKey, revokeApiKey } from "@/server/api-keys";
import { requirePermission } from "@/server/auth/guard";
import { pickLocale } from "@/server/auth/login-cookie";
import { db } from "@/server/db";
import type { SecretState } from "../api/actions";

async function guard(form: FormData) {
  const locale = pickLocale(form.get("locale"));
  const session = await requirePermission(locale, "company");
  return { locale, who: { organizationId: session.organization.id, userId: session.user.id } };
}

/**
 * Clé qui relie ProjectLead, dans toutes les formules (gratuite comprise) : elle ne peut que lire et
 * créer des contacts et créer des brouillons de factures (api-keys.ts, portée « projectlead »).
 * Rendue une seule fois dans l'état du formulaire, jamais dans l'adresse.
 */
export async function createProjectLeadKeyAction(
  prev: SecretState,
  form: FormData,
): Promise<SecretState> {
  const { locale, who } = await guard(form);
  const round = prev.round + 1;
  const result = await createProjectLeadKey(db(), who);
  if (typeof result === "string") return { round, error: result };
  revalidatePath(`/${locale}/app/settings/projectlead`);
  return { round, secret: result.key };
}

/** Révoque une clé ProjectLead ; une clé d'API complète ne se révoque pas d'ici. */
export async function revokeProjectLeadKeyAction(form: FormData) {
  const { locale, who } = await guard(form);
  await revokeApiKey(db(), who, String(form.get("id") ?? ""), "projectlead");
  revalidatePath(`/${locale}/app/settings/projectlead`);
  redirect(`/${locale}/app/settings/projectlead?revoked=1`);
}
