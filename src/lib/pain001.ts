/**
 * Ordre de paiement ISO 20022 pain.001.001.09 : le fichier que l'e-banking suisse (Swiss Payment
 * Standards 2022) ou européen (SEPA) charge pour payer les factures fournisseurs en un lot.
 */
export type Pain001Payment = {
  id: string;
  amountCents: number;
  currency: string;
  executionDate: string;
  creditorName: string;
  creditorStreet: string | null;
  creditorPostalCode: string | null;
  creditorTown: string | null;
  creditorCountry: string | null;
  iban: string;
  bic: string | null;
  /** Référence QR (27 chiffres), référence RF ou communication libre. */
  reference: string | null;
  message: string | null;
};

export type Pain001Input = {
  messageId: string;
  createdAt: Date;
  debtorName: string;
  debtorIban: string;
  debtorCountry: string;
  payments: Pain001Payment[];
};

const esc = (v: string) =>
  v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
/** Jeu de caractères admis par les banques (latin de base et lettres accentuées courantes). */
const clean = (v: string, max: number) =>
  esc(
    v
      .normalize("NFC")
      .replace(/[^\p{L}\p{N} .,:'+\-/()?&]/gu, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, max),
  );
const amount = (cents: number) => (cents / 100).toFixed(2);
const compact = (v: string) => v.replace(/\s/g, "").toUpperCase();

/** Référence QR suisse : 27 chiffres. Référence structurée internationale : « RF » et 2 chiffres. */
export function referenceKind(ref: string | null): "QRR" | "SCOR" | null {
  if (!ref) return null;
  const r = compact(ref);
  if (/^\d{27}$/.test(r)) return "QRR";
  if (/^RF\d{2}[0-9A-Z]{1,21}$/.test(r)) return "SCOR";
  return null;
}

function address(p: {
  street: string | null;
  postalCode: string | null;
  town: string | null;
  country: string | null;
}) {
  if (!p.town || !p.country) return "";
  return `<PstlAdr>${p.street ? `<StrtNm>${clean(p.street, 70)}</StrtNm>` : ""}${
    p.postalCode ? `<PstCd>${clean(p.postalCode, 16)}</PstCd>` : ""
  }<TwnNm>${clean(p.town, 35)}</TwnNm><Ctry>${p.country.toUpperCase()}</Ctry></PstlAdr>`;
}

function remittance(p: Pain001Payment) {
  const kind = referenceKind(p.reference);
  if (kind && p.reference) {
    const tp =
      kind === "QRR"
        ? "<Tp><CdOrPrtry><Prtry>QRR</Prtry></CdOrPrtry></Tp>"
        : "<Tp><CdOrPrtry><Cd>SCOR</Cd></CdOrPrtry></Tp>";
    return `<RmtInf><Strd><CdtrRefInf>${tp}<Ref>${compact(p.reference)}</Ref></CdtrRefInf></Strd></RmtInf>`;
  }
  const text = p.message ?? p.reference;
  return text ? `<RmtInf><Ustrd>${clean(text, 140)}</Ustrd></RmtInf>` : "";
}

/** Rend le fichier pain.001 ; un lot par date d'exécution et par devise. */
export function buildPain001(input: Pain001Input): string {
  const groups = new Map<string, Pain001Payment[]>();
  for (const p of input.payments) {
    const key = `${p.executionDate}|${p.currency}`;
    groups.set(key, [...(groups.get(key) ?? []), p]);
  }
  const total = input.payments.reduce((s, p) => s + p.amountCents, 0);
  const created = input.createdAt.toISOString().replace(/\.\d{3}Z$/, "");
  const sepaCountries = input.debtorCountry !== "CH";
  let n = 0;
  const batches = [...groups.entries()]
    .map(([key, list]) => {
      n += 1;
      const [date, currency] = key.split("|");
      const sum = list.reduce((s, p) => s + p.amountCents, 0);
      // Virement SEPA : en euros, depuis un compte de la zone SEPA hors Suisse.
      const sepa = sepaCountries && currency === "EUR";
      const txs = list
        .map(
          (p) =>
            `<CdtTrfTxInf><PmtId><InstrId>${clean(p.id, 35)}</InstrId><EndToEndId>${clean(p.id, 35)}</EndToEndId></PmtId><Amt><InstdAmt Ccy="${p.currency}">${amount(p.amountCents)}</InstdAmt></Amt>${
              p.bic
                ? `<CdtrAgt><FinInstnId><BICFI>${compact(p.bic)}</BICFI></FinInstnId></CdtrAgt>`
                : ""
            }<Cdtr><Nm>${clean(p.creditorName, 70)}</Nm>${address({
              street: p.creditorStreet,
              postalCode: p.creditorPostalCode,
              town: p.creditorTown,
              country: p.creditorCountry,
            })}</Cdtr><CdtrAcct><Id><IBAN>${compact(p.iban)}</IBAN></Id></CdtrAcct>${remittance(p)}</CdtTrfTxInf>`,
        )
        .join("");
      return `<PmtInf><PmtInfId>${clean(`${input.messageId}-${n}`, 35)}</PmtInfId><PmtMtd>TRF</PmtMtd><BtchBookg>true</BtchBookg><NbOfTxs>${list.length}</NbOfTxs><CtrlSum>${amount(sum)}</CtrlSum>${
        sepa ? "<PmtTpInf><SvcLvl><Cd>SEPA</Cd></SvcLvl></PmtTpInf>" : ""
      }<ReqdExctnDt><Dt>${date}</Dt></ReqdExctnDt><Dbtr><Nm>${clean(input.debtorName, 70)}</Nm></Dbtr><DbtrAcct><Id><IBAN>${compact(input.debtorIban)}</IBAN></Id></DbtrAcct><DbtrAgt><FinInstnId><Othr><Id>NOTPROVIDED</Id></Othr></FinInstnId></DbtrAgt>${
        sepa ? "<ChrgBr>SLEV</ChrgBr>" : ""
      }${txs}</PmtInf>`;
    })
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.001.001.09"><CstmrCdtTrfInitn><GrpHdr><MsgId>${clean(input.messageId, 35)}</MsgId><CreDtTm>${created}</CreDtTm><NbOfTxs>${input.payments.length}</NbOfTxs><CtrlSum>${amount(total)}</CtrlSum><InitgPty><Nm>${clean(input.debtorName, 70)}</Nm></InitgPty></GrpHdr>${batches}</CstmrCdtTrfInitn></Document>
`;
}
