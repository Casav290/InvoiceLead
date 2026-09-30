import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { computeTotals, formatQuantity, parseQuantityToMilli } from "@/lib/invoice-math";
import { attachLeadIdentity } from "@/server/auth/attach";
import { createContact, parseContactForm } from "@/server/contacts";
import { organizations } from "@/server/db/schema";
import {
  convertQuoteToInvoice,
  createCreditNote,
  createInvoice,
  deleteDraft,
  getInvoice,
  issueInvoice,
  listInvoices,
  parseInvoiceForm,
  setQuoteOutcome,
  updateInvoice,
} from "@/server/invoices";
import {
  addPayment,
  deletePayment,
  invoiceBalance,
  listPayments,
  paymentState,
} from "@/server/payments";
import { claims } from "../support/claims";
import { testDb } from "../support/db";

const t = testDb();
const db = t.database;
beforeEach(() => t.reset());
afterAll(() => t.close());

describe("calcul d'une facture", () => {
  it("lit et affiche les quantités", () => {
    expect(parseQuantityToMilli("1.5")).toBe(1500);
    expect(parseQuantityToMilli("2,25")).toBe(2250);
    expect(parseQuantityToMilli("1'000")).toBe(1_000_000);
    expect(parseQuantityToMilli("-1")).toBe(-1000);
    expect(parseQuantityToMilli("0.0005")).toBeNull();
    expect(formatQuantity(1500)).toBe("1.5");
    expect(formatQuantity(2000)).toBe("2");
  });

  it("arrondit la TVA par taux, sur la somme des lignes", () => {
    const totals = computeTotals([
      { quantityMilli: 1000, unitPriceCents: 1005, vatRateBp: 810 },
      { quantityMilli: 1000, unitPriceCents: 1005, vatRateBp: 810 },
      { quantityMilli: 3000, unitPriceCents: 333, vatRateBp: 260 },
    ]);
    expect(totals.lines).toEqual([1005, 1005, 999]);
    // 20.10 × 8.1 % = 1.6281 → 1.63 ; 9.99 × 2.6 % = 0.2597 → 0.26
    expect(totals.vat).toEqual([
      { rateBp: 810, netCents: 2010, vatCents: 163 },
      { rateBp: 260, netCents: 999, vatCents: 26 },
    ]);
    expect(totals.totalCents).toBe(2010 + 999 + 163 + 26);
    expect(computeTotals([{ quantityMilli: 1500, unitPriceCents: 3, vatRateBp: 0 }]).lines).toEqual(
      [5],
    );
  });
});

function form(values: Record<string, string | string[]>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(values)) {
    for (const x of Array.isArray(v) ? v : [v]) f.append(k, x);
  }
  return f;
}

async function setup(vatRegistered = true) {
  const a = await attachLeadIdentity(db, claims());
  const who = { organizationId: a.organization.id, userId: a.user.id };
  await db
    .update(organizations)
    .set({
      vatRegistered,
      uid: "CHE116281710",
      legalName: "Atelier Muster GmbH",
      street: "Bahnhofstrasse",
      buildingNumber: "1",
      postalCode: "8001",
      town: "Zürich",
      iban: "CH9300762011623852957",
      settingsCompletedAt: new Date(),
    })
    .where(eq(organizations.id, a.organization.id));
  const parsed = parseContactForm(
    form({
      kind: "company",
      isCustomer: "on",
      name: "Kunde AG",
      language: "de",
      country: "CH",
      street: "Hauptgasse",
      postalCode: "3000",
      town: "Bern",
      paymentTermDays: "30",
    }),
  );
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
  const contact = await createContact(db, who, parsed.data);
  return { a, who, contact };
}

const lines = {
  "line.description": ["Beratung", "", "Spesen"],
  "line.quantity": ["2.5", "1", "1"],
  "line.unit": ["hour", "hour", "flat"],
  "line.unitPrice": ["150", "", "40.00"],
  "line.vatCode": ["normal", "normal", "normal"],
  "line.productId": ["", "", ""],
};

describe("factures", () => {
  it("valident client, dates, lignes, et ignorent la ligne vide", () => {
    const bad = parseInvoiceForm(
      form({
        contactId: "x",
        language: "de",
        issueDate: "2026-02-30",
        "line.description": ["", "Sans prix"],
        "line.quantity": ["1", "0"],
        "line.unit": ["hour", "hour"],
        "line.unitPrice": ["", "abc"],
        "line.vatCode": ["normal", "normal"],
      }),
      { vatRegistered: true },
    );
    expect(!bad.ok && bad.errors).toMatchObject({
      contactId: "required",
      issueDate: "date",
      "lines.0.quantity": "quantity",
      "lines.0.unitPrice": "amount",
    });
    const old = parseInvoiceForm(
      form({
        contactId: "00000000-0000-4000-8000-000000000000",
        language: "fr",
        issueDate: "2026-01-10",
        serviceDate: "2010-05-01",
        ...lines,
      }),
      { vatRegistered: true },
    );
    expect(!old.ok && old.errors).toMatchObject({ serviceDate: "vatDate" });
  });

  it("se calculent, se numérotent sans trou à l'émission puis ne changent plus", async () => {
    const { a, who, contact } = await setup();
    const parse = (issueDate: string) => {
      const r = parseInvoiceForm(
        form({
          contactId: contact.id,
          language: "de",
          issueDate,
          serviceDate: "2023-12-15",
          ...lines,
        }),
        { vatRegistered: true },
      );
      if (!r.ok) throw new Error(JSON.stringify(r.errors));
      return r.data;
    };
    const draft = await createInvoice(db, who, parse("2026-03-01"));
    if (typeof draft !== "object" || !draft) throw new Error("brouillon");
    // Prestation en 2023 : ancien taux de 7.7 %. 375 + 40 = 415.00 ; TVA 31.955 → 31.96.
    expect(draft).toMatchObject({
      netCents: 41_500,
      vatCents: 3196,
      totalCents: 44_696,
      dueDate: "2026-03-31",
      number: null,
    });
    const full = await getInvoice(db, a.organization.id, draft.id);
    expect(full?.lines.map((l) => [l.position, l.vatRateBp, l.netCents])).toEqual([
      [1, 770, 37_500],
      [2, 770, 4000],
    ]);

    const second = await createInvoice(db, who, parse("2026-04-01"));
    if (typeof second !== "object" || !second) throw new Error("brouillon");
    const first = await issueInvoice(db, who, draft.id);
    expect(first).toMatchObject({ number: "2026-0001", status: "issued" });
    expect(await issueInvoice(db, who, second.id)).toMatchObject({ number: "2026-0002" });
    expect(await issueInvoice(db, who, draft.id)).toBe("notDraft");
    if (typeof first !== "object") throw new Error("émise");
    expect(first.sender).toMatchObject({
      name: "Atelier Muster GmbH",
      vatNumber: "CHE-116.281.710 MWST",
    });
    expect(first.recipient).toMatchObject({ name: "Kunde AG", town: "Bern" });

    expect(await updateInvoice(db, who, draft.id, parse("2026-05-01"))).toBe("notDraft");
    expect(await deleteDraft(db, who, draft.id)).toBe(false);
    const third = await createInvoice(db, who, parse("2027-01-05"));
    if (typeof third !== "object" || !third) throw new Error("brouillon");
    expect(await issueInvoice(db, who, third.id)).toMatchObject({ number: "2027-0001" });
    expect(await listInvoices(db, a.organization.id)).toHaveLength(3);
  });

  it("restent propres à l'organisation et exigent des réglages complets", async () => {
    const { who, contact } = await setup(false);
    const r = parseInvoiceForm(
      form({ contactId: contact.id, language: "fr", issueDate: "2026-03-01", ...lines }),
      { vatRegistered: false },
    );
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    const draft = await createInvoice(db, who, r.data);
    if (typeof draft !== "object" || !draft) throw new Error("brouillon");
    expect(draft).toMatchObject({ vatCents: 0, totalCents: 41_500, vatRegistered: false });

    const b = await attachLeadIdentity(
      db,
      claims({ sub: "sub-b", email: "b@autre.test", org: "org-b" }),
    );
    const whoB = { organizationId: b.organization.id, userId: b.user.id };
    expect(await getInvoice(db, b.organization.id, draft.id)).toBeNull();
    expect(await issueInvoice(db, whoB, draft.id)).toBe("notFound");
    expect(await deleteDraft(db, whoB, draft.id)).toBe(false);
    expect(await createInvoice(db, whoB, r.data)).toBe("contact");

    await db
      .update(organizations)
      .set({ settingsCompletedAt: null })
      .where(eq(organizations.id, who.organizationId));
    expect(await issueInvoice(db, who, draft.id)).toBe("companyIncomplete");
    expect(await deleteDraft(db, who, draft.id)).toBe(true);
  });
});

describe("devis", () => {
  it("ont leur propre numérotation, puis deviennent une facture une seule fois", async () => {
    const { a, who, contact } = await setup();
    const r = parseInvoiceForm(
      form({ contactId: contact.id, language: "de", issueDate: "2026-03-01", ...lines }),
      { vatRegistered: true },
    );
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    const quote = await createInvoice(db, who, r.data, "quote");
    if (typeof quote !== "object" || !quote) throw new Error("devis");
    expect(quote).toMatchObject({ kind: "quote", dueDate: "2026-03-31" });
    expect(await convertQuoteToInvoice(db, who, quote.id, "2026-03-05")).toBe("notConvertible");
    // Une facture ne se modifie pas par le chemin des devis, ni l'inverse.
    expect(await updateInvoice(db, who, quote.id, r.data, "invoice")).toBe("notDraft");

    const issued = await issueInvoice(db, who, quote.id);
    expect(issued).toMatchObject({ number: "O-2026-0001", paymentReference: null });
    expect(await setQuoteOutcome(db, who, quote.id, "declined")).toBe(true);
    expect(await convertQuoteToInvoice(db, who, quote.id, "2026-03-05")).toBe("notConvertible");
    expect(await setQuoteOutcome(db, who, quote.id, "accepted")).toBe(true);

    const invoice = await convertQuoteToInvoice(db, who, quote.id, "2026-03-05");
    if (typeof invoice !== "object") throw new Error(invoice);
    expect(invoice).toMatchObject({
      kind: "invoice",
      status: "draft",
      sourceQuoteId: quote.id,
      issueDate: "2026-03-05",
      netCents: 41_500,
      totalCents: 41_500 + 3362,
    });
    expect((await getInvoice(db, a.organization.id, quote.id))?.invoice.status).toBe("invoiced");
    expect(await convertQuoteToInvoice(db, who, quote.id, "2026-03-06")).toBe("notConvertible");
    expect(await setQuoteOutcome(db, who, quote.id, "declined")).toBe(false);

    expect(await issueInvoice(db, who, invoice.id)).toMatchObject({ number: "2026-0001" });
    expect(await listInvoices(db, a.organization.id, "quote")).toHaveLength(1);
    expect(await listInvoices(db, a.organization.id, "invoice")).toHaveLength(1);
  });
});

describe("paiements et avoirs", () => {
  it("soldent une facture par paiements partiels et avoir, sans jamais la dépasser", async () => {
    const { a, who, contact } = await setup();
    const r = parseInvoiceForm(
      form({ contactId: contact.id, language: "de", issueDate: "2026-03-01", ...lines }),
      { vatRegistered: true },
    );
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    const draft = await createInvoice(db, who, r.data);
    if (typeof draft !== "object" || !draft) throw new Error("brouillon");
    const pay = (amountCents: number) =>
      addPayment(db, who, draft.id, {
        paidOn: "2026-03-10",
        amountCents,
        method: "bank",
        note: null,
      });
    expect(await pay(100)).toBe("notFound");
    await issueInvoice(db, who, draft.id);
    // 415.00 + 8.1 % = 448.62
    const total = 44_862;

    const p1 = await pay(20_000);
    if (typeof p1 !== "object") throw new Error(p1);
    expect(await pay(total)).toBe("tooHigh");
    let b = await invoiceBalance(db, draft.id, total);
    expect(b).toEqual({
      totalCents: total,
      creditedCents: 0,
      paidCents: 20_000,
      chargesCents: 0,
      openCents: 24_862,
    });
    expect(paymentState(b, "2026-03-31", "2026-03-15")).toBe("partial");
    expect(paymentState(b, "2026-03-31", "2026-04-01")).toBe("overdue");

    // Avoir partiel : on garde seulement la ligne de frais (40.00 + TVA = 43.24).
    const credit = await createCreditNote(db, who, draft.id, "2026-03-20");
    if (typeof credit !== "object") throw new Error(credit);
    expect(credit).toMatchObject({
      kind: "credit_note",
      relatedInvoiceId: draft.id,
      totalCents: total,
    });
    const partial = parseInvoiceForm(
      form({
        contactId: contact.id,
        language: "de",
        issueDate: "2026-03-20",
        serviceDate: "2026-03-01",
        "line.description": ["Spesen"],
        "line.quantity": ["1"],
        "line.unit": ["flat"],
        "line.unitPrice": ["40"],
        "line.vatCode": ["normal"],
        "line.productId": [""],
      }),
      { vatRegistered: true },
    );
    if (!partial.ok) throw new Error("avoir");
    expect(await updateInvoice(db, who, credit.id, partial.data, "credit_note")).toMatchObject({
      totalCents: 4324,
    });
    expect(await issueInvoice(db, who, credit.id)).toMatchObject({ number: "G-2026-0001" });
    b = await invoiceBalance(db, draft.id, total);
    expect(b.openCents).toBe(24_862 - 4324);

    // Un second avoir complet dépasserait le reste à créditer.
    const tooMuch = await createCreditNote(db, who, draft.id, "2026-03-21");
    if (typeof tooMuch !== "object") throw new Error(tooMuch);
    expect(await issueInvoice(db, who, tooMuch.id)).toBe("creditTooHigh");
    expect(await deleteDraft(db, who, tooMuch.id)).toBe(true);

    expect(typeof (await pay(24_862 - 4324))).toBe("object");
    b = await invoiceBalance(db, draft.id, total);
    expect(paymentState(b, "2026-03-31", "2026-05-01")).toBe("paid");
    expect((await listInvoices(db, a.organization.id))[0]).toMatchObject({
      paidCents: 20_000 + 24_862 - 4324,
      creditedCents: 4324,
    });

    const b2 = await attachLeadIdentity(
      db,
      claims({ sub: "sub-b", email: "b@autre.test", org: "org-b" }),
    );
    const whoB = { organizationId: b2.organization.id, userId: b2.user.id };
    expect(await deletePayment(db, whoB, p1.id)).toBe(false);
    expect(
      await addPayment(db, whoB, draft.id, {
        paidOn: "2026-03-10",
        amountCents: 1,
        method: "bank",
        note: null,
      }),
    ).toBe("notFound");
    expect(await createCreditNote(db, whoB, draft.id, "2026-03-20")).toBe("notFound");
    expect(await deletePayment(db, who, p1.id)).toBe(true);
    expect(await listPayments(db, a.organization.id, draft.id)).toHaveLength(1);
  });
});
