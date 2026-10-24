import "server-only";
import { accessProblem } from "../auth/guard";
import { getSession } from "../auth/session";
import { db } from "../db";
import { env } from "../env";
import { refreshPlan } from "../plan-refresh";
import type { AssistantAuth, Deps } from "./handlers";

/**
 * Session d'une requête de la bulle, sans redirection : les mêmes contrôles que requireAppSession
 * (formule relue, bêta, rôle, place), rendus en 401 / 403 au lieu d'un écran.
 */
export async function assistantAuth(): Promise<AssistantAuth> {
  const found = await getSession();
  if (!found) return { status: 401 };
  const organization = await refreshPlan(db(), found.organization);
  const session = organization === found.organization ? found : { ...found, organization };
  const problem = await accessProblem(session);
  if (problem) return { status: 403, reason: problem };
  return { status: 200, session };
}

/** La bulle est montrée seulement si la clé est posée côté serveur. */
export function assistantConfigured(): boolean {
  return !!env().ANTHROPIC_API_KEY;
}

export function assistantDeps(): Deps {
  const { ANTHROPIC_API_KEY, SESSION_SECRET } = env();
  return { database: db(), apiKey: ANTHROPIC_API_KEY, secret: SESSION_SECRET };
}
