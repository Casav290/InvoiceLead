import Anthropic from "@anthropic-ai/sdk";
import type {
  BetaMessage,
  BetaMessageParam,
} from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { isVatRegistered } from "../invoices";
import { OPERATIONS } from "./operations";
import { type AssistantContext, rightProblem } from "./ops-core";
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
 * Temps laissé au modèle et aux outils, sous la durée de la fonction Vercel (300 s : plan Hobby avec
 * Fluid compute, src/app/api/assistant/route.ts), avec la marge pour journaliser et répondre.
 */
export const DEADLINE_MS = 270_000;

/**
 * Fin anormale d'un message : refus du modèle, réponse coupée (max_tokens), tour inachevé (plafond
 * d'itérations, pause), panne de l'API. Le navigateur affiche le texte de la bulle qui lui correspond.
 */
export type Notice = "refusal" | "truncated" | "incomplete" | "unavailable";

export type RunResult = {
  messages: BetaMessageParam[];
  reply: string;
  actions: AssistantAction[];
  notice: Notice | null;
  usage: UsageReport;
};

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
  const context = contextPrompt({
    today: ctx.today,
    locale: input.locale,
    page: input.page,
    company: {
      name: ctx.organization.legalName ?? ctx.organization.name,
      country: ctx.organization.country,
      currency: ctx.organization.currency,
      vatRegistered: await isVatRegistered(ctx.database, ctx.organization.id),
    },
    // Ce que le rôle permet, opération par opération (mêmes droits que les actions des écrans).
    allowed: OPERATIONS.filter((op) => !rightProblem(ctx, op)).map((op) => op.id),
  });
  const signal = AbortSignal.timeout(DEADLINE_MS);
  const runner = input.client.beta.messages.toolRunner(
    {
      model: MODEL,
      max_tokens: MAX_TOKENS,
      max_iterations: MAX_ITERATIONS,
      output_config: { effort: "low" },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      // Le fil de la conversation aussi : chaque tour relit le précédent depuis le cache.
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
  // Texte de tout le tour : le modèle parle souvent avant un outil (open_page) et finit sans rien ajouter.
  const said: string[] = [];
  try {
    for await (const message of runner) {
      last = message;
      const text = textOf(message);
      if (text) said.push(text);
      usage.inputTokens += message.usage.input_tokens ?? 0;
      usage.outputTokens += message.usage.output_tokens ?? 0;
      usage.cacheReadTokens += message.usage.cache_read_input_tokens ?? 0;
      usage.cacheWriteTokens += message.usage.cache_creation_input_tokens ?? 0;
    }
  } catch (e) {
    usage.error = e instanceof Anthropic.APIError ? `api_${e.status ?? "network"}` : "failed";
    console.error("[assistant] appel impossible", usage.error);
    return { messages: input.history, reply: "", actions: [], notice: "unavailable", usage };
  }
  const messages = [...runner.params.messages] as BetaMessageParam[];
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
  const reply = said.join("\n\n").trim();
  let notice: Notice | null = null;
  if (stop === "max_tokens") notice = "truncated";
  else if (stop !== "end_turn" && stop !== "stop_sequence") notice = "incomplete";
  if (notice) usage.error = stop ?? "no_message";
  return { messages, reply, actions: state.actions, notice, usage };
}
