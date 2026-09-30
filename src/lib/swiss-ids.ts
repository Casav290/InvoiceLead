/**
 * Identifiants suisses : numéro IDE/UID (CHE-123.456.789) et IBAN (CH/LI, QR-IBAN compris).
 * Fonctions pures, utilisées côté serveur pour valider et côté interface pour aider la saisie.
 */

/** « CHE-123.456.789 », « che123456789 » ou « CHE-123.456.789 MWST » → « CHE123456789 », sinon null. */
export function normalizeUid(input: string): string | null {
  const compact = input
    .toUpperCase()
    .replace(/\b(MWST|TVA|IVA|VAT)\b/g, "")
    .replace(/[\s.-]/g, "");
  return /^CHE\d{9}$/.test(compact) ? compact : null;
}

/** Clé de contrôle modulo 11 du numéro IDE (poids 5, 4, 3, 2, 7, 6, 5, 4). */
export function isValidUid(input: string): boolean {
  const uid = normalizeUid(input);
  if (!uid) return false;
  const digits = uid.slice(3).split("").map(Number);
  const weights = [5, 4, 3, 2, 7, 6, 5, 4];
  const sum = weights.reduce((acc, w, i) => acc + w * (digits[i] ?? 0), 0);
  const check = 11 - (sum % 11);
  if (check === 10) return false;
  return (check === 11 ? 0 : check) === digits[8];
}

/** « CHE123456789 » → « CHE-123.456.789 ». */
export function formatUid(uid: string): string {
  const n = normalizeUid(uid);
  if (!n) return uid;
  return `CHE-${n.slice(3, 6)}.${n.slice(6, 9)}.${n.slice(9, 12)}`;
}

/** Mention TVA selon la langue du document (art. 26 LTVA) : « CHE-123.456.789 MWST / TVA / IVA ». */
export function vatNumberLabel(uid: string, locale: string): string {
  // Allemagne : USt-IdNr. « DE123456789 », même libellé en allemand et en français.
  if (uid.startsWith("DE")) return `USt-IdNr. ${uid}`;
  // Royaume-Uni : VAT registration number.
  if (uid.startsWith("GB")) return `VAT No. ${uid}`;
  // France : numéro de TVA intracommunautaire.
  if (uid.startsWith("FR")) return `${locale.startsWith("fr") ? "N° TVA" : "USt-IdNr."} ${uid}`;
  const suffix = locale.startsWith("fr") ? "TVA" : locale.startsWith("it") ? "IVA" : "MWST";
  return `${formatUid(uid)} ${suffix}`;
}

export function normalizeIban(input: string): string {
  return input.toUpperCase().replace(/\s+/g, "");
}

/** IBAN suisse ou liechtensteinois (21 caractères) avec clé modulo 97 valide. */
export function isValidSwissIban(input: string): boolean {
  const iban = normalizeIban(input);
  if (!/^(CH|LI)\d{7}[A-Z0-9]{12}$/.test(iban)) return false;
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  const numeric = rearranged.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let remainder = 0;
  for (const ch of numeric) remainder = (remainder * 10 + Number(ch)) % 97;
  return remainder === 1;
}

/** Libellé du numéro d'entreprise imprimé sur la facture, selon le pays de l'émetteur. */
export function taxNumberLabel(country: string): string {
  return country === "FR" ? "SIRET" : country === "GB" ? "Company No." : "Steuernummer";
}

/** IBAN d'un pays SEPA (structure générale) avec clé modulo 97 valide. */
export function isValidSepaIban(input: string): boolean {
  const iban = normalizeIban(input);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) return false;
  if (iban.startsWith("DE") && iban.length !== 22) return false;
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  const numeric = rearranged.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let remainder = 0;
  for (const ch of numeric) remainder = (remainder * 10 + Number(ch)) % 97;
  return remainder === 1;
}

/** QR-IBAN : identifiant d'institution (positions 5 à 9) entre 30000 et 31999. Exige une référence QR. */
export function isQrIban(input: string): boolean {
  const iban = normalizeIban(input);
  if (!isValidSwissIban(iban)) return false;
  const iid = Number(iban.slice(4, 9));
  return iid >= 30000 && iid <= 31999;
}

/** « CH9300762011623852957 » → « CH93 0076 2011 6238 5295 7 ». */
export function formatIban(input: string): string {
  return normalizeIban(input)
    .replace(/(.{4})/g, "$1 ")
    .trim();
}
