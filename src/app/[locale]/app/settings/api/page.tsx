import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ProLock } from "@/components/app/ProLock";
import { ApiKeyForm, WebhookForm } from "@/components/settings/ApiForms";
import { SettingsNav } from "@/components/settings/SettingsNav";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/fiscal-year";
import { listApiKeys } from "@/server/api-keys";
import { requireAppSession } from "@/server/auth/guard";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { lockFor } from "@/server/plan-lock";
import { featureAccess } from "@/server/plans";
import { can } from "@/server/roles";
import { listEndpoints, WEBHOOK_EVENTS } from "@/server/webhooks";
import { disableWebhookAction, revokeApiKeyAction } from "./actions";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ revoked?: string; disabled?: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "app.apiSettings" });
  return { title: t("title"), robots: { index: false } };
}

const day = (d: Date | null) => (d ? formatDate(d.toISOString().slice(0, 10)) : null);

/**
 * Clés d'API et webhooks de l'entreprise (formule Pro+). En dessous, les formulaires restent
 * visibles, grisés avec la marque Pro+ ; les clés et adresses déjà créées restent listées et
 * peuvent toujours être révoquées ou coupées.
 */
export default async function ApiSettingsPage({ params, searchParams }: Props) {
  const { locale } = await params;
  const { organization, membership } = await requireAppSession(locale);
  const q = await searchParams;
  const t = await getTranslations({ locale, namespace: "app.apiSettings" });
  const lock = await lockFor(locale, organization, featureAccess(organization, "api"), t("plan"));
  const editable = can(membership, "company");
  const keys = await listApiKeys(db(), organization.id);
  const endpoints = await listEndpoints(db(), organization.id);
  const hidden = <input type="hidden" name="locale" value={locale} />;
  const section = "border border-line-strong bg-panel";
  const heading =
    "border-b border-line bg-head px-5 py-3 text-[10.5px] font-extrabold tracking-[0.09em] text-ink-muted uppercase";

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-8">
      <SettingsNav />
      <h1 className="text-[28px] leading-tight">{t("title")}</h1>
      <p className="mt-2 text-[15px] text-ink-muted">
        {t("subtitle", { base: `${env().APP_URL}/api/v1` })}
      </p>
      <p className="mt-2 text-[13px] text-ink-2" data-testid="mcp-url">
        {t("mcp", { url: `${env().APP_URL}/api/mcp` })}
      </p>
      {q.revoked || q.disabled ? (
        <p
          role="status"
          className="mt-6 border border-ok-fg bg-ok-bg px-4 py-3 text-[13px] text-ok-fg"
        >
          {t(q.revoked ? "keys.revoked" : "webhooks.disabled")}
        </p>
      ) : null}
      <div className="mt-8 space-y-6">
        <section className={section} data-testid="api-keys">
          <h2 className={heading}>{t("keys.title")}</h2>
          {keys.length === 0 ? (
            <p className="px-5 py-4 text-[13px] text-ink-muted">{t("keys.empty")}</p>
          ) : (
            <ul>
              {keys.map((k) => (
                <li
                  key={k.id}
                  className="flex flex-wrap items-center gap-3 border-b border-line-soft px-5 py-3 text-[13px]"
                >
                  <span className="font-semibold [overflow-wrap:anywhere]">{k.name}</span>
                  <span className="text-ink-muted tabular-nums">{k.prefix}…</span>
                  <span className="flex-1 text-[12px] text-ink-muted">
                    {t("keys.meta", {
                      created: day(k.createdAt) ?? "",
                      used: day(k.lastUsedAt) ?? t("keys.never"),
                    })}
                  </span>
                  {editable ? (
                    <form action={revokeApiKeyAction}>
                      {hidden}
                      <input type="hidden" name="id" value={k.id} />
                      <Button type="submit" variant="ghost" size="sm">
                        {t("keys.revoke")}
                      </Button>
                    </form>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          {lock ? (
            <ProLock lock={lock} testId="api-plan" className="border-x-0 border-b-0">
              <ApiKeyForm locale={locale} />
            </ProLock>
          ) : editable ? (
            <ApiKeyForm locale={locale} />
          ) : null}
        </section>

        <section className={section} data-testid="webhooks">
          <h2 className={heading}>{t("webhooks.title")}</h2>
          <p className="px-5 pt-4 text-[13px] text-ink-2">{t("webhooks.hint")}</p>
          {endpoints.length === 0 ? (
            <p className="px-5 py-4 text-[13px] text-ink-muted">{t("webhooks.empty")}</p>
          ) : (
            <ul className="mt-2">
              {endpoints.map((e) => (
                <li
                  key={e.id}
                  className="border-b border-line-soft px-5 py-3 text-[13px]"
                  data-testid="webhook-row"
                >
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="min-w-0 flex-1 font-semibold [overflow-wrap:anywhere]">
                      {e.url}
                    </span>
                    {editable ? (
                      <form action={disableWebhookAction}>
                        {hidden}
                        <input type="hidden" name="id" value={e.id} />
                        <Button type="submit" variant="ghost" size="sm">
                          {t("webhooks.disable")}
                        </Button>
                      </form>
                    ) : null}
                  </div>
                  <p className="mt-1 text-[12px] text-ink-muted">{e.events.join(" · ")}</p>
                  {e.deliveries.length > 0 ? (
                    <ul className="mt-2 space-y-0.5 text-[12px] text-ink-2">
                      {e.deliveries.slice(0, 5).map((d) => (
                        <li
                          key={`${d.event}-${d.createdAt.toISOString()}`}
                          data-testid="webhook-delivery"
                        >
                          {t("webhooks.delivery", {
                            event: d.event,
                            status: t(`webhooks.status.${d.status}`),
                            code: d.lastStatus ?? "–",
                            date: day(d.createdAt) ?? "",
                          })}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          {lock ? (
            <ProLock lock={lock} testId="webhooks-plan" className="border-x-0 border-b-0">
              <WebhookForm locale={locale} events={WEBHOOK_EVENTS} />
            </ProLock>
          ) : editable ? (
            <WebhookForm locale={locale} events={WEBHOOK_EVENTS} />
          ) : null}
        </section>
      </div>
    </div>
  );
}
