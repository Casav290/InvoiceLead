import type { Db } from "./db";
import { feedback } from "./db/schema";

export const FEEDBACK_KINDS = ["idea", "problem", "praise"] as const;
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];

export type FeedbackInput = { kind: FeedbackKind; message: string; page: string | null };

export function parseFeedbackForm(form: FormData): FeedbackInput | null {
  const kind = String(form.get("kind") ?? "");
  const message = String(form.get("message") ?? "").trim();
  const page = String(form.get("page") ?? "").trim();
  if (!(FEEDBACK_KINDS as readonly string[]).includes(kind)) return null;
  if (message.length < 3 || message.length > 5000) return null;
  // Seul un chemin de l'application est gardé, jamais une adresse externe.
  const safePage = /^\/(de|fr)\/app[\w\-/]*$/.test(page) ? page.slice(0, 200) : null;
  return { kind: kind as FeedbackKind, message, page: safePage };
}

export async function saveFeedback(
  database: Db,
  who: { organizationId: string; userId: string },
  data: FeedbackInput,
) {
  const [row] = await database
    .insert(feedback)
    .values({ organizationId: who.organizationId, userId: who.userId, ...data })
    .returning();
  return row;
}
