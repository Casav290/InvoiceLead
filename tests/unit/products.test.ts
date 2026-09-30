import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { formatRate, vatRateBp } from "@/countries/ch/vat";
import { parseAmountToCents } from "@/lib/amount-input";
import { attachLeadIdentity } from "@/server/auth/attach";
import {
  archiveProduct,
  createProduct,
  getProduct,
  listProducts,
  parseProductForm,
  updateProduct,
} from "@/server/products";
import { claims } from "../support/claims";
import { testDb } from "../support/db";

const t = testDb();
const db = t.database;
beforeEach(() => t.reset());
afterAll(() => t.close());

describe("taux de TVA suisses datés", () => {
  it("dépendent de la date de la prestation", () => {
    expect(vatRateBp("normal", "2023-12-31")).toBe(770);
    expect(vatRateBp("normal", "2024-01-01")).toBe(810);
    expect(vatRateBp("reduced", "2026-09-30")).toBe(260);
    expect(vatRateBp("lodging", "2026-09-30")).toBe(380);
    expect(vatRateBp("export", "2026-09-30")).toBe(0);
    expect(vatRateBp("exempt", "2026-09-30")).toBe(0);
    expect(() => vatRateBp("normal", "2010-01-01")).toThrow();
  });

  it("s'affichent selon la langue", () => {
    expect(formatRate(810, "fr")).toBe("8,1 %");
    expect(formatRate(810, "de")).toBe("8.1 %");
    expect(formatRate(0, "de")).toBe("0 %");
  });
});

describe("saisie d'un montant", () => {
  it("lit les formats suisses usuels en centimes", () => {
    expect(parseAmountToCents("1'200.50")).toBe(120_050);
    expect(parseAmountToCents("1 200,5")).toBe(120_050);
    expect(parseAmountToCents("99")).toBe(9_900);
    expect(parseAmountToCents("0.05")).toBe(5);
    expect(parseAmountToCents("")).toBeNull();
    expect(parseAmountToCents("-5")).toBeNull();
    expect(parseAmountToCents("1.234")).toBeNull();
    expect(parseAmountToCents("abc")).toBeNull();
  });
});

function form(values: Record<string, string>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(values)) f.set(k, v);
  return f;
}
const VALID = {
  name: "Conseil",
  sku: "CONS-H",
  unit: "hour",
  unitPrice: "150.00",
  vatCode: "normal",
};
function parsed(values: Record<string, string>) {
  const r = parseProductForm(form(values));
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.data;
}

describe("articles", () => {
  it("valident nom, unité, prix et code TVA", () => {
    const r = parseProductForm(
      form({ name: "", unit: "litre", unitPrice: "12,345", vatCode: "x" }),
    );
    expect(!r.ok && r.errors).toMatchObject({
      name: "required",
      unit: "required",
      unitPriceCents: "amount",
      vatCode: "required",
    });
    expect(parsed(VALID).unitPriceCents).toBe(15_000);
  });

  it("gardent une référence unique parmi les articles actifs et restent propres à l'organisation", async () => {
    const a = await attachLeadIdentity(db, claims());
    const b = await attachLeadIdentity(
      db,
      claims({ sub: "sub-b", email: "b@autre.test", org: "org-b" }),
    );
    const whoA = { organizationId: a.organization.id, userId: a.user.id };
    const whoB = { organizationId: b.organization.id, userId: b.user.id };

    const first = await createProduct(db, whoA, parsed(VALID));
    if (first === "skuTaken") throw new Error("inattendu");
    expect(await createProduct(db, whoA, parsed({ ...VALID, name: "Autre" }))).toBe("skuTaken");
    expect(await createProduct(db, whoB, parsed(VALID))).not.toBe("skuTaken");

    expect(await getProduct(db, b.organization.id, first.id)).toBeNull();
    expect(await updateProduct(db, whoB, first.id, parsed({ ...VALID, sku: "X" }))).toBeNull();
    expect(await archiveProduct(db, whoB, first.id)).toBe(false);

    expect(await archiveProduct(db, whoA, first.id)).toBe(true);
    expect(await listProducts(db, a.organization.id)).toHaveLength(0);
    expect(await createProduct(db, whoA, parsed(VALID))).not.toBe("skuTaken");
  });
});
