import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { attachLeadIdentity } from "@/server/auth/attach";
import { canEditSettings, parseCompanyForm, saveCompanySettings } from "@/server/company";
import { auditLog, organizations } from "@/server/db/schema";
import { claims } from "../support/claims";
import { testDb } from "../support/db";

const t = testDb();
const db = t.database;
beforeEach(() => t.reset());
afterAll(() => t.close());

function form(values: Record<string, string>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(values)) f.set(k, v);
  return f;
}

const VALID = {
  legalName: "Atelier Muster GmbH",
  legalForm: "gmbh",
  street: "Bahnhofstrasse",
  buildingNumber: "12a",
  postalCode: "8001",
  town: "Zürich",
  email: "info@atelier.test",
  uid: "CHE-116.281.710",
  vatRegistered: "on",
  vatMethod: "effective",
  vatSettlement: "agreed",
  iban: "CH93 0076 2011 6238 5295 7",
  qrIban: "",
  fiscalYearStartMonth: "1",
};

describe("formulaire entreprise", () => {
  it("normalise les numéros d'un formulaire valide", () => {
    const r = parseCompanyForm(form(VALID));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.uid).toBe("CHE116281710");
    expect(r.data.iban).toBe("CH9300762011623852957");
    expect(r.data.qrIban).toBeNull();
    expect(r.data.vatRegistered).toBe(true);
  });

  it("signale chaque champ fautif", () => {
    const r = parseCompanyForm(
      form({
        ...VALID,
        legalName: "",
        postalCode: "80011",
        uid: "CHE-116.281.711",
        iban: "CH44 3199 9123 0008 8901 2",
        qrIban: "CH93 0076 2011 6238 5295 7",
        email: "pas-une-adresse",
      }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors).toMatchObject({
      legalName: "required",
      postalCode: "postalCode",
      uid: "uid",
      iban: "ibanIsQr",
      qrIban: "notQrIban",
      email: "email",
    });
  });

  it("exige IDE, méthode et type de décompte pour une entreprise assujettie à la TVA", () => {
    const r = parseCompanyForm(form({ ...VALID, uid: "", vatMethod: "", vatSettlement: "" }));
    expect(!r.ok && r.errors).toMatchObject({
      uid: "uidRequiredForVat",
      vatMethod: "required",
      vatSettlement: "required",
    });
    const notRegistered = parseCompanyForm(
      form({ ...VALID, vatRegistered: "", uid: "", vatMethod: "effective" }),
    );
    expect(notRegistered.ok && notRegistered.data.vatMethod).toBeNull();

    // Méthode TDFN : le taux accordé par l'AFC est exigé, « 6,2 » donne 620 points de base.
    const tdfn = (netTaxRate: string) =>
      parseCompanyForm(form({ ...VALID, vatMethod: "net_tax_rate", netTaxRate }));
    const missing = tdfn("");
    expect(!missing.ok && missing.errors.netTaxRateBp).toBe("netTaxRate");
    const set = tdfn("6,2");
    expect(set.ok && set.data.netTaxRateBp).toBe(620);
    expect(tdfn("16").ok).toBe(false);
    const effective = parseCompanyForm(form({ ...VALID, netTaxRate: "6.2" }));
    expect(effective.ok && effective.data.netTaxRateBp).toBeNull();
  });
});

describe("enregistrement", () => {
  it("réservé aux rôles admin et manager, journalisé, marque les réglages complets", async () => {
    const admin = await attachLeadIdentity(db, claims());
    const member = await attachLeadIdentity(
      db,
      claims({ sub: "sub-bob", email: "bob@atelier.test", org_role: "user" }),
    );
    const parsed = parseCompanyForm(form(VALID));
    if (!parsed.ok) throw new Error("formulaire invalide");

    expect(await canEditSettings(db, member.organization.id, member.user.id)).toBe(false);
    expect(
      await saveCompanySettings(
        db,
        { organizationId: member.organization.id, userId: member.user.id },
        parsed.data,
      ),
    ).toBe("forbidden");

    expect(
      await saveCompanySettings(
        db,
        { organizationId: admin.organization.id, userId: admin.user.id },
        parsed.data,
      ),
    ).toBe("saved");
    const [org] = await db
      .select()
      .from(organizations)
      .where(eq(organizations.id, admin.organization.id));
    expect(org).toMatchObject({
      legalName: "Atelier Muster GmbH",
      uid: "CHE116281710",
      town: "Zürich",
    });
    expect(org?.settingsCompletedAt).toBeInstanceOf(Date);
    const logs = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, "company.settings.update"));
    expect(logs).toHaveLength(1);
  });
});
