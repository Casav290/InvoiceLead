import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ProjectFields } from "@/components/time/ProjectFields";
import { Button } from "@/components/ui/button";
import { countryPack } from "@/countries";
import { Link } from "@/i18n/navigation";
import { formatDate } from "@/lib/fiscal-year";
import { formatAmount } from "@/lib/money";
import { requireAppSession } from "@/server/auth/guard";
import { listContacts } from "@/server/contacts";
import { db } from "@/server/db";
import { formatMinutes, getProject, listEntries, listProjects } from "@/server/time";
import {
  archiveProjectAction,
  deleteEntryAction,
  invoiceProjectAction,
  saveProjectAction,
} from "../../actions";

type Props = {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ saved?: string; error?: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "app.time" });
  return { title: t("projects"), robots: { index: false } };
}

export default async function ProjectPage({ params, searchParams }: Props) {
  const { locale, id } = await params;
  const { organization } = await requireAppSession(locale);
  const q = await searchParams;
  const found = await getProject(db(), organization.id, id);
  if (!found) notFound();
  const { project, customer } = found;
  const t = await getTranslations({ locale, namespace: "app.time" });
  const style = countryPack(organization.country).amounts;
  const [stats, entries, contacts] = await Promise.all([
    listProjects(db(), organization.id, { archived: !!project.archivedAt }),
    listEntries(db(), organization.id, { projectId: id }),
    listContacts(db(), organization.id),
  ]);
  const s = stats.find((x) => x.project.id === id);
  const hidden = (
    <>
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="id" value={id} />
    </>
  );
  const back = <input type="hidden" name="back" value={`/${locale}/app/time/projects/${id}`} />;

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-8">
      <p className="text-[13px]">
        <Link href="/app/time/projects" className="font-semibold text-accent-dark hover:underline">
          {t("allProjects")}
        </Link>
      </p>
      <h1 className="mt-2 text-[28px] leading-tight [overflow-wrap:anywhere]">{project.name}</h1>
      <p className="mt-2 text-[15px] text-ink-muted">
        {customer}
        {project.archivedAt ? ` · ${t("archivedLabel")}` : ""}
      </p>
      {q.saved ? (
        <p
          role="status"
          className="mt-6 border border-ok-fg bg-ok-bg px-4 py-3 text-[13px] text-ok-fg"
        >
          {t("saved")}
        </p>
      ) : null}
      {q.error ? (
        <p
          role="alert"
          className="mt-6 border border-hot-fg bg-hot-bg px-4 py-3 text-[13px] text-hot-fg"
        >
          {t(
            `errors.${["nothing", "contact", "required", "amount", "hours", "project"].includes(q.error) ? q.error : "invalid"}`,
          )}
        </p>
      ) : null}

      {s ? (
        <dl
          className="mt-6 grid grid-cols-2 gap-x-4 gap-y-1 border border-line-strong bg-panel px-5 py-4 text-[14px] sm:grid-cols-4"
          data-testid="project-stats"
        >
          <div>
            <dt className="text-[12px] text-ink-muted">{t("hours")}</dt>
            <dd className="tabular-nums">
              {formatMinutes(s.minutes)}
              {project.budgetMinutes ? ` / ${formatMinutes(project.budgetMinutes)}` : ""}
            </dd>
          </div>
          <div>
            <dt className="text-[12px] text-ink-muted">{t("unbilled")}</dt>
            <dd className="font-extrabold tabular-nums" data-testid="project-unbilled">
              {formatAmount(s.unbilledCents, style)}
            </dd>
          </div>
          <div>
            <dt className="text-[12px] text-ink-muted">{t("invoicedNet")}</dt>
            <dd className="tabular-nums">{formatAmount(s.invoicedNetCents, style)}</dd>
          </div>
          <div>
            <dt className="text-[12px] text-ink-muted">{t("effectiveRate")}</dt>
            <dd className="tabular-nums">
              {s.minutes > 0 && s.invoicedNetCents > 0
                ? formatAmount(Math.round((s.invoicedNetCents * 60) / s.minutes), style)
                : "–"}
            </dd>
          </div>
        </dl>
      ) : null}

      {s && s.unbilledMinutes > 0 ? (
        <form
          action={invoiceProjectAction}
          className="mt-6 flex flex-wrap items-center gap-3 border border-accent bg-panel px-5 py-4"
        >
          {hidden}
          <p className="min-w-0 flex-1 text-[13px]">
            {t("invoiceHint", {
              hours: formatMinutes(s.unbilledMinutes),
              amount: formatAmount(s.unbilledCents, style),
            })}
          </p>
          <Button type="submit" data-testid="project-invoice">
            {t("invoiceHours")}
          </Button>
        </form>
      ) : null}

      <section className="mt-6 border border-line-strong bg-panel">
        <h2 className="border-b border-line bg-head px-5 py-3 text-[10.5px] font-extrabold tracking-[0.09em] text-ink-muted uppercase">
          {t("entries")}
        </h2>
        {entries.length === 0 ? (
          <p className="px-5 py-4 text-[13px] text-ink-muted">{t("empty")}</p>
        ) : (
          <ul>
            {entries.map(({ entry }) => (
              <li
                key={entry.id}
                className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-line-soft px-5 py-2.5 text-[13px] last:border-b-0"
              >
                <span className="tabular-nums text-ink-2">{formatDate(entry.workDate)}</span>
                <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
                  {entry.description ?? "–"}
                  {entry.startedAt ? ` · ${t("running")}` : ""}
                  {entry.billable ? "" : ` · ${t("notBillable")}`}
                  {entry.invoiceId ? ` · ${t("invoiced")}` : ""}
                </span>
                <span className="font-semibold tabular-nums">{formatMinutes(entry.minutes)}</span>
                {entry.invoiceId || entry.startedAt ? null : (
                  <form action={deleteEntryAction}>
                    <input type="hidden" name="locale" value={locale} />
                    <input type="hidden" name="id" value={entry.id} />
                    {back}
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

      <section className="mt-6 border border-line-strong bg-panel">
        <h2 className="border-b border-line bg-head px-5 py-3 text-[10.5px] font-extrabold tracking-[0.09em] text-ink-muted uppercase">
          {t("editProject")}
        </h2>
        <form action={saveProjectAction} className="grid gap-4 p-5 sm:grid-cols-2">
          {hidden}
          <ProjectFields
            locale={locale}
            currency={organization.currency}
            customers={contacts
              .filter((c) => c.isCustomer)
              .map((c) => ({ id: c.id, name: c.name }))}
            values={{
              contactId: project.contactId,
              name: project.name,
              hourlyRate: project.hourlyRateCents ? formatAmount(project.hourlyRateCents) : "",
              budgetHours: project.budgetMinutes ? String(project.budgetMinutes / 60) : "",
            }}
          />
          <div className="sm:col-span-2">
            <Button type="submit" variant="secondary">
              {t("save")}
            </Button>
          </div>
        </form>
      </section>
      <form action={archiveProjectAction} className="mt-6">
        {hidden}
        <input type="hidden" name="archived" value={project.archivedAt ? "0" : "1"} />
        <Button type="submit" variant="ghost">
          {t(project.archivedAt ? "unarchive" : "archive")}
        </Button>
      </form>
    </div>
  );
}
