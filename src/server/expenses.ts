import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { VAT_CODES, type VatCode } from "@/countries/ch/vat";
import { chartPack } from "@/countries/charts";
import { parseAmountToCents } from "@/lib/amount-input";
import { isIsoDate } from "@/lib/fiscal-year";
import { normalizeIban } from "./bills";
import type { Db } from "./db";
import {
  accounts,
  auditLog,
  organizations,
  receipts,
  type SupplierBill,
  supplierBills,
} from "./db/schema";

type Who = { organizationId: string; userId: string };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Taux kilométrique proposé par pays, en centimes de la monnaie de l'entreprise : barème usuel
 * suisse, forfait allemand (§ 9 EStG), barème français moyen, taux HMRC et taux IRS. Modifiable à
 * chaque saisie.
 */
export const MILEAGE_RATE_CENTS: Record<string, number> = {
  CH: 70,
  DE: 30,
  FR: 60,
  GB: 45,
  US: 70,
};

export type ClaimInput = {
  kind: "expense" | "mileage";
  date: string;
  description: string;
  claimantName: string;
  iban: string | null;
  /** Note de frais : montant TTC payé personnellement. */
  amountCents: number;
  vatCode: VatCode | null;
  accountId: string | null;
  /** Indemnité kilométrique. */
  distanceMeters: number | null;
  ratePerKmCents: number | null;
};

const text = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

/** Kilomètres saisis (« 123.5 ») en mètres. */
export function parseKilometers(input: string): number | null {
  const v = input.replace(/[\s'’]/g, "").replace(",", ".");
  if (!/^\d{1,5}(\.\d{1,3})?$/.test(v)) return null;
  const meters = Math.round(Number(v) * 1000);
  return meters > 0 ? meters : null;
}

/** Montant d'une indemnité : kilomètres × taux, arrondi au centime. */
export function mileageCents(distanceMeters: number, ratePerKmCents: number): number {
  return Math.round((distanceMeters * ratePerKmCents) / 1000);
}

export function parseClaimForm(
  form: FormData,
): { ok: true; data: ClaimInput } | { ok: false; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const kind = text(form, "kind") === "mileage" ? "mileage" : "expense";
  const date = text(form, "date");
  if (!isIsoDate(date)) errors.date = "date";
  const description = text(form, "description").slice(0, 200);
  if (!description) errors.description = "required";
  const claimantName = text(form, "claimantName").slice(0, 140);
  if (!claimantName) errors.claimantName = "required";
  const ibanText = text(form, "iban");
  const iban = ibanText ? normalizeIban(ibanText) : null;
  if (ibanText && !iban) errors.iban = "iban";
  let amountCents = 0;
  let distanceMeters: number | null = null;
  let ratePerKmCents: number | null = null;
  let vatCode: VatCode | null = null;
  let accountId: string | null = null;
  if (kind === "mileage") {
    distanceMeters = parseKilometers(text(form, "km"));
    if (!distanceMeters) errors.km = "km";
    ratePerKmCents = parseAmountToCents(text(form, "rate"));
    if (!ratePerKmCents || ratePerKmCents > 1000) errors.rate = "amount";
    if (distanceMeters && ratePerKmCents)
      amountCents = mileageCents(distanceMeters, ratePerKmCents);
  } else {
    amountCents = parseAmountToCents(text(form, "amount")) ?? 0;
    if (amountCents <= 0) errors.amount = "amount";
    const vat = text(form, "vatCode");
    vatCode = (VAT_CODES as readonly string[]).includes(vat) ? (vat as VatCode) : null;
    const account = text(form, "accountId");
    accountId = UUID.test(account) ? account : null;
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    data: {
      kind,
      date,
      description,
      claimantName,
      iban,
      amountCents,
      vatCode,
      accountId,
      distanceMeters,
      ratePerKmCents,
    },
  };
}

/** Compte des frais de déplacement du plan comptable de l'entreprise, s'il existe. */
export async function travelAccountId(database: Db, organizationId: string, country: string) {
  const [row] = await database
    .select({ id: accounts.id })
    .from(accounts)
    .where(
      and(
        eq(accounts.organizationId, organizationId),
        eq(accounts.number, chartPack(country).travelAccount),
      ),
    );
  return row?.id ?? null;
}

/**
 * Note de frais ou indemnité kilométrique : une dette envers la personne, saisie comme une facture
 * fournisseur à son nom. Elle suit le même circuit : approbation (qui comptabilise la charge),
 * fichier de paiement pain.001 si l'IBAN est connu, solde par le relevé bancaire. L'indemnité
 * kilométrique ne porte pas de TVA récupérable.
 */
export async function createClaim(
  database: Db,
  who: Who,
  data: ClaimInput,
  receiptId: string | null = null,
): Promise<SupplierBill> {
  const [org] = await database
    .select({ country: organizations.country, currency: organizations.currency })
    .from(organizations)
    .where(eq(organizations.id, who.organizationId));
  if (!org) throw new Error("organization_missing");
  const travel = await travelAccountId(database, who.organizationId, org.country);
  const description =
    data.kind === "mileage" && data.distanceMeters && data.ratePerKmCents
      ? `${data.description} (${data.distanceMeters / 1000} ${org.country === "GB" || org.country === "US" ? "mi" : "km"} × ${(data.ratePerKmCents / 100).toFixed(2)})`
      : data.description;
  const [row] = await database
    .insert(supplierBills)
    .values({
      organizationId: who.organizationId,
      supplierName: data.claimantName,
      supplierCountry: org.country,
      iban: data.iban,
      issueDate: data.date,
      dueDate: data.date,
      currency: org.currency,
      totalCents: data.amountCents,
      vatCode: data.kind === "mileage" ? null : data.vatCode,
      accountId: data.kind === "mileage" ? travel : (data.accountId ?? travel),
      description: description.slice(0, 200),
      source: data.kind,
      receiptId,
      claimantId: who.userId,
      distanceMeters: data.distanceMeters,
      ratePerKmCents: data.ratePerKmCents,
      createdBy: who.userId,
    })
    .returning();
  if (!row) throw new Error("claim_not_saved");
  // Le justificatif joint est rattaché : il ne reste pas « à traiter » dans les justificatifs.
  if (receiptId)
    await database
      .update(receipts)
      .set({ status: "billed" })
      .where(and(eq(receipts.id, receiptId), eq(receipts.organizationId, who.organizationId)));
  await database.insert(auditLog).values({
    organizationId: who.organizationId,
    userId: who.userId,
    action: `claim.${data.kind}`,
    entity: "bill",
    entityId: row.id,
    data: { totalCents: row.totalCents },
  });
  return row;
}

/** Notes de frais d'une personne (toutes, pour la comptabilité, si `claimantId` est omis). */
export async function listClaims(database: Db, organizationId: string, claimantId?: string) {
  return database
    .select()
    .from(supplierBills)
    .where(
      and(
        eq(supplierBills.organizationId, organizationId),
        inArray(supplierBills.source, ["expense", "mileage"]),
        ...(claimantId ? [eq(supplierBills.claimantId, claimantId)] : []),
      ),
    )
    .orderBy(desc(supplierBills.issueDate), desc(supplierBills.createdAt))
    .limit(200);
}

/** IBAN de la dernière note de frais de la personne, pour pré-remplir la suivante. */
export async function lastClaimIban(database: Db, organizationId: string, claimantId: string) {
  const [row] = await database
    .select({ iban: supplierBills.iban })
    .from(supplierBills)
    .where(
      and(
        eq(supplierBills.organizationId, organizationId),
        eq(supplierBills.claimantId, claimantId),
        inArray(supplierBills.source, ["expense", "mileage"]),
        isNotNull(supplierBills.iban),
      ),
    )
    .orderBy(desc(supplierBills.createdAt))
    .limit(1);
  return row?.iban ?? null;
}

/** Retire une note de frais encore en brouillon, par la personne qui l'a saisie. */
export async function deleteClaim(database: Db, who: Who, id: string): Promise<boolean> {
  if (!UUID.test(id)) return false;
  const [row] = await database
    .delete(supplierBills)
    .where(
      and(
        eq(supplierBills.id, id),
        eq(supplierBills.organizationId, who.organizationId),
        eq(supplierBills.claimantId, who.userId),
        eq(supplierBills.status, "draft"),
        inArray(supplierBills.source, ["expense", "mileage"]),
      ),
    )
    .returning({ id: supplierBills.id, receiptId: supplierBills.receiptId });
  if (row?.receiptId)
    await database
      .update(receipts)
      .set({ status: "new" })
      .where(and(eq(receipts.id, row.receiptId), eq(receipts.status, "billed")));
  return !!row;
}
