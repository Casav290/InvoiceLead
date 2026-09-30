import { and, asc, eq, ilike, isNull, ne, or, sql } from "drizzle-orm";
import { VAT_CODES, type VatCode } from "@/countries/ch/vat";
import { parseAmountToCents } from "@/lib/amount-input";
import type { Db } from "./db";
import { auditLog, type Product, products } from "./db/schema";

export const PRODUCT_UNITS = ["hour", "day", "piece", "flat", "km", "month"] as const;

export type ProductInput = {
  sku: string | null;
  name: string;
  description: string | null;
  unit: (typeof PRODUCT_UNITS)[number];
  unitPriceCents: number;
  vatCode: VatCode;
};

export type ProductErrors = Partial<Record<keyof ProductInput, string>>;

const text = (form: FormData, key: string) => String(form.get(key) ?? "").trim();
const optional = (value: string) => (value === "" ? null : value);

export function parseProductForm(
  form: FormData,
): { ok: true; data: ProductInput } | { ok: false; errors: ProductErrors } {
  const errors: ProductErrors = {};
  const name = text(form, "name");
  if (!name) errors.name = "required";
  else if (name.length > 120) errors.name = "tooLong";
  const sku = optional(text(form, "sku"));
  if (sku && sku.length > 40) errors.sku = "tooLong";
  const unit = text(form, "unit") as ProductInput["unit"];
  if (!PRODUCT_UNITS.includes(unit)) errors.unit = "required";
  const unitPriceCents = parseAmountToCents(text(form, "unitPrice"));
  if (unitPriceCents === null) errors.unitPriceCents = "amount";
  const vatCode = text(form, "vatCode") as VatCode;
  if (!VAT_CODES.includes(vatCode)) errors.vatCode = "required";
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    data: {
      sku,
      name,
      description: optional(text(form, "description")),
      unit,
      unitPriceCents: unitPriceCents ?? 0,
      vatCode,
    },
  };
}

export async function listProducts(
  database: Db,
  organizationId: string,
  query = "",
): Promise<Product[]> {
  const q = query.trim();
  const pattern = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  return database
    .select()
    .from(products)
    .where(
      and(
        eq(products.organizationId, organizationId),
        isNull(products.archivedAt),
        q ? or(ilike(products.name, pattern), ilike(products.sku, pattern)) : undefined,
      ),
    )
    .orderBy(asc(sql`lower(${products.name})`))
    .limit(500);
}

export async function getProduct(
  database: Db,
  organizationId: string,
  id: string,
): Promise<Product | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [row] = await database
    .select()
    .from(products)
    .where(and(eq(products.id, id), eq(products.organizationId, organizationId)))
    .limit(1);
  return row ?? null;
}

/** Une référence (SKU) reste unique parmi les articles actifs de l'organisation. */
async function skuTaken(
  database: Db,
  organizationId: string,
  sku: string | null,
  exceptId?: string,
) {
  if (!sku) return false;
  const [row] = await database
    .select({ id: products.id })
    .from(products)
    .where(
      and(
        eq(products.organizationId, organizationId),
        eq(products.sku, sku),
        isNull(products.archivedAt),
        exceptId ? ne(products.id, exceptId) : undefined,
      ),
    )
    .limit(1);
  return !!row;
}

type Who = { organizationId: string; userId: string };

export async function createProduct(
  database: Db,
  who: Who,
  data: ProductInput,
): Promise<Product | "skuTaken"> {
  if (await skuTaken(database, who.organizationId, data.sku)) return "skuTaken";
  const [row] = await database
    .insert(products)
    .values({ ...data, organizationId: who.organizationId })
    .returning();
  if (!row) throw new Error("product_not_saved");
  await database.insert(auditLog).values({
    organizationId: who.organizationId,
    userId: who.userId,
    action: "product.create",
    entity: "product",
    entityId: row.id,
  });
  return row;
}

export async function updateProduct(
  database: Db,
  who: Who,
  id: string,
  data: ProductInput,
): Promise<Product | "skuTaken" | null> {
  if (!(await getProduct(database, who.organizationId, id))) return null;
  if (await skuTaken(database, who.organizationId, data.sku, id)) return "skuTaken";
  const [row] = await database
    .update(products)
    .set({ ...data, updatedAt: new Date() })
    .where(and(eq(products.id, id), eq(products.organizationId, who.organizationId)))
    .returning();
  await database.insert(auditLog).values({
    organizationId: who.organizationId,
    userId: who.userId,
    action: "product.update",
    entity: "product",
    entityId: id,
  });
  return row ?? null;
}

export async function archiveProduct(database: Db, who: Who, id: string): Promise<boolean> {
  const [row] = await database
    .update(products)
    .set({ archivedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(products.id, id), eq(products.organizationId, who.organizationId)))
    .returning({ id: products.id });
  if (!row) return false;
  await database.insert(auditLog).values({
    organizationId: who.organizationId,
    userId: who.userId,
    action: "product.archive",
    entity: "product",
    entityId: id,
  });
  return true;
}
