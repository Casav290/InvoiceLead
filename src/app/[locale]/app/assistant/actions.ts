"use server";

import { aiConfigured } from "@/server/ai";
import { type AssistantAnswer, askAssistant } from "@/server/assistant";
import { requirePermission } from "@/server/auth/guard";
import { pickLocale } from "@/server/auth/login-cookie";
import { db } from "@/server/db";
import { hasFeature } from "@/server/plans";

export type AssistantState = {
  question?: string;
  result?: AssistantAnswer;
  error?: "plan" | "off" | "empty" | "failed";
  round: number;
};

export async function askAction(prev: AssistantState, form: FormData): Promise<AssistantState> {
  const locale = pickLocale(form.get("locale"));
  const session = await requirePermission(locale, "accounting");
  const round = prev.round + 1;
  const question = String(form.get("question") ?? "");
  if (!hasFeature(session.organization, "assistant")) return { round, question, error: "plan" };
  if (!aiConfigured()) return { round, question, error: "off" };
  const result = await askAssistant(
    db(),
    { organizationId: session.organization.id, userId: session.user.id },
    question,
    locale,
  );
  if (typeof result === "string") return { round, question, error: result };
  return { round, question, result };
}
