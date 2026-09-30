/** Relevé camt.053 minimal, au format des banques suisses, pour les tests. */
export type SampleEntry = {
  date: string;
  amount: string;
  credit: boolean;
  party?: string;
  reference?: string;
  text?: string;
  id: string;
};

export function camt053(iban: string, entries: SampleEntry[], batch?: SampleEntry[]): string {
  const tx = (e: SampleEntry, withAmount: boolean) => `
        <TxDtls>
          <Refs><AcctSvcrRef>${e.id}</AcctSvcrRef></Refs>
          ${withAmount ? `<Amt Ccy="CHF">${e.amount}</Amt>` : ""}
          <RltdPties>${
            e.credit
              ? `<Dbtr><Nm>${e.party ?? ""}</Nm></Dbtr>`
              : `<Cdtr><Nm>${e.party ?? ""}</Nm></Cdtr>`
          }</RltdPties>
          <RmtInf>${
            e.reference
              ? `<Strd><CdtrRefInf><Tp><CdOrPrtry><Prtry>QRR</Prtry></CdOrPrtry></Tp><Ref>${e.reference}</Ref></CdtrRefInf></Strd>`
              : `<Ustrd>${e.text ?? ""}</Ustrd>`
          }</RmtInf>
        </TxDtls>`;
  const ntry = (e: SampleEntry) => `
      <Ntry>
        <Amt Ccy="CHF">${e.amount}</Amt>
        <CdtDbtInd>${e.credit ? "CRDT" : "DBIT"}</CdtDbtInd>
        <Sts><Cd>BOOK</Cd></Sts>
        <BookgDt><Dt>${e.date}</Dt></BookgDt>
        <ValDt><Dt>${e.date}</Dt></ValDt>
        <NtryDtls>${tx(e, false)}
        </NtryDtls>
      </Ntry>`;
  const batchEntry = batch
    ? `
      <Ntry>
        <Amt Ccy="CHF">${batch.reduce((s, e) => s + Number(e.amount), 0).toFixed(2)}</Amt>
        <CdtDbtInd>CRDT</CdtDbtInd>
        <Sts><Cd>BOOK</Cd></Sts>
        <BookgDt><Dt>${batch[0]?.date}</Dt></BookgDt>
        <NtryDtls>${batch.map((e) => tx(e, true)).join("")}
        </NtryDtls>
      </Ntry>`
    : "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.08">
  <BkToCstmrStmt>
    <GrpHdr><MsgId>TEST</MsgId><CreDtTm>2026-09-30T10:00:00</CreDtTm></GrpHdr>
    <Stmt>
      <Id>1</Id>
      <Acct><Id><IBAN>${iban}</IBAN></Id><Ccy>CHF</Ccy></Acct>${entries.map(ntry).join("")}${batchEntry}
    </Stmt>
  </BkToCstmrStmt>
</Document>`;
}
