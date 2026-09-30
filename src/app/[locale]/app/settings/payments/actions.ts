"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/server/auth/guard";
import { pickLocale } from "@/server/auth/login-cookie";
import { db } from "@/server/db";
import { saveStripeAccount } from "@/server/stripe";

export async function disconnectStripeAction(form: FormData) {
  const locale = pickLocale(form.get("locale"));
  const session = await requirePermission(locale, "company");
  await saveStripeAccount(
    db(),
    { organizationId: session.organization.id, userId: session.user.id },
    null,
  );
  const path = `/${locale}/app/settings/payments`;
  revalidatePath(path);
  redirect(`${path}?disconnected=1`);
}
