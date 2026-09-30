/**
 * Références de paiement de la QR-facture suisse (SIX, IG QR-facture) :
 * - QRR, 27 chiffres avec clé modulo 10 récursif, obligatoire avec un QR-IBAN ;
 * - SCOR (ISO 11649), « RF » + clé modulo 97, utilisable avec un IBAN ordinaire.
 * Les deux sont tirées du numéro de facture, unique chez l'émetteur, pour le lettrage des paiements.
 */

const TABLE = [0, 9, 4, 6, 8, 2, 7, 1, 3, 5];

/** Clé de contrôle modulo 10 récursif sur une suite de chiffres. */
export function mod10Recursive(digits: string): number {
  let carry = 0;
  for (const ch of digits) carry = TABLE[(carry + Number(ch)) % 10] ?? 0;
  return (10 - carry) % 10;
}

/** « 2026-0042 » → référence QRR de 27 chiffres. */
export function qrReference(invoiceNumber: string): string {
  const digits = invoiceNumber.replace(/\D/g, "");
  if (digits.length === 0 || digits.length > 26) throw new Error("numéro inutilisable");
  const payload = digits.padStart(26, "0");
  return `${payload}${mod10Recursive(payload)}`;
}

export function isValidQrReference(reference: string): boolean {
  const r = reference.replace(/\s/g, "");
  return /^\d{27}$/.test(r) && mod10Recursive(r.slice(0, 26)) === Number(r[26]);
}

function mod97(numeric: string): number {
  let remainder = 0;
  for (const ch of numeric) remainder = (remainder * 10 + Number(ch)) % 97;
  return remainder;
}

const toNumeric = (s: string) => s.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));

/** « 2026-0042 » → « RF…20260042 » (ISO 11649). */
export function scorReference(invoiceNumber: string): string {
  const body = invoiceNumber.toUpperCase().replace(/[^0-9A-Z]/g, "");
  if (body.length === 0 || body.length > 21) throw new Error("numéro inutilisable");
  const check = 98 - mod97(toNumeric(`${body}RF00`));
  return `RF${String(check).padStart(2, "0")}${body}`;
}

export function isValidScorReference(reference: string): boolean {
  const r = reference.replace(/\s/g, "").toUpperCase();
  if (!/^RF\d{2}[0-9A-Z]{1,21}$/.test(r)) return false;
  return mod97(toNumeric(`${r.slice(4)}${r.slice(0, 4)}`)) === 1;
}

/** Référence adaptée au compte : QRR pour un QR-IBAN, SCOR sinon. */
export function paymentReference(invoiceNumber: string, withQrIban: boolean): string {
  return withQrIban ? qrReference(invoiceNumber) : scorReference(invoiceNumber);
}

/** Affichage par blocs : « 00 00000 … » pour QRR, « RF18 5390 … » pour SCOR. */
export function formatReference(reference: string): string {
  if (/^\d{27}$/.test(reference)) {
    return `${reference.slice(0, 2)} ${reference
      .slice(2)
      .replace(/(\d{5})/g, "$1 ")
      .trim()}`;
  }
  return reference.replace(/(.{4})/g, "$1 ").trim();
}
