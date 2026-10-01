import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import { z } from "zod";
import { INVITE_TOKEN, safeNext } from "./login-cookie";

/**
 * La demande de connexion voyage dans le `state` OpenID Connect, chiffrée et authentifiée
 * (AES-256-GCM, clé tirée de SESSION_SECRET). Le Compte Lead rend le `state` tel quel sur tous ses
 * chemins (connexion, inscription, lien de l'email « mot de passe oublié », retour de Google) : la
 * page demandée, l'invitation et la langue reviennent donc même sans le cookie de la demande (lien
 * ouvert sur un autre appareil ou dans un autre navigateur, écran resté ouvert plus de trois heures).
 *
 * Chiffrée et pas seulement signée : la page et le jeton d'invitation n'apparaissent ni dans les
 * adresses du Compte Lead, ni dans ses journaux, ni dans ses emails.
 *
 * Ce `state` ne donne jamais de session : sans le cookie de la demande (PKCE, nonce), il ne sert
 * qu'à relancer une connexion complète vers la même page.
 *
 * Format : base64url(sel 16 || iv 12 || chiffré || étiquette 16). Le sel aléatoire en tête rend unique
 * le nom du cookie de la demande (les 16 premiers caractères, voir loginCookieName).
 */

export type LoginRequest = { locale: "de" | "fr" | "en"; next?: string; invite?: string };

/**
 * Longueur maximale d'une page gardée dans le `state`. L'adresse /oauth/authorize reste ainsi sous
 * 1 000 caractères (le Compte Lead la porte dans ses propres adresses et cookies). Une page plus
 * longue (lien d'import de CRMlead) reste entière dans le cookie de la demande ; le `state` en garde
 * le chemin seul.
 */
export const STATE_NEXT_MAX = 300;

/** Âge maximal d'une demande retrouvée par son `state` (un écran du Compte Lead peut rester ouvert). */
export const STATE_MAX_AGE_SECONDS = 30 * 24 * 3600;

const SALT = 16;
const IV = 12;
const TAG = 16;

const payload = z.object({
  l: z.enum(["de", "fr", "en"]),
  t: z.number().int().positive(),
  n: z.string().optional(),
  i: z.string().regex(INVITE_TOKEN).optional(),
});

function key(secret: string): Buffer {
  return Buffer.from(hkdfSync("sha256", secret, "", "il-lead-login-state", 32));
}

/** La page à garder dans le `state` : entière si elle tient, sinon son chemin seul. */
export function nextForState(next: string | undefined): string | undefined {
  const safe = safeNext(next);
  if (!safe) return undefined;
  if (safe.length <= STATE_NEXT_MAX) return safe;
  const path = safeNext(safe.split("?")[0]);
  return path && path.length <= STATE_NEXT_MAX ? path : undefined;
}

export function sealState(request: LoginRequest, secret: string, now = Date.now()): string {
  const next = request.invite ? undefined : nextForState(request.next);
  const body = {
    l: request.locale,
    t: Math.floor(now / 1000),
    ...(request.invite ? { i: request.invite } : {}),
    ...(next ? { n: next } : {}),
  };
  const salt = randomBytes(SALT);
  const iv = randomBytes(IV);
  const cipher = createCipheriv("aes-256-gcm", key(secret), iv);
  cipher.setAAD(salt);
  const data = Buffer.concat([cipher.update(JSON.stringify(body), "utf8"), cipher.final()]);
  return Buffer.concat([salt, iv, data, cipher.getAuthTag()]).toString("base64url");
}

/** La demande portée par ce `state`, ou null (autre secret, modifié, tronqué, trop vieux, ancien format). */
export function openState(
  state: string | null | undefined,
  secret: string,
  now = Date.now(),
): (LoginRequest & { at: number }) | null {
  if (!state || state.length > 2000 || !/^[A-Za-z0-9_-]+$/.test(state)) return null;
  const raw = Buffer.from(state, "base64url");
  if (raw.length < SALT + IV + TAG + 2) return null;
  const salt = raw.subarray(0, SALT);
  const iv = raw.subarray(SALT, SALT + IV);
  const data = raw.subarray(SALT + IV, raw.length - TAG);
  const tag = raw.subarray(raw.length - TAG);
  let text: string;
  try {
    const decipher = createDecipheriv("aes-256-gcm", key(secret), iv);
    decipher.setAAD(salt);
    decipher.setAuthTag(tag);
    text = Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
  let parsed: z.infer<typeof payload>;
  try {
    const result = payload.safeParse(JSON.parse(text));
    if (!result.success) return null;
    parsed = result.data;
  } catch {
    return null;
  }
  const at = parsed.t * 1000;
  if (at > now + 60_000 || now - at > STATE_MAX_AGE_SECONDS * 1000) return null;
  const next = safeNext(parsed.n);
  if (parsed.n && !next) return null;
  return {
    locale: parsed.l,
    at,
    ...(parsed.i ? { invite: parsed.i } : {}),
    ...(next ? { next } : {}),
  };
}
