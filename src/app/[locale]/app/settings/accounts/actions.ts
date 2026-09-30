"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { CHART_TEMPLATES, type ChartTemplate } from "@/countries/ch/chart-of-accounts";
import {
  type AccountErrors,
  createAccount,
  installChart,
  parseAccountForm,
  updateAccount,
} from "@/server/accounting";
import { requirePermission } from "@/server/auth/guard";
import { pickLocale } from "@/server/auth/login-cookie";
import { db } from "@/server/db";

export type AccountFormState = {
  status: "idle" | "invalid" | "notFound" | "forbidden";
  errors?: AccountErrors;
  values?: Record<string, string>;
  round: number;
};

export async function saveAccount(
  prev: AccountFormState,
  form: FormData,
): Promise<AccountFormState> {
  const locale = pickLocale(form.get("locale"));
  const session = await requirePermission(locale, "setup");
  const who = { organizationId: session.organization.id, userId: session.user.id };
  const id = String(form.get("id") ?? "");
  const values = Object.fromEntries(
    [...form.entries()].filter(([k]) => !k.startsWith("$")).map(([k, v]) => [k, String(v)]),
  );
  const round = prev.round + 1;
  const parsed = parseAccountForm(form);
  if (!parsed.ok) return { status: "invalid", errors: parsed.errors, values, round };
  const result = id
    ? await updateAccount(db(), who, id, parsed.data)
    : await createAccount(db(), who, parsed.data);
  if (result === null) return { status: "notFound", round };
  if (result === "forbidden") return { status: "forbidden", values, round };
  if (result === "numberTaken")
    return { status: "invalid", errors: { number: "numberTaken" }, values, round };
  if (result === "systemInactive")
    return { status: "invalid", errors: { active: "systemInactive" }, values, round };
  revalidatePath(`/${locale}/app/settings/accounts`);
  redirect(`/${locale}/app/settings/accounts?saved=1`);
}

export async function installChartAction(form: FormData) {
  const locale = pickLocale(form.get("locale"));
  const session = await requirePermission(locale, "setup");
  const raw = String(form.get("template") ?? "");
  const template = (CHART_TEMPLATES as readonly string[]).includes(raw)
    ? (raw as ChartTemplate)
    : "sole_proprietorship";
  await installChart(
    db(),
    { organizationId: session.organization.id, userId: session.user.id },
    template,
  );
  revalidatePath(`/${locale}/app/settings/accounts`);
  redirect(`/${locale}/app/settings/accounts?installed=1`);
}
