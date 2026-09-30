import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { formatDate } from "@/lib/fiscal-year";
import { formatAmount } from "@/lib/money";
import type { Db } from "./db";
import { auditLog, contacts, invoiceReminders, invoices } from "./db/schema";
import { buildDocumentPdf } from "./document-pdf";
import { emailConfigured, sendEmail } from "./email";
import { getInvoice } from "./invoices";
import { invoiceBalance } from "./payments";
import { enableShareLink, shareUrl } from "./sharing";

type Who = { organizationId: string; userId: string };

/** Jours après l'échéance où chaque niveau de relance devient dû (usage courant en Suisse). */
export const REMINDER_DAYS = [10, 25, 40] as const;

function addDays(iso: string, days: number) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export type DueReminder = {
  invoiceId: string;
  number: string;
  customer: string;
  email: string | null;
  dueDate: string;
  openCents: number;
  level: number;
  daysLate: number;
};

/** Relances dues aujourd'hui : factures ouvertes, échues, dont le niveau suivant est atteint. */
export async function dueReminders(
  database: Db,
  organizationId: string,
  today: string,
): Promise<DueReminder[]> {
  const rows = await database
    .select({
      id: invoices.id,
      number: invoices.number,
      total: invoices.totalCents,
      dueDate: invoices.dueDate,
      customer: contacts.name,
      email: contacts.email,
      lastLevel:
        sql<number>`coalesce((select max(r.level) from invoice_reminders r where r.invoice_id = ${invoices.id}), 0)`.mapWith(
          Number,
        ),
    })
    .from(invoices)
    .innerJoin(contacts, eq(contacts.id, invoices.contactId))
    .where(
      and(
        eq(invoices.organizationId, organizationId),
        eq(invoices.kind, "invoice"),
        eq(invoices.status, "issued"),
        sql`${invoices.dueDate} < ${today}`,
      ),
    )
    .orderBy(invoices.dueDate);
  const out: DueReminder[] = [];
  for (const r of rows) {
    const level = r.lastLevel + 1;
    const days = REMINDER_DAYS[level - 1];
    if (days === undefined || addDays(r.dueDate, days) > today) continue;
    const balance = await invoiceBalance(database, r.id, r.total);
    if (balance.openCents <= 0) continue;
    const daysLate = Math.round(
      (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${r.dueDate}T00:00:00Z`)) / 86_400_000,
    );
    out.push({
      invoiceId: r.id,
      number: r.number ?? "",
      customer: r.customer,
      email: r.email,
      dueDate: r.dueDate,
      openCents: balance.openCents,
      level,
      daysLate,
    });
  }
  return out;
}

export async function listReminders(database: Db, organizationId: string, invoiceId: string) {
  return database
    .select()
    .from(invoiceReminders)
    .where(
      and(
        eq(invoiceReminders.organizationId, organizationId),
        eq(invoiceReminders.invoiceId, invoiceId),
      ),
    )
    .orderBy(desc(invoiceReminders.level));
}

export type ReminderResult = "sent" | "recorded" | "notDue" | "noEmail" | "failed";

/**
 * Envoie la relance due d'une facture : e-mail dans la langue de la facture, avec le PDF (et sa
 * QR-facture) et le lien de consultation. `manual` note seulement une relance faite autrement.
 */
export async function sendReminder(
  database: Db,
  who: Who,
  invoiceId: string,
  today: string,
  manual = false,
): Promise<ReminderResult> {
  const due = (await dueReminders(database, who.organizationId, today)).find(
    (d) => d.invoiceId === invoiceId,
  );
  if (!due) return "notDue";
  if (!manual) {
    if (!emailConfigured() || !due.email) return "noEmail";
    const found = await getInvoice(database, who.organizationId, invoiceId);
    if (!found) return "notDue";
    const { invoice, lines, related } = found;
    const t = await getTranslations({ locale: invoice.language, namespace: "app.reminders.email" });
    const token = await enableShareLink(database, who.organizationId, invoiceId);
    const pdf = await buildDocumentPdf(invoice, lines, related);
    const values = {
      number: invoice.number ?? "",
      amount: formatAmount(due.openCents),
      currency: invoice.currency,
      due: formatDate(invoice.dueDate),
      company: invoice.sender?.name ?? "",
    };
    try {
      await sendEmail({
        to: due.email,
        subject: t(`subject${due.level}`, values),
        text: `${t(`body${due.level}`, values)}\n\n${t("link")} ${token ? shareUrl(invoice.language, token) : ""}`.trim(),
        replyTo: invoice.sender?.email ?? null,
        fromName: invoice.sender?.name,
        attachments: [{ filename: pdf.filename, content: pdf.pdf }],
      });
    } catch (e) {
      console.error("[reminder] échec", e instanceof Error ? e.message : "inconnu");
      return "failed";
    }
  }
  await database
    .insert(invoiceReminders)
    .values({
      organizationId: who.organizationId,
      invoiceId,
      level: due.level,
      channel: manual ? "manual" : "email",
      sentTo: manual ? null : due.email,
      sentBy: who.userId,
    })
    .onConflictDoNothing();
  await database.insert(auditLog).values({
    organizationId: who.organizationId,
    userId: who.userId,
    action: "invoice.reminder",
    entity: "invoice",
    entityId: invoiceId,
    data: { level: due.level, channel: manual ? "manual" : "email" },
  });
  return manual ? "recorded" : "sent";
}

/** « Tout envoyer » : chaque relance due qui a une adresse e-mail. */
export async function sendAllReminders(database: Db, who: Who, today: string) {
  const due = await dueReminders(database, who.organizationId, today);
  let sent = 0;
  for (const d of due.filter((x) => x.email)) {
    if ((await sendReminder(database, who, d.invoiceId, today)) === "sent") sent += 1;
  }
  return { sent, remaining: due.length - sent };
}

export async function remindersFor(database: Db, organizationId: string, invoiceIds: string[]) {
  if (invoiceIds.length === 0) return [];
  return database
    .select()
    .from(invoiceReminders)
    .where(
      and(
        eq(invoiceReminders.organizationId, organizationId),
        inArray(invoiceReminders.invoiceId, invoiceIds),
      ),
    );
}
