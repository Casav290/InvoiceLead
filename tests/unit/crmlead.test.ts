import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { attachLeadIdentity } from "@/server/auth/attach";
import { decodeHandoff, encodeHandoff, importHandoff } from "@/server/crmlead";
import { contacts, invoiceLines, invoices } from "@/server/db/schema";
import { claims } from "../support/claims";
import { testDb } from "../support/db";

const t = testDb();
const db = t.database;
beforeEach(() => t.reset());
afterAll(() => t.close());

const HANDOFF = {
  v: 1 as const,
  kind: "quote" as const,
  lead: { id: "lead-42", title: "Refonte du site" },
  contact: {
    id: "co-7",
    name: "Boulangerie Rochat SA",
    contactPerson: "Léa Rochat",
    email: "Lea@Rochat.test",
    postalCode: "1003",
    town: "Lausanne",
    language: "fr" as const,
  },
  lines: [
    {
      description: "Atelier de cadrage",
      quantity: 1.5,
      unit: "day" as const,
      unitPriceCents: 120000,
    },
    { description: "Maquettes", quantity: 1, unitPriceCents: 250000 },
  ],
};

const opts = { language: "fr", today: "2026-09-30", canCreateContact: true };

describe("passage CRMlead", () => {
  it("refuse un lien illisible ou incomplet", () => {
    expect(decodeHandoff(null)).toBeNull();
    expect(decodeHandoff("pas-du-json")).toBeNull();
    expect(decodeHandoff(encodeHandoff({ ...HANDOFF, lines: [] }))).toBeNull();
    expect(decodeHandoff(encodeHandoff({ ...HANDOFF, currency: "EUR" } as never))).toBeNull();
    const ok = decodeHandoff(encodeHandoff(HANDOFF));
    expect(ok?.contact.email).toBe("lea@rochat.test");
    expect(ok?.lines[1]).toMatchObject({ unit: "flat", vatCode: "normal" });
  });

  it("crée client et devis une seule fois, reprend un client connu", async () => {
    const { user, organization } = await attachLeadIdentity(db, claims());
    const who = { organizationId: organization.id, userId: user.id };
    const handoff = decodeHandoff(encodeHandoff(HANDOFF));
    if (!handoff) throw new Error("handoff");

    const first = await importHandoff(db, who, handoff, opts);
    expect(first).toMatchObject({ status: "created", kind: "quote" });
    if (first.status === "contactLimit") return;
    const [doc] = await db.select().from(invoices).where(eq(invoices.id, first.id));
    expect(doc).toMatchObject({
      kind: "quote",
      status: "draft",
      title: "Refonte du site",
      language: "fr",
      netCents: 430000,
      externalRef: "crmlead:lead-42",
    });
    const lines = await db.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, first.id));
    expect(lines.map((l) => l.quantityMilli)).toEqual([1500, 1000]);

    // Second passage du même lead : la même pièce.
    expect(await importHandoff(db, who, handoff, opts)).toEqual({
      status: "existing",
      id: first.id,
      kind: "quote",
    });

    // Autre lead, même client (par sa fiche CRMlead) : pas de nouveau contact, même sans place.
    const other = decodeHandoff(
      encodeHandoff({ ...HANDOFF, kind: "invoice", lead: { id: "lead-43" } }),
    );
    if (!other) throw new Error("handoff");
    const second = await importHandoff(db, who, other, { ...opts, canCreateContact: false });
    expect(second).toMatchObject({ status: "created", kind: "invoice" });
    expect(await db.select().from(contacts)).toHaveLength(1);

    // Nouveau client alors que la limite est atteinte.
    const stranger = decodeHandoff(
      encodeHandoff({
        ...HANDOFF,
        lead: { id: "lead-44" },
        contact: { name: "Garage Favre" },
      }),
    );
    if (!stranger) throw new Error("handoff");
    expect(await importHandoff(db, who, stranger, { ...opts, canCreateContact: false })).toEqual({
      status: "contactLimit",
    });
  });
});
