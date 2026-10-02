import { NextResponse } from "next/server";
import { apiError, jsonBody, toForm, withApi } from "@/server/api";
import { db } from "@/server/db";
import { addPayment, parsePaymentForm } from "@/server/payments";

export const dynamic = "force-dynamic";

/** Paiement reçu sur une facture émise (`amount` en unités, `paidOn`, `method`, `note`, `fxRate`). */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withApi(request, "invoices.pay", async ({ organization, userId }) => {
    const body = await jsonBody(request);
    if (!body) return apiError(400, "json");
    const parsed = parsePaymentForm(
      toForm({ paidOn: new Date().toISOString().slice(0, 10), method: "bank", ...body }),
    );
    if (!parsed.ok) return apiError(422, "invalid", parsed.errors);
    const result = await addPayment(
      db(),
      { organizationId: organization.id, userId },
      (await params).id,
      parsed.data,
    );
    if (result === "notFound") return apiError(404, "not_found");
    if (result === "tooHigh") return apiError(409, "too_high");
    return NextResponse.json(
      {
        data: {
          id: result.id,
          invoiceId: result.invoiceId,
          paidOn: result.paidOn,
          amountCents: result.amountCents,
          method: result.method,
          fxRate: result.fxRate,
        },
      },
      { status: 201 },
    );
  });
}
