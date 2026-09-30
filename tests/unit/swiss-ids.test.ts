import { describe, expect, it } from "vitest";
import {
  formatIban,
  formatUid,
  isQrIban,
  isValidSwissIban,
  isValidUid,
  normalizeUid,
  vatNumberLabel,
} from "@/lib/swiss-ids";

describe("numéro IDE", () => {
  it("accepte les formats usuels et vérifie la clé modulo 11", () => {
    expect(isValidUid("CHE-116.281.710")).toBe(true);
    expect(isValidUid("che116281710")).toBe(true);
    expect(isValidUid("CHE-116.281.710 MWST")).toBe(true);
    expect(isValidUid("CHE-116.281.711")).toBe(false);
    expect(isValidUid("CHE-123.456.789")).toBe(false); // clé 10 : numéro impossible
    expect(isValidUid("DE123456789")).toBe(false);
    expect(normalizeUid("CHE 116 281 710 TVA")).toBe("CHE116281710");
  });

  it("met en forme le numéro et la mention TVA selon la langue", () => {
    expect(formatUid("CHE116281710")).toBe("CHE-116.281.710");
    expect(vatNumberLabel("CHE116281710", "fr")).toBe("CHE-116.281.710 TVA");
    expect(vatNumberLabel("CHE116281710", "de")).toBe("CHE-116.281.710 MWST");
    expect(vatNumberLabel("CHE116281710", "it")).toBe("CHE-116.281.710 IVA");
  });
});

describe("IBAN", () => {
  it("vérifie la clé modulo 97 des IBAN suisses et liechtensteinois", () => {
    expect(isValidSwissIban("CH93 0076 2011 6238 5295 7")).toBe(true);
    expect(isValidSwissIban("CH93 0076 2011 6238 5295 8")).toBe(false);
    expect(isValidSwissIban("DE89370400440532013000")).toBe(false);
    expect(isValidSwissIban("CH93")).toBe(false);
  });

  it("reconnaît un QR-IBAN (institut 30000 à 31999)", () => {
    expect(isQrIban("CH44 3199 9123 0008 8901 2")).toBe(true);
    expect(isQrIban("CH93 0076 2011 6238 5295 7")).toBe(false);
    expect(formatIban("ch4431999123000889012")).toBe("CH44 3199 9123 0008 8901 2");
  });
});
