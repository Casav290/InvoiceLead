import "server-only";
import { and, eq, gt, lt, ne } from "drizzle-orm";
import { cookies } from "next/headers";
import { cache } from "react";
import { SESSION_COOKIE } from "@/lib/cookies";
import { type Db, db } from "../db";
import { memberships, organizations, sessions, users } from "../db/schema";
import { env } from "../env";
import { refresh as leadRefresh } from "../lead-id/leadId";
import { decrypt, encrypt, randomToken, sha256Hex } from "./crypto";

export { SESSION_COOKIE } from "@/lib/cookies";

/**
 * Durée d'une session locale. Courte à dessein : à l'échéance, la personne repasse par le Compte Lead,
 * sans écran si elle y est encore connectée, et ses droits (formule, accès) sont relus à ce moment-là.
 */
export const SESSION_HOURS = 12;

export function cookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    secure: env().APP_URL.startsWith("https://"),
    sameSite: "lax" as const,
    path: "/",
    maxAge: maxAgeSeconds,
  };
}

/**
 * Toutes les cinq minutes au plus, une session vérifie auprès du Compte Lead que l'accès de sa
 * connexion tient (revalidateSession) : un mot de passe réinitialisé, une déconnexion de partout ou un
 * compte fermé y révoquent les jetons de rafraîchissement, et la session tombe à sa page suivante.
 */
export const CHECK_SECONDS = 300;
/** Compte Lead sans réponse : la session continue (panne, pas révocation), la vérification revient. */
const CHECK_TIMEOUT_MS = 5000;
const REFRESH_PURPOSE = "lead-refresh";

export async function createSession(
  database: Db,
  input: {
    userId: string;
    organizationId: string;
    idToken: string | null;
    /** Jeton de rafraîchissement du Compte Lead de cette connexion (gardé chiffré). */
    refreshToken?: string | null;
  },
) {
  const token = randomToken();
  const id = sha256Hex(token);
  const expiresAt = new Date(Date.now() + SESSION_HOURS * 3600_000);
  await database.insert(sessions).values({
    id,
    userId: input.userId,
    organizationId: input.organizationId,
    idToken: input.idToken,
    refreshTokenEnc: input.refreshToken
      ? encrypt(input.refreshToken, env().SESSION_SECRET, REFRESH_PURPOSE)
      : null,
    expiresAt,
  });
  // Ménage opportuniste des sessions échues.
  await database.delete(sessions).where(lt(sessions.expiresAt, new Date()));
  return { id, token, expiresAt };
}

/**
 * Nouvelle connexion de la personne (`keep`) : ses autres sessions InvoiceLead (autres navigateurs)
 * vérifient leur accès auprès du Compte Lead dès leur prochaine page, sans attendre cinq minutes. Une
 * réinitialisation du mot de passe (compte ouvert d'avance par un tiers, puis repris par la vraie
 * personne) ferme ainsi aussitôt la session de l'auteur, dont le Compte Lead a révoqué les jetons.
 * Une session sans jeton de rafraîchissement (ouverte avant leur arrivée) ne peut rien prouver : elle
 * tombe, et la personne repasse sans écran par le Compte Lead si elle y est connectée.
 */
export async function checkOtherSessionsSoon(database: Db, userId: string, keep: string) {
  await database
    .update(sessions)
    .set({ lastSeenAt: new Date(0) })
    .where(and(eq(sessions.userId, userId), ne(sessions.id, keep)));
}

/**
 * Le Compte Lead annonce la date du dernier changement d'identifiants de la personne (`cred_at` :
 * mot de passe réinitialisé ou changé) : les sessions ouvertes avant n'ont plus de raison d'être.
 */
export async function dropSessionsBefore(database: Db, userId: string, before: Date, keep: string) {
  await database
    .delete(sessions)
    .where(and(eq(sessions.userId, userId), lt(sessions.createdAt, before), ne(sessions.id, keep)));
}

type Refresh = (
  refreshToken: string,
) => Promise<{ claims: { sub?: unknown }; tokens: { refresh_token?: string } }>;

/** Jeton refusé par le Compte Lead (révoqué, expiré, déjà tourné) : l'accès ne tient plus. */
const revoked = (error: unknown) =>
  error instanceof Error && error.message === "lead_id:invalid_grant";

/**
 * Vérifie, au plus toutes les CHECK_SECONDS, que l'accès de la session tient encore au Compte Lead :
 * le jeton de rafraîchissement de sa connexion y est échangé (il tourne : le nouveau est gardé). Rend
 * false, la session effacée, si le Compte Lead le refuse (mot de passe réinitialisé, déconnexion de
 * partout, compte fermé) ou s'il répond pour une autre personne. Une panne (réseau, délai, erreur du
 * serveur) n'est pas une révocation : la session continue. Une seule requête vérifie à la fois : celle
 * qui pose la date ; les autres, en parallèle, continuent.
 */
export async function revalidateSession(
  database: Db,
  found: CurrentSession,
  refresh: Refresh = leadRefresh,
): Promise<boolean> {
  const { session, user } = found;
  const seen = session.lastSeenAt.getTime();
  const flagged = seen <= 0;
  const limit = new Date(Date.now() - CHECK_SECONDS * 1000);
  if (!flagged && seen >= limit.getTime()) return true;
  const drop = async () => {
    await database.delete(sessions).where(eq(sessions.id, session.id));
    return false;
  };
  if (!session.refreshTokenEnc) return flagged ? drop() : true;
  const [claimed] = await database
    .update(sessions)
    .set({ lastSeenAt: new Date() })
    .where(and(eq(sessions.id, session.id), lt(sessions.lastSeenAt, limit)))
    .returning({ refreshTokenEnc: sessions.refreshTokenEnc });
  if (!claimed) return true;
  const token = claimed.refreshTokenEnc
    ? decrypt(claimed.refreshTokenEnc, env().SESSION_SECRET, REFRESH_PURPOSE)
    : null;
  if (!token) return drop();
  // La vérification va à son terme même après le délai (le jeton neuf est gardé) ; seule la page,
  // elle, n'attend pas plus longtemps.
  const check = refresh(token)
    .then(
      async ({ claims, tokens }) => {
        if (!user.leadSub || claims.sub !== user.leadSub) return drop();
        if (tokens.refresh_token)
          await database
            .update(sessions)
            .set({
              refreshTokenEnc: encrypt(tokens.refresh_token, env().SESSION_SECRET, REFRESH_PURPOSE),
            })
            .where(eq(sessions.id, session.id));
        return true;
      },
      async (error: unknown) => {
        if (revoked(error)) return drop();
        console.error(
          "[lead-id] vérification de session",
          error instanceof Error ? error.message : "inconnu",
        );
        return true;
      },
    )
    .catch(() => true);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(true), CHECK_TIMEOUT_MS);
  });
  try {
    return await Promise.race([check, late]);
  } finally {
    clearTimeout(timer);
  }
}

export async function findSession(database: Db, token: string) {
  const [row] = await database
    .select({
      session: sessions,
      user: users,
      organization: organizations,
      membership: { role: memberships.role, appRole: memberships.appRole },
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .innerJoin(organizations, eq(sessions.organizationId, organizations.id))
    // Sans appartenance (fiduciaire retirée), la session ne vaut plus rien.
    .innerJoin(
      memberships,
      and(
        eq(memberships.organizationId, sessions.organizationId),
        eq(memberships.userId, sessions.userId),
      ),
    )
    .where(and(eq(sessions.id, sha256Hex(token)), gt(sessions.expiresAt, new Date())))
    .limit(1);
  return row ?? null;
}

/** Supprime la session et rend son jeton d'identité (pour la déconnexion du Compte Lead). */
export async function destroySession(database: Db, token: string): Promise<string | null> {
  const [row] = await database
    .delete(sessions)
    .where(eq(sessions.id, sha256Hex(token)))
    .returning({ idToken: sessions.idToken });
  return row?.idToken ?? null;
}

export type CurrentSession = NonNullable<Awaited<ReturnType<typeof findSession>>>;

/**
 * Session de la requête en cours, lue une seule fois par rendu, et dont l'accès au Compte Lead est
 * revérifié au plus toutes les cinq minutes (revalidateSession).
 */
export const getSession = cache(async (): Promise<CurrentSession | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const found = await findSession(db(), token);
  if (!found) return null;
  return (await revalidateSession(db(), found)) ? found : null;
});
