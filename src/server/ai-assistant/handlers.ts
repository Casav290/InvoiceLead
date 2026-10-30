import Anthropic from "@anthropic-ai/sdk";
import type { BetaMessageParam } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { type Locale, routing } from "@/i18n/routing";
import type { CurrentSession } from "../auth/session";
import type { Db } from "../db";
import { assistantBudget, budgetView } from "../plans";
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
 * Blocs qu'un historique de la bulle peut contenir, par rôle : ce que le service rend (texte,
 * réflexion, appel d'outil, repli de modèle) et ce que le Tool Runner y ajoute (résultat d'outil, en
 * texte : les outils d'InvoiceLead ne rendent que du JSON). Rien d'autre (L10) : ni image, ni
 * document, ni résultat de recherche, ni fichier, ni outil serveur, ni bloc inconnu, à aucun niveau.
 */
type Rebuilt = Record<string, unknown>;
const str = (v: unknown): v is string => typeof v === "string";
/** Un objet de données (entrée d'outil, modèle d'un repli) sans rien qui ressemble à un bloc non-texte. */
function plainData(v: unknown, depth = 0): boolean {
  if (depth > 20) return false;
  if (v === null || typeof v !== "object") return true;
  if (Array.isArray(v)) return v.every((x) => plainData(x, depth + 1));
  const o = v as Record<string, unknown>;
  if (str(o.type) && NON_TEXT.test(o.type)) return false;
  if (isPlainObject(o.source) && str(o.source.type)) return false;
  return Object.values(o).every((x) => plainData(x, depth + 1));
}
const NON_TEXT =
  /^(image|document|search_result|container_upload|file|tool_reference|web_search_tool_result|web_fetch_tool_result|server_tool_use|mcp_tool_use|mcp_tool_result)$/;
/** Texte d'un bloc reconstruit : seulement `type` et `text` (ni citations, ni cache_control). */
const textBlock = (b: Record<string, unknown>): Rebuilt | null =>
  str(b.text) ? { type: "text", text: b.text } : null;
function rebuildBlock(role: "user" | "assistant", b: Record<string, unknown>): Rebuilt | null {
  if (b.type === "text") return textBlock(b);
  if (role === "user") {
    if (b.type !== "tool_result" || !str(b.tool_use_id)) return null;
    let content: unknown;
    if (str(b.content)) content = b.content;
    else if (b.content === undefined) content = "";
    else if (Array.isArray(b.content)) {
      const blocks = b.content.map((c) =>
        isPlainObject(c) && c.type === "text" ? textBlock(c) : null,
      );
      if (blocks.some((c) => c === null)) return null;
      content = blocks;
    } else return null;
    return {
      type: "tool_result",
      tool_use_id: b.tool_use_id,
      content,
      ...(b.is_error === true ? { is_error: true } : {}),
    };
  }
  if (b.type === "tool_use") {
    // Champs déstructurés : aucune lecture du nom d'un objet dans ce fichier (B1, erreurs jamais
    // classées par le nom de leur classe ; la porte le vérifie sur le texte).
    const { id, name: tool, input } = b;
    return str(id) && str(tool) && isPlainObject(input) && plainData(input)
      ? { type: "tool_use", id, name: tool, input }
      : null;
  }
  if (b.type === "thinking")
    return str(b.thinking) && str(b.signature)
      ? { type: "thinking", thinking: b.thinking, signature: b.signature }
      : null;
  if (b.type === "redacted_thinking")
    return str(b.data) ? { type: "redacted_thinking", data: b.data } : null;
  if (b.type === "fallback")
    return isPlainObject(b.from) && isPlainObject(b.to) && plainData(b.from) && plainData(b.to)
      ? { type: "fallback", from: b.from, to: b.to }
      : null;
  return null;
}

/**
 * Historique renvoyé par le navigateur. Seuls les rôles « user » et « assistant » passent : un
 * message « system » glissé par le navigateur porterait l'autorité des consignes. Chaque bloc est
 * reconstruit avec ses seuls champs connus (L10) ; un bloc d'une autre sorte (image, document,
 * fichier, résultat de recherche…, y compris dans le contenu d'un tool_result ou dans l'entrée d'un
 * outil) fait refuser tout le fil avant toute réservation ni appel au modèle : un historique forgé ne
 * peut pas gonfler le coût d'un tour. Tailles bornées : 60 messages et 200 Ko gardés au plus. Le
 * contenu ne donne aucun droit : les écritures exigent un jeton signé.
 */
export function cleanHistory(raw: unknown): BetaMessageParam[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 400) return null;
  // Au-delà de dix fois ce qui est gardé, le fil n'est même pas lu.
  if (JSON.stringify(raw).length > MAX_HISTORY_BYTES * 10) return null;
  const messages: BetaMessageParam[] = [];
  for (const m of raw) {
    if (!isPlainObject(m)) return null;
    if (m.role !== "user" && m.role !== "assistant") return null;
    const role = m.role;
    if (str(m.content)) {
      messages.push({ role, content: m.content });
      continue;
    }
    if (!Array.isArray(m.content)) return null;
    const blocks: Rebuilt[] = [];
    for (const b of m.content) {
      const rebuilt = isPlainObject(b) ? rebuildBlock(role, b) : null;
      if (!rebuilt) return null;
      blocks.push(rebuilt);
    }
    messages.push({ role, content: blocks } as unknown as BetaMessageParam);
  }
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
  // Formule gratuite (L4) : budget du mois atteint par les tours finis → aucun appel au modèle,
  // aucune place de quota prise ; les tours en cours comptent aussi (sous le verrou de l'entreprise,
  // L9 ci-dessous). La formule se décide par tierOf, comme partout dans l'application (plans.ts).
  const day = deps.today ?? today();
  const reserved = await reserveMessage(deps.database, who, undefined, {
    org: session.organization,
    today: day,
  });
  if ("budget" in reserved)
    return { status: 429, body: { error: "free_limit", budget: budgetView(reserved.budget) } };
  // L9 : refusé seulement parce que des tours sont encore en cours. Ce n'est pas la fin du budget
  // du mois : rien n'est dit du mois (aucun compteur), la bulle dit « réessayez dans un instant ».
  if ("limit" in reserved && reserved.limit === "free_wait")
    return { status: 429, body: { error: "free_wait" } };
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
  // Formule gratuite (L5) : le compteur de la bulle suit chaque tour, jetons de ce tour compris
  // (rien pour une formule sans limite, sans lecture du journal).
  const left = budgetView(await assistantBudget(deps.database, session.organization, day));
  const counter = left ? { budget: left } : {};
  // Délai du tour dépassé (B1), fil refusé par le service (B3), service indisponible : chacun son
  // code et son texte dans la bulle.
  if (result.notice === "timeout") return { status: 504, body: { error: "timeout", ...counter } };
  if (result.notice === "history") return { status: 400, body: { error: "history", ...counter } };
  if (result.notice === "unavailable")
    return { status: 502, body: { error: "unavailable", ...counter } };
  return {
    status: 200,
    body: {
      messages: result.messages,
      reply: result.reply,
      actions: result.actions,
      notice: result.notice,
      ...counter,
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
  // La carte ne montre plus ce qui serait écrit (données changées depuis la proposition) : 409.
  if (!done.ok) return { status: done.error === "stale" ? 409 : 422, body: { error: done.error } };
  return { status: 200, body: { ok: true, result: done.result } };
}
