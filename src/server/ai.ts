import "server-only";
import { env } from "./env";

export function aiConfigured(): boolean {
  return !!env().AI_API_KEY;
}

type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export type ChatMessage = { role: "system" | "user"; content: string | ContentPart[] };

/** Jetons d'une réponse, tels que l'API les compte (cached_tokens : partie déjà en cache de l'entrée). */
export type AiUsage = { inputTokens: number; outputTokens: number; cacheReadTokens: number };

/**
 * Appel d'un modèle par l'API « chat completions » compatible OpenAI (Z.ai GLM par défaut), avec une
 * réponse JSON. La réponse est lue avec prudence : l'appelant la valide toujours contre ses données.
 */
export async function chatJson(
  messages: ChatMessage[],
  options: {
    vision?: boolean;
    /**
     * Appelée dès que le modèle a répondu (avant de lire son JSON) avec les jetons de la réponse, ou
     * null si l'API ne les donne pas.
     */
    onUsage?: (usage: AiUsage | null) => void;
  } = {},
): Promise<unknown> {
  const { AI_API_KEY, AI_BASE_URL, AI_MODEL, AI_VISION_MODEL } = env();
  if (!AI_API_KEY) throw new Error("ai_not_configured");
  const res = await fetch(`${AI_BASE_URL.replace(/\/+$/, "")}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${AI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: options.vision ? AI_VISION_MODEL : AI_MODEL,
      messages,
      temperature: 0,
      // Les modèles de vision n'acceptent pas toujours le format JSON imposé : la consigne suffit.
      ...(options.vision ? {} : { response_format: { type: "json_object" } }),
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`ai_failed_${res.status}`);
  const body = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      prompt_tokens_details?: { cached_tokens?: number } | null;
    };
  };
  if (options.onUsage) {
    const u = body.usage;
    const prompt = Number(u?.prompt_tokens);
    const cached = Number(u?.prompt_tokens_details?.cached_tokens ?? 0) || 0;
    const output = Number(u?.completion_tokens);
    options.onUsage(
      Number.isFinite(prompt) && Number.isFinite(output)
        ? {
            inputTokens: Math.max(0, prompt - cached),
            cacheReadTokens: cached,
            outputTokens: output,
          }
        : null,
    );
  }
  const content = body.choices?.[0]?.message?.content ?? "";
  // Certains modèles entourent le JSON d'un bloc ```json … ```.
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("ai_no_json");
  return JSON.parse(content.slice(start, end + 1));
}

/** Langue des réponses de l'assistant, pour les consignes. */
export function aiLanguageName(language: string): string {
  if (language === "fr") return "French";
  if (language === "en") return "British English";
  if (language === "it") return "Italian";
  if (language === "es") return "Spanish";
  return "Swiss German (no ß)";
}
