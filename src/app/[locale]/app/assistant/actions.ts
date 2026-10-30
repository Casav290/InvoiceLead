"use server";

import { aiConfigured } from "@/server/ai";
import { type AssistantAnswer, askAssistant } from "@/server/assistant";
import { requirePermission } from "@/server/auth/guard";
import { pickLocale } from "@/server/auth/login-cookie";
import { db } from "@/server/db";
import { assistantBudget, type BudgetView, budgetView } from "@/server/plans";

export type AssistantState = {
  question?: string;
  result?: AssistantAnswer;
  /** « busy » : une demande est déjà en cours (formule gratuite, L9) ; ce n'est pas la fin du mois. */
  error?: "quota" | "off" | "empty" | "failed" | "busy";
  /** Formule gratuite : ce qui reste ce mois-ci, pour tenir le compteur à jour sans recharger. */
  budget?: BudgetView | null;
  round: number;
};

/**
 * Formule gratuite : le budget de jetons de l'assistant IA (commun avec la bulle) ; une fois atteint,
 * le serveur refuse avant tout appel à l'IA (« quota »).
 */
export async function askAction(prev: AssistantState, form: FormData): Promise<AssistantState> {
  const locale = pickLocale(form.get("locale"));
  const session = await requirePermission(locale, "accounting");
  const round = prev.round + 1;
  const question = String(form.get("question") ?? "");
  if (!aiConfigured()) return { round, question, error: "off" };
  const result = await askAssistant(
    db(),
    { organizationId: session.organization.id, userId: session.user.id },
    question,
    locale,
  );
  const budget = budgetView(await assistantBudget(db(), session.organization));
  if (typeof result === "string") return { round, question, error: result, budget };
  return { round, question, result, budget };
}
