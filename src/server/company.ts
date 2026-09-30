import { and, eq } from "drizzle-orm";
import {
  isQrIban,
  isValidSwissIban,
  isValidUid,
  normalizeIban,
  normalizeUid,
} from "@/lib/swiss-ids";
import type { Db } from "./db";
import { auditLog, memberships, organizations } from "./db/schema";
import { can } from "./roles";

export const LEGAL_FORMS = [
  "sole_proprietorship",
  "gmbh",
  "ag",
  "partnership",
  "association",
  "other",
] as const;
export const VAT_METHODS = ["effective", "net_tax_rate"] as const;
export const VAT_SETTLEMENTS = ["agreed", "received"] as const;
/** Rôles Lead autorisés à modifier les réglages de l'entreprise. */

export type CompanyInput = {
  legalName: string;
  legalForm: (typeof LEGAL_FORMS)[number];
  street: string;
  buildingNumber: string | null;
  postalCode: string;
  town: string;
  email: string | null;
  phone: string | null;
  website: string | null;
  uid: string | null;
  vatRegistered: boolean;
  vatMethod: (typeof VAT_METHODS)[number] | null;
  vatSettlement: (typeof VAT_SETTLEMENTS)[number] | null;
  netTaxRateBp: number | null;
  iban: string | null;
  qrIban: string | null;
  fiscalYearStartMonth: number;
};

/** Codes d'erreur par champ, traduits par l'interface (messages app.company.errors.*). */
export type CompanyErrors = Partial<Record<keyof CompanyInput, string>>;

const text = (form: FormData, key: string) => String(form.get(key) ?? "").trim();
const optional = (value: string) => (value === "" ? null : value);

/** Lit et valide le formulaire. Aucune donnée n'est enregistrée si une seule erreur subsiste. */
export function parseCompanyForm(
  form: FormData,
): { ok: true; data: CompanyInput } | { ok: false; errors: CompanyErrors } {
  const errors: CompanyErrors = {};

  const legalName = text(form, "legalName");
  if (!legalName) errors.legalName = "required";
  else if (legalName.length > 120) errors.legalName = "tooLong";

  const legalForm = text(form, "legalForm") as CompanyInput["legalForm"];
  if (!LEGAL_FORMS.includes(legalForm)) errors.legalForm = "required";

  // Adresse structurée : obligatoire pour la QR-facture depuis novembre 2025 (SIX IG 2.3).
  const street = text(form, "street");
  if (!street) errors.street = "required";
  else if (street.length > 70) errors.street = "tooLong";
  const buildingNumber = optional(text(form, "buildingNumber"));
  if (buildingNumber && buildingNumber.length > 16) errors.buildingNumber = "tooLong";
  const postalCode = text(form, "postalCode");
  if (!/^\d{4}$/.test(postalCode)) errors.postalCode = "postalCode";
  const town = text(form, "town");
  if (!town) errors.town = "required";
  else if (town.length > 35) errors.town = "tooLong";

  const email = optional(text(form, "email"));
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.email = "email";
  const phone = optional(text(form, "phone"));
  const website = optional(text(form, "website"));

  const uidRaw = optional(text(form, "uid"));
  const uid = uidRaw ? normalizeUid(uidRaw) : null;
  if (uidRaw && (!uid || !isValidUid(uid))) errors.uid = "uid";

  const vatRegistered = form.get("vatRegistered") === "on";
  let vatMethod = optional(text(form, "vatMethod")) as CompanyInput["vatMethod"];
  let vatSettlement = optional(text(form, "vatSettlement")) as CompanyInput["vatSettlement"];
  if (vatRegistered) {
    if (!uidRaw) errors.uid = "uidRequiredForVat";
    if (!vatMethod || !VAT_METHODS.includes(vatMethod)) errors.vatMethod = "required";
    if (!vatSettlement || !VAT_SETTLEMENTS.includes(vatSettlement))
      errors.vatSettlement = "required";
  } else {
    vatMethod = null;
    vatSettlement = null;
  }
  // Taux TDFN : « 6.2 » ou « 6,2 » (%), exigé seulement avec cette méthode.
  const rateRaw = text(form, "netTaxRate").replace(",", ".").replace("%", "").trim();
  let netTaxRateBp: number | null = null;
  if (vatRegistered && vatMethod === "net_tax_rate") {
    const n = Number(rateRaw);
    if (!rateRaw || !/^\d{1,2}(\.\d{1,2})?$/.test(rateRaw) || n <= 0 || n > 15)
      errors.netTaxRateBp = "netTaxRate";
    else netTaxRateBp = Math.round(n * 100);
  }

  const ibanRaw = optional(text(form, "iban"));
  const iban = ibanRaw ? normalizeIban(ibanRaw) : null;
  if (iban && !isValidSwissIban(iban)) errors.iban = "iban";
  else if (iban && isQrIban(iban)) errors.iban = "ibanIsQr";

  const qrIbanRaw = optional(text(form, "qrIban"));
  const qrIban = qrIbanRaw ? normalizeIban(qrIbanRaw) : null;
  if (qrIban && !isValidSwissIban(qrIban)) errors.qrIban = "iban";
  else if (qrIban && !isQrIban(qrIban)) errors.qrIban = "notQrIban";

  const fiscalYearStartMonth = Number(text(form, "fiscalYearStartMonth") || "1");
  if (
    !Number.isInteger(fiscalYearStartMonth) ||
    fiscalYearStartMonth < 1 ||
    fiscalYearStartMonth > 12
  ) {
    errors.fiscalYearStartMonth = "required";
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    data: {
      legalName,
      legalForm,
      street,
      buildingNumber,
      postalCode,
      town,
      email,
      phone,
      website,
      uid,
      vatRegistered,
      vatMethod,
      vatSettlement,
      netTaxRateBp,
      iban,
      qrIban,
      fiscalYearStartMonth,
    },
  };
}

async function memberOf(database: Db, organizationId: string, userId: string) {
  const [row] = await database
    .select({ role: memberships.role, appRole: memberships.appRole })
    .from(memberships)
    .where(and(eq(memberships.organizationId, organizationId), eq(memberships.userId, userId)))
    .limit(1);
  return row ?? null;
}

/** Réglages de l'entreprise et équipe : responsables Lead (admin, manager). */
export async function canEditSettings(database: Db, organizationId: string, userId: string) {
  const m = await memberOf(database, organizationId, userId);
  return !!m && can(m, "company");
}

/** Plan comptable, exercices et clôture : responsables et fiduciaire invitée. */
export async function canSetUpAccounting(database: Db, organizationId: string, userId: string) {
  const m = await memberOf(database, organizationId, userId);
  return !!m && can(m, "setup");
}

/** Enregistre les réglages de l'organisation de la session, après contrôle du rôle. */
export async function saveCompanySettings(
  database: Db,
  who: { organizationId: string; userId: string },
  data: CompanyInput,
): Promise<"saved" | "forbidden"> {
  if (!(await canEditSettings(database, who.organizationId, who.userId))) return "forbidden";
  const complete = !!(
    data.legalName &&
    data.street &&
    data.postalCode &&
    data.town &&
    (data.iban || data.qrIban)
  );
  await database.transaction(async (tx) => {
    const [before] = await tx
      .select({ completedAt: organizations.settingsCompletedAt })
      .from(organizations)
      .where(eq(organizations.id, who.organizationId));
    await tx
      .update(organizations)
      .set({
        ...data,
        settingsCompletedAt: complete ? (before?.completedAt ?? new Date()) : null,
        updatedAt: new Date(),
      })
      .where(eq(organizations.id, who.organizationId));
    await tx.insert(auditLog).values({
      organizationId: who.organizationId,
      userId: who.userId,
      action: "company.settings.update",
      entity: "organization",
      entityId: who.organizationId,
      data: { complete, vatRegistered: data.vatRegistered, vatMethod: data.vatMethod },
    });
  });
  return "saved";
}
