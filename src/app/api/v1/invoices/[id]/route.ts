import { NextResponse } from "next/server";
import { apiError, invoiceJson, withApi } from "@/server/api";
import { db } from "@/server/db";
import { getInvoice } from "@/server/invoices";
import { invoiceBalance } from "@/server/payments";

export const dynamic = "force-dynamic";

/** Une pièce avec ses lignes et, pour une facture émise, son solde. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withApi(request, "invoices.get", async ({ organization }) => {
    const found = await getInvoice(db(), organization.id, (await params).id);
    if (!found) return apiError(404, "not_found");
    const { invoice, lines } = found;
    const balance =
      invoice.kind === "invoice" && invoice.status === "issued"
        ? await invoiceBalance(db(), invoice.id, invoice.totalCents)
        : null;
    return NextResponse.json({ data: invoiceJson(invoice, lines, balance) });
  });
}
