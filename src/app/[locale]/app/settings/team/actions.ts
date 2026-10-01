"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requirePermission } from "@/server/auth/guard";
import { pickLocale } from "@/server/auth/login-cookie";
import { db } from "@/server/db";
import { emailConfigured, sendEmail } from "@/server/email";
import { env } from "@/server/env";
import { featureAccess } from "@/server/plans";
import {
  cancelInvitation,
  INVITATION_DAYS,
  inviteFiduciary,
  removeFiduciary,
  setAppRole,
} from "@/server/team";

export async function setAppRoleAction(form: FormData) {
  const locale = pickLocale(form.get("locale"));
  const session = await requirePermission(locale, "company");
  const result = await setAppRole(
    db(),
    { organizationId: session.organization.id, userId: session.user.id },
    String(form.get("userId") ?? ""),
    String(form.get("appRole") ?? ""),
  );
  const path = `/${locale}/app/settings/team`;
  revalidatePath(path);
  redirect(result === "saved" ? `${path}?saved=1` : path);
}

export type InviteState = {
  round: number;
  status?: "invited" | "linkOnly";
  error?: "invalid" | "forbidden" | "plan" | "failed";
  email?: string;
  link?: string;
};

export async function inviteFiduciaryAction(prev: InviteState, form: FormData) {
  const locale = pickLocale(form.get("locale"));
  const session = await requirePermission(locale, "company");
  const round = prev.round + 1;
  if (!featureAccess(session.organization, "fiduciary").allowed)
    return { round, error: "plan" as const };
  const result = await inviteFiduciary(
    db(),
    { organizationId: session.organization.id, userId: session.user.id },
    String(form.get("email") ?? ""),
  );
  if (result === "invalid" || result === "forbidden") return { round, error: result };
  const link = `${env().APP_URL}/${locale}/invite?token=${result.token}`;
  revalidatePath(`/${locale}/app/settings/team`);
  if (!emailConfigured()) return { round, status: "linkOnly" as const, email: result.email, link };
  const t = await getTranslations({ locale, namespace: "app.team" });
  const org = session.organization.name;
  try {
    await sendEmail({
      to: result.email,
      subject: t("emailSubject", { org }),
      text: `${t("emailBody", { org, days: INVITATION_DAYS })}\n${link}`,
      replyTo: session.user.email,
      fromName: org,
    });
  } catch (e) {
    console.error("[team] invitation", e instanceof Error ? e.message : "inconnu");
    return { round, error: "failed" as const, email: result.email, link };
  }
  return { round, status: "invited" as const, email: result.email, link };
}

export async function removeFiduciaryAction(form: FormData) {
  const locale = pickLocale(form.get("locale"));
  const session = await requirePermission(locale, "company");
  const result = await removeFiduciary(
    db(),
    { organizationId: session.organization.id, userId: session.user.id },
    String(form.get("userId") ?? ""),
  );
  const path = `/${locale}/app/settings/team`;
  revalidatePath(path);
  redirect(result === "removed" ? `${path}?removed=1` : path);
}

export async function cancelInvitationAction(form: FormData) {
  const locale = pickLocale(form.get("locale"));
  const session = await requirePermission(locale, "company");
  await cancelInvitation(
    db(),
    { organizationId: session.organization.id, userId: session.user.id },
    String(form.get("id") ?? ""),
  );
  const path = `/${locale}/app/settings/team`;
  revalidatePath(path);
  redirect(path);
}
