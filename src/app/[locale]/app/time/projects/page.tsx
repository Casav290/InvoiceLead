import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ProjectFields } from "@/components/time/ProjectFields";
import { Button } from "@/components/ui/button";
import { countryPack } from "@/countries";
import { Link } from "@/i18n/navigation";
import { formatAmount } from "@/lib/money";
import { requireAppSession } from "@/server/auth/guard";
import { listContacts } from "@/server/contacts";
import { db } from "@/server/db";
import { formatMinutes, listProjects } from "@/server/time";
import { saveProjectAction } from "../actions";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ error?: string; archived?: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "app.time" });
  return { title: t("projects"), robots: { index: false } };
}

/** Projets : heures, reste à facturer, chiffre d'affaires et tarif horaire réalisé. */
export default async function ProjectsPage({ params, searchParams }: Props) {
  const { locale } = await params;
  const { organization } = await requireAppSession(locale);
  const q = await searchParams;
  const t = await getTranslations({ locale, namespace: "app.time" });
  const style = countryPack(organization.country).amounts;
  const archived = q.archived === "1";
  const [rows, contacts] = await Promise.all([
    listProjects(db(), organization.id, { archived }),
    listContacts(db(), organization.id),
  ]);
  const customers = contacts.filter((c) => c.isCustomer && !c.archivedAt);

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-8">
      <p className="text-[13px]">
        <Link href="/app/time" className="font-semibold text-accent-dark hover:underline">
          {t("back")}
        </Link>
      </p>
      <h1 className="mt-2 text-[28px] leading-tight">{t("projects")}</h1>
      <p className="mt-2 text-[15px] text-ink-muted">{t("projectsSubtitle")}</p>
      {q.error ? (
        <p
          role="alert"
          className="mt-6 border border-hot-fg bg-hot-bg px-4 py-3 text-[13px] text-hot-fg"
        >
          {t(
            `errors.${["contact", "required", "amount", "hours"].includes(q.error) ? q.error : "invalid"}`,
          )}
        </p>
      ) : null}

      {rows.length === 0 ? (
        <p className="mt-6 border border-line-strong bg-panel px-5 py-6 text-center text-[14px] text-ink-muted">
          {t(archived ? "noArchived" : "noProjectsYet")}
        </p>
      ) : (
        <div className="mt-6 overflow-x-auto border border-line-strong bg-panel">
          <table className="w-full text-left text-[13px]" data-testid="projects-table">
            <thead>
              <tr className="border-b border-line-strong bg-head text-[10.5px] font-extrabold tracking-[0.09em] text-ink-muted uppercase">
                <th className="px-4 py-2.5">{t("project")}</th>
                <th className="px-4 py-2.5 text-right">{t("hours")}</th>
                <th className="hidden px-4 py-2.5 text-right sm:table-cell">{t("unbilled")}</th>
                <th className="hidden px-4 py-2.5 text-right md:table-cell">{t("invoicedNet")}</th>
                <th className="hidden px-4 py-2.5 text-right md:table-cell">
                  {t("effectiveRate")}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.project.id}
                  className="border-b border-line-soft last:border-b-0"
                  data-testid="project-row"
                >
                  <td className="px-4 py-3">
                    <Link
                      href={`/app/time/projects/${r.project.id}`}
                      className="font-semibold text-accent-dark hover:underline [overflow-wrap:anywhere]"
                    >
                      {r.project.name}
                    </Link>
                    <span className="block text-[12px] text-ink-muted">{r.customer}</span>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {formatMinutes(r.minutes)}
                    {r.project.budgetMinutes ? (
                      <span className="block text-[11px] text-ink-muted">
                        {t("ofBudget", { budget: formatMinutes(r.project.budgetMinutes) })}
                      </span>
                    ) : null}
                  </td>
                  <td className="hidden px-4 py-3 text-right tabular-nums sm:table-cell">
                    {formatAmount(r.unbilledCents, style)}
                  </td>
                  <td className="hidden px-4 py-3 text-right tabular-nums md:table-cell">
                    {formatAmount(r.invoicedNetCents, style)}
                  </td>
                  <td className="hidden px-4 py-3 text-right tabular-nums md:table-cell">
                    {r.minutes > 0 && r.invoicedNetCents > 0
                      ? formatAmount(Math.round((r.invoicedNetCents * 60) / r.minutes), style)
                      : "–"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-3 text-[13px]">
        <Link
          href={archived ? "/app/time/projects" : "/app/time/projects?archived=1"}
          className="font-semibold text-accent-dark hover:underline"
        >
          {t(archived ? "showActive" : "showArchived")}
        </Link>
      </p>

      {archived ? null : customers.length === 0 ? (
        <p className="mt-8 border border-line-strong bg-panel px-5 py-6 text-[14px] text-ink-2">
          {t("noCustomers")}
        </p>
      ) : (
        <section className="mt-8 border border-line-strong bg-panel">
          <h2 className="border-b border-line bg-head px-5 py-3 text-[10.5px] font-extrabold tracking-[0.09em] text-ink-muted uppercase">
            {t("newProject")}
          </h2>
          <form
            action={saveProjectAction}
            className="grid gap-4 p-5 sm:grid-cols-2"
            data-testid="project-form"
          >
            <input type="hidden" name="locale" value={locale} />
            <ProjectFields
              locale={locale}
              currency={organization.currency}
              customers={customers.map((c) => ({ id: c.id, name: c.name }))}
            />
            <div className="sm:col-span-2">
              <Button type="submit" data-testid="project-save">
                {t("createProject")}
              </Button>
            </div>
          </form>
        </section>
      )}
    </div>
  );
}
