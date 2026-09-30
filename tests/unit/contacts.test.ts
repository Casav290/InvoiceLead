import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { attachLeadIdentity } from "@/server/auth/attach";
import {
  archiveContact,
  createContact,
  getContact,
  listContacts,
  parseContactForm,
  updateContact,
} from "@/server/contacts";
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
  kind: "company",
  isCustomer: "on",
  name: "Bäckerei Frei AG",
  street: "Marktgasse",
  buildingNumber: "3",
  postalCode: "3011",
  town: "Bern",
  country: "CH",
  language: "de",
  paymentTermDays: "30",
};

function parsed(values: Record<string, string>) {
  const r = parseContactForm(form(values));
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.data;
}

describe("formulaire contact", () => {
  it("accepte un contact sans adresse, mais pas une adresse incomplète", () => {
    expect(
      parseContactForm(form({ kind: "person", isCustomer: "on", name: "Léa", language: "fr" })).ok,
    ).toBe(true);
    const r = parseContactForm(form({ ...VALID, postalCode: "", town: "" }));
    expect(!r.ok && r.errors).toMatchObject({ postalCode: "required", town: "required" });
  });

  it("exige au moins un rôle, un délai raisonnable et un IDE valide s'il est saisi", () => {
    const r = parseContactForm(
      form({ ...VALID, isCustomer: "", paymentTermDays: "400", uid: "CHE-116.281.711" }),
    );
    expect(!r.ok && r.errors).toMatchObject({
      isCustomer: "role",
      paymentTermDays: "paymentTerm",
      uid: "uid",
    });
    expect(parsed({ ...VALID, uid: "CHE-116.281.710 MWST" }).uid).toBe("CHE116281710");
  });

  it("accepte un NPA étranger hors format suisse", () => {
    expect(
      parsed({ ...VALID, country: "DE", postalCode: "80331", town: "München" }).postalCode,
    ).toBe("80331");
  });
});

describe("contacts d'une organisation", () => {
  it("restent invisibles et intouchables pour une autre organisation", async () => {
    const a = await attachLeadIdentity(db, claims());
    const b = await attachLeadIdentity(
      db,
      claims({ sub: "sub-b", email: "b@autre.test", org: "org-b" }),
    );
    const whoA = { organizationId: a.organization.id, userId: a.user.id };
    const whoB = { organizationId: b.organization.id, userId: b.user.id };

    const c = await createContact(db, whoA, parsed(VALID));
    expect(await getContact(db, a.organization.id, c.id)).not.toBeNull();
    expect(await getContact(db, b.organization.id, c.id)).toBeNull();
    expect(await listContacts(db, b.organization.id)).toHaveLength(0);
    expect(await updateContact(db, whoB, c.id, parsed({ ...VALID, name: "Pirate" }))).toBeNull();
    expect(await archiveContact(db, whoB, c.id)).toBe(false);
    expect((await getContact(db, a.organization.id, c.id))?.name).toBe("Bäckerei Frei AG");
    expect(await getContact(db, a.organization.id, "pas-un-uuid")).toBeNull();
  });

  it("se cherchent par nom, e-mail ou localité, et disparaissent de la liste une fois archivés", async () => {
    const a = await attachLeadIdentity(db, claims());
    const who = { organizationId: a.organization.id, userId: a.user.id };
    const frei = await createContact(db, who, parsed(VALID));
    await createContact(
      db,
      who,
      parsed({ ...VALID, name: "Atelier Rossi", town: "Lugano", postalCode: "6900" }),
    );
    expect((await listContacts(db, a.organization.id, "lugano")).map((c) => c.name)).toEqual([
      "Atelier Rossi",
    ]);
    expect((await listContacts(db, a.organization.id, "%")).length).toBe(0);
    expect(await archiveContact(db, who, frei.id)).toBe(true);
    expect((await listContacts(db, a.organization.id)).map((c) => c.name)).toEqual([
      "Atelier Rossi",
    ]);
  });
});
