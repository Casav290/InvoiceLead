import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { attachLeadIdentity } from "@/server/auth/attach";
import { createContact, parseContactForm } from "@/server/contacts";
import { hasFeature, LIMITS, limitReached, tierOf, upgradeUrl } from "@/server/plans";
import { claims } from "../support/claims";
import { testDb } from "../support/db";

const t = testDb();
const db = t.database;
beforeEach(() => t.reset());
afterAll(() => t.close());

describe("formules", () => {
  it("se lisent dans les droits du Compte Lead", () => {
    const free = { leadPlan: "free", entitlements: { plan: { rank: 0 } } };
    const pro = { leadPlan: "pro", entitlements: { plan: { rank: 1 } } };
    const plus = { leadPlan: "x", entitlements: { plan: { rank: 2 } } };
    expect([tierOf(free), tierOf(pro), tierOf(plus)]).toEqual(["free", "pro", "proplus"]);
    expect(tierOf({ leadPlan: "pro", entitlements: null })).toBe("pro");
    expect(hasFeature(free, "vatReturn")).toBe(false);
    expect(hasFeature(pro, "vatReturn")).toBe(true);
    expect(
      upgradeUrl({
        leadPlan: "free",
        entitlements: {
          apps: { invoicelead: { upgrade_url: "https://scanlead.io/billing?app=invoicelead" } },
        },
      }),
    ).toBe("https://scanlead.io/billing?app=invoicelead");
    expect(
      upgradeUrl({
        leadPlan: "free",
        entitlements: { apps: { invoicelead: { upgrade_url: "javascript:alert(1)" } } },
      }),
    ).toBe("https://scanlead.io/billing");
  });

  it("limitent les contacts de la formule gratuite", async () => {
    const a = await attachLeadIdentity(db, claims());
    const who = { organizationId: a.organization.id, userId: a.user.id };
    const f = new FormData();
    for (const [k, v] of Object.entries({
      kind: "company",
      isCustomer: "on",
      name: "X",
      language: "de",
      country: "CH",
      paymentTermDays: "30",
    }))
      f.set(k, v);
    const parsed = parseContactForm(f);
    if (!parsed.ok) throw new Error("contact");
    for (let i = 0; i < LIMITS.free.contacts; i++)
      await createContact(db, who, { ...parsed.data, name: `C${i}` });
    expect(await limitReached(db, a.organization, "contact")).toEqual({ limit: 50 });
    expect(
      await limitReached(db, { ...a.organization, entitlements: { plan: { rank: 1 } } }, "contact"),
    ).toBeNull();
    expect(await limitReached(db, a.organization, "invoice")).toBeNull();
  });
});
