import type { VatCode } from "../ch/vat";

/**
 * Taux de TVA allemands (Umsatzsteuer, § 12 UStG), datés par la prestation. Baisse temporaire du
 * 1.7 au 31.12.2020. « lodging » (Beherbergung) suit le taux réduit ; « exempt » couvre § 4 UStG et
 * « export » les livraisons intracommunautaires et exportations (0 %).
 */
const PERIODS = [
  { from: "2007-01-01", to: "2020-06-30", normal: 1900, reduced: 700 },
  { from: "2020-07-01", to: "2020-12-31", normal: 1600, reduced: 500 },
  { from: "2021-01-01", to: null, normal: 1900, reduced: 700 },
];

export function vatRateBpDe(code: VatCode, serviceDate: string): number {
  if (code === "exempt" || code === "export") return 0;
  const p = PERIODS.find((r) => serviceDate >= r.from && (r.to === null || serviceDate <= r.to));
  if (!p) throw new Error(`Kein Umsatzsteuersatz bekannt am ${serviceDate}`);
  return code === "normal" ? p.normal : p.reduced;
}

/** USt-IdNr. : « DE » suivi de 9 chiffres, le dernier étant la clé (méthode 11,10 de l'ISO 7064). */
export function isValidUstId(input: string): boolean {
  const v = input.replace(/[\s.-]/g, "").toUpperCase();
  if (!/^DE\d{9}$/.test(v)) return false;
  const digits = v.slice(2).split("").map(Number);
  let product = 10;
  for (let i = 0; i < 8; i++) {
    let sum = ((digits[i] ?? 0) + product) % 10;
    if (sum === 0) sum = 10;
    product = (2 * sum) % 11;
  }
  const check = (11 - product) % 10;
  return check === digits[8];
}

export const normalizeUstId = (input: string) => input.replace(/[\s.-]/g, "").toUpperCase();
