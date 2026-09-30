/**
 * Lecture des relevés bancaires ISO 20022 camt.053 (et camt.054), le format que toutes les banques
 * suisses fournissent en e-banking. On ne garde que ce qu'il faut pour comptabiliser : date, montant
 * signé, contrepartie, référence (QRR ou SCOR) et communication.
 */

import { createHash } from "node:crypto";
import { XMLParser } from "fast-xml-parser";

export type BankEntry = {
  externalId: string;
  bookingDate: string;
  amountCents: number; // positif : entrée d'argent ; négatif : sortie
  currency: string;
  counterparty: string | null;
  reference: string | null;
  text: string | null;
};

export type BankStatement = { iban: string | null; currency: string | null; entries: BankEntry[] };

type Node = Record<string, unknown>;
const list = <T>(v: T | T[] | undefined): T[] =>
  v === undefined ? [] : Array.isArray(v) ? v : [v];
const obj = (v: unknown): Node => (v && typeof v === "object" ? (v as Node) : {});
const str = (v: unknown): string | null => {
  if (v === undefined || v === null) return null;
  if (typeof v === "object") return str((v as Node)["#text"]);
  const s = String(v).trim();
  return s === "" ? null : s;
};
const path = (v: unknown, ...keys: string[]): unknown =>
  keys.reduce<unknown>((acc, k) => obj(acc)[k], v);

function cents(amount: unknown): number {
  const s = str(amount) ?? "0";
  if (!/^\d+(\.\d{1,2})?$/.test(s)) throw new Error(`montant illisible : ${s}`);
  const [u = "0", d = ""] = s.split(".");
  return Number(u) * 100 + Number(d.padEnd(2, "0"));
}

export function parseCamt(xml: string): BankStatement {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@",
    removeNSPrefix: true,
    parseTagValue: false,
    processEntities: true,
  });
  const doc = obj(parser.parse(xml)).Document;
  const root = obj(obj(doc).BkToCstmrStmt ?? obj(doc).BkToCstmrDbtCdtNtfctn);
  const statements = list(root.Stmt ?? root.Ntfctn);
  if (statements.length === 0) throw new Error("pas un relevé camt.053 ou camt.054");
  let iban: string | null = null;
  let currency: string | null = null;
  const entries: BankEntry[] = [];
  for (const stmt of statements) {
    iban ??= str(path(stmt, "Acct", "Id", "IBAN"));
    currency ??= str(path(stmt, "Acct", "Ccy"));
    for (const ntry of list(obj(stmt).Ntry)) {
      const n = obj(ntry);
      if (str(path(n, "Sts", "Cd")) === "PDNG" || str(n.Sts) === "PDNG") continue;
      const sign = str(n.CdtDbtInd) === "DBIT" ? -1 : 1;
      const bookingDate = (
        str(path(n, "BookgDt", "Dt")) ??
        str(path(n, "BookgDt", "DtTm")) ??
        ""
      ).slice(0, 10);
      const entryCcy = str(obj(n.Amt)["@Ccy"]) ?? currency ?? "CHF";
      const details = list(path(n, "NtryDtls") as unknown).flatMap((d) => list(obj(d).TxDtls));
      // Une écriture groupée (plusieurs paiements QR crédités ensemble) se décompose en ses transactions.
      const parts = details.length > 1 ? details : [details[0]];
      parts.forEach((tx, i) => {
        const t = obj(tx);
        const amount =
          details.length > 1 ? (path(t, "Amt") ?? path(t, "AmtDtls", "TxAmt", "Amt")) : n.Amt;
        const party =
          sign > 0
            ? (str(path(t, "RltdPties", "Dbtr", "Nm")) ??
              str(path(t, "RltdPties", "Dbtr", "Pty", "Nm")))
            : (str(path(t, "RltdPties", "Cdtr", "Nm")) ??
              str(path(t, "RltdPties", "Cdtr", "Pty", "Nm")));
        const reference = str(path(t, "RmtInf", "Strd", "CdtrRefInf", "Ref"));
        const ustrd = list(path(t, "RmtInf", "Ustrd") as unknown)
          .map(str)
          .filter(Boolean)
          .join(" ");
        const text =
          [ustrd, str(n.AddtlNtryInf), str(t.AddtlTxInf)].filter(Boolean).join(" · ") || null;
        const amountCents = sign * cents(amount);
        const bankRef =
          str(path(t, "Refs", "AcctSvcrRef")) ??
          str(n.AcctSvcrRef) ??
          str(path(t, "Refs", "EndToEndId"));
        const externalId = createHash("sha256")
          .update(JSON.stringify([bankRef, bookingDate, amountCents, reference, text, i]))
          .digest("hex")
          .slice(0, 32);
        entries.push({
          externalId,
          bookingDate,
          amountCents,
          currency: entryCcy,
          counterparty: party,
          reference: reference?.replace(/\s/g, "") ?? null,
          text,
        });
      });
    }
  }
  return { iban, currency, entries };
}
