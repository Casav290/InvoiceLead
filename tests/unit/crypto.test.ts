import { describe, expect, it } from "vitest";
import { randomToken, sha256Hex, sign, unsign } from "@/server/auth/crypto";
import {
  describeLoginError,
  localeFromRequest,
  openLogin,
  pickLocale,
  sealLogin,
} from "@/server/auth/login-cookie";

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
      Buffer.from(JSON.stringify({ ...saved, locale: "it" })).toString("base64url"),
      SECRET,
    );
    expect(openLogin(forged, SECRET)).toBeNull();
  });

  it("ramène toute langue inconnue à l'allemand", () => {
    expect(pickLocale("fr")).toBe("fr");
    expect(pickLocale("it")).toBe("de");
    expect(pickLocale("en")).toBe("en");
    expect(pickLocale(null)).toBe("de");
  });
});

describe("langue d'une requête sans demande en cours", () => {
  it("préfère le cookie de langue, puis Accept-Language, sinon l'allemand", () => {
    expect(localeFromRequest("fr", "de-CH")).toBe("fr");
    expect(localeFromRequest(undefined, "fr-CH,fr;q=0.9,de;q=0.8")).toBe("fr");
    expect(localeFromRequest(undefined, "it-CH,de;q=0.5,fr;q=0.7")).toBe("fr");
    expect(localeFromRequest(undefined, "en-US")).toBe("en");
    expect(localeFromRequest(undefined, "it-IT")).toBe("de");
    expect(localeFromRequest("it", null)).toBe("de");
    expect(localeFromRequest(undefined, "fr;q=0")).toBe("de");
  });
});

describe("journal des erreurs de connexion", () => {
  it("garde les messages du kit Lead", () => {
    expect(describeLoginError(new Error("lead_id:state_mismatch"))).toBe("lead_id:state_mismatch");
  });

  it("ne recopie jamais le message d'une erreur de base (paramètres, jetons)", () => {
    const error = Object.assign(
      new Error("Failed query: insert ... params: ada@x.test,eyJhbGciOi..."),
      {
        name: "DrizzleQueryError",
        cause: { code: "23505", constraint: "users_email_unlinked_idx" },
      },
    );
    const logged = describeLoginError(error);
    expect(logged).toBe("DrizzleQueryError 23505 users_email_unlinked_idx");
    expect(logged).not.toContain("ada@");
    expect(describeLoginError("chaîne")).toBe("error");
  });
});
