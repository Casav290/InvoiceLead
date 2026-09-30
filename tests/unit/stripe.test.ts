import { createHmac } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFirstFiscalYear, installChart } from "@/server/accounting";
import { attachLeadIdentity } from "@/server/auth/attach";
import { createContact, parseContactForm } from "@/server/contacts";
import { accounts, invoicePayments, journalLines, organizations } from "@/server/db/schema";
import { createInvoice, issueInvoice, parseInvoiceForm } from "@/server/invoices";
import { postPending } from "@/server/ledger";
import { invoiceBalance } from "@/server/payments";
import { createCheckout, handleStripeEvent, verifyStripeSignature } from "@/server/stripe";
import { claims } from "../support/claims";
import { testDb } from "../support/db";
import { setTestEnv } from "../support/env";

const t = testDb();
const db = t.database;
setTestEnv({
  STRIPE_SECRET_KEY: "sk_test_x",
  STRIPE_CONNECT_CLIENT_ID: "ca_test",
  STRIPE_WEBHOOK_SECRET: "whsec_test",
  STRIPE_API_URL: "https://stripe.test",
});
beforeEach(() => t.reset());
afterEach(() => vi.unstubAllGlobals());
afterAll(() => t.close());

function form(values: Record<string, string | string[]>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(values))
    for (const x of Array.isArray(v) ? v : [v]) f.append(k, x);
  return f;
}

async function issuedInvoice(withChart = true) {
  const a = await attachLeadIdentity(db, claims());
  const who = { organizationId: a.organization.id, userId: a.user.id };
  await db
    .update(organizations)
    .set({
      legalName: "Atelier Muster GmbH",
      street: "Bahnhofstrasse",
      postalCode: "8001",
      town: "Zürich",
      iban: "CH9300762011623852957",
      stripeAccountId: "acct_atelier",
      settingsCompletedAt: new Date(),
    })
    .where(eq(organizations.id, a.organization.id));
  if (withChart) {
    await installChart(db, who, "corporation");
    // Plan installé comme avant les paiements en ligne : sans compte d'attente.
    await db.delete(accounts).where(eq(accounts.role, "payment_clearing"));
    await createFirstFiscalYear(db, who, { start: "2026-01-01", extended: false });
  }
  const c = parseContactForm(
    form({
      kind: "company",
      isCustomer: "on",
      name: "Kunde AG",
      language: "de",
      country: "CH",
      paymentTermDays: "30",
      email: "ap@kunde.test",
    }),
  );
  if (!c.ok) throw new Error("contact");
  const contact = await createContact(db, who, c.data);
  const r = parseInvoiceForm(
    form({
      contactId: contact.id,
      language: "de",
      issueDate: "2026-02-10",
      "line.description": ["Beratung"],
      "line.quantity": ["1"],
      "line.unit": ["flat"],
      "line.unitPrice": ["500"],
      "line.vatCode": ["normal"],
      "line.productId": [""],
    }),
    { vatRegistered: false },
  );
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  const draft = await createInvoice(db, who, r.data);
  if (typeof draft !== "object" || !draft) throw new Error("brouillon");
  await issueInvoice(db, who, draft.id);
  return { a, who, invoiceId: draft.id };
}

const event = (orgId: string, invoiceId: string, over: Record<string, unknown> = {}) => ({
  type: "checkout.session.completed",
  account: "acct_atelier",
  data: {
    object: {
      id: "cs_test_1",
      payment_status: "paid",
      amount_total: 50000,
      created: Date.UTC(2026, 1, 20) / 1000,
      metadata: { invoice_id: invoiceId, organization_id: orgId },
      ...over,
    },
  },
});

describe("Stripe", () => {
  it("vérifie la signature et refuse un rejeu trop ancien", () => {
    const payload = '{"id":"evt"}';
    const now = 1_790_000_000;
    const sig = createHmac("sha256", "whsec_test").update(`${now}.${payload}`).digest("hex");
    expect(verifyStripeSignature(payload, `t=${now},v1=${sig}`, "whsec_test", now)).toBe(true);
    expect(verifyStripeSignature(payload, `t=${now},v1=${sig}`, "whsec_test", now + 301)).toBe(
      false,
    );
    expect(verifyStripeSignature(`${payload} `, `t=${now},v1=${sig}`, "whsec_test", now)).toBe(
      false,
    );
    expect(verifyStripeSignature(payload, null, "whsec_test", now)).toBe(false);
  });

  it("ouvre une session Checkout pour le solde, sur le compte de l'entreprise", async () => {
    const { a, invoiceId } = await issuedInvoice(false);
    const calls: { url: string; headers: Record<string, string>; body: string }[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      calls.push({ url, headers: init.headers as Record<string, string>, body: String(init.body) });
      return new Response(JSON.stringify({ id: "cs_1", url: "https://checkout.stripe.test/cs_1" }));
    });
    const url = await createCheckout(db, {
      organizationId: a.organization.id,
      invoiceId,
      successUrl: "https://invoicelead.io/de/d/x?paid=1",
      cancelUrl: "https://invoicelead.io/de/d/x",
    });
    expect(url).toBe("https://checkout.stripe.test/cs_1");
    expect(calls[0]?.url).toBe("https://stripe.test/v1/checkout/sessions");
    expect(calls[0]?.headers["Stripe-Account"]).toBe("acct_atelier");
    const body = new URLSearchParams(calls[0]?.body);
    expect(body.get("line_items[0][price_data][unit_amount]")).toBe("50000");
    expect(body.get("line_items[0][price_data][currency]")).toBe("chf");
    expect(body.get("metadata[invoice_id]")).toBe(invoiceId);
    expect(body.get("customer_email")).toBe("ap@kunde.test");
  });

  it("enregistre le paiement une seule fois, du bon compte, et le comptabilise en attente", async () => {
    const { a, who, invoiceId } = await issuedInvoice();
    expect(
      await handleStripeEvent(db, {
        ...event(a.organization.id, invoiceId),
        account: "acct_autre",
      }),
    ).toBe("ignored");
    expect(await handleStripeEvent(db, event(a.organization.id, invoiceId))).toBe("recorded");
    expect(await handleStripeEvent(db, event(a.organization.id, invoiceId))).toBe("duplicate");
    const [payment] = await db.select().from(invoicePayments);
    expect(payment).toMatchObject({
      method: "online",
      amountCents: 50000,
      paidOn: "2026-02-20",
      externalRef: "cs_test_1",
    });
    expect((await invoiceBalance(db, invoiceId, 50000)).openCents).toBe(0);

    await postPending(db, who);
    const [clearing] = await db
      .select()
      .from(accounts)
      .where(eq(accounts.role, "payment_clearing"));
    expect(clearing?.number).toBe("1091");
    const lines = await db
      .select()
      .from(journalLines)
      .where(eq(journalLines.accountId, clearing?.id ?? ""));
    expect(lines.reduce((s, l) => s + l.debitCents - l.creditCents, 0)).toBe(50000);
  });
});
