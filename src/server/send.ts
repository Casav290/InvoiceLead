import "server-only";
import { and, eq } from "drizzle-orm";
import type { Db } from "./db";
import { auditLog, invoices } from "./db/schema";
import { buildDocumentPdf } from "./document-pdf";
import { emailConfigured, sendEmail } from "./email";
import { getInvoice } from "./invoices";
import { enableShareLink, shareUrl } from "./sharing";

type Who = { organizationId: string; userId: string };

export type SendInput = { to: string; subject: string; message: string };

export function parseSendForm(
  form: FormData,
): { ok: true; data: SendInput } | { ok: false; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const to = String(form.get("to") ?? "").trim();
  if (!/^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(to)) errors.to = "email";
  const subject = String(form.get("subject") ?? "").trim();
  if (!subject) errors.subject = "required";
  else if (subject.length > 200) errors.subject = "tooLong";
  const message = String(form.get("message") ?? "").trim();
  if (message.length > 5000) errors.message = "tooLong";
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, data: { to, subject, message } };
}

export type SendResult = "sent" | "notFound" | "notConfigured" | "failed";

/**
 * Envoie une pièce émise par e-mail : message saisi, lien de consultation ajouté à la fin et PDF en
 * pièce jointe. Les réponses du client vont à l'adresse de l'entreprise.
 */
export async function sendDocument(
  database: Db,
  who: Who,
  invoiceId: string,
  data: SendInput,
  linkLabel: string,
): Promise<SendResult> {
  if (!emailConfigured()) return "notConfigured";
  const found = await getInvoice(database, who.organizationId, invoiceId);
  if (!found || found.invoice.status === "draft") return "notFound";
  const { invoice, lines, related } = found;
  const token = await enableShareLink(database, who.organizationId, invoiceId);
  if (!token) return "notFound";
  const url = shareUrl(invoice.language, token);
  const attachment = await buildDocumentPdf(invoice, lines, related);
  try {
    await sendEmail({
      to: data.to,
      subject: data.subject,
      text: `${data.message}\n\n${linkLabel} ${url}`.trim(),
      replyTo: invoice.sender?.email ?? null,
      fromName: invoice.sender?.name,
      attachments: [{ filename: attachment.filename, content: attachment.pdf }],
    });
  } catch (e) {
    // Aucune donnée personnelle dans le journal : seulement le code d'erreur.
    console.error("[send] échec", e instanceof Error ? e.message : "inconnu");
    return "failed";
  }
  await database
    .update(invoices)
    .set({ sentAt: new Date(), sentTo: data.to })
    .where(and(eq(invoices.id, invoiceId), eq(invoices.organizationId, who.organizationId)));
  await database.insert(auditLog).values({
    organizationId: who.organizationId,
    userId: who.userId,
    action: `${invoice.kind}.send`,
    entity: invoice.kind,
    entityId: invoiceId,
  });
  return "sent";
}
