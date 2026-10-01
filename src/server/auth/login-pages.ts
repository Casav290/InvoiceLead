import "server-only";
import { createHmac, hkdfSync, timingSafeEqual } from "node:crypto";
import { and, eq, gt, lt, sql } from "drizzle-orm";
import type { Db } from "../db";
import { loginPages } from "../db/schema";
import { safeNext } from "./login-cookie";
import { PAGE_REF, STATE_MAX_AGE_SECONDS, STATE_NEXT_MAX } from "./login-state";

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
 * session, elle n'indique que la page où revenir après une connexion complète. Durée : celle d'un
 * `state` (30 jours), puis la tâche quotidienne l'efface.
 */

function key(secret: string): Buffer {
  return Buffer.from(hkdfSync("sha256", secret, "", "il-lead-login-page", 32));
}

/** Référence d'une page : 22 premiers caractères base64url de son HMAC. */
export function pageRef(next: string, secret: string): string {
  return createHmac("sha256", key(secret)).update(next).digest("base64url").slice(0, 22);
}

/**
 * Garde une page trop longue pour le `state` et rend sa référence, ou undefined (page courte ou
 * refusée, base indisponible : la demande part alors sans, comme avant).
 */
export async function savePage(
  database: Db,
  next: string | undefined,
  secret: string,
): Promise<string | undefined> {
  const page = safeNext(next);
  if (!page || page.length <= STATE_NEXT_MAX) return undefined;
  const id = pageRef(page, secret);
  try {
    await database
      .insert(loginPages)
      .values({ id, next: page })
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
          gt(loginPages.createdAt, new Date(now - STATE_MAX_AGE_SECONDS * 1000)),
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

/** Ménage : pages plus vieilles qu'un `state`. Rend le nombre de lignes effacées. */
export async function purgePages(database: Db, now = Date.now()): Promise<number> {
  const gone = await database
    .delete(loginPages)
    .where(lt(loginPages.createdAt, new Date(now - STATE_MAX_AGE_SECONDS * 1000)))
    .returning({ id: loginPages.id });
  return gone.length;
}
