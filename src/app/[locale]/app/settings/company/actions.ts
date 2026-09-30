"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/server/auth/guard";
import { pickLocale } from "@/server/auth/login-cookie";
import { type CompanyErrors, parseCompanyForm, saveCompanySettings } from "@/server/company";
import { db } from "@/server/db";

export type CompanyFormState = {
  status: "idle" | "saved" | "invalid" | "forbidden";
  errors?: CompanyErrors;
  values?: Record<string, string>;
  /** Change à chaque envoi pour remonter le formulaire avec les valeurs saisies. */
  round: number;
};

export async function saveCompany(
  prev: CompanyFormState,
  form: FormData,
): Promise<CompanyFormState> {
  const locale = pickLocale(form.get("locale"));
  const session = await requirePermission(locale, "company");
  const values = Object.fromEntries(
    [...form.entries()].filter(([k]) => !k.startsWith("$")).map(([k, v]) => [k, String(v)]),
  );
  const round = prev.round + 1;
  const parsed = parseCompanyForm(form);
  if (!parsed.ok) return { status: "invalid", errors: parsed.errors, values, round };
  const result = await saveCompanySettings(
    db(),
    { organizationId: session.organization.id, userId: session.user.id },
    parsed.data,
  );
  if (result === "forbidden") return { status: "forbidden", values, round };
  if (result === "countryLocked")
    return { status: "invalid", errors: { country: "countryLocked" }, values, round };
  revalidatePath(`/${locale}/app`, "layout");
  return { status: "saved", round };
}
