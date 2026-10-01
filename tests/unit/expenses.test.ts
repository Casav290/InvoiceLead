import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createFirstFiscalYear, installChart } from "@/server/accounting";
import { attachLeadIdentity } from "@/server/auth/attach";
import { approveBill, exportPayments } from "@/server/bills";
import { accounts, bookingRules, journalLines, organizations } from "@/server/db/schema";
import {
  createClaim,
  deleteClaim,
  lastClaimIban,
  listClaims,
  mileageCents,
  parseClaimForm,
  parseKilometers,
} from "@/server/expenses";
import { claims } from "../support/claims";
import { testDb } from "../support/db";
import { setTestEnv } from "../support/env";

const t = testDb();
const db = t.database;
beforeAll(() => setTestEnv());
beforeEach(() => t.reset());
afterAll(() => t.close());

function form(values: Record<string, string>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(values)) f.append(k, v);
  return f;
}

async function company() {
  const a = await attachLeadIdentity(db, claims());
  const who = { organizationId: a.organization.id, userId: a.user.id };
  await db
    .update(organizations)
    .set({
      vatRegistered: true,
      vatMethod: "effective",
      uid: "CHE116281710",
      legalName: "Atelier Muster GmbH",
      street: "Bahnhofstrasse",
      postalCode: "8001",
      town: "Zürich",
      iban: "CH9300762011623852957",
      settingsCompletedAt: new Date(),
    })
    .where(eq(organizations.id, a.organization.id));
  await installChart(db, who, "corporation");
  await createFirstFiscalYear(db, who, { start: "2026-01-01", extended: false });
  const [travel] = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.organizationId, who.organizationId), eq(accounts.number, "5820")));
  if (!travel) throw new Error("compte");
  return { who, travel };
}

describe("notes de frais", () => {
  it("lisent kilomètres et montants", () => {
    expect(parseKilometers("123,5")).toBe(123_500);
    expect(parseKilometers("0")).toBeNull();
    expect(parseKilometers("abc")).toBeNull();
    expect(mileageCents(123_500, 70)).toBe(8_645);
    const bad = parseClaimForm(form({ kind: "mileage", date: "2026-03-01", km: "x" }));
    expect(bad.ok).toBe(false);
    if (!bad.ok)
      expect(bad.errors).toMatchObject({
        km: "km",
        description: "required",
        claimantName: "required",
      });
  });

  it("indemnité kilométrique et dépense : approuvées, comptabilisées et remboursées par pain.001", async () => {
    const { who, travel } = await company();
    const mileage = parseClaimForm(
      form({
        kind: "mileage",
        date: "2026-03-10",
        description: "Zürich – Bern, client Kunde AG",
        km: "250",
        rate: "0.70",
        claimantName: "Eva Muster",
        iban: "CH56 0483 5012 3456 7800 9",
      }),
    );
    if (!mileage.ok) throw new Error(JSON.stringify(mileage.errors));
    const trip = await createClaim(db, who, mileage.data);
    expect(trip).toMatchObject({
      source: "mileage",
      totalCents: 17_500,
      vatCode: null,
      accountId: travel.id,
      claimantId: who.userId,
      iban: "CH5604835012345678009",
      description: "Zürich – Bern, client Kunde AG (250 km × 0.70)",
    });

    const lunch = parseClaimForm(
      form({
        kind: "expense",
        date: "2026-03-11",
        description: "Repas client",
        amount: "54.05",
        vatCode: "normal",
        accountId: travel.id,
        claimantName: "Eva Muster",
        iban: "",
      }),
    );
    if (!lunch.ok) throw new Error(JSON.stringify(lunch.errors));
    const meal = await createClaim(db, who, lunch.data);
    expect(meal).toMatchObject({ source: "expense", totalCents: 5_405, vatCode: "normal" });
    expect(await lastClaimIban(db, who.organizationId, who.userId)).toBe("CH5604835012345678009");
    expect(await listClaims(db, who.organizationId, who.userId)).toHaveLength(2);

    // Approbation : charge sans impôt préalable pour les kilomètres, avec pour le repas.
    const approved = await approveBill(db, who, trip.id);
    if (typeof approved !== "object") throw new Error(approved);
    const lines = await db
      .select()
      .from(journalLines)
      .where(eq(journalLines.entryId, approved.journalEntryId ?? ""));
    expect(lines.find((l) => l.accountId === travel.id)?.debitCents).toBe(17_500);
    expect(lines).toHaveLength(2);
    const approvedMeal = await approveBill(db, who, meal.id);
    if (typeof approvedMeal !== "object") throw new Error(approvedMeal);
    const mealLines = await db
      .select()
      .from(journalLines)
      .where(eq(journalLines.entryId, approvedMeal.journalEntryId ?? ""));
    expect(mealLines).toHaveLength(3);
    // Rien n'est appris sur les paiements à la personne.
    expect(await db.select().from(bookingRules)).toEqual([]);

    // Seule la note avec IBAN part dans le fichier de paiement.
    const file = await exportPayments(db, who, null, "2026-03-20");
    if (typeof file === "string") throw new Error(file);
    expect(file.count).toBe(1);
    expect(file.xml).toContain("<IBAN>CH5604835012345678009</IBAN>");
    expect(file.xml).toContain("<Nm>Eva Muster</Nm>");
  });

  it("se retire seulement en brouillon et par la personne qui l'a saisie", async () => {
    const { who } = await company();
    const parsed = parseClaimForm(
      form({
        kind: "expense",
        date: "2026-03-11",
        description: "Parking",
        amount: "12",
        claimantName: "Eva Muster",
      }),
    );
    if (!parsed.ok) throw new Error("form");
    const claim = await createClaim(db, who, parsed.data);
    expect(await deleteClaim(db, { ...who, userId: crypto.randomUUID() }, claim.id)).toBe(false);
    expect(await deleteClaim(db, who, claim.id)).toBe(true);
    expect(await listClaims(db, who.organizationId)).toEqual([]);
  });
});
