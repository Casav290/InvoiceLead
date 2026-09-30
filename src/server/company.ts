import { and, eq, ne } from "drizzle-orm";
import { type Country, countryPack, isCountry } from "@/countries";
import { isValidUstId, normalizeUstId } from "@/countries/de/vat";
import {
  isQrIban,
  isValidSepaIban,
  isValidSwissIban,
  isValidUid,
  normalizeIban,
  normalizeUid,
} from "@/lib/swiss-ids";
import type { Db } from "./db";
import { auditLog, invoices, memberships, organizations } from "./db/schema";
import { can } from "./roles";

export const LEGAL_FORMS = [
  "sole_proprietorship",
  "gmbh",
  "ag",
  "partnership",
  "association",
  "ug",
  "ek",
  "gbr",
  "other",
] as const;
export const VAT_METHODS = ["effective", "net_tax_rate"] as const;
export const VAT_SETTLEMENTS = ["agreed", "received"] as const;
/** Rôles Lead autorisés à modifier les réglages de l'entreprise. */

export type CompanyInput = {
  country: Country;
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
  taxNumber: string | null;
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
  const countryRaw = text(form, "country") || "CH";
  if (!isCountry(countryRaw)) errors.country = "required";
  const country: Country = isCountry(countryRaw) ? countryRaw : "CH";
  const germany = country === "DE";

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
  if (!(germany ? /^\d{5}$/ : /^\d{4}$/).test(postalCode)) errors.postalCode = "postalCode";
  const town = text(form, "town");
  if (!town) errors.town = "required";
  else if (town.length > 35) errors.town = "tooLong";

  const email = optional(text(form, "email"));
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.email = "email";
  const phone = optional(text(form, "phone"));
  const website = optional(text(form, "website"));

  const uidRaw = optional(text(form, "uid"));
  // Suisse : IDE (CHE…) ; Allemagne : USt-IdNr. (DE…).
  const uid = uidRaw ? (germany ? normalizeUstId(uidRaw) : normalizeUid(uidRaw)) : null;
  if (uidRaw && (!uid || !(germany ? isValidUstId(uid) : isValidUid(uid))))
    errors.uid = germany ? "ustId" : "uid";

  // Allemagne : Steuernummer du Finanzamt (10 à 13 chiffres) ; USt-IdNr. ou Steuernummer exigé.
  const taxNumberRaw = germany ? optional(text(form, "taxNumber")) : null;
  const taxNumber = taxNumberRaw ? taxNumberRaw.replace(/\s+/g, " ") : null;
  if (taxNumber) {
    const digits = taxNumber.replace(/\D/g, "").length;
    if (!/^[\d/ ]+$/.test(taxNumber) || digits < 10 || digits > 13) errors.taxNumber = "taxNumber";
  }
  if (germany && !uidRaw && !taxNumber) errors.taxNumber = "taxIdRequired";

  const vatRegistered = form.get("vatRegistered") === "on";
  // L'Allemagne ne connaît que la méthode effective (Soll- ou Ist-Versteuerung).
  let vatMethod = (
    germany ? "effective" : optional(text(form, "vatMethod"))
  ) as CompanyInput["vatMethod"];
  let vatSettlement = optional(text(form, "vatSettlement")) as CompanyInput["vatSettlement"];
  if (vatRegistered) {
    if (!uidRaw && !germany) errors.uid = "uidRequiredForVat";
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
  if (iban && !(germany ? isValidSepaIban(iban) : isValidSwissIban(iban))) errors.iban = "iban";
  else if (iban && isQrIban(iban)) errors.iban = "ibanIsQr";

  const qrIbanRaw = germany ? null : optional(text(form, "qrIban"));
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
      country,
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
      taxNumber,
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
): Promise<"saved" | "forbidden" | "countryLocked"> {
  if (!(await canEditSettings(database, who.organizationId, who.userId))) return "forbidden";
  // Le pays fixe la devise et les taux : il ne change plus une fois une pièce émise.
  const [current] = await database
    .select({ country: organizations.country })
    .from(organizations)
    .where(eq(organizations.id, who.organizationId));
  if (current && current.country !== data.country) {
    const [issued] = await database
      .select({ id: invoices.id })
      .from(invoices)
      .where(and(eq(invoices.organizationId, who.organizationId), ne(invoices.status, "draft")))
      .limit(1);
    if (issued) return "countryLocked";
  }
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
        currency: countryPack(data.country).currency,
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
