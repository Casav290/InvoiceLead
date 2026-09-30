import "server-only";
import { env } from "./env";

export function aiConfigured(): boolean {
  return !!env().AI_API_KEY;
}

type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export type ChatMessage = { role: "system" | "user"; content: string | ContentPart[] };

/**
 * Appel d'un modèle par l'API « chat completions » compatible OpenAI (Z.ai GLM par défaut), avec une
 * réponse JSON. La réponse est lue avec prudence : l'appelant la valide toujours contre ses données.
 */
export async function chatJson(
  messages: ChatMessage[],
  options: { vision?: boolean } = {},
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
  const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const content = body.choices?.[0]?.message?.content ?? "";
  // Certains modèles entourent le JSON d'un bloc ```json … ```.
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("ai_no_json");
  return JSON.parse(content.slice(start, end + 1));
}
