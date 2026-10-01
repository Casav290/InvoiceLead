import { contactJson, invoiceJson, toForm } from "./api";
import type { ApiCaller } from "./api-keys";
import { bookFacts } from "./assistant";
import { listBills } from "./bills";
import { createContact, listContacts, parseContactForm } from "./contacts";
import { db } from "./db";
import {
  createInvoice,
  DOCUMENT_KINDS,
  type DocumentKind,
  getInvoice,
  issueInvoice,
  isVatRegistered,
  listInvoices,
  parseInvoiceForm,
} from "./invoices";
import { addPayment, invoiceBalance, parsePaymentForm } from "./payments";
import { quotaAccess } from "./plans";
import { addEntry, listProjects, parseEntryForm } from "./time";

/**
 * Serveur MCP (Model Context Protocol, transport HTTP « streamable » en réponses JSON) : un
 * assistant comme Claude ou ChatGPT lit et prépare la comptabilité avec une clé d'API Pro+, avec les
 * mêmes règles que l'application. Émettre une facture reste une action explicite de l'outil.
 */
export const MCP_PROTOCOL = "2025-06-18";

type Json = Record<string, unknown>;
type Tool = {
  name: string;
  description: string;
  inputSchema: Json;
  write?: boolean;
  run: (caller: ApiCaller, args: Json) => Promise<unknown>;
};

const str = (v: unknown) => (typeof v === "string" ? v : "");
const today = () => new Date().toISOString().slice(0, 10);
const who = (c: ApiCaller) => ({ organizationId: c.organization.id, userId: c.userId });

class ToolError extends Error {}

const TOOLS: Tool[] = [
  {
    name: "get_books_summary",
    description:
      "Snapshot of the company's books: profit and loss for the current financial year, bank and cash, open and overdue customer invoices, revenue by month, top customers, supplier bills to pay, unbilled time and work waiting for review. Amounts in the company's currency.",
    inputSchema: { type: "object", properties: {} },
    run: (c) => bookFacts(db(), c.organization.id, today()),
  },
  {
    name: "list_invoices",
    description: "List invoices (or quotes, or credit notes) with their open amount, newest first.",
    inputSchema: {
      type: "object",
      properties: { kind: { type: "string", enum: ["invoice", "quote", "credit_note"] } },
    },
    run: async (c, a) => {
      const kind = (DOCUMENT_KINDS as readonly string[]).includes(str(a.kind))
        ? (str(a.kind) as DocumentKind)
        : "invoice";
      const rows = await listInvoices(db(), c.organization.id, kind);
      return rows.slice(0, 100).map((r) => ({
        id: r.id,
        number: r.number,
        status: r.status,
        customer: r.contactName,
        issueDate: r.issueDate,
        dueDate: r.dueDate,
        currency: r.currency,
        totalCents: r.totalCents,
        openCents: r.totalCents - r.paidCents - r.creditedCents + r.chargesCents,
      }));
    },
  },
  {
    name: "get_invoice",
    description: "One invoice, quote or credit note with its lines and, once issued, its balance.",
    inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
    run: async (c, a) => {
      const found = await getInvoice(db(), c.organization.id, str(a.id));
      if (!found) throw new ToolError("not_found");
      const balance =
        found.invoice.kind === "invoice" && found.invoice.status === "issued"
          ? await invoiceBalance(db(), found.invoice.id, found.invoice.totalCents)
          : null;
      return invoiceJson(found.invoice, found.lines, balance);
    },
  },
  {
    name: "list_contacts",
    description: "Customers and suppliers, optionally filtered by a search text.",
    inputSchema: { type: "object", properties: { query: { type: "string" } } },
    run: async (c, a) =>
      (await listContacts(db(), c.organization.id, str(a.query).slice(0, 100)))
        .slice(0, 100)
        .map(contactJson),
  },
  {
    name: "create_contact",
    description:
      "Create a customer. Fields: name (required), kind (company|person), email, street, buildingNumber, postalCode, town, country (ISO code), language (de|fr|en), uid, paymentTermDays.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        kind: { type: "string", enum: ["company", "person"] },
        email: { type: "string" },
        street: { type: "string" },
        postalCode: { type: "string" },
        town: { type: "string" },
        country: { type: "string" },
        language: { type: "string", enum: ["de", "fr", "en"] },
      },
      required: ["name"],
    },
    write: true,
    run: async (c, a) => {
      const parsed = parseContactForm(
        toForm({ kind: "company", isCustomer: true, ...a }, ["isCustomer", "isSupplier"]),
      );
      if (!parsed.ok) throw new ToolError(`invalid: ${JSON.stringify(parsed.errors)}`);
      if (!(await quotaAccess(db(), c.organization, "contacts")).allowed)
        throw new ToolError("plan_limit");
      return contactJson(await createContact(db(), who(c), parsed.data));
    },
  },
  {
    name: "create_invoice_draft",
    description:
      'Create a DRAFT invoice (or quote with kind=quote). Amounts in units as strings ("150.00"). VAT is computed by InvoiceLead. Lines: description, quantity, unit (hour|day|piece|flat|km|month), unitPrice, vatCode (normal|reduced|lodging|exempt|export). The draft is not sent nor issued.',
    inputSchema: {
      type: "object",
      properties: {
        contactId: { type: "string" },
        kind: { type: "string", enum: ["invoice", "quote"] },
        language: { type: "string", enum: ["de", "fr", "en"] },
        issueDate: { type: "string" },
        currency: { type: "string" },
        lines: {
          type: "array",
          items: {
            type: "object",
            properties: {
              description: { type: "string" },
              quantity: { type: "string" },
              unit: { type: "string" },
              unitPrice: { type: "string" },
              vatCode: { type: "string" },
            },
            required: ["description", "unitPrice"],
          },
        },
      },
      required: ["contactId", "lines"],
    },
    write: true,
    run: async (c, a) => {
      const kind: DocumentKind = a.kind === "quote" ? "quote" : "invoice";
      const { kind: _k, ...rest } = a;
      const parsed = parseInvoiceForm(
        toForm({ issueDate: today(), language: c.organization.defaultLocale, ...rest }),
        {
          vatRegistered: await isVatRegistered(db(), c.organization.id),
          country: c.organization.country,
        },
      );
      if (!parsed.ok) throw new ToolError(`invalid: ${JSON.stringify(parsed.errors)}`);
      const result = await createInvoice(db(), who(c), parsed.data, kind);
      if (typeof result !== "object" || !result) throw new ToolError("invalid: contactId");
      const found = await getInvoice(db(), c.organization.id, result.id);
      return invoiceJson(result, found?.lines);
    },
  },
  {
    name: "issue_invoice",
    description:
      "Issue a draft: final number, frozen document, accounting entries. Only call this when the user explicitly asked to issue the invoice.",
    inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
    write: true,
    run: async (c, a) => {
      if (!(await quotaAccess(db(), c.organization, "invoices")).allowed)
        throw new ToolError("plan_limit");
      const result = await issueInvoice(db(), who(c), str(a.id));
      if (typeof result === "string") throw new ToolError(result);
      return invoiceJson(result);
    },
  },
  {
    name: "record_payment",
    description:
      'Record a payment received on an issued invoice: amount in units ("216.20"), paidOn (YYYY-MM-DD, default today), method (bank|cash|other).',
    inputSchema: {
      type: "object",
      properties: {
        invoiceId: { type: "string" },
        amount: { type: "string" },
        paidOn: { type: "string" },
        method: { type: "string", enum: ["bank", "cash", "other"] },
      },
      required: ["invoiceId", "amount"],
    },
    write: true,
    run: async (c, a) => {
      const parsed = parsePaymentForm(toForm({ paidOn: today(), method: "bank", ...a }));
      if (!parsed.ok) throw new ToolError(`invalid: ${JSON.stringify(parsed.errors)}`);
      const result = await addPayment(db(), who(c), str(a.invoiceId), parsed.data);
      if (typeof result === "string") throw new ToolError(result);
      return {
        id: result.id,
        invoiceId: result.invoiceId,
        amountCents: result.amountCents,
        paidOn: result.paidOn,
      };
    },
  },
  {
    name: "list_supplier_bills",
    description:
      "Supplier bills with their status (draft, approved, scheduled, paid) and due date.",
    inputSchema: { type: "object", properties: {} },
    run: async (c) =>
      (await listBills(db(), c.organization.id)).slice(0, 100).map((b) => ({
        id: b.id,
        supplier: b.supplierName,
        number: b.number,
        status: b.status,
        dueDate: b.dueDate,
        currency: b.currency,
        totalCents: b.totalCents,
      })),
  },
  {
    name: "list_projects",
    description: "Projects with logged, unbilled and invoiced figures.",
    inputSchema: { type: "object", properties: {} },
    run: async (c) =>
      (await listProjects(db(), c.organization.id)).map((p) => ({
        id: p.project.id,
        name: p.project.name,
        customer: p.customer,
        minutes: p.minutes,
        unbilledMinutes: p.unbilledMinutes,
        unbilledCents: p.unbilledCents,
        invoicedNetCents: p.invoicedNetCents,
      })),
  },
  {
    name: "log_time",
    description:
      'Log time on a project: projectId, workDate (YYYY-MM-DD, default today), duration ("1:30", "1.5" or "45m"), description, billable (default true).',
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        workDate: { type: "string" },
        duration: { type: "string" },
        description: { type: "string" },
        billable: { type: "boolean" },
      },
      required: ["projectId", "duration"],
    },
    write: true,
    run: async (c, a) => {
      const parsed = parseEntryForm(
        toForm({ workDate: today(), ...a, billable: a.billable !== false }, ["billable"]),
      );
      if (!parsed.ok) throw new ToolError(`invalid: ${JSON.stringify(parsed.errors)}`);
      const result = await addEntry(db(), who(c), parsed.data);
      if (!result || result === "project") throw new ToolError("project");
      return { id: result.id, minutes: result.minutes, workDate: result.workDate };
    },
  },
];

type RpcRequest = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Json };
export type McpReply = { status: number; body: unknown | null; wrote: boolean };

const reply = (id: RpcRequest["id"], result: unknown): McpReply => ({
  status: 200,
  body: { jsonrpc: "2.0", id: id ?? null, result },
  wrote: false,
});
const fail = (id: RpcRequest["id"], code: number, message: string): McpReply => ({
  status: 200,
  body: { jsonrpc: "2.0", id: id ?? null, error: { code, message } },
  wrote: false,
});

/** Traite un message JSON-RPC du client MCP. */
export async function handleMcp(caller: ApiCaller, message: unknown): Promise<McpReply> {
  if (!message || typeof message !== "object" || Array.isArray(message))
    return {
      status: 400,
      body: { jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } },
      wrote: false,
    };
  const req = message as RpcRequest;
  // Notifications (sans id) : accusées, sans réponse.
  if (req.id === undefined) return { status: 202, body: null, wrote: false };
  switch (req.method) {
    case "initialize":
      return reply(req.id, {
        protocolVersion:
          typeof req.params?.protocolVersion === "string"
            ? req.params.protocolVersion
            : MCP_PROTOCOL,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "invoicelead", title: "InvoiceLead", version: "1.0.0" },
        instructions:
          "InvoiceLead keeps the invoicing and books of one company. Amounts returned in cents unless stated. Create drafts freely; issue invoices or record payments only when the user asked for it.",
      });
    case "ping":
      return reply(req.id, {});
    case "tools/list":
      return reply(req.id, {
        tools: TOOLS.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
          annotations: { readOnlyHint: !t.write },
        })),
      });
    case "tools/call": {
      const name = str(req.params?.name);
      const tool = TOOLS.find((t) => t.name === name);
      if (!tool) return fail(req.id, -32602, `unknown tool: ${name}`);
      const args = (
        req.params?.arguments && typeof req.params.arguments === "object"
          ? req.params.arguments
          : {}
      ) as Json;
      try {
        const data = await tool.run(caller, args);
        return {
          ...reply(req.id, {
            content: [{ type: "text", text: JSON.stringify(data) }],
            structuredContent: Array.isArray(data) ? { items: data } : data,
            isError: false,
          }),
          wrote: !!tool.write,
        };
      } catch (e) {
        if (!(e instanceof ToolError)) throw e;
        return reply(req.id, { content: [{ type: "text", text: e.message }], isError: true });
      }
    }
    default:
      return fail(req.id, -32601, `method not found: ${req.method ?? ""}`);
  }
}
