import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { and, eq, lt } from "drizzle-orm";
import type { Db } from "../db";
import { assistantConfirmations } from "../db/schema";

/**
 * Jeton « À confirmer » de la bulle Assistant IA : l'écriture proposée par l'assistant, signée
 * (HMAC-SHA256, clé dérivée de SESSION_SECRET pour ce seul usage), liée à la personne et à
 * l'entreprise de la session, valable 10 minutes et une seule fois (assistant_confirmations).
 * Le contenu reste lisible par le navigateur (ce sont ses propres données) ; toute modification est
 * détectée.
 */
export const CONFIRM_TTL_MS = 10 * 60_000;

export type ProposedAction = { tool: string; input: Record<string, unknown> };

type Payload = { v: 1; u: string; o: string; exp: number; jti: string; a: ProposedAction };

const key = (secret: string) =>
  createHash("sha256").update(`invoicelead:assistant-confirm:${secret}`).digest();

const mac = (body: string, secret: string) =>
  createHmac("sha256", key(secret)).update(body).digest("base64url");

export function signAction(
  action: ProposedAction,
  who: { userId: string; organizationId: string },
  secret: string,
  now = Date.now(),
): string {
  const payload: Payload = {
    v: 1,
    u: who.userId,
    o: who.organizationId,
    exp: now + CONFIRM_TTL_MS,
    jti: randomBytes(16).toString("base64url"),
    a: action,
  };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${mac(body, secret)}`;
}

export type VerifiedAction = { jti: string; action: ProposedAction };

/**
 * Vérifie un jeton pour cette session. Rend null (→ 403) s'il est falsifié, expiré, ou fait pour une
 * autre personne ou une autre entreprise. L'usage unique se joue ensuite dans claimAction.
 */
export function verifyAction(
  token: unknown,
  who: { userId: string; organizationId: string },
  secret: string,
  now = Date.now(),
): VerifiedAction | null {
  if (typeof token !== "string" || token.length > 20_000) return null;
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const expected = Buffer.from(mac(body, secret));
  const given = Buffer.from(token.slice(dot + 1));
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  let payload: Payload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Payload;
  } catch {
    return null;
  }
  if (payload?.v !== 1 || typeof payload.jti !== "string") return null;
  if (typeof payload.exp !== "number" || payload.exp <= now) return null;
  if (payload.u !== who.userId || payload.o !== who.organizationId) return null;
  const a = payload.a;
  if (!a || typeof a.tool !== "string" || !a.input || typeof a.input !== "object") return null;
  return { jti: payload.jti, action: { tool: a.tool, input: a.input } };
}

/** Marque le jeton comme utilisé ; false s'il l'était déjà (rejeu). */
export async function claimAction(
  database: Db,
  verified: VerifiedAction,
  who: { userId: string; organizationId: string },
): Promise<boolean> {
  // Ménage : un jeton expire au bout de 10 minutes, sa trace n'a plus d'usage après deux jours.
  await database
    .delete(assistantConfirmations)
    .where(lt(assistantConfirmations.usedAt, new Date(Date.now() - 2 * 86_400_000)));
  const rows = await database
    .insert(assistantConfirmations)
    .values({
      jti: verified.jti,
      organizationId: who.organizationId,
      userId: who.userId,
      tool: verified.action.tool,
    })
    .onConflictDoNothing()
    .returning({ jti: assistantConfirmations.jti });
  return rows.length === 1;
}

/** Jeton déjà utilisé ? (tests et diagnostic) */
export async function actionUsed(database: Db, jti: string, organizationId: string) {
  const [row] = await database
    .select({ jti: assistantConfirmations.jti })
    .from(assistantConfirmations)
    .where(
      and(
        eq(assistantConfirmations.jti, jti),
        eq(assistantConfirmations.organizationId, organizationId),
      ),
    );
  return !!row;
}
