"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/server/auth/guard";
import { pickLocale } from "@/server/auth/login-cookie";
import {
  approveBill,
  billFromPhoto,
  billFromReceipt,
  createBill,
  deleteBill,
  getBill,
  importEInvoice,
  markBillPaid,
  parseBillForm,
  updateBill,
} from "@/server/bills";
import { db } from "@/server/db";
import { auditLog, organizations } from "@/server/db/schema";
import { featureAccess } from "@/server/plans";

export type BillFormState = {
  status: "idle" | "invalid" | "notFound";
  errors?: Record<string, string>;
  values?: Record<string, string>;
  round: number;
};

async function guard(form: FormData) {
  const locale = pickLocale(form.get("locale"));
  const session = await requirePermission(locale, "accounting");
  return {
    locale,
    session,
    who: { organizationId: session.organization.id, userId: session.user.id },
    path: `/${locale}/app/accounting/bills`,
  };
}

export async function saveBillAction(prev: BillFormState, form: FormData): Promise<BillFormState> {
  const { locale, session, who, path } = await guard(form);
  const round = prev.round + 1;
  const values = Object.fromEntries(
    [...form.entries()].filter(([k]) => !k.startsWith("$")).map(([k, v]) => [k, String(v)]),
  );
  const parsed = parseBillForm(form);
  if (!parsed.ok) return { status: "invalid", errors: parsed.errors, values, round };
  const id = String(form.get("id") ?? "");
  // Saisir une facture fournisseur en devise étrangère fait partie de la formule Pro ; une facture
  // déjà dans sa devise (lue d'un justificatif ou d'une e-facture) la garde, mais ne se
  // comptabilise qu'avec Pro (approveBill refuse « plan »).
  if (
    parsed.data.currency !== session.organization.currency &&
    !featureAccess(session.organization, "multiCurrency").allowed
  ) {
    const stored = id ? await getBill(db(), session.organization.id, id) : null;
    if (stored?.currency !== parsed.data.currency)
      return { status: "invalid", errors: { currency: "plan" }, values, round };
  }
  const bill = id
    ? await updateBill(db(), who, id, parsed.data)
    : await createBill(db(), who, parsed.data);
  if (!bill) return { status: "notFound", round };
  revalidatePath(`/${locale}/app/accounting`, "layout");
  redirect(`${path}/${bill.id}?saved=1`);
}

export async function approveBillAction(form: FormData) {
  const { locale, who, path } = await guard(form);
  const id = String(form.get("id") ?? "");
  const result = await approveBill(db(), who, id);
  revalidatePath(`/${locale}/app/accounting`, "layout");
  if (typeof result === "string") redirect(`${path}/${id}?error=${result}`);
  redirect(`${path}/${id}?${result.status === "approved" ? "approved=1" : "firstApproval=1"}`);
}

export async function deleteBillAction(form: FormData) {
  const { locale, who, path } = await guard(form);
  await deleteBill(db(), who, String(form.get("id") ?? ""));
  revalidatePath(`/${locale}/app/accounting`, "layout");
  redirect(`${path}?deleted=1`);
}

export async function markBillPaidAction(form: FormData) {
  const { locale, who, path } = await guard(form);
  const id = String(form.get("id") ?? "");
  const money = form.get("money") === "cash" ? "cash" : "bank";
  const result = await markBillPaid(db(), who, id, String(form.get("paidOn") ?? ""), money);
  revalidatePath(`/${locale}/app/accounting`, "layout");
  redirect(`${path}/${id}?${result === "paid" ? "paid=1" : `error=${result}`}`);
}

/**
 * E-factures reçues (XML, ou PDF ZUGFeRD / Factur-X) : chacune devient une facture à payer. Lues
 * sans IA, elles ne comptent pas dans les pièces lues du mois, quelle que soit la formule.
 */
export async function importEInvoicesAction(form: FormData) {
  const { locale, who, path } = await guard(form);
  const files = form.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  let imported = 0;
  let rejected = 0;
  for (const f of files.slice(0, 20)) {
    const type = f.type || (f.name.toLowerCase().endsWith(".xml") ? "application/xml" : "");
    const result = await importEInvoice(db(), who, {
      name: f.name,
      type,
      bytes: Buffer.from(await f.arrayBuffer()),
    });
    if (typeof result === "object") imported += 1;
    else rejected += 1;
  }
  revalidatePath(`/${locale}/app/accounting`, "layout");
  redirect(`${path}?imported=${imported}&rejected=${rejected}`);
}

export async function billFromReceiptAction(form: FormData) {
  const { locale, who, path } = await guard(form);
  const result = await billFromReceipt(db(), who, String(form.get("receiptId") ?? ""));
  revalidatePath(`/${locale}/app/accounting`, "layout");
  if (typeof result === "string") redirect(`/${locale}/app/accounting/receipts?error=${result}`);
  redirect(`${path}/${result.id}?saved=1`);
}

/**
 * « Prendre en photo » : la facture photographiée (ou un PDF choisi sur l'ordinateur) devient un
 * brouillon rempli par l'IA, qui s'ouvre pour être vérifié puis approuvé. Une lecture du mois ; au-delà,
 * la photo est refusée sans être enregistrée, et « Nouvelle facture fournisseur » reste la voie à la
 * main.
 */
export async function billFromPhotoAction(form: FormData) {
  const { locale, who, path } = await guard(form);
  const file = form.get("photo");
  if (!(file instanceof File) || file.size === 0) redirect(`${path}?error=type#photo`);
  const result = await billFromPhoto(
    db(),
    who,
    { name: file.name, type: file.type, bytes: Buffer.from(await file.arrayBuffer()) },
    locale,
  );
  revalidatePath(`/${locale}/app/accounting`, "layout");
  if (typeof result === "string") redirect(`${path}?error=${result}#photo`);
  redirect(`${path}/${result.id}?photo=1`);
}

export async function dualApprovalAction(form: FormData) {
  const locale = pickLocale(form.get("locale"));
  const session = await requirePermission(locale, "company");
  const on = form.get("dualApproval") === "on";
  await db()
    .update(organizations)
    .set({ dualApproval: on })
    .where(eq(organizations.id, session.organization.id));
  await db()
    .insert(auditLog)
    .values({
      organizationId: session.organization.id,
      userId: session.user.id,
      action: on ? "bills.dual_on" : "bills.dual_off",
      entity: "organization",
      entityId: session.organization.id,
    });
  revalidatePath(`/${locale}/app/accounting/bills`);
  redirect(`/${locale}/app/accounting/bills?dual=${on ? "on" : "off"}`);
}
