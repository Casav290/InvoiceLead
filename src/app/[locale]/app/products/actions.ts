"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/server/auth/guard";
import { pickLocale } from "@/server/auth/login-cookie";
import { db } from "@/server/db";
import {
  archiveProduct,
  createProduct,
  type ProductErrors,
  parseProductForm,
  updateProduct,
} from "@/server/products";

export type ProductFormState = {
  status: "idle" | "invalid" | "notFound";
  errors?: ProductErrors;
  values?: Record<string, string>;
  round: number;
};

export async function saveProduct(
  prev: ProductFormState,
  form: FormData,
): Promise<ProductFormState> {
  const locale = pickLocale(form.get("locale"));
  const session = await requirePermission(locale, "billing");
  const who = { organizationId: session.organization.id, userId: session.user.id };
  const id = String(form.get("id") ?? "");
  const values = Object.fromEntries(
    [...form.entries()].filter(([k]) => !k.startsWith("$")).map(([k, v]) => [k, String(v)]),
  );
  const round = prev.round + 1;
  const parsed = parseProductForm(form);
  if (!parsed.ok) return { status: "invalid", errors: parsed.errors, values, round };
  const result = id
    ? await updateProduct(db(), who, id, parsed.data)
    : await createProduct(db(), who, parsed.data);
  if (result === null) return { status: "notFound", round };
  if (result === "skuTaken")
    return { status: "invalid", errors: { sku: "skuTaken" }, values, round };
  revalidatePath(`/${locale}/app/products`);
  redirect(`/${locale}/app/products?saved=1`);
}

export async function archiveProductAction(form: FormData) {
  const locale = pickLocale(form.get("locale"));
  const session = await requirePermission(locale, "billing");
  await archiveProduct(
    db(),
    { organizationId: session.organization.id, userId: session.user.id },
    String(form.get("id") ?? ""),
  );
  revalidatePath(`/${locale}/app/products`);
  redirect(`/${locale}/app/products?archived=1`);
}
