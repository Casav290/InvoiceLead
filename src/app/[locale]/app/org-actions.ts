"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/server/auth/guard";
import { pickLocale } from "@/server/auth/login-cookie";
import { db } from "@/server/db";
import { switchOrganization } from "@/server/team";

/** Change l'entreprise de la session (fiduciaire qui passe d'un client à l'autre). */
export async function switchOrgAction(form: FormData) {
  const locale = pickLocale(form.get("locale"));
  const session = await requireSession(locale);
  await switchOrganization(
    db(),
    session.session.id,
    session.user.id,
    String(form.get("organizationId") ?? ""),
  );
  revalidatePath(`/${locale}/app`, "layout");
  redirect(`/${locale}/app`);
}
