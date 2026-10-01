"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { requirePermission } from "@/server/auth/guard";
import { pickLocale } from "@/server/auth/login-cookie";
import { db } from "@/server/db";
import { emailConfigured, sendEmail } from "@/server/email";
import { env } from "@/server/env";
import { inviteMember } from "@/server/lead-id/members";
import { hasFeature, seatsOf, upgradeUrl } from "@/server/plans";
import {
  cancelInvitation,
  INVITATION_DAYS,
  inviteFiduciary,
  listTeam,
  removeFiduciary,
  seated,
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
  if (!hasFeature(session.organization, "fiduciary")) return { round, error: "plan" as const };
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

export type MemberInviteState = {
  round: number;
  status?: "invited" | "resent";
  error?:
    | "invalid"
    | "adminOnly"
    | "seatLimit"
    | "alreadyMember"
    | "notSent"
    | "tooMany"
    | "failed";
  /** Adresse invitée ; après une erreur, ce qui était saisi, pour le reproposer. */
  email?: string;
  name?: string;
  /** Lien pour passer à une formule avec plus de places. */
  upgrade?: string;
};

const memberInput = z.object({
  email: z.email().max(254),
  name: z.string().trim().min(1).max(120),
});

/**
 * Invite une personne dans l'entreprise : le Compte Lead crée son accès dans l'organisation et lui
 * envoie un email au nom d'InvoiceLead ; en l'acceptant, elle arrive directement ici.
 */
export async function inviteMemberAction(
  prev: MemberInviteState,
  form: FormData,
): Promise<MemberInviteState> {
  const locale = pickLocale(form.get("locale"));
  const session = await requirePermission(locale, "company");
  const typed = {
    round: prev.round + 1,
    email: String(form.get("email") ?? "")
      .trim()
      .toLowerCase()
      .slice(0, 254),
    name: String(form.get("name") ?? "").slice(0, 120),
  };
  const { organization, user, membership } = session;
  // Le Compte Lead ne laisse inviter que l'administrateur de l'organisation.
  if (membership.role !== "admin") return { ...typed, error: "adminOnly" };
  const parsed = memberInput.safeParse(typed);
  if (!parsed.success) return { ...typed, error: "invalid" };
  const { email, name } = parsed.data;
  if (!organization.leadOrg || !user.leadSub) return { ...typed, error: "failed" };
  const { members } = await listTeam(db(), organization.id);
  if (members.some((m) => m.email.toLowerCase() === email))
    return { ...typed, error: "alreadyMember" };
  // Toutes les places déjà prises ici : inutile de demander au Compte Lead, qui refuserait.
  const seats = seatsOf(organization);
  const full = { ...typed, error: "seatLimit" as const, upgrade: upgradeUrl(organization) };
  if (seated(members, seats).size >= seats) return full;
  const outcome = await inviteMember({
    org: organization.leadOrg,
    inviter: user.leadSub,
    email,
    name,
    locale,
  });
  if (outcome.status === "invited" || outcome.status === "resent")
    return { round: typed.round, status: outcome.status, email };
  if (outcome.status === "seatLimit") return full;
  return { ...typed, error: outcome.status };
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
