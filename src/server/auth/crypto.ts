import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/** Clé dérivée du secret de l'application pour un usage donné. */
function derive(secret: string, purpose: string): Buffer {
  return createHash("sha256").update(`invoicelead:${purpose}:${secret}`).digest();
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** `valeur.signature` : la valeur reste lisible, toute modification est détectée. */
export function sign(value: string, secret: string): string {
  const mac = createHmac("sha256", derive(secret, "sign")).update(value).digest("base64url");
  return `${value}.${mac}`;
}

export function unsign(signed: string, secret: string): string | null {
  const dot = signed.lastIndexOf(".");
  if (dot <= 0) return null;
  const value = signed.slice(0, dot);
  const expected = Buffer.from(sign(value, secret).slice(dot + 1));
  const given = Buffer.from(signed.slice(dot + 1));
  return expected.length === given.length && timingSafeEqual(expected, given) ? value : null;
}
