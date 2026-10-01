"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAppSession } from "@/server/auth/guard";
import { pickLocale } from "@/server/auth/login-cookie";
import { db } from "@/server/db";
import { createClaim, deleteClaim, parseClaimForm } from "@/server/expenses";
import { uploadReceipt } from "@/server/receipts";
import { appRoleOf } from "@/server/roles";

/** Toute personne de l'équipe qui peut agir (pas en lecture seule) saisit ses notes de frais. */
async function guard(form: FormData) {
  const locale = pickLocale(form.get("locale"));
  const session = await requireAppSession(locale);
  if (appRoleOf(session.membership) === "readonly") redirect(`/${locale}/app/expenses?error=role`);
  return { locale, who: { organizationId: session.organization.id, userId: session.user.id } };
}

export async function createClaimAction(form: FormData) {
  const { locale, who } = await guard(form);
  const parsed = parseClaimForm(form);
  if (!parsed.ok)
    redirect(`/${locale}/app/expenses?error=${Object.values(parsed.errors)[0] ?? "invalid"}`);
  let receiptId: string | null = null;
  const file = form.get("receipt");
  if (file instanceof File && file.size > 0) {
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
