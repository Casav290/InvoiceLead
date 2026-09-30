import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

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

/** Chiffre une valeur à garder lisible par le serveur seul (AES-256-GCM, clé dérivée du secret). */
export function encrypt(value: string, secret: string, purpose: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", derive(secret, `encrypt:${purpose}`), iv);
  const data = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((b) => b.toString("base64url")).join(".");
}

export function decrypt(sealed: string, secret: string, purpose: string): string | null {
  const [iv, tag, data] = sealed.split(".").map((p) => Buffer.from(p, "base64url"));
  if (!iv || !tag || !data) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", derive(secret, `encrypt:${purpose}`), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}
