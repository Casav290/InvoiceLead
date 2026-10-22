import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createFirstFiscalYear, installChart } from "@/server/accounting";
import { attachLeadIdentity } from "@/server/auth/attach";
import { approveBill, markBillPaid, updateBill } from "@/server/bills";
import {
  accounts,
  einvoiceConnections,
  organizations,
  receipts,
  supplierBills,
} from "@/server/db/schema";
import { type B2Brouter, B2BrouterError, b2brouter } from "@/server/einvoicing/b2brouter";
import {
  getConnection,
  receptionState,
  refuseBill,
  registerReception,
  syncAll,
  syncConnection,
  syncIfStale,
} from "@/server/einvoicing/reception";
import { claims } from "../support/claims";
import { testDb } from "../support/db";
import { setTestEnv } from "../support/env";

const t = testDb();
const db = t.database;
beforeAll(() => setTestEnv());
beforeEach(() => t.reset());
afterAll(() => t.close());

/** Facture Factur-X / CII reçue d'un fournisseur français. */
const CII = (number: string, total = "1200.00") => `<?xml version="1.0" encoding="UTF-8"?>
<rsm:CrossIndustryInvoice xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100" xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100" xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100">
  <rsm:ExchangedDocument><ram:ID>${number}</ram:ID><ram:TypeCode>380</ram:TypeCode>
    <ram:IssueDateTime><udt:DateTimeString format="102">20261020</udt:DateTimeString></ram:IssueDateTime></rsm:ExchangedDocument>
  <rsm:SupplyChainTradeTransaction>
    <ram:IncludedSupplyChainTradeLineItem><ram:SpecifiedTradeProduct><ram:Name>Maintenance du site</ram:Name></ram:SpecifiedTradeProduct></ram:IncludedSupplyChainTradeLineItem>
    <ram:ApplicableHeaderTradeAgreement>
      <ram:SellerTradeParty><ram:Name>Studio Lumière SARL</ram:Name>
        <ram:PostalTradeAddress><ram:PostcodeCode>69002</ram:PostcodeCode><ram:LineOne>3 quai Saint-Antoine</ram:LineOne><ram:CityName>Lyon</ram:CityName><ram:CountryID>FR</ram:CountryID></ram:PostalTradeAddress>
      </ram:SellerTradeParty>
    </ram:ApplicableHeaderTradeAgreement>
    <ram:ApplicableHeaderTradeSettlement>
      <ram:InvoiceCurrencyCode>EUR</ram:InvoiceCurrencyCode>
      <ram:SpecifiedTradeSettlementPaymentMeans><ram:TypeCode>58</ram:TypeCode><ram:PayeePartyCreditorFinancialAccount><ram:IBANID>FR7630006000011234567890189</ram:IBANID></ram:PayeePartyCreditorFinancialAccount></ram:SpecifiedTradeSettlementPaymentMeans>
      <ram:ApplicableTradeTax><ram:CalculatedAmount>200.00</ram:CalculatedAmount><ram:TypeCode>VAT</ram:TypeCode><ram:BasisAmount>1000.00</ram:BasisAmount><ram:CategoryCode>S</ram:CategoryCode><ram:RateApplicablePercent>20</ram:RateApplicablePercent></ram:ApplicableTradeTax>
      <ram:SpecifiedTradePaymentTerms><ram:DueDateDateTime><udt:DateTimeString format="102">20261119</udt:DateTimeString></ram:DueDateDateTime></ram:SpecifiedTradePaymentTerms>
      <ram:SpecifiedTradeSettlementHeaderMonetarySummation><ram:TaxBasisTotalAmount>1000.00</ram:TaxBasisTotalAmount><ram:TaxTotalAmount currencyID="EUR">200.00</ram:TaxTotalAmount><ram:GrandTotalAmount>${total}</ram:GrandTotalAmount><ram:DuePayableAmount>${total}</ram:DuePayableAmount></ram:SpecifiedTradeSettlementHeaderMonetarySummation>
    </ram:ApplicableHeaderTradeSettlement>
  </rsm:SupplyChainTradeTransaction>
</rsm:CrossIndustryInvoice>`;

type Inbox = { id: string; number: string; type: string; body: string };

/** Fausse plateforme : boîte de réception, acquittements et états reçus, comme B2Brouter. */
function fakePlatform(inbox: Inbox[]) {
  const acked = new Set<string>();
  const marks: { id: string; state: string; reason?: string }[] = [];
  const accounts: Record<string, unknown>[] = [];
  const settings: { accountId: string; startDate: string; migrationCode: string | null }[] = [];
  let failRegister: B2BrouterError | null = null;
  const client: B2Brouter = {
    async createAccount(a) {
      accounts.push(a);
      return "777";
    },
    async registerReception(accountId, s) {
      if (failRegister) throw failRegister;
      settings.push({ accountId, startDate: s.startDate, migrationCode: s.migrationCode });
    },
    async listReceived(_accountId, offset, limit) {
      return inbox
        .filter((i) => !acked.has(i.id))
        .slice(offset, offset + limit)
        .map((i) => ({ id: i.id, number: i.number, state: "received" }));
    },
    async downloadOriginal(id) {
      const i = inbox.find((x) => x.id === id);
      if (!i) throw new B2BrouterError(404, "");
      return { type: i.type, bytes: Buffer.from(i.body) };
    },
    async ack(id) {
      acked.add(id);
    },
    async markAs(id, state, reason) {
      marks.push({ id, state, ...(reason ? { reason } : {}) });
    },
  };
  return {
    client,
    acked,
    marks,
    accounts,
    settings,
    failNextRegister: (e: B2BrouterError | null) => {
      failRegister = e;
    },
  };
}

async function frenchCompany() {
  const a = await attachLeadIdentity(db, claims());
  const who = { organizationId: a.organization.id, userId: a.user.id };
  await db
    .update(organizations)
    .set({
      country: "FR",
      currency: "EUR",
      vatRegistered: true,
      vatMethod: "effective",
      legalName: "Atelier Durand SAS",
      street: "Rue de Rivoli",
      buildingNumber: "10",
      postalCode: "75001",
      town: "Paris",
      email: "compta@atelier-durand.fr",
      uid: "FR40303265045",
      taxNumber: "30326504500003",
      settingsCompletedAt: new Date(),
    })
    .where(eq(organizations.id, a.organization.id));
  await installChart(db, who, "corporation");
  await createFirstFiscalYear(db, who, { start: "2026-01-01", extended: false });
  return who;
}

describe("client HTTP B2Brouter", () => {
  it("envoie la clé et la version, crée le compte au SIREN, inscrit en réception seule", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetcher = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      if (url.endsWith("/accounts"))
        return Response.json({ account: { id: 4321 } }, { status: 201 });
      if (url.includes("/invoices?"))
        return Response.json({ invoices: [{ id: 9, number: "F-1", state: "received" }] });
      if (url.endsWith("/as/original"))
        return new Response("<x/>", {
          headers: { "content-type": "application/xml; charset=utf-8" },
        });
      if (url.endsWith("/mark_as")) return new Response(null, { status: 204 });
      if (url.endsWith("/tax_report_settings"))
        return Response.json(
          { error: "SIREN already registered in Annuaire with another PA" },
          { status: 422 },
        );
      return Response.json({});
    }) as unknown as typeof fetch;
    const c = b2brouter(
      { key: "test_k", url: "https://api.b2brouter.net/", version: "2026-06-26" },
      fetcher,
    );

    const id = await c.createAccount({
      name: "Atelier Durand SAS",
      siren: "303265045",
      vatNumber: "FR40303265045",
      street: "Rue de Rivoli 10",
      postalCode: "75001",
      town: "Paris",
      email: null,
    });
    expect(id).toBe("4321");
    const first = calls[0];
    expect(first?.url).toBe("https://api.b2brouter.net/accounts");
    const headers = first?.init.headers as Record<string, string>;
    expect(headers["X-B2B-API-Key"]).toBe("test_k");
    expect(headers["X-B2B-API-Version"]).toBe("2026-06-26");
    expect(JSON.parse(String(first?.init.body))).toMatchObject({
      account: { country: "fr", cin_scheme: "0002", cin_value: "303265045", tin_scheme: 9957 },
    });

    await expect(
      c.registerReception("4321", { startDate: "2026-10-23", email: null, migrationCode: "ABC" }),
    ).rejects.toMatchObject({ status: 422 });
    expect(JSON.parse(String(calls[1]?.init.body))).toEqual({
      tax_report_setting: {
        code: "dgfip",
        start_date: "2026-10-23",
        annuaire_only: true,
        peppol_migration_code: "ABC",
      },
    });

    expect(await c.listReceived("4321", 0, 50)).toEqual([
      { id: "9", number: "F-1", state: "received" },
    ]);
    expect(calls[2]?.url).toBe(
      "https://api.b2brouter.net/accounts/4321/invoices?type=ReceivedInvoice&offset=0&limit=50",
    );
    expect(await c.downloadOriginal("9")).toMatchObject({ type: "application/xml" });
    await c.markAs("9", "refused", "Bon de commande manquant");
    expect(calls[4]?.url).toBe("https://api.b2brouter.net/invoices/9/mark_as");
    expect(JSON.parse(String(calls[4]?.init.body))).toEqual({
      state: "refused",
      reason: "Bon de commande manquant",
    });
  });
});

describe("réception des factures électroniques en France", () => {
  it("inscrit le SIREN à l'annuaire, active le lendemain, refuse hors de France ou sans clé", async () => {
    const who = await frenchCompany();
    const p = fakePlatform([]);
    expect(await registerReception(db, who, null, "2026-10-22", null)).toBe("unavailable");

    // Une inscription interrompue garde le compte et reprend dessus.
    p.failNextRegister(new B2BrouterError(500, "boom"));
    expect(await registerReception(db, who, p.client, "2026-10-22", null)).toBe("failed");
    expect(receptionState(await getConnection(db, who.organizationId), "2026-10-22")).toBe(
      "notRegistered",
    );
    p.failNextRegister(new B2BrouterError(422, "SIREN already registered with another PA"));
    expect(await registerReception(db, who, p.client, "2026-10-22", null)).toBe("alreadyElsewhere");
    p.failNextRegister(null);
    const c = await registerReception(db, who, p.client, "2026-10-22", "MIG-1");
    if (typeof c === "string") throw new Error(c);
    expect(p.accounts).toHaveLength(1);
    expect(p.accounts[0]).toMatchObject({
      siren: "303265045",
      vatNumber: "FR40303265045",
      name: "Atelier Durand SAS",
      street: "Rue de Rivoli 10",
    });
    expect(p.settings).toEqual([
      { accountId: "777", startDate: "2026-10-23", migrationCode: "MIG-1" },
    ]);
    expect(c).toMatchObject({ siren: "303265045", startDate: "2026-10-23", lastError: null });
    expect(receptionState(c, "2026-10-22")).toBe("scheduled");
    expect(receptionState(c, "2026-10-23")).toBe("active");
    // Rejouée, l'inscription ne crée rien de plus.
    expect(await registerReception(db, who, p.client, "2026-10-22", null)).toMatchObject({
      id: c.id,
    });
    expect(p.accounts).toHaveLength(1);

    // Une entreprise suisse, ou française sans SIRET valide, ne s'inscrit pas.
    const ch = await attachLeadIdentity(
      db,
      claims({ org: "org_ch", sub: "u_ch", email: "ch@x.ch" }),
    );
    const chWho = { organizationId: ch.organization.id, userId: ch.user.id };
    expect(await registerReception(db, chWho, p.client, "2026-10-22", null)).toBe("notFrance");
    await db
      .update(organizations)
      .set({ country: "FR", taxNumber: "30326504500004" })
      .where(eq(organizations.id, ch.organization.id));
    expect(await registerReception(db, chWho, p.client, "2026-10-22", null)).toBe("siret");
  });

  it("relève les factures reçues en brouillons, garde l'illisible comme justificatif, acquitte tout", async () => {
    const who = await frenchCompany();
    const p = fakePlatform([
      { id: "101", number: "SL-2026-41", type: "application/xml", body: CII("SL-2026-41") },
      { id: "102", number: "SL-2026-42", type: "text/xml", body: CII("SL-2026-42", "600.00") },
      { id: "103", number: "SCAN-7", type: "application/pdf", body: "%PDF-1.4 pas de XML" },
    ]);
    const c = await registerReception(db, who, p.client, "2026-10-22", null);
    if (typeof c === "string") throw new Error(c);

    const r = await syncConnection(db, c, p.client);
    expect(r).toEqual({ imported: 2, stored: 1, pushed: 0, error: null });
    expect([...p.acked].sort()).toEqual(["101", "102", "103"]);
    const bills = await db
      .select()
      .from(supplierBills)
      .where(eq(supplierBills.organizationId, who.organizationId));
    expect(
      bills.map((b) => [b.platformRef, b.number, b.totalCents, b.status, b.source]).sort(),
    ).toEqual([
      ["b2brouter:101", "SL-2026-41", 120_000, "draft", "einvoice"],
      ["b2brouter:102", "SL-2026-42", 60_000, "draft", "einvoice"],
    ]);
    expect(bills[0]).toMatchObject({ supplierName: "Studio Lumière SARL", vatCode: "normal" });
    const files = await db
      .select({ filename: receipts.filename, status: receipts.status })
      .from(receipts)
      .where(eq(receipts.organizationId, who.organizationId));
    expect(files.map((f) => f.filename).sort()).toEqual([
      "SCAN-7.pdf",
      "SL-2026-41.xml",
      "SL-2026-42.xml",
    ]);

    // Relevé de nouveau : rien de plus, même si la plateforme renvoie une facture déjà importée.
    p.acked.delete("101");
    expect(await syncConnection(db, c, p.client)).toMatchObject({ imported: 0, stored: 0 });
    expect(p.acked.has("101")).toBe(true);
    const [after] = await db
      .select()
      .from(einvoiceConnections)
      .where(eq(einvoiceConnections.organizationId, who.organizationId));
    expect(after?.lastSyncAt).not.toBeNull();
    expect(after?.lastError).toBeNull();
  });

  it("ne perd jamais une facture : type deviné, fichier inconnu et panne gardés pour plus tard", async () => {
    const who = await frenchCompany();
    const p = fakePlatform([
      { id: "401", number: "C-1", type: "application/octet-stream", body: CII("C-1") },
      { id: "402", number: "C-2", type: "application/octet-stream", body: "\u0000\u0001binaire" },
      { id: "403", number: "C-3", type: "application/xml", body: CII("C-3") },
      { id: "404", number: "C-4", type: "application/xml", body: CII("C-4") },
    ]);
    const c = await registerReception(db, who, p.client, "2026-10-22", null);
    if (typeof c === "string") throw new Error(c);
    const download = p.client.downloadOriginal;
    p.client.downloadOriginal = async (id) => {
      if (id === "403") throw new B2BrouterError(500, "boom");
      return download(id);
    };
    const r = await syncConnection(db, c, p.client);
    expect(r.imported).toBe(2);
    expect(r.error).not.toBeNull();
    // 401 deviné XML, 404 importée malgré la panne de 403 ; 402 et 403 restent à relever.
    expect([...p.acked].sort()).toEqual(["401", "404"]);
    p.client.downloadOriginal = download;
    expect(await syncConnection(db, c, p.client)).toMatchObject({
      imported: 1,
      error: "unreadable",
    });
    expect([...p.acked].sort()).toEqual(["401", "403", "404"]);
  });

  it("rend à la plateforme l'approbation, le paiement et le refus avec son motif", async () => {
    const who = await frenchCompany();
    const p = fakePlatform([
      { id: "201", number: "A-1", type: "application/xml", body: CII("A-1") },
      { id: "202", number: "A-2", type: "application/xml", body: CII("A-2") },
    ]);
    const c = await registerReception(db, who, p.client, "2026-10-22", null);
    if (typeof c === "string") throw new Error(c);
    await syncConnection(db, c, p.client);
    const rows = await db
      .select()
      .from(supplierBills)
      .where(eq(supplierBills.organizationId, who.organizationId));
    const first = rows.find((b) => b.platformRef === "b2brouter:201");
    const second = rows.find((b) => b.platformRef === "b2brouter:202");
    if (!first || !second) throw new Error("factures");
    const [account] = await db
      .select()
      .from(accounts)
      .where(and(eq(accounts.organizationId, who.organizationId), eq(accounts.number, "604000")));
    if (!account) throw new Error("compte 604000");
    await updateBill(db, who, first.id, {
      supplierName: first.supplierName,
      supplierStreet: first.supplierStreet,
      supplierPostalCode: first.supplierPostalCode,
      supplierTown: first.supplierTown,
      supplierCountry: first.supplierCountry,
      iban: first.iban,
      bic: first.bic,
      paymentReference: first.paymentReference,
      number: first.number,
      issueDate: first.issueDate,
      dueDate: first.dueDate,
      currency: first.currency,
      totalCents: first.totalCents,
      vatCode: "normal",
      accountId: account.id,
      description: first.description,
    });
    expect(await approveBill(db, who, first.id)).toMatchObject({ status: "approved" });

    expect(await refuseBill(db, who, second.id, " ")).toBe("reason");
    expect(await refuseBill(db, who, first.id, "Déjà approuvée")).toBe("notFound");
    expect(await refuseBill(db, who, second.id, "Bon de commande manquant")).toMatchObject({
      status: "refused",
      refusalReason: "Bon de commande manquant",
    });

    expect(await syncConnection(db, c, p.client)).toMatchObject({ pushed: 2, error: null });
    expect(p.marks).toEqual([
      { id: "201", state: "accepted" },
      { id: "202", state: "refused", reason: "Bon de commande manquant" },
    ]);
    expect(await markBillPaid(db, who, first.id, "2026-10-22", "bank")).toBe("paid");
    expect(await syncConnection(db, c, p.client)).toMatchObject({ pushed: 1 });
    expect(p.marks.at(-1)).toEqual({ id: "201", state: "paid" });
    // Chaque état ne part qu'une fois.
    expect(await syncConnection(db, c, p.client)).toMatchObject({ pushed: 0 });
  });

  it("un relevé à la fois, au plus tous les quart d'heure ; la tâche quotidienne relève tout", async () => {
    const who = await frenchCompany();
    const p = fakePlatform([
      { id: "301", number: "B-1", type: "application/xml", body: CII("B-1") },
    ]);
    expect(await syncIfStale(db, who.organizationId, p.client)).toBeNull();
    const c = await registerReception(db, who, p.client, "2026-10-22", null);
    if (typeof c === "string") throw new Error(c);
    expect(await syncIfStale(db, who.organizationId, null)).toBeNull();
    const [a, b] = await Promise.all([
      syncIfStale(db, who.organizationId, p.client),
      syncIfStale(db, who.organizationId, p.client),
    ]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
    expect(await syncIfStale(db, who.organizationId, p.client)).toBeNull();
    await db
      .update(einvoiceConnections)
      .set({ lastSyncAt: new Date(Date.now() - 5 * 60_000) })
      .where(eq(einvoiceConnections.id, c.id));
    expect(await syncAll(db, p.client)).toEqual({ companies: 1, imported: 0, errors: 0 });
    expect(await syncAll(db, null)).toEqual({ companies: 0, imported: 0, errors: 0 });

    // Une panne de la plateforme est notée, sans rien casser.
    p.client.listReceived = async () => {
      throw new B2BrouterError(503, "maintenance");
    };
    await db
      .update(einvoiceConnections)
      .set({ lastSyncAt: null })
      .where(eq(einvoiceConnections.id, c.id));
    expect(await syncIfStale(db, who.organizationId, p.client)).toMatchObject({
      error: "b2brouter_503",
    });
  });
});
