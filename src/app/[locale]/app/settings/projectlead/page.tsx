import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { AppMark } from "@/components/brand/AppMark";
import { ProjectLeadKeyForm } from "@/components/settings/ProjectLeadKeyForm";
import { SettingsNav } from "@/components/settings/SettingsNav";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/fiscal-year";
import { PROJECTLEAD_URL } from "@/lib/lead-apps";
import { listApiKeys } from "@/server/api-keys";
import { requireAppSession } from "@/server/auth/guard";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { PLANS, tierOf } from "@/server/plans";
import { can } from "@/server/roles";
import { revokeProjectLeadKeyAction } from "./actions";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ revoked?: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "app.projectLead" });
  return { title: t("title"), robots: { index: false } };
}

const day = (d: Date | null) => (d ? formatDate(d.toISOString().slice(0, 10)) : null);

/**
 * Relier ProjectLead, dans toutes les formules : une clé réservée à ProjectLead (contacts et
 * brouillons de factures seulement), affichée une fois, révocable. L'API complète et les webhooks
 * restent dans Réglages, API (Pro+).
 */
export default async function ProjectLeadSettingsPage({ params, searchParams }: Props) {
  const { locale } = await params;
  const { organization, membership } = await requireAppSession(locale);
  const q = await searchParams;
  const t = await getTranslations({ locale, namespace: "app.projectLead" });
  const editable = can(membership, "company");
  const keys = await listApiKeys(db(), organization.id, "projectlead");
  const free = tierOf(organization) === "free";
  const hidden = <input type="hidden" name="locale" value={locale} />;
  const heading =
    "border-b border-line bg-head px-5 py-3 text-[10.5px] font-extrabold tracking-[0.09em] text-ink-muted uppercase";

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-8">
      <SettingsNav />
      <div className="flex items-center gap-3">
        <AppMark label="PL" className="h-9 w-9 bg-projectlead text-[12px]" />
        <h1 className="text-[28px] leading-tight">{t("title")}</h1>
      </div>
      <p className="mt-3 text-[15px] text-ink-2">{t("subtitle")}</p>
      <p className="mt-3 text-[13px]">
        <a
          href={PROJECTLEAD_URL}
          rel="noopener"
          className="font-semibold text-accent-dark underline"
          data-testid="projectlead-open"
        >
          {t("open")}
        </a>
      </p>
      {q.revoked ? (
        <p
          role="status"
          className="mt-6 border border-ok-fg bg-ok-bg px-4 py-3 text-[13px] text-ok-fg"
        >
          {t("key.revoked")}
        </p>
      ) : null}

      <section className="mt-8 border border-line-strong bg-panel" data-testid="projectlead-keys">
        <h2 className={heading}>{t("key.title")}</h2>
        <div className="px-5 pt-4 text-[13px] text-ink-2">
          <p>{t("key.scope")}</p>
          <ol className="mt-3 list-decimal space-y-1 pl-5">
            <li>{t("steps.create")}</li>
            <li>{t("steps.open")}</li>
            <li>{t("steps.paste", { url: env().APP_URL })}</li>
          </ol>
          {free ? (
            <p className="mt-3" data-testid="projectlead-drafts">
              {t("drafts", { limit: PLANS.free.quotas.invoices })}
            </p>
          ) : null}
        </div>
        {keys.length === 0 ? (
          <p className="px-5 pt-4 text-[13px] text-ink-muted">{t("key.empty")}</p>
        ) : (
          <ul className="mt-4 border-t border-line-soft">
            {keys.map((k) => (
              <li
                key={k.id}
                className="flex flex-wrap items-center gap-3 border-b border-line-soft px-5 py-3 text-[13px]"
                data-testid="projectlead-key-row"
              >
                <span className="font-semibold">{k.name}</span>
                <span className="text-ink-muted tabular-nums">{k.prefix}…</span>
                <span className="flex-1 text-[12px] text-ink-muted">
                  {t("key.meta", {
                    created: day(k.createdAt) ?? "",
                    used: day(k.lastUsedAt) ?? t("key.never"),
                  })}
                </span>
                {editable ? (
                  <form action={revokeProjectLeadKeyAction}>
                    {hidden}
                    <input type="hidden" name="id" value={k.id} />
                    <Button type="submit" variant="ghost" size="sm">
                      {t("key.revoke")}
                    </Button>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {editable ? (
          <ProjectLeadKeyForm locale={locale} />
        ) : (
          <p className="px-5 py-4 text-[13px] text-ink-muted">{t("key.adminOnly")}</p>
        )}
      </section>
    </div>
  );
}
