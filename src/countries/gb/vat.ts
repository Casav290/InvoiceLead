import type { VatCode } from "../ch/vat";

/**
 * Taux de TVA britanniques (VAT Act 1994), datés par la prestation : 20 % standard, 5 % réduit.
 * « lodging » suit le taux standard (l'hôtellerie n'a plus de taux réduit depuis le 1.4.2022).
 * « exempt » couvre aussi le taux zéro (livres, alimentation) : les deux valent 0 % et entrent
 * pareillement dans la case 6 de la déclaration.
 */
const PERIODS: {
  from: string;
  to: string | null;
  normal: number;
  reduced: number;
  lodging: number;
}[] = [{ from: "2011-01-04", to: null, normal: 2000, reduced: 500, lodging: 2000 }];

export function vatRateBpGb(code: VatCode, serviceDate: string): number {
  if (code === "exempt" || code === "export") return 0;
  const p = PERIODS.find((r) => serviceDate >= r.from && (r.to === null || serviceDate <= r.to));
  if (!p) throw new Error(`No UK VAT rate known on ${serviceDate}`);
  return p[code];
}

const compact = (v: string) => v.replace(/[\s.-]/g, "").toUpperCase();

/**
 * Numéro de TVA britannique : GB + 9 chiffres, clé HMRC (somme pondérée 8 à 2 des 7 premiers
 * chiffres, plus les deux derniers, divisible par 97, ou par 97 après ajout de 55).
 */
export function isValidGbVatNumber(input: string): boolean {
  const v = compact(input);
  const m = /^GB(\d{9})(\d{3})?$/.exec(v);
  if (!m?.[1]) return false;
  const d = m[1].split("").map(Number);
  const weighted = [8, 7, 6, 5, 4, 3, 2].reduce((s, w, i) => s + w * (d[i] ?? 0), 0);
  const check = (d[7] ?? 0) * 10 + (d[8] ?? 0);
  const total = weighted + check;
  return total % 97 === 0 || (total + 55) % 97 === 0;
}

export const normalizeGbVatNumber = compact;

/** Numéro d'immatriculation Companies House : 8 caractères (chiffres, ou 2 lettres et 6 chiffres). */
export function isValidCompanyNumber(input: string): boolean {
  return /^([0-9]{8}|[A-Z]{2}[0-9]{6})$/.test(compact(input));
}

/** Code postal britannique (format général, sans vérifier l'existence). */
export function isValidUkPostcode(input: string): boolean {
  return /^[A-Z]{1,2}\d[A-Z\d]? ?\d[A-Z]{2}$/i.test(input.trim());
}
