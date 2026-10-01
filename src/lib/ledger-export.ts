/**
 * Exports du journal pour les fiduciaires : DATEV (Buchungsstapel, Allemagne) et FEC (fichier des
 * écritures comptables, France, art. A47 A-1 du LPF). Fonctions pures, à partir des écritures d'un
 * exercice.
 */

export type ExportLine = {
  accountNumber: string;
  accountName: string;
  debitCents: number;
  creditCents: number;
  /** Taux de la ligne, en points de base (1900 = 19 %). */
  vatRateBp: number | null;
  /** Ligne d'impôt (TVA due ou préalable) plutôt que ligne de base. */
  isVat: boolean;
};

export type ExportEntry = {
  number: number;
  entryDate: string;
  description: string;
  sourceType: string;
  /** Date d'enregistrement (validation), AAAA-MM-JJ. */
  recordedOn: string;
  lines: ExportLine[];
};

const cents = (v: number) => {
  const abs = Math.abs(v);
  return `${v < 0 ? "-" : ""}${Math.floor(abs / 100)},${String(abs % 100).padStart(2, "0")}`;
};
const compact = (date: string) => date.replaceAll("-", "");

// ---------------------------------------------------------------------------------------------
// DATEV

/** Clés BU : TVA due (2 = 7 %, 3 = 19 %) et impôt préalable (8 = 7 %, 9 = 19 %). */
const OUTPUT_KEY: Record<number, string> = { 700: "2", 1900: "3" };
const INPUT_KEY: Record<number, string> = { 700: "8", 1900: "9" };
/** Comptes automatiques du SKR04 : DATEV en tire la TVA sans clé. */
const AUTOMATIC: Record<string, number> = { "4400": 1900, "4300": 700 };

export type DatevRow = {
  amountCents: number;
  side: "S" | "H";
  account: string;
  counter: string;
  key: string;
  date: string;
  document: string;
  text: string;
};

type Work = { account: string; amount: number; rate: number | null; key: string };

/**
 * Lignes DATEV d'une écriture. La TVA rejoint le montant brut de sa ligne de base, avec la clé BU
 * du taux (sauf compte automatique) ; chaque autre ligne est ensuite passée contre la ligne
 * principale de l'écriture, ce qui garde le solde de chaque compte.
 */
export function datevRows(entry: ExportEntry): DatevRow[] {
  const work: Work[] = entry.lines
    .filter((l) => !l.isVat)
    .map((l) => ({
      account: l.accountNumber,
      amount: l.debitCents - l.creditCents,
      rate: l.vatRateBp,
      key: "",
    }));
  for (const v of entry.lines.filter((l) => l.isVat)) {
    const amount = v.debitCents - v.creditCents;
    const rate = v.vatRateBp ?? 0;
    const key = amount < 0 ? OUTPUT_KEY[rate] : INPUT_KEY[rate];
    const base = work
      .filter((w) => w.rate === rate && Math.sign(w.amount) === Math.sign(amount) && !w.key)
      .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))[0];
    if (!key || !base) {
      // Taux sans clé (ancien taux, autoliquidation) : la ligne de TVA reste à part.
      work.push({ account: v.accountNumber, amount, rate: null, key: "" });
      continue;
    }
    base.amount += amount;
    base.key = AUTOMATIC[base.account] === rate ? "-" : key;
  }
  const lines = work.filter((w) => w.amount !== 0);
  if (lines.length < 2) return [];
  // Ligne principale : le plus gros montant, de préférence sans clé (compte de tiers ou banque).
  const main = [...lines].sort(
    (a, b) => Math.abs(b.amount) - Math.abs(a.amount) || Number(!!a.key) - Number(!!b.key),
  )[0] as Work;
  const day = entry.entryDate.slice(8, 10) + entry.entryDate.slice(5, 7);
  const text = entry.description.slice(0, 60);
  return lines
    .filter((l) => l !== main)
    .map((l) => {
      const key = l.key === "-" ? "" : l.key;
      // La clé accompagne le Gegenkonto : la ligne qui la porte passe en contrepartie.
      if (key)
        return {
          amountCents: Math.abs(l.amount),
          side: l.amount < 0 ? "S" : "H",
          account: main.account,
          counter: l.account,
          key,
          date: day,
          document: String(entry.number),
          text,
        };
      return {
        amountCents: Math.abs(l.amount),
        side: l.amount > 0 ? "S" : "H",
        account: l.account,
        counter: main.account,
        key: main.key === "-" ? "" : main.key,
        date: day,
        document: String(entry.number),
        text,
      };
    });
}

const datevText = (s: string) =>
  `"${s
    .replaceAll("€", "EUR")
    .replace(/[–—]/g, "-")
    .replace(/[‘’]/g, "'")
    .replace(/[  ]/g, " ")
    .replace(/[\r\n;"]/g, " ")}"`;

export type DatevOptions = {
  consultant: number;
  client: number;
  fiscalYearStart: string;
  from: string;
  to: string;
  createdAt: Date;
  /** Plan comptable : « 04 » pour le SKR04. */
  chart?: string;
};

/** Buchungsstapel au format DATEV (EXTF 700, catégorie 21), en Windows-1252. */
export function buildDatev(entries: ExportEntry[], o: DatevOptions): Buffer {
  const stamp = o.createdAt
    .toISOString()
    .replace(/[-:T.Z]/g, "")
    .slice(0, 17);
  const header = [
    '"EXTF"',
    "700",
    "21",
    '"Buchungsstapel"',
    "13",
    stamp,
    "",
    '"RE"',
    '""',
    '""',
    String(o.consultant),
    String(o.client),
    compact(o.fiscalYearStart),
    "4",
    compact(o.from),
    compact(o.to),
    '"InvoiceLead"',
    '""',
    "1",
    "0",
    "0",
    '"EUR"',
    "",
    '""',
    "",
    "",
    `"${o.chart ?? "04"}"`,
    "",
    "",
    '""',
    '""',
  ].join(";");
  const columns = [
    "Umsatz (ohne Soll/Haben-Kz)",
    "Soll/Haben-Kennzeichen",
    "WKZ Umsatz",
    "Kurs",
    "Basis-Umsatz",
    "WKZ Basis-Umsatz",
    "Konto",
    "Gegenkonto (ohne BU-Schlüssel)",
    "BU-Schlüssel",
    "Belegdatum",
    "Belegfeld 1",
    "Belegfeld 2",
    "Skonto",
    "Buchungstext",
  ].join(";");
  const rows = entries
    .flatMap(datevRows)
    .map((r) =>
      [
        cents(r.amountCents),
        `"${r.side}"`,
        '"EUR"',
        "",
        "",
        '""',
        r.account,
        r.counter,
        `"${r.key}"`,
        r.date,
        datevText(r.document),
        '""',
        "",
        datevText(r.text),
      ].join(";"),
    );
  const text = [header, columns, ...rows].join("\r\n");
  // Windows-1252 : hors Latin-1, un caractère devient « ? ».
  const safe = Array.from(text, (c) => ((c.codePointAt(0) ?? 0) > 0xff ? "?" : c)).join("");
  return Buffer.from(safe, "latin1");
}

// ---------------------------------------------------------------------------------------------
// FEC

/** Journal d'une écriture selon son origine : ventes, achats, banque ou opérations diverses. */
export function fecJournal(sourceType: string): [string, string] {
  if (["invoice", "credit_note", "reminder", "reminder_waiver"].includes(sourceType))
    return ["VE", "Ventes"];
  if (sourceType === "bill") return ["AC", "Achats"];
  if (["payment", "payment_reversal", "bank", "bank_reversal", "bill_payment"].includes(sourceType))
    return ["BQ", "Banque"];
  if (sourceType === "opening") return ["AN", "A nouveaux"];
  return ["OD", "Opérations diverses"];
}

export const FEC_COLUMNS = [
  "JournalCode",
  "JournalLib",
  "EcritureNum",
  "EcritureDate",
  "CompteNum",
  "CompteLib",
  "CompAuxNum",
  "CompAuxLib",
  "PieceRef",
  "PieceDate",
  "EcritureLib",
  "Debit",
  "Credit",
  "EcritureLet",
  "DateLet",
  "ValidDate",
  "Montantdevise",
  "Idevise",
] as const;

const fecText = (s: string) => s.replace(/[|\r\n\t]/g, " ").trim();

/** Fichier des écritures comptables : dix-huit colonnes séparées par « | », une ligne par mouvement. */
export function buildFec(entries: ExportEntry[]): string {
  const sorted = [...entries].sort(
    (a, b) => a.entryDate.localeCompare(b.entryDate) || a.number - b.number,
  );
  const rows = sorted.flatMap((e) => {
    const [code, label] = fecJournal(e.sourceType);
    return e.lines.map((l) =>
      [
        code,
        label,
        String(e.number),
        compact(e.entryDate),
        l.accountNumber,
        fecText(l.accountName),
        "",
        "",
        String(e.number),
        compact(e.entryDate),
        fecText(e.description) || "-",
        cents(l.debitCents),
        cents(l.creditCents),
        "",
        "",
        compact(e.recordedOn),
        "",
        "",
      ].join("|"),
    );
  });
  return `${[FEC_COLUMNS.join("|"), ...rows].join("\r\n")}\r\n`;
}

/** Nom imposé : SIREN, « FEC », date de clôture de l'exercice. */
export function fecFilename(siren: string, closing: string): string {
  return `${siren}FEC${compact(closing)}.txt`;
}
