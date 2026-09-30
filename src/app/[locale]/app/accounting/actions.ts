"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAppSession } from "@/server/auth/guard";
import { pickLocale } from "@/server/auth/login-cookie";
import { db } from "@/server/db";
import { postPending } from "@/server/ledger";

export async function postPendingAction(form: FormData) {
  const locale = pickLocale(form.get("locale"));
  const session = await requireAppSession(locale);
  const result = await postPending(db(), {
    organizationId: session.organization.id,
    userId: session.user.id,
  });
  revalidatePath(`/${locale}/app/accounting`);
  const q = new URLSearchParams({ posted: String(result.posted) });
  if (result.reason) q.set("reason", result.reason);
  redirect(`/${locale}/app/accounting?${q}`);
}
