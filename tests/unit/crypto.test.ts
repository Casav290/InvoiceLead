import { describe, expect, it } from "vitest";
import { randomToken, sha256Hex, sign, unsign } from "@/server/auth/crypto";
import { openLogin, pickLocale, sealLogin } from "@/server/auth/login-cookie";

const SECRET = "s".repeat(40);

describe("signature", () => {
  it("rend la valeur quand la signature est intacte", () => {
    expect(unsign(sign("bonjour.le.monde", SECRET), SECRET)).toBe("bonjour.le.monde");
  });

  it("refuse une valeur modifiée, une signature modifiée ou un autre secret", () => {
    const signed = sign("valeur", SECRET);
    expect(unsign(signed.replace("valeur", "valeuR"), SECRET)).toBeNull();
    expect(unsign(`${signed}x`, SECRET)).toBeNull();
    expect(unsign(signed, "t".repeat(40))).toBeNull();
    expect(unsign("sans-point", SECRET)).toBeNull();
  });

  it("produit des jetons aléatoires et des empreintes stables", () => {
    expect(randomToken()).not.toBe(randomToken());
    expect(randomToken()).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});

describe("cookie de connexion", () => {
  const saved = { state: "st", nonce: "no", verifier: "ve", locale: "fr" as const };

  it("fait l'aller-retour", () => {
    expect(openLogin(sealLogin(saved, SECRET), SECRET)).toEqual(saved);
  });

  it("refuse un cookie absent, falsifié ou mal formé", () => {
    expect(openLogin(undefined, SECRET)).toBeNull();
    expect(openLogin(sealLogin(saved, SECRET), "x".repeat(40))).toBeNull();
    const forged = sign(
      Buffer.from(JSON.stringify({ ...saved, locale: "en" })).toString("base64url"),
      SECRET,
    );
    expect(openLogin(forged, SECRET)).toBeNull();
  });

  it("ramène toute langue inconnue à l'allemand", () => {
    expect(pickLocale("fr")).toBe("fr");
    expect(pickLocale("en")).toBe("de");
    expect(pickLocale(null)).toBe("de");
  });
});
