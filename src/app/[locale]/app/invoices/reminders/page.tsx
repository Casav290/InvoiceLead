import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Button } from "@/components/ui/button";
import { countryPack } from "@/countries";
import { Link } from "@/i18n/navigation";
import { formatDate } from "@/lib/fiscal-year";
import { formatAmount } from "@/lib/money";
import { requireAppSession } from "@/server/auth/guard";
import { db } from "@/server/db";
import { emailConfigured } from "@/server/email";
import { dueReminders } from "@/server/reminders";
import { sendAllRemindersAction, sendReminderAction } from "./actions";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ result?: string; sent?: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "app.reminders" });
  return { title: t("title"), robots: { index: false } };
}

const RESULTS = ["sent", "recorded", "notDue", "noEmail", "failed"];

export default async function RemindersPage({ params, searchParams }: Props) {
  const { locale } = await params;
  const { organization } = await requireAppSession(locale);
  const q = await searchParams;
  const t = await getTranslations({ locale, namespace: "app.reminders" });
  const rows = await dueReminders(db(), organization.id, new Date().toISOString().slice(0, 10));
  const canEmail = emailConfigured();
  const hidden = <input type="hidden" name="locale" value={locale} />;
  const ok = q.result === "sent" || q.result === "recorded";

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-8">
      <p className="text-[13px]">
        <Link href="/app/invoices" className="font-semibold text-accent-dark hover:underline">
          {t("back")}
        </Link>
      </p>
      <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
        <h1 className="text-[28px] leading-tight">{t("title")}</h1>
        {canEmail && rows.some((r) => r.email) ? (
          <form action={sendAllRemindersAction}>
            {hidden}
            <Button type="submit" data-testid="reminders-send-all">
              {t("sendAll")}
            </Button>
          </form>
        ) : null}
      </div>
      <p className="mt-2 text-[15px] text-ink-muted">{t("subtitle")}</p>
      {q.result && RESULTS.includes(q.result) ? (
        <p
          role={ok ? "status" : "alert"}
          className={`mt-6 border px-4 py-3 text-[13px] ${ok ? "border-ok-fg bg-ok-bg text-ok-fg" : "border-hot-fg bg-hot-bg text-hot-fg"}`}
        >
          {t(`results.${q.result}`)}
        </p>
      ) : null}
      {q.sent !== undefined ? (
        <p
          role="status"
          className="mt-6 border border-ok-fg bg-ok-bg px-4 py-3 text-[13px] text-ok-fg"
        >
          {t("sentCount", { count: Number(q.sent) || 0 })}
        </p>
      ) : null}

      {rows.length === 0 ? (
        <p className="mt-8 border border-line-strong bg-panel px-5 py-8 text-center text-[14px] text-ink-muted">
          {t("empty")}
        </p>
      ) : (
        <ul className="mt-6 space-y-3" data-testid="reminders-list">
          {rows.map((r) => (
            <li
              key={r.invoiceId}
              className="border border-line-strong bg-panel px-4 py-3"
              data-testid="reminder-row"
            >
              <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                <Link
                  href={`/app/invoices/${r.invoiceId}`}
                  className="font-semibold text-accent-dark hover:underline"
                >
                  {r.number}
                </Link>
                <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{r.customer}</span>
                <span className="font-extrabold tabular-nums">
                  {formatAmount(r.openCents, countryPack(organization.country).amounts)}
                </span>
              </div>
              <p className="mt-1 text-[12px] text-ink-2">
                {t("line", { level: r.level, days: r.daysLate, due: formatDate(r.dueDate) })}
                {r.email ? "" : ` · ${t("noEmail")}`}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {canEmail && r.email ? (
                  <form action={sendReminderAction}>
                    {hidden}
                    <input type="hidden" name="id" value={r.invoiceId} />
                    <Button type="submit" size="sm" data-testid="reminder-send">
                      {t("send")}
                    </Button>
                  </form>
                ) : null}
                <form action={sendReminderAction}>
                  {hidden}
                  <input type="hidden" name="id" value={r.invoiceId} />
                  <input type="hidden" name="manual" value="1" />
                  <Button type="submit" variant="ghost" size="sm">
                    {t("markManual")}
                  </Button>
                </form>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
