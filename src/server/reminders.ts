import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { formatDate } from "@/lib/fiscal-year";
import { formatAmount } from "@/lib/money";
import type { Db } from "./db";
import {
  auditLog,
  contacts,
  invoiceReminders,
  invoices,
  memberships,
  organizations,
} from "./db/schema";
import { buildDocumentPdf } from "./document-pdf";
import { emailConfigured, sendEmail } from "./email";
import { getInvoice } from "./invoices";
import { LedgerError, postPending, reverseEntry } from "./ledger";
import { invoiceBalance } from "./payments";
import { hasFeature } from "./plans";
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
  currency: string;
  /** Montant de la facture encore ouvert, sans les frais. */
  openCents: number;
  level: number;
  daysLate: number;
  /** Frais de rappel ajoutés par cette relance. */
  feeCents: number;
  /** Intérêts moratoires courus depuis la relance précédente. */
  interestCents: number;
  /** Total réclamé : facture ouverte, frais et intérêts déjà réclamés, et ceux de cette relance. */
  totalDueCents: number;
};

/** Intérêt moratoire simple, sur 365 jours. */
export function lateInterest(openCents: number, rateBp: number | null, daysLate: number): number {
  if (!rateBp || rateBp <= 0 || openCents <= 0 || daysLate <= 0) return 0;
  return Math.round((openCents * rateBp * daysLate) / 10_000 / 365);
}

/** Relances dues aujourd'hui : factures ouvertes, échues, dont le niveau suivant est atteint. */
export async function dueReminders(
  database: Db,
  organizationId: string,
  today: string,
): Promise<DueReminder[]> {
  const [org] = await database
    .select()
    .from(organizations)
    .where(eq(organizations.id, organizationId));
  if (!org) return [];
  // Formule gratuite : la première relance seulement, sans frais ni intérêts.
  const pro = hasFeature(org, "reminders");
  const maxLevel = pro ? REMINDER_DAYS.length : 1;
  const rows = await database
    .select({
      id: invoices.id,
      number: invoices.number,
      total: invoices.totalCents,
      currency: invoices.currency,
      dueDate: invoices.dueDate,
      customer: contacts.name,
      email: contacts.email,
      lastLevel:
        sql<number>`coalesce((select max(r.level) from invoice_reminders r where r.invoice_id = ${invoices.id}), 0)`.mapWith(
          Number,
        ),
      interestSoFar:
        sql<number>`coalesce((select sum(r.interest_cents) from invoice_reminders r where r.invoice_id = ${invoices.id} and r.waived_at is null), 0)`.mapWith(
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
    if (level > maxLevel || days === undefined || addDays(r.dueDate, days) > today) continue;
    const balance = await invoiceBalance(database, r.id, r.total);
    const charged = balance.chargesCents ?? 0;
    const open = balance.openCents - charged;
    if (open <= 0) continue;
    const daysLate = Math.round(
      (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${r.dueDate}T00:00:00Z`)) / 86_400_000,
    );
    // Frais et intérêts : formule Pro, factures dans la monnaie de l'entreprise.
    const charges = pro && r.currency === org.currency;
    const feeCents = charges && level >= 2 ? org.reminderFeeCents : 0;
    const interestCents = charges
      ? Math.max(0, lateInterest(open, org.lateInterestBp, daysLate) - r.interestSoFar)
      : 0;
    out.push({
      invoiceId: r.id,
      number: r.number ?? "",
      customer: r.customer,
      email: r.email,
      dueDate: r.dueDate,
      currency: r.currency,
      openCents: open,
      level,
      daysLate,
      feeCents,
      interestCents,
      totalDueCents: open + charged + feeCents + interestCents,
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
      amount: formatAmount(due.totalDueCents),
      currency: invoice.currency,
      due: formatDate(invoice.dueDate),
      company: invoice.sender?.name ?? "",
    };
    // Détail des frais et intérêts réclamés, sous le texte de la relance.
    const charged = due.totalDueCents - due.openCents;
    const detail =
      charged > 0
        ? `\n\n${t("charges", {
            currency: invoice.currency,
            open: formatAmount(due.openCents),
            charges: formatAmount(charged),
            total: formatAmount(due.totalDueCents),
          })}`
        : "";
    try {
      await sendEmail({
        to: due.email,
        subject: t(`subject${due.level}`, values),
        text: `${t(`body${due.level}`, values)}${detail}\n\n${t("link")} ${token ? shareUrl(invoice.language, token) : ""}`.trim(),
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
      feeCents: due.feeCents,
      interestCents: due.interestCents,
    })
    .onConflictDoNothing();
  await database.insert(auditLog).values({
    organizationId: who.organizationId,
    userId: who.userId,
    action: "invoice.reminder",
    entity: "invoice",
    entityId: invoiceId,
    data: {
      level: due.level,
      channel: manual ? "manual" : "email",
      feeCents: due.feeCents,
      interestCents: due.interestCents,
    },
  });
  if (due.feeCents + due.interestCents > 0) {
    // Frais et intérêts : créance contre produit financier, comptabilisés tout de suite si possible.
    try {
      await postPending(database, who);
    } catch (e) {
      console.error(
        "[ledger] comptabilisation reportée",
        e instanceof Error ? e.message : "inconnu",
      );
    }
  }
  return manual ? "recorded" : "sent";
}

/**
 * Renonce aux frais et intérêts encore dus d'une facture (client de bonne foi, geste commercial) :
 * ils sortent du solde, et leurs écritures sont extournées dans la même transaction.
 */
export async function waiveCharges(
  database: Db,
  who: Who,
  invoiceId: string,
  today: string,
): Promise<number | "closed"> {
  try {
    return await database.transaction(async (tx) => {
      const rows = await tx
        .update(invoiceReminders)
        .set({ waivedAt: new Date() })
        .where(
          and(
            eq(invoiceReminders.organizationId, who.organizationId),
            eq(invoiceReminders.invoiceId, invoiceId),
            isNull(invoiceReminders.waivedAt),
            sql`${invoiceReminders.feeCents} + ${invoiceReminders.interestCents} > 0`,
          ),
        )
        .returning();
      for (const r of rows) {
        if (r.journalEntryId)
          await reverseEntry(
            tx as unknown as Db,
            who,
            r.journalEntryId,
            "reminder_waiver",
            r.id,
            today,
          );
      }
      const total = rows.reduce((s, r) => s + r.feeCents + r.interestCents, 0);
      if (rows.length > 0)
        await tx.insert(auditLog).values({
          organizationId: who.organizationId,
          userId: who.userId,
          action: "invoice.reminder_waive",
          entity: "invoice",
          entityId: invoiceId,
          data: { cents: total },
        });
      return total;
    });
  } catch (e) {
    if (e instanceof LedgerError) return "closed";
    throw e;
  }
}

/**
 * Tâche quotidienne : pour chaque entreprise Pro qui l'a activé, envoie les relances dues qui ont
 * une adresse e-mail. Les relances sont faites au nom d'un administrateur de l'entreprise.
 */
export async function runAutoReminders(database: Db, today: string) {
  const orgs = await database
    .select()
    .from(organizations)
    .where(eq(organizations.reminderAuto, true));
  let sent = 0;
  for (const org of orgs) {
    if (!hasFeature(org, "reminders")) continue;
    const [admin] = await database
      .select({ userId: memberships.userId })
      .from(memberships)
      .where(
        and(
          eq(memberships.organizationId, org.id),
          inArray(memberships.role, ["admin", "manager"]),
        ),
      )
      .orderBy(memberships.createdAt)
      .limit(1);
    if (!admin) continue;
    const r = await sendAllReminders(
      database,
      { organizationId: org.id, userId: admin.userId },
      today,
    );
    sent += r.sent;
  }
  return { sent };
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
