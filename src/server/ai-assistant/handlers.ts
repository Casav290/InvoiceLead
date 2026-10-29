import Anthropic from "@anthropic-ai/sdk";
import type { BetaMessageParam } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { type Locale, routing } from "@/i18n/routing";
import type { CurrentSession } from "../auth/session";
import type { Db } from "../db";
import { actionOperations, applyAction } from "./operations";
import { type AssistantContext, rightProblem } from "./ops-core";
import { recordUsage, reserveMessage } from "./quota";
import { DEADLINE_MS, type RunResult, runAssistant } from "./run";
import { claimAction, verifyAction } from "./token";
import { safePagePath } from "./tools";

/** Session de la requête : absente (401), sans accès à InvoiceLead (403), ou valide. */
export type AssistantAuth =
  | { status: 401 }
  | { status: 403; reason: string }
  | { status: 200; session: CurrentSession };

export type HandlerResult = { status: number; body: Record<string, unknown> };

export type Deps = {
  database: Db;
  apiKey: string | undefined;
  secret: string;
  today?: string;
  /** Pour les tests : remplace l'appel au modèle. */
  run?: (input: Parameters<typeof runAssistant>[0]) => Promise<RunResult>;
  /** Pour les tests : faux service Anthropic (fetch du client) et délai du tour plus court. */
  fetch?: typeof fetch;
  deadlineMs?: number;
};

/** Historique gardé : 60 messages et 200 Ko au plus, le plus ancien part d'abord. */
export const MAX_HISTORY = 60;
export const MAX_HISTORY_BYTES = 200_000;
/** Question tapée dans la bulle (avec les notes de confirmation qui l'accompagnent). */
export const MAX_QUESTION = 4000;

const today = () => new Date().toISOString().slice(0, 10);

/** Langue de la demande, sinon celle de l'entreprise, sinon la langue par défaut de l'application. */
const localeOf = (value: unknown, fallback: string): Locale => {
  const known = routing.locales as readonly string[];
  if (known.includes(String(value))) return String(value) as Locale;
  return (known.includes(fallback) ? fallback : routing.defaultLocale) as Locale;
};

function context(session: CurrentSession, deps: Deps, locale: unknown): AssistantContext {
  return {
    database: deps.database,
    userId: session.user.id,
    userName: session.user.name ?? session.user.email,
    organization: session.organization,
    membership: session.membership,
    today: deps.today ?? today(),
    locale: localeOf(locale, session.organization.defaultLocale),
  };
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);

/** La nouvelle question : un texte, ou des blocs de texte seulement (notes « confirmé » / « annulé »). */
function questionOk(content: unknown): boolean {
  if (typeof content === "string")
    return content.trim().length > 0 && content.length <= MAX_QUESTION;
  if (!Array.isArray(content) || content.length === 0 || content.length > 10) return false;
  let size = 0;
  for (const b of content) {
    if (!isPlainObject(b) || b.type !== "text" || typeof b.text !== "string") return false;
    size += b.text.length;
  }
  return size > 0 && size <= MAX_QUESTION + 2000;
}

/**
 * Historique renvoyé par le navigateur. Seuls les rôles « user » et « assistant » passent : un
 * message « system » glissé par le navigateur porterait l'autorité des consignes. Le contenu reste
 * celui que l'API a rendu (blocs de réflexion compris) ; il ne donne aucun droit : les écritures
 * exigent un jeton signé.
 */
export function cleanHistory(raw: unknown): BetaMessageParam[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 400) return null;
  for (const m of raw) {
    if (!isPlainObject(m)) return null;
    if (m.role !== "user" && m.role !== "assistant") return null;
    if (typeof m.content !== "string" && !Array.isArray(m.content)) return null;
    if (
      Array.isArray(m.content) &&
      m.content.some((b) => !isPlainObject(b) || typeof b.type !== "string")
    )
      return null;
  }
  const messages = raw as BetaMessageParam[];
  const lastMessage = messages.at(-1);
  if (lastMessage?.role !== "user" || !questionOk(lastMessage.content)) return null;
  if (messages[0]?.role !== "user") return null;
  // Trop long : on coupe au début d'un tour (question de la personne, pas un résultat d'outil).
  const startsTurn = (m: BetaMessageParam) =>
    m.role === "user" &&
    (typeof m.content === "string" ||
      m.content.every((b) => (b as { type: string }).type === "text"));
  let kept = messages;
  while (
    kept.length > 1 &&
    (kept.length > MAX_HISTORY || JSON.stringify(kept).length > MAX_HISTORY_BYTES)
  ) {
    const next = kept.findIndex((m, i) => i > 0 && startsTurn(m));
    if (next <= 0) break;
    kept = kept.slice(next);
  }
  if (JSON.stringify(kept).length > MAX_HISTORY_BYTES * 1.5) kept = [lastMessage];
  return kept;
}

/** POST /api/assistant : un message de la conversation. */
export async function assistantPost(
  auth: AssistantAuth,
  body: unknown,
  deps: Deps,
): Promise<HandlerResult> {
  if (auth.status === 401) return { status: 401, body: { error: "unauthorized" } };
  if (auth.status === 403) return { status: 403, body: { error: "forbidden" } };
  if (!deps.apiKey) return { status: 503, body: { error: "not_configured" } };
  if (!isPlainObject(body) || !Array.isArray(body.messages))
    return { status: 400, body: { error: "invalid" } };
  // La question elle-même est illisible (vide, trop longue) : la reformuler suffit.
  const asked = body.messages.at(-1) as unknown;
  if (!isPlainObject(asked) || asked.role !== "user" || !questionOk(asked.content))
    return { status: 400, body: { error: "invalid" } };
  // Le fil, lui, ne peut pas continuer (rôle inconnu, premier message, trop de messages) : la bulle
  // propose « Nouvelle conversation » dans le message d'erreur (B3).
  const history = cleanHistory(body.messages);
  if (!history) return { status: 400, body: { error: "history" } };
  const locale = (routing.locales as readonly string[]).includes(String(body.locale))
    ? String(body.locale)
    : routing.defaultLocale;
  const page = safePagePath(body.page) ?? "/app";

  const { session } = auth;
  const who = { organizationId: session.organization.id, userId: session.user.id };
  const reserved = await reserveMessage(deps.database, who);
  if ("limit" in reserved) return { status: 429, body: { error: "quota", scope: reserved.limit } };

  const run = deps.run ?? runAssistant;
  // B1 : une nouvelle tentative au plus, et chaque appel sous le délai du tour.
  const deadlineMs = deps.deadlineMs ?? DEADLINE_MS;
  let result: RunResult;
  try {
    result = await run({
      client: new Anthropic({
        apiKey: deps.apiKey,
        maxRetries: 1,
        timeout: deadlineMs,
        ...(deps.fetch ? { fetch: deps.fetch } : {}),
      }),
      ctx: context(session, deps, locale),
      secret: deps.secret,
      locale,
      page,
      history,
      deadlineMs,
    });
  } catch (e) {
    await recordUsage(deps.database, reserved.id, {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      tools: [],
      error: "failed",
    });
    console.error("[assistant] échec", e instanceof Error ? e.name : "inconnu");
    return { status: 502, body: { error: "unavailable" } };
  }
  await recordUsage(deps.database, reserved.id, result.usage);
  // Délai du tour dépassé (B1), fil refusé par le service (B3), service indisponible : chacun son
  // code et son texte dans la bulle.
  if (result.notice === "timeout") return { status: 504, body: { error: "timeout" } };
  if (result.notice === "history") return { status: 400, body: { error: "history" } };
  if (result.notice === "unavailable") return { status: 502, body: { error: "unavailable" } };
  return {
    status: 200,
    body: {
      messages: result.messages,
      reply: result.reply,
      actions: result.actions,
      notice: result.notice,
    },
  };
}

/**
 * POST /api/assistant/confirm : applique l'écriture (ou le lot) d'un jeton « À confirmer ». Le
 * jeton est vérifié (signature, personne, entreprise, 10 minutes), les droits de CHAQUE opération
 * sont relus maintenant (rôle changé depuis la proposition), puis le jeton est consommé (usage
 * unique) et l'écriture jouée dans une transaction : un échec n'écrit rien.
 */
export async function confirmPost(
  auth: AssistantAuth,
  body: unknown,
  deps: Deps,
): Promise<HandlerResult> {
  if (auth.status === 401) return { status: 401, body: { error: "unauthorized" } };
  if (auth.status === 403) return { status: 403, body: { error: "forbidden" } };
  const { session } = auth;
  const who = { organizationId: session.organization.id, userId: session.user.id };
  const input = isPlainObject(body) ? body : {};
  const verified = verifyAction(input.token, who, deps.secret);
  const operations = verified ? actionOperations(verified.action) : null;
  if (!verified || !operations) return { status: 403, body: { error: "invalid_token" } };
  const ctx = context(session, deps, input.locale);
  if (operations.some((op) => rightProblem(ctx, op)))
    return { status: 403, body: { error: "forbidden_role" } };
  if (!(await claimAction(deps.database, verified, who)))
    return { status: 403, body: { error: "token_used" } };
  const done = await applyAction(ctx, verified.action);
  if (!done.ok) return { status: 422, body: { error: done.error } };
  return { status: 200, body: { ok: true, result: done.result } };
}
