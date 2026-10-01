import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { parseAmountToCents } from "@/lib/amount-input";
import { isIsoDate } from "@/lib/fiscal-year";
import type { Db } from "./db";
import {
  auditLog,
  contacts,
  invoices,
  organizations,
  type Project,
  projects,
  type TimeEntry,
  timeEntries,
} from "./db/schema";
import { createInvoice, documentLanguage, type InvoiceInput } from "./invoices";

type Who = { organizationId: string; userId: string };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Durée saisie : « 1:30 », « 1.5 », « 1,5 » (heures) ou « 90m » ; en minutes, ou null. */
export function parseDuration(value: string): number | null {
  const v = value.trim().toLowerCase().replace(",", ".");
  let minutes: number | null = null;
  const hm = /^(\d{1,2}):([0-5]\d)$/.exec(v);
  const m = /^(\d{1,4})\s*m(in)?$/.exec(v);
  const h = /^(\d{1,2}(\.\d{1,2})?)\s*h?$/.exec(v);
  if (hm) minutes = Number(hm[1]) * 60 + Number(hm[2]);
  else if (m) minutes = Number(m[1]);
  else if (h) minutes = Math.round(Number(h[1]) * 60);
  return minutes !== null && minutes > 0 && minutes <= 1440 ? minutes : null;
}

/** « 1:30 » pour 90 minutes. */
export const formatMinutes = (minutes: number) =>
  `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;

export type ProjectInput = {
  contactId: string;
  name: string;
  hourlyRateCents: number;
  budgetMinutes: number | null;
};

export function parseProjectForm(
  form: FormData,
): { ok: true; data: ProjectInput } | { ok: false; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const contactId = String(form.get("contactId") ?? "");
  if (!UUID.test(contactId)) errors.contactId = "required";
  const name = String(form.get("name") ?? "").trim();
  if (!name) errors.name = "required";
  else if (name.length > 120) errors.name = "tooLong";
  const rate = String(form.get("hourlyRate") ?? "").trim();
  const hourlyRateCents = rate === "" ? 0 : parseAmountToCents(rate);
  if (hourlyRateCents === null || hourlyRateCents < 0) errors.hourlyRate = "amount";
  const budget = String(form.get("budgetHours") ?? "")
    .trim()
    .replace(",", ".");
  const budgetHours = budget === "" ? null : Number(budget);
  if (
    budgetHours !== null &&
    !(Number.isFinite(budgetHours) && budgetHours > 0 && budgetHours <= 100_000)
  )
    errors.budgetHours = "hours";
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    data: {
      contactId,
      name,
      hourlyRateCents: hourlyRateCents ?? 0,
      budgetMinutes: budgetHours === null ? null : Math.round(budgetHours * 60),
    },
  };
}

async function customerOf(database: Db, organizationId: string, contactId: string) {
  const [c] = await database
    .select()
    .from(contacts)
    .where(and(eq(contacts.id, contactId), eq(contacts.organizationId, organizationId)));
  return c ?? null;
}

export async function createProject(database: Db, who: Who, data: ProjectInput) {
  if (!(await customerOf(database, who.organizationId, data.contactId))) return "contact" as const;
  const [row] = await database
    .insert(projects)
    .values({ ...data, organizationId: who.organizationId })
    .returning();
  if (!row) throw new Error("project_not_saved");
  await database.insert(auditLog).values({
    organizationId: who.organizationId,
    userId: who.userId,
    action: "project.create",
    entity: "project",
    entityId: row.id,
  });
  return row;
}

export async function updateProject(database: Db, who: Who, id: string, data: ProjectInput) {
  if (!UUID.test(id)) return null;
  if (!(await customerOf(database, who.organizationId, data.contactId))) return "contact" as const;
  const [row] = await database
    .update(projects)
    .set({ ...data, updatedAt: new Date() })
    .where(and(eq(projects.id, id), eq(projects.organizationId, who.organizationId)))
    .returning();
  return row ?? null;
}

export async function setProjectArchived(database: Db, who: Who, id: string, archived: boolean) {
  if (!UUID.test(id)) return false;
  const rows = await database
    .update(projects)
    .set({ archivedAt: archived ? new Date() : null, updatedAt: new Date() })
    .where(and(eq(projects.id, id), eq(projects.organizationId, who.organizationId)))
    .returning({ id: projects.id });
  return rows.length > 0;
}

export async function getProject(database: Db, organizationId: string, id: string) {
  if (!UUID.test(id)) return null;
  const [row] = await database
    .select({ project: projects, customer: contacts.name })
    .from(projects)
    .innerJoin(contacts, eq(contacts.id, projects.contactId))
    .where(and(eq(projects.id, id), eq(projects.organizationId, organizationId)));
  return row ?? null;
}

export type ProjectStats = {
  project: Project;
  customer: string;
  minutes: number;
  unbilledMinutes: number;
  unbilledCents: number;
  /** Chiffre d'affaires facturé sur le projet, hors TVA, avoirs déduits. */
  invoicedNetCents: number;
};

/** Projets avec leurs heures, ce qui reste à facturer et ce qui a été facturé. */
export async function listProjects(
  database: Db,
  organizationId: string,
  options: { archived?: boolean } = {},
): Promise<ProjectStats[]> {
  const rows = await database
    .select({
      project: projects,
      customer: contacts.name,
      minutes: sql<number>`coalesce((select sum(e.minutes) from time_entries e where e.project_id = ${projects.id} and e.started_at is null), 0)::int`,
      unbilledMinutes: sql<number>`coalesce((select sum(e.minutes) from time_entries e where e.project_id = ${projects.id} and e.started_at is null and e.billable and e.invoice_id is null), 0)::int`,
      unbilledCents:
        sql<number>`coalesce((select sum(round(e.minutes * e.rate_cents / 60.0)) from time_entries e where e.project_id = ${projects.id} and e.started_at is null and e.billable and e.invoice_id is null), 0)::bigint`.mapWith(
          Number,
        ),
      invoicedNetCents:
        sql<number>`coalesce((select sum(case when i.kind = 'credit_note' then -i.net_cents else i.net_cents end) from invoices i where (i.project_id = ${projects.id} or (i.kind = 'credit_note' and i.related_invoice_id in (select j.id from invoices j where j.project_id = ${projects.id}))) and i.status = 'issued'), 0)::bigint`.mapWith(
          Number,
        ),
    })
    .from(projects)
    .innerJoin(contacts, eq(contacts.id, projects.contactId))
    .where(
      and(
        eq(projects.organizationId, organizationId),
        options.archived ? isNotNull(projects.archivedAt) : isNull(projects.archivedAt),
      ),
    )
    .orderBy(asc(projects.name));
  return rows;
}

export type EntryInput = {
  projectId: string;
  workDate: string;
  minutes: number;
  description: string | null;
  billable: boolean;
};

export function parseEntryForm(
  form: FormData,
): { ok: true; data: EntryInput } | { ok: false; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const projectId = String(form.get("projectId") ?? "");
  if (!UUID.test(projectId)) errors.projectId = "required";
  const workDate = String(form.get("workDate") ?? "");
  if (!isIsoDate(workDate)) errors.workDate = "date";
  const minutes = parseDuration(String(form.get("duration") ?? ""));
  if (!minutes) errors.duration = "duration";
  const description =
    String(form.get("description") ?? "")
      .trim()
      .slice(0, 300) || null;
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    data: {
      projectId,
      workDate,
      minutes: minutes ?? 0,
      description,
      billable: form.get("billable") === "on",
    },
  };
}

async function activeProject(database: Db, organizationId: string, id: string) {
  if (!UUID.test(id)) return null;
  const [p] = await database
    .select()
    .from(projects)
    .where(
      and(
        eq(projects.id, id),
        eq(projects.organizationId, organizationId),
        isNull(projects.archivedAt),
      ),
    );
  return p ?? null;
}

export async function addEntry(database: Db, who: Who, data: EntryInput) {
  const project = await activeProject(database, who.organizationId, data.projectId);
  if (!project) return "project" as const;
  const [row] = await database
    .insert(timeEntries)
    .values({
      ...data,
      organizationId: who.organizationId,
      userId: who.userId,
      rateCents: project.hourlyRateCents,
    })
    .returning();
  return row ?? null;
}

export async function deleteEntry(database: Db, who: Who, id: string): Promise<boolean> {
  if (!UUID.test(id)) return false;
  const rows = await database
    .delete(timeEntries)
    .where(
      and(
        eq(timeEntries.id, id),
        eq(timeEntries.organizationId, who.organizationId),
        isNull(timeEntries.invoiceId),
      ),
    )
    .returning({ id: timeEntries.id });
  return rows.length > 0;
}

/** Chrono en cours de la personne, s'il y en a un. */
export async function runningTimer(database: Db, who: Who) {
  const [row] = await database
    .select({ entry: timeEntries, project: projects.name })
    .from(timeEntries)
    .innerJoin(projects, eq(projects.id, timeEntries.projectId))
    .where(
      and(
        eq(timeEntries.organizationId, who.organizationId),
        eq(timeEntries.userId, who.userId),
        isNotNull(timeEntries.startedAt),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** Arrête le chrono : la durée écoulée (au moins une minute) devient la saisie. */
export async function stopTimer(
  database: Db,
  who: Who,
  now = new Date(),
): Promise<TimeEntry | null> {
  const running = await runningTimer(database, who);
  if (!running?.entry.startedAt) return null;
  const minutes = Math.min(
    1440,
    Math.max(1, Math.round((now.getTime() - running.entry.startedAt.getTime()) / 60_000)),
  );
  const [row] = await database
    .update(timeEntries)
    .set({ minutes, startedAt: null })
    .where(eq(timeEntries.id, running.entry.id))
    .returning();
  return row ?? null;
}

/** Lance un chrono sur un projet ; un chrono déjà en cours est d'abord arrêté. */
export async function startTimer(
  database: Db,
  who: Who,
  projectId: string,
  description: string | null,
  now = new Date(),
) {
  const project = await activeProject(database, who.organizationId, projectId);
  if (!project) return "project" as const;
  await stopTimer(database, who, now);
  const [row] = await database
    .insert(timeEntries)
    .values({
      organizationId: who.organizationId,
      projectId,
      userId: who.userId,
      workDate: now.toISOString().slice(0, 10),
      minutes: 0,
      description: description?.slice(0, 300) || null,
      billable: true,
      rateCents: project.hourlyRateCents,
      startedAt: now,
    })
    .returning();
  return row ?? null;
}

/** Saisies récentes de l'entreprise (ou d'un projet), les plus récentes d'abord. */
export async function listEntries(
  database: Db,
  organizationId: string,
  options: { projectId?: string; since?: string } = {},
) {
  return database
    .select({ entry: timeEntries, project: projects.name })
    .from(timeEntries)
    .innerJoin(projects, eq(projects.id, timeEntries.projectId))
    .where(
      and(
        eq(timeEntries.organizationId, organizationId),
        ...(options.projectId ? [eq(timeEntries.projectId, options.projectId)] : []),
        ...(options.since ? [gte(timeEntries.workDate, options.since)] : []),
      ),
    )
    .orderBy(desc(timeEntries.workDate), desc(timeEntries.createdAt))
    .limit(300);
}

/**
 * Facture les heures facturables pas encore facturées d'un projet : un brouillon au client, une
 * ligne par saisie (date et description, heures au tarif du projet), rattaché au projet.
 */
export async function invoiceProject(
  database: Db,
  who: Who,
  projectId: string,
  today: string,
): Promise<{ invoiceId: string; entries: number } | "nothing" | "project" | "contact"> {
  const found = await getProject(database, who.organizationId, projectId);
  if (!found) return "project";
  const entries = await database
    .select()
    .from(timeEntries)
    .where(
      and(
        eq(timeEntries.projectId, projectId),
        eq(timeEntries.billable, true),
        isNull(timeEntries.invoiceId),
        isNull(timeEntries.startedAt),
      ),
    )
    .orderBy(asc(timeEntries.workDate), asc(timeEntries.createdAt));
  if (entries.length === 0) return "nothing";
  const [contact] = await database
    .select({ language: contacts.language })
    .from(contacts)
    .where(eq(contacts.id, found.project.contactId));
  const [org] = await database
    .select({ vatRegistered: organizations.vatRegistered })
    .from(organizations)
    .where(eq(organizations.id, who.organizationId));
  const first = entries[0]?.workDate ?? today;
  const last = entries[entries.length - 1]?.workDate ?? today;
  const data: InvoiceInput = {
    contactId: found.project.contactId,
    language: documentLanguage(contact?.language),
    title: null,
    introText: found.project.name,
    footerText: null,
    issueDate: today,
    serviceDate: last > today ? today : last,
    dueDate: null,
    lines: entries.map((e) => ({
      productId: null,
      description: [e.workDate, e.description ?? found.project.name].join(" · ").slice(0, 500),
      quantityMilli: Math.round((e.minutes * 1000) / 60),
      unit: "hour",
      unitPriceCents: e.rateCents,
      vatCode: org?.vatRegistered ? "normal" : null,
    })),
  };
  const invoice = await createInvoice(database, who, data);
  if (invoice === "contact") return "contact";
  if (typeof invoice !== "object" || !invoice) throw new Error("project_invoice_failed");
  await database.update(invoices).set({ projectId }).where(eq(invoices.id, invoice.id));
  await database
    .update(timeEntries)
    .set({ invoiceId: invoice.id })
    .where(
      inArray(
        timeEntries.id,
        entries.map((e) => e.id),
      ),
    );
  await database.insert(auditLog).values({
    organizationId: who.organizationId,
    userId: who.userId,
    action: "project.invoice",
    entity: "project",
    entityId: projectId,
    data: { invoiceId: invoice.id, entries: entries.length, from: first, to: last },
  });
  return { invoiceId: invoice.id, entries: entries.length };
}
