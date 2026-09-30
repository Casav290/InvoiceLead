import { redirect as nextRedirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { AppHeader } from "@/components/app/AppHeader";
import { Button } from "@/components/ui/button";
import { leadAppItems } from "@/lib/lead-apps";
import { APP_CODE } from "@/server/auth/attach";
import { getSession } from "@/server/auth/session";
import type { LeadEntitlements } from "@/server/lead-id/leadId";

const DEFAULT_UPGRADE_URL = "https://scanlead.io/billing";

export default async function AppLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const session = await getSession();
  // Un cookie sans session valide (échue) : on repasse par le Compte Lead, sans écran s'il y est encore connecté.
  if (!session) nextRedirect(`/auth/lead/start?locale=${locale}`);

  const { user, organization } = session;
  const entitlements = organization.entitlements as LeadEntitlements | null;
  const plan = entitlements?.plan?.name ?? organization.leadPlan;

  if (!organization.hasAccess) {
    const t = await getTranslations({ locale, namespace: "app.noAccess" });
    const upgradeUrl = entitlements?.apps?.[APP_CODE]?.upgrade_url ?? DEFAULT_UPGRADE_URL;
    return (
      <main className="flex min-h-screen items-start justify-center px-4 py-20">
        <div
          className="w-full max-w-[480px] border border-line-strong bg-panel"
          data-testid="no-access"
        >
          <div className="border-b border-line px-6 py-5">
            <h1 className="text-[22px] leading-tight">{t("title")}</h1>
            <p className="mt-2 text-[14px] leading-relaxed text-ink-muted">
              {t("body", { org: organization.name })}
            </p>
          </div>
          <div className="flex flex-wrap gap-3 px-6 py-5">
            <Button asChild>
              <a href={upgradeUrl}>{t("upgrade")}</a>
            </Button>
            <form action="/auth/lead/logout" method="post">
              <input type="hidden" name="locale" value={locale} />
              <Button type="submit" variant="secondary">
                {t("logout")}
              </Button>
            </form>
          </div>
        </div>
      </main>
    );
  }

  return (
    <div className="flex min-h-screen flex-col">
      <AppHeader
        locale={locale}
        orgName={organization.name}
        user={{ name: user.name, email: user.email }}
        plan={plan}
        apps={leadAppItems(APP_CODE, entitlements?.apps)}
      />
      <main className="flex-1">{children}</main>
    </div>
  );
}
