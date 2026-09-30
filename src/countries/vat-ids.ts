import { isValidUid, normalizeUid } from "@/lib/swiss-ids";
import { isValidUstId } from "./de/vat";
import { isValidFrVatId } from "./fr/vat";
import { isValidGbVatNumber } from "./gb/vat";

/**
 * Numéro de TVA d'un client, quel que soit son pays : IDE suisse (CHE), numéros allemand, français
 * et britannique avec leur clé, autres pays de l'UE au format général (préfixe pays et 2 à 12
 * caractères). Rend le numéro normalisé, ou null s'il n'est pas valable.
 */
export function normalizeVatId(input: string): string | null {
  const v = input.replace(/[\s.-]/g, "").toUpperCase();
  if (v.startsWith("CHE")) {
    const uid = normalizeUid(input);
    return uid && isValidUid(uid) ? uid : null;
  }
  if (v.startsWith("DE")) return isValidUstId(v) ? v : null;
  if (v.startsWith("FR")) return isValidFrVatId(v) ? v : null;
  if (v.startsWith("GB")) return isValidGbVatNumber(v) ? v : null;
  return /^[A-Z]{2}[A-Z0-9]{2,12}$/.test(v) ? v : null;
}
