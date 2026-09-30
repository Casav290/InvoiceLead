import { z } from "zod";
import { sign, unsign } from "./crypto";

const saved = z.object({
  state: z.string().min(1),
  nonce: z.string().min(1),
  verifier: z.string().min(1),
  locale: z.enum(["de", "fr"]),
});

export type SavedLogin = z.infer<typeof saved>;

/** Ce qu'il faut garder entre le départ vers le Compte Lead et le retour : signé, jamais lisible côté navigateur. */
export function sealLogin(value: SavedLogin, secret: string): string {
  return sign(Buffer.from(JSON.stringify(value)).toString("base64url"), secret);
}

export function openLogin(cookie: string | undefined, secret: string): SavedLogin | null {
  if (!cookie) return null;
  const value = unsign(cookie, secret);
  if (!value) return null;
  try {
    const parsed = saved.safeParse(JSON.parse(Buffer.from(value, "base64url").toString("utf8")));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function pickLocale(value: unknown): "de" | "fr" {
  return value === "fr" ? "fr" : "de";
}
