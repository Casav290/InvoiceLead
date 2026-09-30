import { NextResponse } from "next/server";
import { apiError, invoiceJson, jsonBody, toForm, withApi } from "@/server/api";
import { db } from "@/server/db";
import {
  createInvoice,
  DOCUMENT_KINDS,
  type DocumentKind,
  getInvoice,
  isVatRegistered,
  listInvoices,
  parseInvoiceForm,
} from "@/server/invoices";

export const dynamic = "force-dynamic";

const kindOf = (v: unknown): DocumentKind | null =>
  v === undefined || v === null || v === ""
    ? "invoice"
    : (DOCUMENT_KINDS as readonly string[]).includes(String(v)) && v !== "credit_note"
      ? (v as DocumentKind)
      : null;

/** Factures (ou devis avec `?kind=quote`, avoirs avec `?kind=credit_note`), les plus récentes d'abord. */
export async function GET(request: Request) {
  return withApi(request, async ({ organization }) => {
    const k = new URL(request.url).searchParams.get("kind") ?? "invoice";
    if (!(DOCUMENT_KINDS as readonly string[]).includes(k)) return apiError(400, "kind");
    const rows = await listInvoices(db(), organization.id, k as DocumentKind);
    return NextResponse.json({
      data: rows.map((r) => ({
        id: r.id,
        number: r.number,
        status: r.status,
        issueDate: r.issueDate,
        dueDate: r.dueDate,
        currency: r.currency,
        totalCents: r.totalCents,
        customer: r.contactName,
        openCents: r.totalCents - r.paidCents - r.creditedCents + r.chargesCents,
      })),
    });
  });
}

/**
 * Brouillon de facture ou de devis (`kind: "quote"`). Montants en unités (« 150.00 »), comme dans le
 * formulaire ; la TVA est calculée ici, au taux en vigueur à la date de prestation.
 */
export async function POST(request: Request) {
  return withApi(request, async ({ organization, userId }) => {
    const body = await jsonBody(request);
    if (!body) return apiError(400, "json");
    const kind = kindOf(body.kind);
    if (!kind) return apiError(422, "invalid", { kind: "required" });
    const { kind: _kind, ...rest } = body;
    const today = new Date().toISOString().slice(0, 10);
    const form = toForm({ issueDate: today, language: organization.defaultLocale, ...rest });
    const parsed = parseInvoiceForm(form, {
      vatRegistered: await isVatRegistered(db(), organization.id),
      country: organization.country,
    });
    if (!parsed.ok) return apiError(422, "invalid", parsed.errors);
    const who = { organizationId: organization.id, userId };
    const result = await createInvoice(db(), who, parsed.data, kind);
    if (result === "contact") return apiError(422, "invalid", { contactId: "required" });
    if (typeof result !== "object" || !result) return apiError(500, "server");
    const found = await getInvoice(db(), organization.id, result.id);
    return NextResponse.json({ data: invoiceJson(result, found?.lines) }, { status: 201 });
  });
}
