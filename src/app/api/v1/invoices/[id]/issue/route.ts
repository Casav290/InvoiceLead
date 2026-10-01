import { NextResponse } from "next/server";
import { apiError, invoiceJson, withApi } from "@/server/api";
import { db } from "@/server/db";
import { issueInvoice } from "@/server/invoices";
import { quotaAccess } from "@/server/plans";

export const dynamic = "force-dynamic";

/** Émet un brouillon : numéro définitif, pièce figée, écritures et événement « invoice.issued ». */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withApi(request, async ({ organization, userId }) => {
    if (!(await quotaAccess(db(), organization, "invoices")).allowed)
      return apiError(403, "plan_limit");
    const result = await issueInvoice(
      db(),
      { organizationId: organization.id, userId },
      (await params).id,
    );
    if (result === "notFound") return apiError(404, "not_found");
    if (typeof result === "string") return apiError(409, result);
    return NextResponse.json({ data: invoiceJson(result) });
  });
}
