import "server-only";
import { env } from "./env";

export type OutgoingEmail = {
  to: string;
  subject: string;
  text: string;
  replyTo?: string | null;
  fromName?: string;
  attachments?: { filename: string; content: Buffer }[];
};

export function emailConfigured(): boolean {
  return !!env().RESEND_API_KEY;
}

/** « Atelier Muster <factures@invoicelead.io> » : le nom de l'entreprise, l'adresse d'InvoiceLead. */
function fromHeader(fromName?: string) {
  const configured = env().EMAIL_FROM;
  if (!fromName) return configured;
  const address = configured.match(/<([^>]+)>/)?.[1] ?? configured;
  const name = fromName.replace(/["<>\r\n]/g, "").slice(0, 70);
  return `"${name}" <${address}>`;
}

/** Envoie un e-mail par l'API Resend. Rend l'identifiant du message, ou lève une erreur. */
export async function sendEmail(mail: OutgoingEmail): Promise<string> {
  const { RESEND_API_KEY, RESEND_API_URL } = env();
  if (!RESEND_API_KEY) throw new Error("email_not_configured");
  const res = await fetch(`${RESEND_API_URL.replace(/\/+$/, "")}/emails`, {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: fromHeader(mail.fromName),
      to: [mail.to],
      subject: mail.subject,
      text: mail.text,
      reply_to: mail.replyTo ? [mail.replyTo] : undefined,
      attachments: mail.attachments?.map((a) => ({
        filename: a.filename,
        content: a.content.toString("base64"),
      })),
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`email_failed_${res.status}`);
  const body = (await res.json().catch(() => ({}))) as { id?: string };
  return body.id ?? "";
}
