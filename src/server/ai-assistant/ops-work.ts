import { z } from "zod";
import { VAT_CODES } from "@/countries/ch/vat";
import { toForm } from "../api";
import { getContact } from "../contacts";
import type { Product } from "../db/schema";
import { createClaim, MILEAGE_RATE_CENTS, parseClaimForm } from "../expenses";
import {
  createProduct,
  getProduct,
  PRODUCT_UNITS,
  parseProductForm,
  updateProduct,
} from "../products";
import {
  addEntry,
  createProject,
  getProject,
  invoiceProject,
  parseEntryForm,
  parseProjectForm,
  runningTimer,
  setProjectArchived,
  startTimer,
  stopTimer,
  updateProject,
} from "../time";
import {
  type AssistantContext,
  amountText,
  changes,
  dateField,
  defineOp,
  documentPath,
  documentSummary,
  enumField,
  fail,
  filled,
  formValue,
  moneyField,
  type OpOutcome,
  text,
  who,
} from "./ops-core";

/**
 * Opérations du catalogue, du temps et des notes de frais : articles, projets, saisies et chrono,
 * facturation du temps d'un projet, notes de frais et indemnités kilométriques. Mêmes validations
 * que les formulaires (parseProductForm, parseProjectForm, parseEntryForm, parseClaimForm).
 */

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .describe("YYYY-MM-DD");
const amount = z.union([z.string().max(20), z.number()]);
type Json = Record<string, unknown>;

// Articles

const productFields = {
  name: z.string().max(120).optional(),
  sku: z.string().max(40).optional().describe("reference / article number, unique"),
  description: z.string().max(1000).optional(),
  unit: z.enum(PRODUCT_UNITS).optional().describe("default flat"),
  unitPrice: amount.optional().describe("net unit price in units of the company currency"),
  vatCode: z.enum(VAT_CODES).optional().describe("default normal"),
};

function productForm(p: Product): Json {
  return {
    name: p.name,
    sku: p.sku ?? "",
    description: p.description ?? "",
    unit: p.unit,
    unitPrice: (p.unitPriceCents / 100).toFixed(2),
    vatCode: p.vatCode,
  };
}

function productPatch(input: Json): Json {
  const out: Json = {};
  for (const k of ["name", "sku", "description", "unit", "vatCode"])
    if (input[k] !== undefined) out[k] = formValue(input[k]);
  if (input.unitPrice !== undefined) out.unitPrice = amountText(input.unitPrice);
  return out;
}

const productView = (p: {
  name: string;
  sku: string | null;
  description: string | null;
  unit: string;
  unitPriceCents: number;
  vatCode: string;
}) => ({
  name: p.name,
  sku: p.sku ?? "",
  description: p.description ?? "",
  unit: p.unit,
  unitPriceCents: String(p.unitPriceCents),
  vatCode: p.vatCode,
});

function parseProduct(merged: Json) {
  const parsed = parseProductForm(toForm(merged));
  return parsed.ok
    ? parsed
    : { ok: false as const, error: `invalid ${JSON.stringify(parsed.errors)}` };
}

export const createProductOp = defineOp({
  id: "create_product",
  permission: "billing",
  description:
    "PROPOSE a new product or service in the catalogue (name, unit, net unit price, VAT code, optional SKU and description). Nothing is saved until the user confirms.",
  schema: z.object({
    ...productFields,
    name: z.string().min(1).max(120),
    unitPrice: amount.describe("net unit price in units of the company currency"),
  }),
  async run(ctx, input) {
    const parsed = parseProduct({ unit: "flat", vatCode: "normal", ...productPatch(input) });
    if (!parsed.ok) return fail(parsed.error);
    const created = await createProduct(ctx.database, who(ctx), parsed.data);
    if (created === "skuTaken") return fail("sku_taken");
    const currency = ctx.organization.currency;
    return {
      ok: true,
      result: {
        action: "create_product",
        id: created.id,
        entity: "product",
        path: `/app/products/${created.id}`,
        label: created.name,
      },
      summary: {
        action: "create_product",
        fields: filled([
          text("name", created.name),
          text("sku", created.sku),
          text("description", created.description),
          enumField("unit", created.unit),
          moneyField("unitPrice", created.unitPriceCents, currency),
          enumField("vatCode", ctx.organization.vatRegistered ? created.vatCode : ""),
        ]),
      },
      item: {
        action: "create_product",
        label: created.name,
        amountCents: created.unitPriceCents,
        currency,
      },
    };
  },
});

export const updateProductOp = defineOp({
  id: "update_product",
  permission: "billing",
  description:
    "PROPOSE changes to a product of the catalogue (productId from list_products): only the fields to change.",
  schema: z.object({ productId: z.string(), ...productFields }),
  refs: { productId: "product" },
  async run(ctx, input) {
    const current = await getProduct(ctx.database, ctx.organization.id, input.productId);
    if (!current || current.archivedAt) return fail("product_not_found");
    const parsed = parseProduct({ ...productForm(current), ...productPatch(input) });
    if (!parsed.ok) return fail(parsed.error);
    const currency = ctx.organization.currency;
    const fields = changes(productView(current), productView(parsed.data), [
      { key: "name" },
      { key: "sku" },
      { key: "description" },
      { key: "unit", format: "enum" },
      { key: "unitPriceCents", format: "money", currency },
      { key: "vatCode", format: "enum" },
    ]).map((f) => (f.key === "unitPriceCents" ? { ...f, key: "unitPrice" } : f));
    if (fields.length === 0) return fail("no_change");
    const updated = await updateProduct(ctx.database, who(ctx), current.id, parsed.data);
    if (updated === "skuTaken") return fail("sku_taken");
    if (!updated) return fail("product_not_found");
    return {
      ok: true,
      result: {
        action: "update_product",
        id: updated.id,
        entity: "product",
        path: `/app/products/${updated.id}`,
        label: updated.name,
      },
      summary: {
        action: "update_product",
        fields: fields.some((f) => f.key === "name")
          ? fields
          : [text("product", updated.name), ...fields],
      },
      item: { action: "update_product", label: updated.name },
    };
  },
});

// Projets et temps

const hours = z.union([z.string().max(12), z.number()]);

const projectFields = {
  contactId: z.string().optional().describe("customer of the project (search_contacts) or @key"),
  name: z.string().max(120).optional(),
  hourlyRate: amount
    .optional()
    .describe("hourly rate in units of the company currency; 0 or empty = none"),
  budgetHours: hours.optional().describe("budget in hours, optional"),
};

type ProjectRow = NonNullable<Awaited<ReturnType<typeof getProject>>>;

function projectForm(p: ProjectRow["project"]): Json {
  return {
    contactId: p.contactId,
    name: p.name,
    hourlyRate: (p.hourlyRateCents / 100).toFixed(2),
    budgetHours: p.budgetMinutes === null ? "" : String(p.budgetMinutes / 60),
  };
}

function projectPatch(input: Json): Json {
  const out: Json = {};
  for (const k of ["contactId", "name"]) if (input[k] !== undefined) out[k] = formValue(input[k]);
  if (input.hourlyRate !== undefined) out.hourlyRate = amountText(input.hourlyRate);
  if (input.budgetHours !== undefined) out.budgetHours = amountText(input.budgetHours);
  return out;
}

function parseProject(merged: Json) {
  const parsed = parseProjectForm(toForm(merged));
  return parsed.ok
    ? parsed
    : { ok: false as const, error: `invalid ${JSON.stringify(parsed.errors)}` };
}

async function customerName(ctx: AssistantContext, id: string) {
  return (await getContact(ctx.database, ctx.organization.id, id))?.name ?? "";
}

export const createProjectOp = defineOp({
  id: "create_project",
  permission: "billing",
  description:
    "PROPOSE a new time-tracking project for a customer (contactId), with an optional hourly rate and budget in hours.",
  schema: z.object({
    ...projectFields,
    contactId: z.string().describe("customer of the project (search_contacts) or @key"),
    name: z.string().min(1).max(120),
  }),
  refs: { contactId: "contact" },
  async run(ctx, input) {
    const parsed = parseProject(projectPatch(input));
    if (!parsed.ok) return fail(parsed.error);
    const created = await createProject(ctx.database, who(ctx), parsed.data);
    if (created === "contact") return fail("contact_not_found");
    const customer = await customerName(ctx, created.contactId);
    const currency = ctx.organization.currency;
    return {
      ok: true,
      result: {
        action: "create_project",
        id: created.id,
        entity: "project",
        path: `/app/time/projects/${created.id}`,
        label: created.name,
      },
      summary: {
        action: "create_project",
        fields: filled([
          text("name", created.name),
          text("customer", customer),
          created.hourlyRateCents > 0
            ? moneyField("hourlyRate", created.hourlyRateCents, currency)
            : null,
          created.budgetMinutes !== null
            ? { key: "budget", value: String(created.budgetMinutes), format: "minutes" as const }
            : null,
        ]),
      },
      item: { action: "create_project", label: `${created.name} · ${customer}` },
    };
  },
});

export const updateProjectOp = defineOp({
  id: "update_project",
  permission: "billing",
  description:
    "PROPOSE changes to a time-tracking project (projectId from list_projects): name, customer, hourly rate, budget; reactivate=true brings an archived project back. Archiving is not possible from the assistant.",
  schema: z.object({ projectId: z.string(), ...projectFields, reactivate: z.boolean().optional() }),
  refs: { projectId: "project", contactId: "contact" },
  async run(ctx, input) {
    const current = await getProject(ctx.database, ctx.organization.id, input.projectId);
    if (!current) return fail("project_not_found");
    const p = current.project;
    const reactivate = input.reactivate === true && !!p.archivedAt;
    if (input.reactivate === true && !p.archivedAt) return fail("project_not_archived");
    const parsed = parseProject({ ...projectForm(p), ...projectPatch(input) });
    if (!parsed.ok) return fail(parsed.error);
    const currency = ctx.organization.currency;
    const before = {
      name: p.name,
      customer: current.customer,
      hourlyRate: String(p.hourlyRateCents),
      budget: p.budgetMinutes === null ? "" : String(p.budgetMinutes),
      projectStatus: p.archivedAt ? "archived" : "active",
    };
    const after = {
      name: parsed.data.name,
      customer: await customerName(ctx, parsed.data.contactId),
      hourlyRate: String(parsed.data.hourlyRateCents),
      budget: parsed.data.budgetMinutes === null ? "" : String(parsed.data.budgetMinutes),
      projectStatus: reactivate ? "active" : before.projectStatus,
    };
    const fields = changes(before, after, [
      { key: "name" },
      { key: "customer" },
      { key: "hourlyRate", format: "money", currency },
      { key: "budget", format: "minutes" },
      { key: "projectStatus", format: "enum" },
    ]);
    if (fields.length === 0) return fail("no_change");
    const updated = await updateProject(ctx.database, who(ctx), p.id, parsed.data);
    if (updated === "contact") return fail("contact_not_found");
    if (!updated) return fail("project_not_found");
    if (reactivate) await setProjectArchived(ctx.database, who(ctx), p.id, false);
    return {
      ok: true,
      result: {
        action: "update_project",
        id: p.id,
        entity: "project",
        path: `/app/time/projects/${p.id}`,
        label: updated.name,
      },
      summary: {
        action: "update_project",
        fields: fields.some((f) => f.key === "name")
          ? fields
          : [text("project", updated.name), ...fields],
      },
      item: { action: "update_project", label: updated.name },
    };
  },
});

export const timeEntryOp = defineOp({
  id: "create_time_entry",
  permission: "billing",
  description:
    'PROPOSE a time entry on an active project (projectId from list_projects, or @key): date, duration ("1:30", "1.5" hours or "90m"), description, billable (default true). The project\'s hourly rate applies.',
  schema: z.object({
    projectId: z.string(),
    workDate: isoDate.optional().describe("default today"),
    duration: hours.describe('"1:30", "1.5" (hours) or "90m"'),
    description: z.string().max(300).optional(),
    billable: z.boolean().optional().describe("default true"),
  }),
  refs: { projectId: "project" },
  async run(ctx, input) {
    const parsed = parseEntryForm(
      toForm(
        {
          projectId: input.projectId,
          workDate: input.workDate ?? ctx.today,
          duration: amountText(input.duration),
          description: input.description ?? "",
          billable: input.billable !== false,
        },
        ["billable"],
      ),
    );
    if (!parsed.ok) return fail(`invalid ${JSON.stringify(parsed.errors)}`);
    const added = await addEntry(ctx.database, who(ctx), parsed.data);
    if (added === "project") return fail("project_not_found");
    if (!added) return fail("not_saved");
    const project = await getProject(ctx.database, ctx.organization.id, added.projectId);
    const name = project?.project.name ?? "";
    return {
      ok: true,
      result: {
        action: "create_time_entry",
        id: added.id,
        entity: "time_entry",
        path: `/app/time/projects/${added.projectId}`,
        label: name,
      },
      summary: {
        action: "create_time_entry",
        fields: filled([
          text("project", name),
          dateField("workDate", added.workDate),
          { key: "duration", value: String(added.minutes), format: "minutes" },
          text("description", added.description),
          { key: "billable", value: String(added.billable), format: "bool" },
        ]),
      },
      item: { action: "create_time_entry", label: `${name} · ${added.workDate}` },
    };
  },
});

export const startTimerOp = defineOp({
  id: "start_timer",
  permission: "billing",
  description:
    "PROPOSE to start the user's timer on an active project (projectId), with an optional description. A timer already running is stopped first and saved, as on the time screen.",
  schema: z.object({ projectId: z.string(), description: z.string().max(300).optional() }),
  refs: { projectId: "project" },
  async run(ctx, input) {
    const running = await runningTimer(ctx.database, who(ctx));
    const started = await startTimer(
      ctx.database,
      who(ctx),
      input.projectId,
      input.description?.trim() || null,
    );
    if (started === "project") return fail("project_not_found");
    if (!started) return fail("not_saved");
    const project = await getProject(ctx.database, ctx.organization.id, started.projectId);
    const name = project?.project.name ?? "";
    return {
      ok: true,
      result: {
        action: "start_timer",
        id: started.id,
        entity: "time_entry",
        path: "/app/time",
        label: name,
      },
      summary: {
        action: "start_timer",
        fields: filled([text("project", name), text("description", started.description)]),
        ...(running ? { notes: ["timerStopsRunning"] } : {}),
      },
      item: { action: "start_timer", label: name },
    };
  },
});

export const stopTimerOp = defineOp({
  id: "stop_timer",
  permission: "billing",
  description:
    "PROPOSE to stop the user's running timer: the elapsed time (at least one minute) becomes a time entry.",
  schema: z.object({}),
  async run(ctx) {
    const running = await runningTimer(ctx.database, who(ctx));
    if (!running) return fail("no_running_timer");
    const stopped = await stopTimer(ctx.database, who(ctx));
    if (!stopped) return fail("no_running_timer");
    return {
      ok: true,
      result: {
        action: "stop_timer",
        id: stopped.id,
        entity: "time_entry",
        path: "/app/time",
        label: running.project,
      },
      summary: {
        action: "stop_timer",
        fields: filled([
          text("project", running.project),
          { key: "duration", value: String(stopped.minutes), format: "minutes" },
          text("description", stopped.description),
        ]),
      },
      item: { action: "stop_timer", label: running.project },
    };
  },
});

export const invoiceProjectOp = defineOp({
  id: "invoice_project_time",
  permission: "billing",
  description:
    "PROPOSE a DRAFT invoice for the billable time of a project not invoiced yet (projectId): one line per entry at the project's rate; the entries are marked invoiced. Not issued, not sent.",
  schema: z.object({ projectId: z.string() }),
  refs: { projectId: "project" },
  async run(ctx, input) {
    const done = await invoiceProject(ctx.database, who(ctx), input.projectId, ctx.today);
    if (done === "nothing") return fail("nothing_to_invoice");
    if (done === "project") return fail("project_not_found");
    if (done === "contact") return fail("contact_not_found");
    const described = await documentSummary(ctx, "invoice_project_time", done.invoiceId, [
      text("entries", done.entries),
    ]);
    if (!described) return fail("document_not_found");
    return {
      ok: true,
      result: {
        action: "invoice_project_time",
        id: done.invoiceId,
        entity: "document",
        path: documentPath("invoice", done.invoiceId),
        label: described.label,
      },
      summary: described.summary,
      item: described.item,
    };
  },
});

// Notes de frais

export const expenseClaimOp = defineOp({
  id: "create_expense_claim",
  permission: "member",
  description:
    "PROPOSE an expense claim of the user: kind=expense (amount paid personally, VAT included, optional VAT code and expense account) or kind=mileage (kilometres × rate per km; default rate of the company's country). It is then approved by the accounting like on the expenses screen. A receipt photo can only be added on the screen.",
  schema: z.object({
    kind: z.enum(["expense", "mileage"]).optional().describe("default expense"),
    date: isoDate.optional().describe("default today"),
    description: z.string().min(1).max(200),
    claimantName: z.string().max(140).optional().describe("default: the user's name"),
    iban: z.string().max(40).optional().describe("IBAN for the refund, optional"),
    amount: amount.optional().describe("expense: amount paid, VAT included, in company currency"),
    vatCode: z.enum(VAT_CODES).optional(),
    accountId: z.string().optional().describe("expense account id from list_accounts, optional"),
    km: amount.optional().describe("mileage: distance"),
    ratePerKm: amount.optional().describe("mileage: rate per km in units; default of the country"),
  }),
  refs: { accountId: "account" },
  async run(ctx, input): Promise<OpOutcome> {
    const kind = input.kind ?? "expense";
    const rate =
      input.ratePerKm !== undefined
        ? amountText(input.ratePerKm)
        : ((MILEAGE_RATE_CENTS[ctx.organization.country] ?? 70) / 100).toFixed(2);
    const parsed = parseClaimForm(
      toForm({
        kind,
        date: input.date ?? ctx.today,
        description: input.description,
        claimantName: input.claimantName?.trim() || ctx.userName,
        iban: input.iban ?? "",
        amount: kind === "expense" ? amountText(input.amount) : "",
        vatCode: input.vatCode ?? "",
        accountId: input.accountId ?? "",
        km: kind === "mileage" ? amountText(input.km) : "",
        rate: kind === "mileage" ? rate : "",
      }),
    );
    if (!parsed.ok) return fail(`invalid ${JSON.stringify(parsed.errors)}`);
    const claim = await createClaim(ctx.database, who(ctx), parsed.data, null);
    const currency = claim.currency;
    return {
      ok: true,
      result: {
        action: "create_expense_claim",
        id: claim.id,
        entity: "bill",
        path: "/app/expenses",
        label: claim.description ?? parsed.data.description,
      },
      summary: {
        action: "create_expense_claim",
        fields: filled([
          enumField("claimKind", parsed.data.kind),
          dateField("date", parsed.data.date),
          text("description", claim.description),
          text("claimant", parsed.data.claimantName),
          moneyField("amount", claim.totalCents, currency),
          enumField("vatCode", claim.vatCode),
          text("iban", parsed.data.iban),
        ]),
      },
      item: {
        action: "create_expense_claim",
        label: claim.description ?? parsed.data.description,
        amountCents: claim.totalCents,
        currency,
      },
    };
  },
});
