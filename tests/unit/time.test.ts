import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { attachLeadIdentity } from "@/server/auth/attach";
import { createContact, parseContactForm } from "@/server/contacts";
import { invoiceLines, organizations, timeEntries } from "@/server/db/schema";
import { deleteDraft, getInvoice, issueInvoice } from "@/server/invoices";
import {
  addEntry,
  createProject,
  formatMinutes,
  invoiceProject,
  listProjects,
  parseDuration,
  parseProjectForm,
  runningTimer,
  startTimer,
  stopTimer,
} from "@/server/time";
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

describe("durées", () => {
  it("lit heures, minutes et décimales", () => {
    expect(parseDuration("1:30")).toBe(90);
    expect(parseDuration("1.5")).toBe(90);
    expect(parseDuration("1,25")).toBe(75);
    expect(parseDuration("2h")).toBe(120);
    expect(parseDuration("45m")).toBe(45);
    expect(parseDuration("0")).toBeNull();
    expect(parseDuration("25:00")).toBeNull();
    expect(parseDuration("abc")).toBeNull();
    expect(formatMinutes(95)).toBe("1:35");
  });
});

async function setup() {
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
  const c = parseContactForm(
    form({ kind: "company", isCustomer: "on", name: "Kunde AG", language: "fr", country: "CH" }),
  );
  if (!c.ok) throw new Error("contact");
  const contact = await createContact(db, who, c.data);
  const p = parseProjectForm(
    form({ contactId: contact.id, name: "Site web", hourlyRate: "150", budgetHours: "10" }),
  );
  if (!p.ok) throw new Error(JSON.stringify(p.errors));
  const project = await createProject(db, who, p.data);
  if (typeof project !== "object") throw new Error("projet");
  return { who, project };
}

describe("temps et projets", () => {
  it("saisit, chronomètre, puis facture les heures non facturées", async () => {
    const { who, project } = await setup();
    expect(project.budgetMinutes).toBe(600);
    await addEntry(db, who, {
      projectId: project.id,
      workDate: "2026-03-02",
      minutes: 90,
      description: "Maquette",
      billable: true,
    });
    await addEntry(db, who, {
      projectId: project.id,
      workDate: "2026-03-03",
      minutes: 30,
      description: "Appel interne",
      billable: false,
    });
    const start = new Date("2026-03-04T08:00:00Z");
    await startTimer(db, who, project.id, "Intégration", start);
    expect((await runningTimer(db, who))?.project).toBe("Site web");
    // Un nouveau chrono arrête le précédent.
    await startTimer(db, who, project.id, "Tests", new Date("2026-03-04T09:00:00Z"));
    const stopped = await stopTimer(db, who, new Date("2026-03-04T09:45:00Z"));
    expect(stopped?.minutes).toBe(45);
    expect(await runningTimer(db, who)).toBeNull();

    const [stats] = await listProjects(db, who.organizationId);
    expect(stats).toMatchObject({ minutes: 90 + 30 + 60 + 45, unbilledMinutes: 90 + 60 + 45 });
    expect(stats?.unbilledCents).toBe(Math.round((195 * 15_000) / 60));

    const result = await invoiceProject(db, who, project.id, "2026-03-05");
    if (typeof result !== "object") throw new Error(result);
    expect(result.entries).toBe(3);
    const found = await getInvoice(db, who.organizationId, result.invoiceId);
    expect(found?.invoice).toMatchObject({
      projectId: project.id,
      language: "fr",
      introText: "Site web",
    });
    const lines = await db
      .select()
      .from(invoiceLines)
      .where(eq(invoiceLines.invoiceId, result.invoiceId));
    expect(lines.map((l) => [l.quantityMilli, l.unit, l.unitPriceCents, l.vatCode])).toEqual([
      [1500, "hour", 15_000, "normal"],
      [1000, "hour", 15_000, "normal"],
      [750, "hour", 15_000, "normal"],
    ]);
    expect(await invoiceProject(db, who, project.id, "2026-03-05")).toBe("nothing");

    // Brouillon supprimé : les heures redeviennent facturables.
    expect(await deleteDraft(db, who, result.invoiceId)).toBe(true);
    const free = await db.select().from(timeEntries).where(eq(timeEntries.projectId, project.id));
    expect(free.every((e) => e.invoiceId === null)).toBe(true);

    const again = await invoiceProject(db, who, project.id, "2026-03-05");
    if (typeof again !== "object") throw new Error(again);
    await issueInvoice(db, who, again.invoiceId);
    const [after] = await listProjects(db, who.organizationId);
    expect(after?.unbilledMinutes).toBe(0);
    expect(after?.invoicedNetCents).toBe(48_750);
  });
});
