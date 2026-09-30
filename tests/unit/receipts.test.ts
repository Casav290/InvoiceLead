import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { parseCamt } from "@/countries/ch/camt";
import { createFirstFiscalYear, installChart } from "@/server/accounting";
import { attachLeadIdentity } from "@/server/auth/attach";
import { importEntries, proposeAll, validateTransaction } from "@/server/bank";
import {
  accounts,
  bankTransactions,
  journalLines,
  organizations,
  receipts,
} from "@/server/db/schema";
import { readReceipt, receiptFile, uploadReceipt } from "@/server/receipts";
import { camt053 } from "../support/camt";
import { claims } from "../support/claims";
import { testDb } from "../support/db";
import { samplePdf } from "../support/pdf";

const t = testDb();
const db = t.database;
beforeAll(() => {
  Object.assign(process.env, {
    DATABASE_URL: process.env.TEST_DATABASE_URL,
    APP_URL: "https://invoicelead.io",
    SESSION_SECRET: "unit-secret-unit-secret-unit-secret-unit",
    LEAD_ID_ISSUER: "https://crmlead.io",
    LEAD_ID_CLIENT_ID: "invoicelead",
    LEAD_ID_CLIENT_SECRET: "x",
    LEAD_ID_REDIRECT_URI: "https://invoicelead.io/auth/lead/callback",
    LEAD_ID_APP: "invoicelead",
    AI_API_KEY: "test",
    AI_BASE_URL: "https://ai.test/v4",
  });
});
beforeEach(() => t.reset());
afterEach(() => vi.unstubAllGlobals());
afterAll(() => t.close());

function aiAnswer(json: object) {
  return new Response(
    JSON.stringify({ choices: [{ message: { content: `Voici : ${JSON.stringify(json)}` } }] }),
  );
}

describe("justificatifs", () => {
  it("se lisent, se rattachent au paiement et deviennent la pièce de l'écriture", async () => {
    const a = await attachLeadIdentity(db, claims());
    const who = { organizationId: a.organization.id, userId: a.user.id };
    await db
      .update(organizations)
      .set({ vatRegistered: true, vatMethod: "effective" })
      .where(eq(organizations.id, a.organization.id));
    await installChart(db, who, "sole_proprietorship");
    await createFirstFiscalYear(db, who, { start: "2026-01-01", extended: false });

    const pdf = await samplePdf([
      "Swisscom (Schweiz) AG",
      "Rechnung 55-1234 vom 01.03.2026",
      "Internet Abo März",
      "Total CHF 107.70 inkl. MWST 8.1 % CHF 8.07",
    ]);
    expect(
      await uploadReceipt(db, who, {
        name: "note.txt",
        type: "text/plain",
        bytes: Buffer.from("x"),
      }),
    ).toBe("type");
    const receipt = await uploadReceipt(db, who, {
      name: "swisscom.pdf",
      type: "application/pdf",
      bytes: pdf,
    });
    if (typeof receipt !== "object") throw new Error(receipt);
    expect(
      await uploadReceipt(db, who, { name: "copie.pdf", type: "application/pdf", bytes: pdf }),
    ).toBe("duplicate");

    await importEntries(
      db,
      who,
      parseCamt(
        camt053("CH9300762011623852957", [
          {
            id: "S1",
            date: "2026-03-20",
            amount: "107.70",
            credit: false,
            party: "Swisscom (Schweiz) AG",
            text: "LSV",
          },
          {
            id: "S2",
            date: "2026-03-21",
            amount: "99.00",
            credit: false,
            party: "Autre",
            text: "?",
          },
        ]),
      ).entries,
    );
    await proposeAll(db, who, { language: "fr", useAi: false });

    const fetchMock = vi.fn(async (_url: string, init: { body: string }) => {
      const body = JSON.parse(init.body);
      expect(body.model).toBe("glm-4.6");
      expect(body.messages[1].content).toContain("Total CHF 107.70");
      return aiAnswer({
        supplier: "Swisscom (Schweiz) AG",
        date: "2026-03-01",
        total: "107.70",
        currency: "CHF",
        vat: "8.07",
        vat_code: "normal",
        invoice_number: "55-1234",
        description: "Abonnement internet",
        account: "6510",
        confidence: 0.93,
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    expect(await readReceipt(db, who, receipt.id, "fr")).toBe("read");

    const [linked] = await db.select().from(receipts).where(eq(receipts.id, receipt.id));
    expect(linked).toMatchObject({
      status: "matched",
      extraction: { totalCents: 10_770, vatCents: 807, accountNumber: "6510" },
    });
    const [tx] = await db
      .select()
      .from(bankTransactions)
      .where(eq(bankTransactions.id, linked?.bankTransactionId ?? ""));
    expect(tx?.proposal).toMatchObject({
      kind: "account",
      vatCode: "normal",
      source: "receipt",
      confidence: 0.97,
    });
    expect(tx?.proposal?.explanation).toContain("facture 55-1234");

    expect(await validateTransaction(db, who, tx?.id ?? "")).toBe("posted");
    const [posted] = await db.select().from(receipts).where(eq(receipts.id, receipt.id));
    expect(posted?.status).toBe("posted");
    const lines = await db
      .select({ n: accounts.number, d: journalLines.debitCents, c: journalLines.creditCents })
      .from(journalLines)
      .innerJoin(accounts, eq(accounts.id, journalLines.accountId))
      .where(eq(journalLines.entryId, posted?.journalEntryId ?? ""))
      .orderBy(journalLines.position);
    expect(lines).toEqual([
      { n: "1020", d: 0, c: 10_770 },
      { n: "6510", d: 9963, c: 0 },
      { n: "1171", d: 807, c: 0 },
    ]);

    // Le fichier reste lisible par son organisation, et par elle seule.
    expect((await receiptFile(db, who.organizationId, receipt.id))?.bytes.equals(pdf)).toBe(true);
    const b = await attachLeadIdentity(
      db,
      claims({ sub: "sub-b", email: "b@autre.test", org: "org-b" }),
    );
    expect(await receiptFile(db, b.organization.id, receipt.id)).toBeNull();
  });

  it("refuse un PDF scanné et lit une photo par le modèle de vision", async () => {
    const a = await attachLeadIdentity(db, claims());
    const who = { organizationId: a.organization.id, userId: a.user.id };
    const scanned = await uploadReceipt(db, who, {
      name: "scan.pdf",
      type: "application/pdf",
      bytes: await samplePdf([]),
    });
    if (typeof scanned !== "object") throw new Error(scanned);
    const fetchMock = vi.fn(async (_url: string, init: { body: string }) => {
      const body = JSON.parse(init.body);
      expect(body.model).toBe("glm-4.5v");
      expect(body.response_format).toBeUndefined();
      expect(body.messages[1].content[1].image_url.url).toMatch(/^data:image\/png;base64,/);
      return aiAnswer({
        supplier: "Migros",
        date: "2026-02-30",
        total: "12,40",
        vat: null,
        confidence: 2,
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    expect(await readReceipt(db, who, scanned.id, "de")).toBe("unreadable");
    expect(fetchMock).not.toHaveBeenCalled();

    const photo = await uploadReceipt(db, who, {
      name: "ticket.png",
      type: "image/png",
      bytes: Buffer.from("89504e470d0a1a0a0000000d4948445200000001", "hex"),
    });
    if (typeof photo !== "object") throw new Error(photo);
    expect(await readReceipt(db, who, photo.id, "de")).toBe("read");
    const [row] = await db.select().from(receipts).where(eq(receipts.id, photo.id));
    // Date impossible écartée, montant « 12,40 » lu, certitude ramenée à 1.
    expect(row?.extraction).toMatchObject({
      supplier: "Migros",
      date: null,
      totalCents: 1240,
      vatCents: null,
      confidence: 1,
    });
  });
});
