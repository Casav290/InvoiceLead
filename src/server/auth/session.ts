import "server-only";
import { and, eq, gt, lt } from "drizzle-orm";
import { cookies } from "next/headers";
import { cache } from "react";
import { SESSION_COOKIE } from "@/lib/cookies";
import { type Db, db } from "../db";
import { organizations, sessions, users } from "../db/schema";
import { env } from "../env";
import { randomToken, sha256Hex } from "./crypto";

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

export async function createSession(
  database: Db,
  input: { userId: string; organizationId: string; idToken: string | null },
) {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + SESSION_HOURS * 3600_000);
  await database.insert(sessions).values({
    id: sha256Hex(token),
    userId: input.userId,
    organizationId: input.organizationId,
    idToken: input.idToken,
    expiresAt,
  });
  // Ménage opportuniste des sessions échues.
  await database.delete(sessions).where(lt(sessions.expiresAt, new Date()));
  return { token, expiresAt };
}

export async function findSession(database: Db, token: string) {
  const [row] = await database
    .select({ session: sessions, user: users, organization: organizations })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .innerJoin(organizations, eq(sessions.organizationId, organizations.id))
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

/** Session de la requête en cours, lue une seule fois par rendu. */
export const getSession = cache(async (): Promise<CurrentSession | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return findSession(db(), token);
});
