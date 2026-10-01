import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { LockNote, ProBadge, ProLock } from "@/components/app/ProLock";
import { Button } from "@/components/ui/button";
import { countryPack } from "@/countries";
import { Link } from "@/i18n/navigation";
import { formatDate } from "@/lib/fiscal-year";
import { formatAmount } from "@/lib/money";
import { requireAppSession } from "@/server/auth/guard";
import { expectedCollections } from "@/server/collections";
import { db } from "@/server/db";
import { emailConfigured } from "@/server/email";
import { lockFor, planLock } from "@/server/plan-lock";
import { featureAccess, quotaAccess } from "@/server/plans";
import { dueReminders } from "@/server/reminders";
import { can } from "@/server/roles";
import { saveReminderSettingsAction, sendAllRemindersAction, sendReminderAction } from "./actions";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ result?: string; sent?: string; settings?: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "app.reminders" });
  return { title: t("title"), robots: { index: false } };
}

const RESULTS = ["sent", "recorded", "notDue", "noEmail", "failed", "plan"];

export default async function RemindersPage({ params, searchParams }: Props) {
  const { locale } = await params;
  const session = await requireAppSession(locale);
  const { organization } = session;
  const canSetup = can(session.membership, "company");
  const amounts = countryPack(organization.country).amounts;
  const q = await searchParams;
  const t = await getTranslations({ locale, namespace: "app.reminders" });
  const today = new Date().toISOString().slice(0, 10);
  const rows = await dueReminders(db(), organization.id, today);
  const forecast = await expectedCollections(db(), organization.id, organization.currency, today);
  const forecastTotal =
    forecast.weeks.reduce((s, w) => s + w.expectedCents, 0) + forecast.laterCents;
  const canEmail = emailConfigured();
  const hidden = <input type="hidden" name="locale" value={locale} />;
  const ok = q.result === "sent" || q.result === "recorded";
  const tp = await getTranslations({ locale, namespace: "app.plan" });
  // Formule gratuite : première relance à la main, 5 par mois ; les relances suivantes, l'envoi
  // automatique, les frais et les intérêts restent visibles, grisés, avec la marque Pro.
  const sends = await quotaAccess(db(), organization, "reminders");
  const usedUp = tp("used.reminders", { limit: sends.limit, plan: sends.tier });
  const sendLock = await lockFor(locale, organization, sends, usedUp);
  const settingsLock = await lockFor(
    locale,
    organization,
    featureAccess(organization, "reminderAuto"),
    t("settings.plan"),
  );
  const levelLock = featureAccess(organization, "reminderLevels").allowed
    ? null
    : await planLock(locale, organization, "pro", t("levelPlan"));
  const sendable = rows.filter((r) => !r.locked);
  const settingsForm = (
    <form action={saveReminderSettingsAction} className="grid gap-4 p-5 sm:grid-cols-2">
      {hidden}
      <label className="flex items-start gap-3 sm:col-span-2">
        <input
          type="checkbox"
          name="auto"
          defaultChecked={organization.reminderAuto}
          disabled={!canSetup}
          className="mt-1 h-4 w-4 accent-accent"
        />
        <span>
          <span className="block text-[14px] font-semibold">{t("settings.auto")}</span>
          <span className="block text-[12px] text-ink-muted">{t("settings.autoHint")}</span>
        </span>
      </label>
      <label className="block">
        <span className="mb-1 block text-[13px] font-semibold">
          {t("settings.fee", { currency: organization.currency })}
        </span>
        <input
          name="fee"
          defaultValue={
            organization.reminderFeeCents ? formatAmount(organization.reminderFeeCents) : ""
          }
          disabled={!canSetup}
          inputMode="decimal"
          className="h-10 w-full border border-line-strong bg-panel px-3 text-[14px] disabled:bg-muted"
        />
        <span className="mt-1 block text-[12px] text-ink-muted">{t("settings.feeHint")}</span>
      </label>
      <label className="block">
        <span className="mb-1 block text-[13px] font-semibold">{t("settings.interest")}</span>
        <input
          name="interest"
          defaultValue={
            organization.lateInterestBp ? String(organization.lateInterestBp / 100) : ""
          }
          disabled={!canSetup}
          inputMode="decimal"
          className="h-10 w-full border border-line-strong bg-panel px-3 text-[14px] disabled:bg-muted"
        />
        <span className="mt-1 block text-[12px] text-ink-muted">
          {t(`settings.interestHint.${organization.country}`)}
        </span>
      </label>
      {canSetup ? (
        <div className="sm:col-span-2">
          <Button type="submit" variant="secondary" data-testid="reminder-settings-save">
            {t("settings.save")}
          </Button>
        </div>
      ) : null}
    </form>
  );

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-8">
      <p className="text-[13px]">
        <Link href="/app/invoices" className="font-semibold text-accent-dark hover:underline">
          {t("back")}
        </Link>
      </p>
      <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
        <h1 className="text-[28px] leading-tight">{t("title")}</h1>
        {canEmail && sendable.some((r) => r.email) ? (
          <form action={sendAllRemindersAction} className="inline-flex items-center gap-2">
            {hidden}
            <Button
              type="submit"
              disabled={!!sendLock}
              aria-disabled={sendLock ? true : undefined}
              aria-describedby={sendLock ? "reminders-lock-reason" : undefined}
              data-testid="reminders-send-all"
            >
              {t("sendAll")}
            </Button>
            {sendLock?.tier ? <ProBadge tier={sendLock.tier} /> : null}
          </form>
        ) : null}
      </div>
      <p className="mt-2 text-[15px] text-ink-muted">{t("subtitle")}</p>
      {Number.isFinite(sends.limit) ? (
        <p className="mt-2 text-[13px] text-ink-2" data-testid="reminders-quota">
          {tp("quota.reminders", { used: sends.used, limit: sends.limit })}
        </p>
      ) : null}
      {sendLock ? (
        <LockNote
          lock={sendLock}
          id="reminders-lock-reason"
          testId="reminders-lock"
          className="mt-3 border border-line-strong bg-muted px-4 py-3"
        />
      ) : null}
      {q.result === "quota" ? (
        <p
          role="alert"
          className="mt-6 border border-hot-fg bg-hot-bg px-4 py-3 text-[13px] text-hot-fg"
        >
          {usedUp}
        </p>
      ) : null}
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
              className={`border border-line-strong px-4 py-3 ${r.locked ? "bg-muted text-ink-muted" : "bg-panel"}`}
              data-testid={r.locked ? "reminder-row-locked" : "reminder-row"}
            >
              <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                <Link
                  href={`/app/invoices/${r.invoiceId}`}
                  className="font-semibold text-accent-dark hover:underline"
                >
                  {r.number}
                </Link>
                <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{r.customer}</span>
                <span className="font-extrabold tabular-nums" data-testid="reminder-total">
                  {r.currency} {formatAmount(r.totalDueCents, amounts)}
                </span>
              </div>
              <p className="mt-1 text-[12px] text-ink-2">
                {r.level === 0
                  ? t("courtesyLine", { due: formatDate(r.dueDate) })
                  : t("line", { level: r.level, days: r.daysLate, due: formatDate(r.dueDate) })}
                {r.risk !== "unknown"
                  ? ` · ${t(`profile.${r.risk}`, { days: Math.round(r.avgDaysLate ?? 0) })}`
                  : ""}
                {r.email ? "" : ` · ${t("noEmail")}`}
              </p>
              {r.totalDueCents > r.openCents ? (
                <p className="mt-1 text-[12px] text-ink-2" data-testid="reminder-charges">
                  {t("chargesLine", {
                    open: formatAmount(r.openCents, amounts),
                    fee: formatAmount(r.feeCents, amounts),
                    interest: formatAmount(r.interestCents, amounts),
                    before: formatAmount(
                      r.totalDueCents - r.openCents - r.feeCents - r.interestCents,
                      amounts,
                    ),
                  })}
                </p>
              ) : null}
              {r.locked && levelLock ? (
                <LockNote lock={levelLock} testId="reminder-level-lock" className="mt-2" />
              ) : (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {canEmail && r.email ? (
                    <form action={sendReminderAction}>
                      {hidden}
                      <input type="hidden" name="id" value={r.invoiceId} />
                      <Button
                        type="submit"
                        size="sm"
                        disabled={!!sendLock}
                        aria-disabled={sendLock ? true : undefined}
                        aria-describedby={sendLock ? "reminders-lock-reason" : undefined}
                        data-testid="reminder-send"
                      >
                        {t("send")}
                      </Button>
                    </form>
                  ) : null}
                  <form action={sendReminderAction}>
                    {hidden}
                    <input type="hidden" name="id" value={r.invoiceId} />
                    <input type="hidden" name="manual" value="1" />
                    <Button
                      type="submit"
                      variant="ghost"
                      size="sm"
                      disabled={!!sendLock}
                      aria-disabled={sendLock ? true : undefined}
                      aria-describedby={sendLock ? "reminders-lock-reason" : undefined}
                      data-testid="reminder-mark"
                    >
                      {t("markManual")}
                    </Button>
                  </form>
                  {sendLock?.tier ? <ProBadge tier={sendLock.tier} /> : null}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <section className="mt-10 border border-line-strong bg-panel" data-testid="forecast">
        <h2 className="border-b border-line bg-head px-5 py-3 text-[10.5px] font-extrabold tracking-[0.09em] text-ink-muted uppercase">
          {t("forecastTitle")}
        </h2>
        <p className="px-5 pt-3 text-[12px] text-ink-muted">{t("forecastHint")}</p>
        {forecastTotal === 0 ? (
          <p className="px-5 py-4 text-[13px] text-ink-2">{t("forecastEmpty")}</p>
        ) : (
          <ul className="px-5 py-3 text-[13px]">
            {forecast.weeks
              .filter((w) => w.expectedCents > 0)
              .map((w) => (
                <li
                  key={w.weekStart}
                  className="flex justify-between gap-4 border-b border-line py-2 last:border-b-0"
                  data-testid="forecast-week"
                >
                  <span>{t("week", { date: formatDate(w.weekStart) })}</span>
                  <span className="font-semibold tabular-nums">
                    {organization.currency} {formatAmount(w.expectedCents, amounts)}
                  </span>
                </li>
              ))}
            {forecast.laterCents > 0 ? (
              <li className="flex justify-between gap-4 py-2">
                <span>{t("later")}</span>
                <span className="font-semibold tabular-nums">
                  {organization.currency} {formatAmount(forecast.laterCents, amounts)}
                </span>
              </li>
            ) : null}
          </ul>
        )}
      </section>

      <section className="mt-10 border border-line-strong bg-panel" data-testid="reminder-settings">
        <h2 className="border-b border-line bg-head px-5 py-3 text-[10.5px] font-extrabold tracking-[0.09em] text-ink-muted uppercase">
          {t("settings.title")}
        </h2>
        {q.settings ? (
          <p
            role={q.settings === "saved" ? "status" : "alert"}
            className={`mx-5 mt-4 border px-4 py-3 text-[13px] ${q.settings === "saved" ? "border-ok-fg bg-ok-bg text-ok-fg" : "border-hot-fg bg-hot-bg text-hot-fg"}`}
          >
            {t(
              `settings.results.${["saved", "plan", "invalidFee", "invalidRate"].includes(q.settings) ? q.settings : "saved"}`,
            )}
          </p>
        ) : null}
        {settingsLock ? (
          <ProLock
            lock={settingsLock}
            testId="reminder-settings-lock"
            className="border-x-0 border-b-0"
          >
            {settingsForm}
          </ProLock>
        ) : (
          settingsForm
        )}
      </section>
    </div>
  );
}
