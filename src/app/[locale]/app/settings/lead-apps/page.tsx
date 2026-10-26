import type { Metadata } from "next";
import { AppMark } from "@/components/brand/AppMark";
import { SettingsNav } from "@/components/settings/SettingsNav";
import { Button } from "@/components/ui/button";
import { countryPack } from "@/countries";
import { Link } from "@/i18n/navigation";
import { formatDate } from "@/lib/fiscal-year";
import { CRMLEAD_URL, PROJECTLEAD_URL } from "@/lib/lead-apps";
import { requireAppSession } from "@/server/auth/guard";
import { getSessionCountryTranslations } from "@/server/country-translations";
import { db } from "@/server/db";
import { lastProjectLeadDraft } from "@/server/lead-exchange";
import { refreshEntitlementsNow } from "@/server/plan-refresh";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getSessionCountryTranslations({ locale, namespace: "app.leadApps" });
  return { title: t("title"), robots: { index: false } };
}

/** Une page ne patiente pas plus que ceci pour relire au Compte Lead quelles apps sont utilisées. */
const WAIT_MS = 3_000;

type Apps = Record<string, { used?: unknown } | undefined>;

/**
 * Applications Lead de l'entreprise (liaison sans clé, 26.10.2026) : même entreprise dans le Compte
 * Lead = reliées. Rien à copier ni à coller, aucune formule. L'état « Reliée » vient d'ERPlead
 * (apps[code].used), relu à l'ouverture de l'écran ; il sert à l'affichage seulement.
 */
export default async function LeadAppsSettingsPage({ params }: Props) {
  const { locale } = await params;
  const { organization, user } = await requireAppSession(locale);
  const t = await getSessionCountryTranslations({ locale, namespace: "app.leadApps" });
  const dates = countryPack(organization.country).dates;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const fresh = await Promise.race([
    refreshEntitlementsNow(db(), organization).catch(() => null),
    new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), WAIT_MS);
    }),
  ]).finally(() => clearTimeout(timer));
  const apps = ((fresh ?? organization.entitlements) as { apps?: Apps } | null)?.apps ?? {};
  const used = (code: string) => apps[code]?.used === true;
  const last = await lastProjectLeadDraft(db(), organization.id);
  const heading =
    "border-b border-line bg-head px-5 py-3 text-[10.5px] font-extrabold tracking-[0.09em] text-ink-muted uppercase";

  const rows = [
    {
      code: "projectlead",
      name: "ProjectLead",
      mark: "PL",
      color: "bg-projectlead",
      url: PROJECTLEAD_URL,
      text: t("projectlead"),
      extra: last
        ? t("lastDraft", { date: formatDate(last.toISOString().slice(0, 10), dates) })
        : t("noDraft"),
    },
    {
      code: "crmlead",
      name: "CRMlead",
      mark: "CR",
      color: "bg-crmlead",
      url: CRMLEAD_URL,
      text: t("crmlead"),
      extra: null,
    },
  ];

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-8">
      <SettingsNav />
      <h1 className="text-[28px] leading-tight">{t("title")}</h1>
      <p className="mt-3 text-[15px] text-ink-2" data-testid="lead-apps-intro">
        {t("intro", { name: organization.name, email: user.email })}
      </p>

      <section className="mt-8 border border-line-strong bg-panel" data-testid="lead-apps">
        <h2 className={heading}>{t("title")}</h2>
        <ul>
          {rows.map((app) => {
            const linked = used(app.code);
            return (
              <li
                key={app.code}
                className="flex flex-wrap items-start gap-4 border-b border-line-soft px-5 py-4 last:border-b-0"
                data-testid={`lead-app-${app.code}`}
              >
                <AppMark label={app.mark} className={`h-9 w-9 ${app.color} text-[12px]`} />
                <div className="min-w-0 flex-1 basis-60">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-[16px] font-bold">{app.name}</h3>
                    <span
                      className={
                        linked
                          ? "border border-ok-fg bg-ok-bg px-2 py-0.5 text-[11px] font-bold text-ok-fg"
                          : "border border-line-strong bg-muted px-2 py-0.5 text-[11px] font-bold text-ink-muted"
                      }
                      data-testid={`lead-app-${app.code}-state`}
                    >
                      {linked ? t("linked") : t("notUsed")}
                    </span>
                  </div>
                  <p className="mt-1 text-[14px] text-ink-2">
                    {linked ? app.text : t("notUsedText", { app: app.name })}
                  </p>
                  {linked && app.extra ? (
                    <p
                      className="mt-1 text-[13px] text-ink-muted"
                      data-testid={`lead-app-${app.code}-last`}
                    >
                      {app.extra}
                    </p>
                  ) : null}
                  <div className="mt-3">
                    <Button asChild variant="secondary" size="sm">
                      <a href={app.url} rel="noopener" data-testid={`lead-app-${app.code}-open`}>
                        {t("open", { app: app.name })}
                      </a>
                    </Button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="mt-6 border border-line-strong bg-panel" data-testid="lead-apps-api">
        <h2 className={heading}>{t("apiTitle")}</h2>
        <p className="px-5 pt-4 text-[13px] text-ink-2">{t("apiText")}</p>
        <p className="px-5 pt-2 pb-4 text-[13px]">
          <Link href="/app/settings/api" className="font-semibold text-accent-dark underline">
            {t("apiLink")}
          </Link>
        </p>
      </section>
    </div>
  );
}
