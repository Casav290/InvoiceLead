import "server-only";
import { createHmac, hkdfSync, timingSafeEqual } from "node:crypto";
import { and, eq, gt, lt, sql } from "drizzle-orm";
import { decodeHandoff } from "../crmlead";
import type { Db } from "../db";
import { loginPages } from "../db/schema";
import { safeNext } from "./login-cookie";
import { PAGE_REF, STATE_NEXT_MAX } from "./login-state";

/**
 * Pages trop longues pour le `state` de la connexion (lien d'import de CRMlead, jusqu'à 2 400
 * caractères) : gardées ici, le `state` n'en porte que la référence. Sans cela, un retour sans le
 * cookie de la demande (lien de l'email « mot de passe oublié » ouvert sur un autre appareil, écran
 * resté ouvert plus de trois heures, cookie évincé) n'avait plus que le chemin, et la pièce préparée
 * dans CRMlead était perdue.
 *
 * La référence dépend du contenu (HMAC sous une clé tirée de SESSION_SECRET) : le même lien ne fait
 * qu'une ligne, et une ligne relue n'est acceptée que si elle redonne sa référence. Elle ne voyage
 * que dans le `state` chiffré : le Compte Lead ne la voit pas. Une page retrouvée ne donne jamais de
 * session, elle n'indique que la page où revenir après une connexion complète.
 *
 * L'écriture se fait avant toute connexion (n'importe qui peut ouvrir /auth/lead/start), elle est donc
 * bornée de tous côtés :
 * - seule la page qui en a besoin est gardée : un lien d'import de CRMlead (« /xx/app/import/crmlead »,
 *   un seul paramètre `d`, que le décodage du lead accepte). Toute autre page longue part sans
 *   référence, le cookie de la demande la garde entière comme avant ;
 * - au plus PAGES_PER_CLIENT_HOUR nouvelles pages par heure et par réseau (clientKey) : un script ne
 *   prive que son propre réseau de la référence, jamais les autres ;
 * - au plus PAGES_MAX pages vivantes (environ 50 Mo au pire) : au-delà, les nouvelles partent sans
 *   référence, les anciennes ne sont jamais évincées ;
 * - durée PAGE_MAX_AGE_SECONDS (huit jours) : le plus long retour sans cookie est le lien de
 *   confirmation d'adresse du Compte Lead, valable sept jours. La tâche quotidienne efface le reste.
 * Le même lien rejoué n'est jamais refusé : sa ligne est seulement rafraîchie.
 */
export const PAGES_PER_CLIENT_HOUR = 20;
export const PAGES_MAX = 20_000;
export const PAGE_MAX_AGE_SECONDS = 8 * 24 * 3600;

/** Page d'import de CRMlead, seule page longue gardée côté serveur. */
const IMPORT_PAGE = /^\/(de|fr|en)\/app\/import\/crmlead\?d=([A-Za-z0-9_-]+)$/;

function key(secret: string): Buffer {
  return Buffer.from(hkdfSync("sha256", secret, "", "il-lead-login-page", 32));
}

/** Référence d'une page : 22 premiers caractères base64url de son HMAC. */
export function pageRef(next: string, secret: string): string {
  return createHmac("sha256", key(secret)).update(next).digest("base64url").slice(0, 22);
}

/**
 * Réseau d'une adresse IP, pour le plafond par client : l'adresse IPv4 entière, le préfixe /56 d'une
 * adresse IPv6 (un abonnement en reçoit au moins autant ; un /64 de plus ne donne pas un client de plus).
 */
export function clientNetwork(ip: string): string {
  const v = ip
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/%.*$/, "");
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(v);
  if (mapped?.[1]) return mapped[1];
  if (!v.includes(":")) return v;
  const parts = v.split("::");
  if (parts.length > 2) return v;
  const head = parts[0] ? parts[0].split(":") : [];
  const tail = parts.length === 2 && parts[1] ? parts[1].split(":") : [];
  const groups =
    parts.length === 2
      ? [...head, ...Array<string>(Math.max(0, 8 - head.length - tail.length)).fill("0"), ...tail]
      : head;
  if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return v;
  const [a = "", b = "", c = "", d = ""] = groups.map((g) => g.padStart(4, "0"));
  return `${a}:${b}:${c}:${d.slice(0, 2)}/56`;
}

/**
 * Clé du client qui demande une page : HMAC de son réseau (IP vue par Vercel), jamais l'adresse
 * elle-même. `x-real-ip` d'abord (posé par Vercel, que le client ne peut pas imposer), sinon le premier
 * élément de `x-forwarded-for`, sinon « local » (développement).
 */
export function clientKey(headers: Headers, secret: string): string {
  const ip =
    headers.get("x-real-ip")?.trim() ||
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "local";
  const k = Buffer.from(hkdfSync("sha256", secret, "", "il-lead-login-client", 32));
  return createHmac("sha256", k).update(clientNetwork(ip)).digest("base64url").slice(0, 22);
}

export type PageLimits = { perClientHour: number; max: number };

/**
 * Garde une page trop longue pour le `state` et rend sa référence, ou undefined (page courte, autre
 * qu'un lien d'import, plafond atteint, base indisponible : la demande part alors sans, comme avant,
 * et son cookie garde la page entière).
 */
export async function savePage(
  database: Db,
  next: string | undefined,
  secret: string,
  client: string,
  limits: PageLimits = { perClientHour: PAGES_PER_CLIENT_HOUR, max: PAGES_MAX },
): Promise<string | undefined> {
  const page = safeNext(next);
  if (!page || page.length <= STATE_NEXT_MAX) return undefined;
  const handoff = IMPORT_PAGE.exec(page);
  if (!handoff?.[2] || !decodeHandoff(handoff[2])) return undefined;
  const id = pageRef(page, secret);
  try {
    // Même lien déjà gardé : rafraîchi, jamais refusé.
    const again = await database
      .update(loginPages)
      .set({ createdAt: sql`now()` })
      .where(eq(loginPages.id, id))
      .returning({ id: loginPages.id });
    if (again.length) return id;
    const [mine] = await database
      .select({ count: sql<number>`count(*)::int` })
      .from(loginPages)
      .where(
        and(
          eq(loginPages.client, client),
          gt(loginPages.createdAt, new Date(Date.now() - 3600_000)),
        ),
      );
    if ((mine?.count ?? 0) >= limits.perClientHour) return undefined;
    const [live] = await database
      .select({ count: sql<number>`count(*)::int` })
      .from(loginPages)
      .where(gt(loginPages.createdAt, new Date(Date.now() - PAGE_MAX_AGE_SECONDS * 1000)));
    if ((live?.count ?? 0) >= limits.max) return undefined;
    await database
      .insert(loginPages)
      .values({ id, next: page, client })
      .onConflictDoUpdate({ target: loginPages.id, set: { createdAt: sql`now()` } });
    return id;
  } catch (error) {
    console.error("[lead-id] login page", error instanceof Error ? error.name : "error");
    return undefined;
  }
}

/** La page gardée sous cette référence, si elle vit encore et redonne bien sa référence. */
export async function loadPage(
  database: Db,
  ref: string | undefined,
  secret: string,
  now = Date.now(),
): Promise<string | undefined> {
  if (!ref || !PAGE_REF.test(ref)) return undefined;
  let found: string | undefined;
  try {
    const [row] = await database
      .select({ next: loginPages.next })
      .from(loginPages)
      .where(
        and(
          eq(loginPages.id, ref),
          gt(loginPages.createdAt, new Date(now - PAGE_MAX_AGE_SECONDS * 1000)),
        ),
      )
      .limit(1);
    found = row?.next;
  } catch (error) {
    console.error("[lead-id] login page", error instanceof Error ? error.name : "error");
    return undefined;
  }
  const page = safeNext(found);
  if (!page) return undefined;
  const a = Buffer.from(pageRef(page, secret));
  const b = Buffer.from(ref);
  return a.length === b.length && timingSafeEqual(a, b) ? page : undefined;
}

/** Ménage : pages plus vieilles que PAGE_MAX_AGE_SECONDS. Rend le nombre de lignes effacées. */
export async function purgePages(database: Db, now = Date.now()): Promise<number> {
  const gone = await database
    .delete(loginPages)
    .where(lt(loginPages.createdAt, new Date(now - PAGE_MAX_AGE_SECONDS * 1000)))
    .returning({ id: loginPages.id });
  return gone.length;
}
