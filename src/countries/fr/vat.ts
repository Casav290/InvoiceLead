import type { VatCode } from "../ch/vat";

/**
 * Taux de TVA français (art. 278 et suivants du CGI), datés par la prestation : 20 % normal, 10 %
 * intermédiaire (hébergement, restauration, travaux), 5,5 % réduit. Le taux particulier de 2,1 %
 * (presse, médicaments remboursables) n'a pas de code : à saisir en taux réduit ne conviendrait pas,
 * il viendra avec un code dédié si le besoin se présente.
 */
const PERIODS = [
  { from: "2012-01-01", to: "2013-12-31", normal: 1960, reduced: 550, lodging: 700 },
  { from: "2014-01-01", to: null, normal: 2000, reduced: 550, lodging: 1000 },
];

export function vatRateBpFr(code: VatCode, serviceDate: string): number {
  if (code === "exempt" || code === "export") return 0;
  const p = PERIODS.find((r) => serviceDate >= r.from && (r.to === null || serviceDate <= r.to));
  if (!p) throw new Error(`Aucun taux de TVA français connu au ${serviceDate}`);
  return p[code];
}

const digits = (v: string) => v.replace(/[\s.-]/g, "");

/** Clé de Luhn, utilisée par le SIREN (9 chiffres) et le SIRET (14 chiffres). */
function luhn(v: string): boolean {
  let sum = 0;
  for (let i = 0; i < v.length; i++) {
    let d = Number(v[v.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

/** SIREN (9 chiffres) ou SIRET (14 chiffres), clé de Luhn vérifiée. La Poste (356000000) fait exception. */
export function isValidSiret(input: string): boolean {
  const v = digits(input);
  if (!/^(\d{9}|\d{14})$/.test(v)) return false;
  if (v.startsWith("356000000")) return true;
  return luhn(v);
}

export const normalizeSiret = (input: string) => digits(input);

/** Numéro de TVA intracommunautaire : FR + clé à 2 chiffres + SIREN, clé = (12 + 3 × (SIREN mod 97)) mod 97. */
export function isValidFrVatId(input: string): boolean {
  const v = digits(input).toUpperCase();
  const m = /^FR(\d{2})(\d{9})$/.exec(v);
  if (!m) return false;
  const siren = Number(m[2]);
  return Number(m[1]) === (12 + 3 * (siren % 97)) % 97;
}

export const normalizeFrVatId = (input: string) => digits(input).toUpperCase();

/** Numéro de TVA déduit du SIREN. */
export function frVatIdFromSiren(siren: string): string {
  const n = Number(siren.slice(0, 9));
  return `FR${String((12 + 3 * (n % 97)) % 97).padStart(2, "0")}${siren.slice(0, 9)}`;
}
