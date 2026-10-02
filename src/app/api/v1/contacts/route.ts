import { NextResponse } from "next/server";
import { apiError, contactJson, jsonBody, toForm, withApi } from "@/server/api";
import { createContactWithinPlan, listContacts, parseContactForm } from "@/server/contacts";
import { db } from "@/server/db";

export const dynamic = "force-dynamic";

/** Contacts de l'entreprise (recherche par `?q=`). */
export async function GET(request: Request) {
  return withApi(request, async ({ organization }) => {
    const q = new URL(request.url).searchParams.get("q") ?? "";
    const rows = await listContacts(db(), organization.id, q.slice(0, 100));
    return NextResponse.json({ data: rows.map(contactJson) });
  });
}

/** Nouveau contact, client par défaut ; mêmes champs et contrôles que le formulaire. */
export async function POST(request: Request) {
  return withApi(request, async ({ organization, userId }) => {
    const body = await jsonBody(request);
    if (!body) return apiError(400, "json");
    const form = toForm({ kind: "company", isCustomer: true, ...body }, [
      "isCustomer",
      "isSupplier",
    ]);
    const parsed = parseContactForm(form);
    if (!parsed.ok) return apiError(422, "invalid", parsed.errors);
    const contact = await createContactWithinPlan(
      db(),
      { organizationId: organization.id, userId },
      parsed.data,
    );
    if (contact === "planLimit") return apiError(403, "plan_limit");
    return NextResponse.json({ data: contactJson(contact) }, { status: 201 });
  });
}
