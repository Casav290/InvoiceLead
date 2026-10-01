"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { aiConfigured } from "@/server/ai";
import { requireAppSession } from "@/server/auth/guard";
import { pickLocale } from "@/server/auth/login-cookie";
import { db } from "@/server/db";
import { createClaim, deleteClaim, parseClaimForm, scannedTicket } from "@/server/expenses";
import { limitReached } from "@/server/plans";
import { extractReceipt, uploadReceipt } from "@/server/receipts";
import { appRoleOf } from "@/server/roles";

/** Toute personne de l'équipe qui peut agir (pas en lecture seule) saisit ses notes de frais. */
async function guard(form: FormData) {
  const locale = pickLocale(form.get("locale"));
  const session = await requireAppSession(locale);
  if (appRoleOf(session.membership) === "readonly") redirect(`/${locale}/app/expenses?error=role`);
  return {
    locale,
    session,
    who: { organizationId: session.organization.id, userId: session.user.id },
  };
}

/**
 * « Scanner un ticket » : la photo est gardée comme justificatif, lue par l'IA, et la note de frais
 * s'ouvre remplie (date, objet, montant, TVA, catégorie). La personne vérifie et envoie.
 */
export async function scanTicketAction(form: FormData) {
  const { locale, session, who } = await guard(form);
  const file = form.get("ticket");
  if (!(file instanceof File) || file.size === 0) redirect(`/${locale}/app/expenses?error=type`);
  if (await limitReached(db(), session.organization, "receipt"))
    redirect(`/${locale}/app/expenses?error=quota`);
  const receipt = await uploadReceipt(db(), who, {
    name: file.name,
    type: file.type,
    bytes: Buffer.from(await file.arrayBuffer()),
  });
  if (typeof receipt === "string") redirect(`/${locale}/app/expenses?error=${receipt}`);
  const read = aiConfigured() ? await extractReceipt(db(), who, receipt.id, locale) : "failed";
  redirect(
    `/${locale}/app/expenses?scan=${receipt.id}${typeof read === "string" ? "&unread=1" : ""}#ticket`,
  );
}

export async function createClaimAction(form: FormData) {
  const { locale, who } = await guard(form);
  const parsed = parseClaimForm(form);
  if (!parsed.ok)
    redirect(`/${locale}/app/expenses?error=${Object.values(parsed.errors)[0] ?? "invalid"}`);
  // Ticket déjà scanné (et lu) : il est rattaché tel quel, sans nouvel envoi.
  let receiptId: string | null = await scannedTicket(
    db(),
    who,
    String(form.get("receiptId") ?? ""),
  ).then((r) => r?.id ?? null);
  const file = form.get("receipt");
  if (!receiptId && file instanceof File && file.size > 0) {
    const receipt = await uploadReceipt(db(), who, {
      name: file.name,
      type: file.type,
      bytes: Buffer.from(await file.arrayBuffer()),
    });
    if (typeof receipt === "string") redirect(`/${locale}/app/expenses?error=${receipt}`);
    receiptId = receipt.id;
  }
  await createClaim(db(), who, parsed.data, receiptId);
  revalidatePath(`/${locale}/app/expenses`);
  revalidatePath(`/${locale}/app/accounting/bills`);
  redirect(`/${locale}/app/expenses?added=1`);
}

export async function deleteClaimAction(form: FormData) {
  const { locale, who } = await guard(form);
  await deleteClaim(db(), who, String(form.get("id") ?? ""));
  revalidatePath(`/${locale}/app/expenses`);
  redirect(`/${locale}/app/expenses`);
}
