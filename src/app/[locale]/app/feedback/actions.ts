"use server";

import { redirect } from "next/navigation";
import { requireAppSession } from "@/server/auth/guard";
import { pickLocale } from "@/server/auth/login-cookie";
import { db } from "@/server/db";
import { emailConfigured, sendEmail } from "@/server/email";
import { env } from "@/server/env";
import { parseFeedbackForm, saveFeedback } from "@/server/feedback";

export async function sendFeedbackAction(form: FormData) {
  const locale = pickLocale(form.get("locale"));
  const session = await requireAppSession(locale);
  const data = parseFeedbackForm(form);
  const path = `/${locale}/app/feedback`;
  if (!data) redirect(`${path}?error=invalid`);
  await saveFeedback(
    db(),
    { organizationId: session.organization.id, userId: session.user.id },
    data,
  );
  const to = env().FEEDBACK_EMAIL;
  if (to && emailConfigured()) {
    try {
      await sendEmail({
        to,
        subject: `[InvoiceLead bêta] ${data.kind} · ${session.organization.name}`,
        text: `${data.message}\n\n${session.user.name} <${session.user.email}>\n${session.organization.name}\n${data.page ?? ""}`,
        replyTo: session.user.email,
      });
    } catch (e) {
      // L'avis est gardé en base ; l'e-mail n'est qu'une copie.
      console.error("[feedback] e-mail", e instanceof Error ? e.message : "inconnu");
    }
  }
  redirect(`${path}?sent=1`);
}
