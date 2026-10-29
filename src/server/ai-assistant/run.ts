import Anthropic from "@anthropic-ai/sdk";
import type {
  BetaMessage,
  BetaMessageParam,
} from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { isVatRegistered } from "../invoices";
import { OPERATIONS } from "./operations";
import { type AssistantContext, rightProblem } from "./ops-core";
import { pageLabel, scrubPaths } from "./page-label";
import { contextPrompt, STABLE_PROMPT } from "./prompt";
import type { UsageReport } from "./quota";
import { type AssistantAction, buildTools, type ToolState } from "./tools";

export const MODEL = "claude-opus-5-5";
/**
 * Par appel au modèle : assez pour qu'un plan complet (un lot de 150 opérations, un devis de 100
 * lignes) tienne dans un seul appel d'outil, sans dépasser la limite d'une requête sans streaming
 * du SDK (21 333 jetons, environ dix minutes).
 */
export const MAX_TOKENS = 16_000;
export const MAX_ITERATIONS = 10;
/**
 * Délai global du tour (B1) : un seul signal pour tout le runner, modèle et outils compris. La durée
 * de la fonction Vercel /api/assistant est de 300 s (plan Hobby avec Fluid compute,
 * src/app/api/assistant/route.ts) ; le tour s'arrête 10 s avant, le temps de journaliser et de
 * répondre « timeout ». Le client Anthropic a le même plafond par appel (handlers.ts).
 */
export const DEADLINE_MS = 290_000;

/**
 * Fin anormale d'un message : refus du modèle, réponse coupée (max_tokens), tour inachevé (plafond
 * d'itérations, pause), délai du tour dépassé, fil refusé par le service (400, contexte trop long),
 * panne de l'API, ni texte ni carte. Le navigateur affiche le texte de la bulle qui lui correspond.
 */
export type Notice =
  | "refusal"
  | "truncated"
  | "incomplete"
  | "timeout"
  | "history"
  | "unavailable"
  | "empty";

export type RunResult = {
  messages: BetaMessageParam[];
  reply: string;
  actions: AssistantAction[];
  notice: Notice | null;
  usage: UsageReport;
};

/**
 * Classe une erreur du tour par le signal et par instanceof, jamais par le nom de la classe (cassé
 * par la minification) : délai dépassé (le signal du tour, ou le plafond du client par appel), fil
 * refusé par le service (400 : historique abîmé ou trop long), sinon service indisponible.
 */
export function failureNotice(
  e: unknown,
  signal: AbortSignal,
): "timeout" | "history" | "unavailable" {
  if (
    signal.aborted ||
    e instanceof Anthropic.APIUserAbortError ||
    e instanceof Anthropic.APIConnectionTimeoutError
  )
    return "timeout";
  if (e instanceof Anthropic.BadRequestError) return "history";
  return "unavailable";
}

/**
 * Historique rendu sans appel d'outil orphelin (B4) : un message du modèle coupé (max_tokens, pause)
 * qui demande un outil sans résultat dans le message suivant ferait refuser le tour d'après par le
 * service. Ces appels sont retirés (le message aussi s'il ne reste rien).
 */
export function withoutDanglingToolUse(messages: BetaMessageParam[]): BetaMessageParam[] {
  return messages.flatMap((m, i) => {
    if (m.role !== "assistant" || typeof m.content === "string") return [m];
    const next = messages[i + 1];
    const answered = new Set(
      next?.role === "user" && Array.isArray(next.content)
        ? next.content.flatMap((b) => (b.type === "tool_result" ? [b.tool_use_id] : []))
        : [],
    );
    const kept = m.content.filter((b) => b.type !== "tool_use" || answered.has(b.id));
    if (kept.length === m.content.length) return [m];
    return kept.length > 0 ? [{ ...m, content: kept }] : [];
  });
}

const textOf = (m: BetaMessage | undefined) =>
  (m?.content ?? [])
    .filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();

/** Un message de l'assistant : boucle d'outils de l'API (Tool Runner), 10 itérations au plus. */
export async function runAssistant(input: {
  client: Anthropic;
  ctx: AssistantContext;
  secret: string;
  locale: string;
  page: string;
  history: BetaMessageParam[];
  /** Pour les tests : délai du tour plus court que DEADLINE_MS. */
  deadlineMs?: number;
}): Promise<RunResult> {
  const { ctx } = input;
  const state: ToolState = { actions: [], called: [] };
  const usage: UsageReport = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    tools: state.called,
    error: null,
  };
  const country = ctx.organization.country;
  const context = contextPrompt({
    today: ctx.today,
    locale: input.locale,
    page: input.page,
    pageLabel: await pageLabel(input.page, input.locale, country),
    company: {
      name: ctx.organization.legalName ?? ctx.organization.name,
      country,
      currency: ctx.organization.currency,
      vatRegistered: await isVatRegistered(ctx.database, ctx.organization.id),
    },
    // Ce que le rôle permet, opération par opération (mêmes droits que les actions des écrans).
    allowed: OPERATIONS.filter((op) => !rightProblem(ctx, op)).map((op) => op.id),
  });
  const signal = AbortSignal.timeout(input.deadlineMs ?? DEADLINE_MS);
  const runner = input.client.beta.messages.toolRunner(
    {
      model: MODEL,
      max_tokens: MAX_TOKENS,
      max_iterations: MAX_ITERATIONS,
      output_config: { effort: "low" },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      // Le fil de la conversation aussi (B2) : marqueur automatique sur le dernier bloc, chaque tour
      // relit le précédent depuis le cache. Deux marqueurs en tout (avec la consigne stable), sur 4.
      cache_control: { type: "ephemeral" },
      system: [
        { type: "text", text: STABLE_PROMPT, cache_control: { type: "ephemeral" } },
        { type: "text", text: context },
      ],
      tools: buildTools(ctx, state, input.secret),
      messages: [...input.history],
    },
    { signal },
  );
  let last: BetaMessage | undefined;
  // Texte de tout le tour (B4) : le modèle parle souvent avant un outil (open_page) et finit sans
  // rien ajouter. Chaque texte une fois.
  const said: string[] = [];
  try {
    for await (const message of runner) {
      last = message;
      const text = textOf(message);
      if (text && !said.includes(text)) said.push(text);
      usage.inputTokens += message.usage.input_tokens ?? 0;
      usage.outputTokens += message.usage.output_tokens ?? 0;
      usage.cacheReadTokens += message.usage.cache_read_input_tokens ?? 0;
      usage.cacheWriteTokens += message.usage.cache_creation_input_tokens ?? 0;
    }
  } catch (e) {
    const notice = failureNotice(e, signal);
    usage.error =
      notice === "timeout"
        ? "timeout"
        : e instanceof Anthropic.APIError
          ? `api_${e.status ?? "network"}`
          : "failed";
    console.error("[assistant] appel impossible", usage.error);
    return { messages: input.history, reply: "", actions: [], notice, usage };
  }
  const stop = last?.stop_reason ?? null;
  if (stop === "refusal") {
    usage.error = "refusal";
    // Le tour refusé ne reste pas dans l'historique : la conversation peut continuer sans lui.
    return {
      messages: input.history.slice(0, -1),
      reply: "",
      actions: [],
      notice: "refusal",
      usage,
    };
  }
  if (stop === "model_context_window_exceeded") {
    usage.error = stop;
    // Le fil est trop long pour le modèle : la bulle propose une nouvelle conversation (B3).
    return { messages: input.history, reply: "", actions: [], notice: "history", usage };
  }
  // Coupé ou en pause : traité avant le texte, sans appel d'outil orphelin dans l'historique (B4).
  const messages = withoutDanglingToolUse([...runner.params.messages] as BetaMessageParam[]);
  let notice: Notice | null = null;
  if (stop === "max_tokens") notice = "truncated";
  else if (stop !== "end_turn" && stop !== "stop_sequence") notice = "incomplete";
  if (notice) usage.error = stop ?? "no_message";
  // Aucun chemin brut dans le fil (B5) : un chemin recopié devient le nom de l'écran.
  const reply = await scrubPaths(said.join("\n\n").trim(), input.locale, country);
  // Jamais muet (B4) : ni texte, ni carte, ni page ouverte → phrase de repli.
  if (!reply && state.actions.length === 0 && !notice) {
    notice = "empty";
    usage.error = "empty";
  }
  return { messages, reply, actions: state.actions, notice, usage };
}
