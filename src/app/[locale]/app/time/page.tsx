import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { AppMark } from "@/components/brand/AppMark";
import { Elapsed } from "@/components/time/Elapsed";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { addDays, formatDate } from "@/lib/fiscal-year";
import { PROJECTLEAD_URL } from "@/lib/lead-apps";
import { requireAppSession } from "@/server/auth/guard";
import { db } from "@/server/db";
import { formatMinutes, listEntries, listProjects, runningTimer } from "@/server/time";
import { addEntryAction, deleteEntryAction, startTimerAction, stopTimerAction } from "./actions";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ error?: string; added?: string; stopped?: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "app.time" });
  return { title: t("title"), robots: { index: false } };
}

const field = "h-10 w-full border border-line-strong bg-panel px-3 text-[14px]";

/** Temps : chrono, saisie rapide et saisies des deux dernières semaines. */
export default async function TimePage({ params, searchParams }: Props) {
  const { locale } = await params;
  const { organization, user } = await requireAppSession(locale);
  const q = await searchParams;
  const t = await getTranslations({ locale, namespace: "app.time" });
  const today = new Date().toISOString().slice(0, 10);
  const who = { organizationId: organization.id, userId: user.id };
  const [projects, running, entries] = await Promise.all([
    listProjects(db(), organization.id),
    runningTimer(db(), who),
    listEntries(db(), organization.id, { since: addDays(today, -14) }),
  ]);
  const hidden = <input type="hidden" name="locale" value={locale} />;
  const done = entries.filter((e) => !e.entry.startedAt);
  const total = done.reduce((s, e) => s + e.entry.minutes, 0);

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="text-[28px] leading-tight">{t("title")}</h1>
        <Link
          href="/app/time/projects"
          className="text-[13px] font-semibold text-accent-dark hover:underline"
        >
          {t("projectsLink", { count: projects.length })}
        </Link>
      </div>
      <p className="mt-2 text-[15px] text-ink-muted">{t("subtitle")}</p>

      {/* Projets d'équipe : ProjectLead, qui crée ici les brouillons de factures du mois. */}
      <section
        className="mt-6 flex flex-wrap items-start gap-4 border border-line-strong bg-panel px-5 py-4"
        data-testid="projectlead-block"
      >
        <AppMark label="PL" className="h-9 w-9 bg-projectlead text-[12px]" />
        <div className="min-w-0 flex-1 basis-60">
          <h2 className="text-[16px] font-bold">{t("projectLead.title")}</h2>
          <p className="mt-1 text-[14px] text-ink-2">{t("projectLead.text")}</p>
          <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2">
            <Button asChild variant="secondary" size="sm">
              <a href={PROJECTLEAD_URL} rel="noopener" data-testid="projectlead-open">
                {t("projectLead.open")}
              </a>
            </Button>
            <Link
              href="/app/settings/projectlead"
              className="text-[13px] font-semibold text-accent-dark underline"
              data-testid="projectlead-connect"
            >
              {t("projectLead.connect")}
            </Link>
          </div>
        </div>
      </section>
      {q.error ? (
        <p
          role="alert"
          className="mt-6 border border-hot-fg bg-hot-bg px-4 py-3 text-[13px] text-hot-fg"
        >
          {t(
            `errors.${["project", "date", "duration", "required"].includes(q.error) ? q.error : "invalid"}`,
          )}
        </p>
      ) : null}
      {q.added || q.stopped ? (
        <p
          role="status"
          className="mt-6 border border-ok-fg bg-ok-bg px-4 py-3 text-[13px] text-ok-fg"
        >
          {t(q.added ? "added" : "stopped")}
        </p>
      ) : null}

      {projects.length === 0 ? (
        <p className="mt-8 border border-line-strong bg-panel px-5 py-6 text-[14px] text-ink-2">
          {t("noProjects")}{" "}
          <Link href="/app/time/projects" className="font-semibold text-accent-dark underline">
            {t("createProject")}
          </Link>
        </p>
      ) : (
        <>
          <section className="mt-6 border border-line-strong bg-panel" data-testid="timer">
            <h2 className="border-b border-line bg-head px-5 py-3 text-[10.5px] font-extrabold tracking-[0.09em] text-ink-muted uppercase">
              {t("timer")}
            </h2>
            {running?.entry.startedAt ? (
              <form
                action={stopTimerAction}
                className="flex flex-wrap items-center gap-4 px-5 py-4"
              >
                {hidden}
                <Elapsed since={running.entry.startedAt.toISOString()} />
                <span className="min-w-0 flex-1 text-[14px] [overflow-wrap:anywhere]">
                  <span className="font-semibold">{running.project}</span>
                  {running.entry.description ? ` · ${running.entry.description}` : ""}
                </span>
                <Button type="submit" data-testid="timer-stop">
                  {t("stop")}
                </Button>
              </form>
            ) : (
              <form
                action={startTimerAction}
                className="grid gap-3 px-5 py-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
              >
                {hidden}
                <label className="block">
                  <span className="mb-1 block text-[13px] font-semibold">{t("project")}</span>
                  <select name="projectId" required className={field}>
                    {projects.map((p) => (
                      <option key={p.project.id} value={p.project.id}>
                        {p.project.name} · {p.customer}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1 block text-[13px] font-semibold">{t("description")}</span>
                  <input name="description" maxLength={300} className={field} />
                </label>
                <Button type="submit" data-testid="timer-start">
                  {t("start")}
                </Button>
              </form>
            )}
          </section>

          <section className="mt-6 border border-line-strong bg-panel">
            <h2 className="border-b border-line bg-head px-5 py-3 text-[10.5px] font-extrabold tracking-[0.09em] text-ink-muted uppercase">
              {t("manual")}
            </h2>
            <form
              action={addEntryAction}
              className="grid gap-3 px-5 py-4 sm:grid-cols-2 lg:grid-cols-[1.2fr_0.8fr_0.6fr_1.4fr_auto] lg:items-end"
              data-testid="time-entry-form"
            >
              {hidden}
              <label className="block">
                <span className="mb-1 block text-[13px] font-semibold">{t("project")}</span>
                <select name="projectId" required className={field}>
                  {projects.map((p) => (
                    <option key={p.project.id} value={p.project.id}>
                      {p.project.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-[13px] font-semibold">{t("date")}</span>
                <input
                  name="workDate"
                  type="date"
                  required
                  defaultValue={today}
                  className={field}
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-[13px] font-semibold">{t("duration")}</span>
                <input name="duration" required placeholder="1:30" className={field} />
              </label>
              <label className="block">
                <span className="mb-1 block text-[13px] font-semibold">{t("description")}</span>
                <input name="description" maxLength={300} className={field} />
              </label>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 text-[13px]">
                  <input
                    type="checkbox"
                    name="billable"
                    defaultChecked
                    className="h-4 w-4 accent-accent"
                  />
                  {t("billable")}
                </label>
                <Button type="submit" variant="secondary" data-testid="time-entry-save">
                  {t("add")}
                </Button>
              </div>
            </form>
          </section>
        </>
      )}

      <section className="mt-6 border border-line-strong bg-panel" data-testid="time-entries">
        <h2 className="flex flex-wrap justify-between gap-2 border-b border-line bg-head px-5 py-3 text-[10.5px] font-extrabold tracking-[0.09em] text-ink-muted uppercase">
          <span>{t("recent")}</span>
          <span className="tabular-nums">{formatMinutes(total)}</span>
        </h2>
        {done.length === 0 ? (
          <p className="px-5 py-4 text-[13px] text-ink-muted">{t("empty")}</p>
        ) : (
          <ul>
            {done.map(({ entry, project }) => (
              <li
                key={entry.id}
                className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-line-soft px-5 py-2.5 text-[13px] last:border-b-0"
                data-testid="time-entry"
              >
                <span className="tabular-nums text-ink-2">{formatDate(entry.workDate)}</span>
                <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
                  <span className="font-semibold">{project}</span>
                  {entry.description ? ` · ${entry.description}` : ""}
                  {entry.billable ? "" : ` · ${t("notBillable")}`}
                  {entry.invoiceId ? ` · ${t("invoiced")}` : ""}
                </span>
                <span className="font-semibold tabular-nums">{formatMinutes(entry.minutes)}</span>
                {entry.invoiceId ? null : (
                  <form action={deleteEntryAction}>
                    {hidden}
                    <input type="hidden" name="id" value={entry.id} />
                    <Button type="submit" variant="ghost" size="sm">
                      {t("delete")}
                    </Button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
