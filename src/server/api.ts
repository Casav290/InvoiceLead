import { NextResponse } from "next/server";
import { type ApiCaller, type ApiEndpoint, apiCaller } from "./api-keys";
import { db } from "./db";
import type { Contact, Invoice, InvoiceLine } from "./db/schema";
import { postPending } from "./ledger";
import type { Balance } from "./payments";
import { flushWebhooks } from "./webhooks";

/** Réponse d'erreur de l'API : `{ "error": code, "fields"?: { champ: code } }`. */
export function apiError(status: number, error: string, fields?: Record<string, string>) {
  return NextResponse.json(fields ? { error, fields } : { error }, { status });
}

/**
 * Exécute une requête d'API authentifiée par clé, pour ce point d'accès : une clé dont la portée ne
 * l'ouvre pas (clé ProjectLead hors contacts et brouillons de factures) reçoit 403 avant toute
 * lecture. Après l'action : comptabilisation de ce qui peut l'être, puis envoi des webhooks de
 * l'entreprise.
 */
export async function withApi(
  request: Request,
  endpoint: ApiEndpoint,
  handler: (caller: ApiCaller) => Promise<Response>,
): Promise<Response> {
  const caller = await apiCaller(db(), request.headers.get("authorization"), endpoint);
  if (caller === "unauthorized") return apiError(401, "unauthorized");
  if (caller === "forbidden") return apiError(403, "forbidden");
  const response = await handler(caller);
  if (request.method !== "GET" && response.ok) {
    const who = { organizationId: caller.organization.id, userId: caller.userId };
    try {
      await postPending(db(), who);
    } catch (e) {
      console.error("[api] comptabilisation reportée", e instanceof Error ? e.message : "inconnu");
    }
    await flushWebhooks(db(), caller.organization.id);
  }
  return response;
}

/** Corps JSON (objet) de la requête, ou null. */
export async function jsonBody(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = (await request.json()) as unknown;
    return body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

const scalar = (v: unknown) =>
  typeof v === "string" || typeof v === "number" || typeof v === "boolean" ? String(v) : "";

/**
 * Convertit un corps JSON en FormData pour réutiliser la validation des formulaires : mêmes règles,
 * mêmes codes d'erreur. Les lignes (`lines: [{ description, … }]`) deviennent « line.description ».
 */
export function toForm(body: Record<string, unknown>, booleans: string[] = []): FormData {
  const form = new FormData();
  for (const [key, value] of Object.entries(body)) {
    if (key === "lines" && Array.isArray(value)) {
      for (const line of value) {
        const l = (line && typeof line === "object" ? line : {}) as Record<string, unknown>;
        for (const f of ["description", "quantity", "unit", "unitPrice", "vatCode", "productId"])
          form.append(`line.${f}`, scalar(l[f] ?? (f === "quantity" ? "1" : "")));
      }
    } else if (booleans.includes(key)) {
      if (value === true) form.append(key, "on");
    } else form.append(key, scalar(value));
  }
  return form;
}

export const contactJson = (c: Contact) => ({
  id: c.id,
  kind: c.kind,
  name: c.name,
  contactPerson: c.contactPerson,
  email: c.email,
  phone: c.phone,
  street: c.street,
  buildingNumber: c.buildingNumber,
  postalCode: c.postalCode,
  town: c.town,
  region: c.region,
  country: c.country,
  language: c.language,
  uid: c.uid,
  paymentTermDays: c.paymentTermDays,
  isCustomer: c.isCustomer,
  isSupplier: c.isSupplier,
});

export const invoiceJson = (i: Invoice, lines?: InvoiceLine[], balance?: Balance | null) => ({
  id: i.id,
  kind: i.kind,
  number: i.number,
  status: i.status,
  contactId: i.contactId,
  language: i.language,
  currency: i.currency,
  fxRate: i.fxRate,
  title: i.title,
  issueDate: i.issueDate,
  serviceDate: i.serviceDate,
  dueDate: i.dueDate,
  netCents: i.netCents,
  vatCents: i.vatCents,
  totalCents: i.totalCents,
  paymentReference: i.paymentReference,
  relatedInvoiceId: i.relatedInvoiceId,
  ...(balance
    ? {
        balance: {
          creditedCents: balance.creditedCents,
          paidCents: balance.paidCents,
          chargesCents: balance.chargesCents ?? 0,
          openCents: balance.openCents,
        },
      }
    : {}),
  ...(lines
    ? {
        lines: lines.map((l) => ({
          position: l.position,
          productId: l.productId,
          description: l.description,
          quantityMilli: l.quantityMilli,
          unit: l.unit,
          unitPriceCents: l.unitPriceCents,
          vatCode: l.vatCode,
          vatRateBp: l.vatRateBp,
          netCents: l.netCents,
        })),
      }
    : {}),
});
