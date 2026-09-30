"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/server/auth/guard";
import { INVITE_TOKEN, pickLocale } from "@/server/auth/login-cookie";
import { db } from "@/server/db";
import { acceptInvitation, switchOrganization } from "@/server/team";

export async function acceptInvitationAction(form: FormData) {
  const locale = pickLocale(form.get("locale"));
  const session = await requireSession(locale);
  const token = String(form.get("token") ?? "");
  if (!INVITE_TOKEN.test(token)) redirect(`/${locale}/invite?error=invalid`);
  const result = await acceptInvitation(db(), session.user, token);
  if (result.status !== "accepted")
    redirect(`/${locale}/invite?token=${token}&error=${result.status}`);
  await switchOrganization(db(), session.session.id, session.user.id, result.organizationId);
  revalidatePath(`/${locale}/app`, "layout");
  redirect(`/${locale}/app/accounting?welcome=fiduciary`);
}
