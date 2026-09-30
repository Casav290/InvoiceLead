"use server";

import { redirect } from "next/navigation";
import { requirePermission } from "@/server/auth/guard";
import { pickLocale } from "@/server/auth/login-cookie";
import { decodeHandoff, importHandoff } from "@/server/crmlead";
import { db } from "@/server/db";
import { limitReached } from "@/server/plans";

export async function importCrmleadAction(form: FormData) {
  const locale = pickLocale(form.get("locale"));
  const session = await requirePermission(locale, "billing");
  const payload = String(form.get("d") ?? "");
  const handoff = decodeHandoff(payload);
  const back = `/${locale}/app/import/crmlead?d=${payload}`;
  if (!handoff) redirect(`/${locale}/app/import/crmlead?error=invalid`);
  const result = await importHandoff(
    db(),
    { organizationId: session.organization.id, userId: session.user.id },
    handoff,
    {
      language: locale,
      today: new Date().toISOString().slice(0, 10),
      canCreateContact: !(await limitReached(db(), session.organization, "contact")),
    },
  );
  if (result.status === "contactLimit") redirect(`${back}&error=contactLimit`);
  const section = result.kind === "quote" ? "quotes" : "invoices";
  redirect(`/${locale}/app/${section}/${result.id}?from=crmlead`);
}
