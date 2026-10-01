import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { LOGIN_COOKIE } from "@/lib/cookies";
import { sign, unsign } from "./crypto";

/** Jeton d'invitation : base64url de 32 octets. */
export const INVITE_TOKEN = /^[A-Za-z0-9_-]{20,100}$/;

/**
 * Page à rouvrir après la connexion : une adresse de l'application, sur ce site seulement
 * (« /fr/app/invoices/… »), avec sa recherche telle qu'un navigateur l'écrit. Un formulaire GET
 * laisse « * » tel quel (recherche « Müller* ») ; un lien collé dans la barre d'adresse garde aussi
 * « ! $ ' ( ) ; @ / ? | [ ] { } ^ ». Jamais d'espace, de « # », de « \ », de guillemet, de chevron ni
 * de caractère de contrôle ; « // » est refusé à part (safeNext). Rien d'autre n'est suivi.
 */
export const NEXT_PATH =
  /^\/(de|fr|en)\/app(\/[A-Za-z0-9_\-/]*)?(\?[A-Za-z0-9=&%._~+,:;!$'()*@/?|[\]{}^-]*)?$/;

/**
 * Longueur maximale d'une page à rouvrir. Les liens « Créer la facture » de CRMlead
 * (« /fr/app/import/crmlead?d=… ») portent tout le lead : CRMlead les garde sous 2 400 caractères
 * (docs/CRMLEAD.md) pour qu'ils survivent à une reconnexion. Avec une page de cette longueur, le
 * cookie de la demande (« il_lead_login_<16>=<valeur>.<signature> ») pèse environ 3 400 octets,
 * sous les 4 096 qu'un navigateur accepte pour un cookie.
 */
export const NEXT_MAX = 2400;

export function safeNext(value: string | null | undefined): string | undefined {
  if (!value || value.length > NEXT_MAX || value.includes("//")) return undefined;
  return NEXT_PATH.test(value) ? value : undefined;
}

export function pickLocale(value: unknown): "de" | "fr" | "en" {
  return value === "fr" || value === "en" ? value : "de";
}

/** Page d'une invitation de fiduciaire, à rouvrir après la connexion. */
export const INVITE_PATH = /^\/(de|fr|en)\/invite\?token=([A-Za-z0-9_-]{20,100})$/;

export function invitePath(locale: string, token: string): string {
  return `/${pickLocale(locale)}/invite?token=${token}`;
}

export function safeInvite(value: string | null | undefined): string | undefined {
  return value && INVITE_TOKEN.test(value) ? value : undefined;
}

/** Page où une connexion aboutie a mené : une page de l'application ou une invitation. */
export function safeFinished(value: string | null | undefined): string | undefined {
  if (!value || value.length > NEXT_MAX || value.includes("//")) return undefined;
  return NEXT_PATH.test(value) || INVITE_PATH.test(value) ? value : undefined;
}

/**
 * Paramètres d'un nouveau départ vers le Compte Lead qui ramène à cette page : l'invitation (le
 * départ la reprend par son jeton) ou la page de l'application.
 */
export function returnParams(target: string | undefined): Record<string, string> {
  const finished = safeFinished(target);
  if (!finished) return {};
  const invite = INVITE_PATH.exec(finished)?.[2];
  return invite ? { invite } : { next: finished };
}

/** Durée d'une demande de connexion : celle de l'écran du Compte Lead qui l'attend. */
export const LOGIN_REQUEST_SECONDS = 3 * 3600;

const saved = z
  .object({
    /** Ancien cookie (avant le 01.10.2026) : le `state` en clair. */
    state: z.string().min(1).optional(),
    /** Empreinte du `state` scellé (login-state.ts) : le cookie ne vaut que pour cette demande. */
    stateHash: z.string().min(1).optional(),
    nonce: z.string().min(1),
    verifier: z.string().min(1),
    /** Début de la demande, en millisecondes : les demandes les plus anciennes s'effacent d'abord. */
    at: z.number().int().positive().optional(),
    /** Ancien cookie : la langue. Elle voyage désormais dans le `state`. */
    locale: z.enum(["de", "fr", "en"]).optional(),
    /** Ancien cookie : jeton d'invitation de fiduciaire. Il voyage désormais dans le `state`. */
    invite: z.string().regex(INVITE_TOKEN).optional(),
    /**
     * Page demandée avant la connexion. Dans le cookie seulement quand elle est trop longue pour le
     * `state` (lien d'import de CRMlead) ; sinon elle voyage dans le `state`.
     */
    next: z.string().max(NEXT_MAX).regex(NEXT_PATH).optional(),
  })
  .refine((v) => Boolean(v.state || v.stateHash));

export type SavedLogin = z.infer<typeof saved>;

/** Empreinte d'un `state`, gardée dans le cookie à sa place. */
export function hashState(state: string): string {
  return createHash("sha256").update(state).digest("base64url");
}

/** Le `state` reçu au retour s'il est bien celui de cette demande, sinon undefined. */
export function stateOf(value: SavedLogin, given: string | null | undefined): string | undefined {
  if (!given) return undefined;
  if (value.stateHash) {
    const a = Buffer.from(value.stateHash);
    const b = Buffer.from(hashState(given));
    return a.length === b.length && timingSafeEqual(a, b) ? given : undefined;
  }
  return value.state === given ? given : undefined;
}

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

/** Cookie d'une demande en cours, et sa trace une fois aboutie (« _ok »). */
const PENDING_COOKIE = new RegExp(`^${LOGIN_COOKIE}_[A-Za-z0-9_-]{16}$`);
const DONE_COOKIE = new RegExp(`^${LOGIN_COOKIE}_[A-Za-z0-9_-]{16}_ok$`);

/**
 * Plafonds des cookies de connexion. Ils partent tous avec chaque requête vers /auth/lead, et Node
 * refuse une requête dont les en-têtes dépassent 16 Ko (erreur 431, connexion impossible) : des
 * départs abandonnés, ou une page d'un autre site qui ouvre /auth/lead/start en boucle, ne doivent
 * jamais l'atteindre. Au plus 5 demandes en cours dans 6 000 octets, au plus 3 traces dans 3 000.
 */
export const PENDING_KEEP = 5;
export const PENDING_BYTES = 6000;
export const DONE_KEEP = 3;
export const DONE_BYTES = 3000;

type Jar = { name: string; value: string }[];

/** Octets d'un cookie dans l'en-tête Cookie : nom, « = », valeur encodée, séparateur. */
export function cookieBytes(name: string, value: string): number {
  return name.length + encodeURIComponent(value).length + 3;
}

/**
 * Noms des cookies à effacer pour qu'avec le nouveau (`incoming` octets), il en reste au plus `keep`
 * dans `bytes` octets : les plus récents restent. Un cookie sans date compte pour le plus ancien.
 */
function overflow(
  found: { name: string; bytes: number; at: number }[],
  incoming: number,
  keep: number,
  bytes: number,
): string[] {
  const ordered = [...found].sort((a, b) => b.at - a.at);
  const stale: string[] = [];
  let used = incoming;
  let kept = 1;
  for (const c of ordered) {
    if (kept < keep && used + c.bytes <= bytes) {
      kept += 1;
      used += c.bytes;
    } else stale.push(c.name);
  }
  return stale;
}

/** Demandes en cours à effacer avant d'en poser une nouvelle de `incoming` octets. */
export function stalePending(jar: Jar, secret: string, incoming: number): string[] {
  const found = jar
    .filter((c) => PENDING_COOKIE.test(c.name))
    .map((c) => ({
      name: c.name,
      bytes: cookieBytes(c.name, c.value),
      at: openLogin(c.value, secret)?.at ?? 0,
    }));
  return overflow(found, incoming, PENDING_KEEP, PENDING_BYTES);
}

/** Trace d'une demande aboutie : sa date (secondes) suivie de la page où elle a mené. */
export function doneValue(target: string, now = Date.now()): string {
  return `${Math.floor(now / 1000)}${target}`;
}

/** Date et page d'une trace, ou undefined. Les traces d'avant le 01.10.2026 n'ont pas de date. */
export function readDone(value: string | undefined): { at: number; target: string } | undefined {
  const m = value ? /^(\d{0,12})(\/.*)$/.exec(value) : null;
  const target = safeFinished(m?.[2]);
  return m && target ? { at: Number(m[1] || 0), target } : undefined;
}

/** Traces à effacer avant d'en poser une nouvelle de `incoming` octets (sous le nom `except`). */
export function staleDone(jar: Jar, incoming: number, except?: string): string[] {
  const found = jar
    .filter((c) => DONE_COOKIE.test(c.name) && c.name !== except)
    .map((c) => ({
      name: c.name,
      bytes: cookieBytes(c.name, c.value),
      at: readDone(c.value)?.at ?? 0,
    }));
  return overflow(found, incoming, DONE_KEEP, DONE_BYTES);
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
