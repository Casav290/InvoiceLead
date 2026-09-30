import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  ACCOUNT_ROLES,
  CHART_ACCOUNTS,
  TYPES_BY_CLASS,
  templateAccounts,
  templateForLegalForm,
} from "@/countries/ch/chart-of-accounts";
import { chartPack } from "@/countries/charts";
import {
  firstFiscalYear,
  fiscalYearContaining,
  formatDate,
  isIsoDate,
  nextFiscalYear,
} from "@/lib/fiscal-year";
import {
  createAccount,
  createFirstFiscalYear,
  installChart,
  listAccounts,
  listFiscalYears,
  openNextFiscalYear,
  parseAccountForm,
  updateAccount,
} from "@/server/accounting";
import { attachLeadIdentity } from "@/server/auth/attach";
import { claims } from "../support/claims";
import { testDb } from "../support/db";

const t = testDb();
const db = t.database;
beforeEach(() => t.reset());
afterAll(() => t.close());

describe("plan comptable PME", () => {
  it("a deux modèles cohérents, avec chaque rôle système une seule fois", () => {
    for (const template of ["sole_proprietorship", "corporation"] as const) {
      const rows = templateAccounts(template);
      expect(rows.length).toBeGreaterThan(70);
      expect(new Set(rows.map((a) => a.number)).size).toBe(rows.length);
      for (const a of rows) {
        expect(a.number).toMatch(/^[1-9]\d{3}$/);
        expect(TYPES_BY_CLASS[a.number[0] ?? ""]).toContain(a.type);
        expect(a.de).not.toContain("ß");
      }
      const roles = rows.flatMap((a) => (a.role ? [a.role] : []));
      expect(new Set(roles).size).toBe(roles.length);
      for (const role of [
        "receivable",
        "bank",
        "vat_output",
        "vat_input_material",
        "annual_result",
      ])
        expect(roles).toContain(role);
    }
    expect(templateAccounts("sole_proprietorship").some((a) => a.role === "private")).toBe(true);
    expect(templateAccounts("corporation").some((a) => a.role === "private")).toBe(false);
    expect(templateAccounts("corporation").some((a) => a.role === "retained_earnings")).toBe(true);
    expect(CHART_ACCOUNTS.every((a) => !a.role || ACCOUNT_ROLES.includes(a.role))).toBe(true);
    expect(templateForLegalForm("ag")).toBe("corporation");
    expect(templateForLegalForm("gmbh")).toBe("corporation");
    expect(templateForLegalForm(null)).toBe("sole_proprietorship");
  });

  it("valide numéro, type selon la classe et libellés", () => {
    const f = (v: Record<string, string>) => {
      const fd = new FormData();
      for (const [k, x] of Object.entries(v)) fd.set(k, x);
      return parseAccountForm(fd);
    };
    const bad = f({ number: "0123", nameDe: "", nameFr: "", type: "asset" });
    expect(!bad.ok && bad.errors).toMatchObject({ number: "number", nameDe: "required" });
    const wrongType = f({ number: "3450", nameFr: "Ventes", type: "asset" });
    expect(!wrongType.ok && wrongType.errors).toMatchObject({ type: "typeForClass" });
    const ok = f({ number: "3450", nameFr: "Ventes en ligne", type: "revenue", active: "on" });
    expect(ok.ok && ok.data).toMatchObject({
      nameDe: "Ventes en ligne",
      vatCode: null,
      active: true,
    });
  });

  it("s'installe une fois, reste propre à l'organisation et protège les comptes système", async () => {
    const a = await attachLeadIdentity(db, claims({ org_role: "admin" }));
    const b = await attachLeadIdentity(
      db,
      claims({ sub: "sub-b", email: "b@autre.test", org: "org-b", org_role: "user" }),
    );
    const whoA = { organizationId: a.organization.id, userId: a.user.id };
    const whoB = { organizationId: b.organization.id, userId: b.user.id };

    expect(await installChart(db, whoB, "corporation")).toBe("forbidden");
    expect(await installChart(db, whoA, "corporation")).toBe("installed");
    expect(await installChart(db, whoA, "sole_proprietorship")).toBe("exists");
    const rows = await listAccounts(db, a.organization.id);
    expect(rows).toHaveLength(chartPack("CH").templateAccounts("corporation").length);
    expect(await listAccounts(db, b.organization.id)).toHaveLength(0);

    const input = {
      number: "1021",
      nameDe: "Bank 2",
      nameFr: "Banque 2",
      type: "asset" as const,
      vatCode: null,
      active: true,
    };
    const created = await createAccount(db, whoA, input);
    expect(typeof created).toBe("object");
    expect(await createAccount(db, whoA, input)).toBe("numberTaken");

    const bank = rows.find((r) => r.role === "bank");
    if (!bank) throw new Error("banque manquante");
    const asBank = { ...input, number: bank.number, nameDe: "Bank", nameFr: "Banque" };
    expect(await updateAccount(db, whoA, bank.id, { ...asBank, active: false })).toBe(
      "systemInactive",
    );
    expect(await updateAccount(db, whoA, bank.id, { ...asBank, number: "1021" })).toBe(
      "numberTaken",
    );
    expect(await updateAccount(db, whoA, bank.id, { ...asBank, nameDe: "UBS" })).toMatchObject({
      nameDe: "UBS",
      role: "bank",
    });
  });
});

describe("exercices comptables", () => {
  it("se calculent selon le mois de début", () => {
    expect(isIsoDate("2026-02-29")).toBe(false);
    expect(isIsoDate("2028-02-29")).toBe(true);
    expect(fiscalYearContaining("2026-09-30", 1)).toEqual({
      start: "2026-01-01",
      end: "2026-12-31",
    });
    expect(fiscalYearContaining("2026-03-15", 7)).toEqual({
      start: "2025-07-01",
      end: "2026-06-30",
    });
    expect(firstFiscalYear("2026-04-15", 1, false)).toMatchObject({
      end: "2026-12-31",
      extendable: true,
    });
    expect(firstFiscalYear("2026-04-15", 1, true).end).toBe("2027-12-31");
    expect(firstFiscalYear("2026-01-01", 1, true)).toMatchObject({
      end: "2026-12-31",
      extendable: false,
    });
    expect(nextFiscalYear("2026-12-31")).toEqual({ start: "2027-01-01", end: "2027-12-31" });
    expect(nextFiscalYear("2027-06-30")).toEqual({ start: "2027-07-01", end: "2028-06-30" });
    expect(formatDate("2026-01-05")).toBe("05.01.2026");
  });

  it("se suivent sans trou et ne s'ouvrent qu'avec le bon rôle", async () => {
    const a = await attachLeadIdentity(db, claims({ org_role: "manager" }));
    const who = { organizationId: a.organization.id, userId: a.user.id };
    expect(await openNextFiscalYear(db, who)).toBe("none");
    expect(await createFirstFiscalYear(db, who, { start: "2026-02-30", extended: false })).toBe(
      "invalid",
    );
    expect(
      await createFirstFiscalYear(db, who, { start: "2026-04-15", extended: false }),
    ).toMatchObject({ startDate: "2026-04-15", endDate: "2026-12-31", status: "open" });
    expect(await createFirstFiscalYear(db, who, { start: "2027-01-01", extended: false })).toBe(
      "exists",
    );
    expect(await openNextFiscalYear(db, who)).toMatchObject({
      startDate: "2027-01-01",
      endDate: "2027-12-31",
    });
    expect((await listFiscalYears(db, a.organization.id)).map((y) => y.startDate)).toEqual([
      "2027-01-01",
      "2026-04-15",
    ]);

    const u = await attachLeadIdentity(
      db,
      claims({ sub: "sub-u", email: "u@autre.test", org: "org-u", org_role: "user" }),
    );
    expect(
      await openNextFiscalYear(db, { organizationId: u.organization.id, userId: u.user.id }),
    ).toBe("forbidden");
  });
});
