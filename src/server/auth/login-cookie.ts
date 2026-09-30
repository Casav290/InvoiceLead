import { z } from "zod";
import { sign, unsign } from "./crypto";

/** Jeton d'invitation : base64url de 32 octets. */
export const INVITE_TOKEN = /^[A-Za-z0-9_-]{20,100}$/;

const saved = z.object({
  state: z.string().min(1),
  nonce: z.string().min(1),
  verifier: z.string().min(1),
  locale: z.enum(["de", "fr", "en"]),
  /** Jeton d'invitation de fiduciaire à reprendre après la connexion. */
  invite: z.string().regex(INVITE_TOKEN).optional(),
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

export function pickLocale(value: unknown): "de" | "fr" | "en" {
  return value === "fr" || value === "en" ? value : "de";
}

/**
 * Langue d'une requête sans demande de connexion en cours : cookie de langue de next-intl d'abord,
 * puis la première langue connue de l'en-tête Accept-Language, sinon l'allemand.
 */
export function localeFromRequest(
  nextLocaleCookie: string | undefined,
  acceptLanguage: string | null,
) {
  if (nextLocaleCookie === "de" || nextLocaleCookie === "fr" || nextLocaleCookie === "en")
    return nextLocaleCookie;
  const ranked = (acceptLanguage ?? "")
    .split(",")
    .map((part) => {
      const [tag = "", ...params] = part.trim().split(";");
      const q = Number(params.find((p) => p.trim().startsWith("q="))?.split("=")[1] ?? 1);
      return { lang: tag.slice(0, 2).toLowerCase(), q: Number.isFinite(q) ? q : 0 };
    })
    .sort((a, b) => b.q - a.q);
  const found = ranked.find((r) => r.q > 0 && ["de", "fr", "en"].includes(r.lang));
  return found ? pickLocale(found.lang) : "de";
}

/** Ce qu'on peut journaliser d'une erreur de connexion, sans données personnelles ni jeton. */
export function describeLoginError(error: unknown): string {
  if (error instanceof Error && error.message.startsWith("lead_id:")) return error.message;
  const cause = (error as { cause?: { code?: unknown; constraint?: unknown } } | null)?.cause;
  return [
    error instanceof Error ? error.name : "error",
    typeof cause?.code === "string" ? cause.code : null,
    typeof cause?.constraint === "string" ? cause.constraint : null,
  ]
    .filter(Boolean)
    .join(" ");
}
