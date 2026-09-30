import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Button } from "@/components/ui/button";
import { APP_CODE } from "@/server/auth/attach";
import { requireSession } from "@/server/auth/guard";
import type { LeadEntitlements } from "@/server/lead-id/leadId";

/** Tant que seul Scanlead encaisse, toute mise à niveau passe par sa page de facturation (LEAD-ID.md). */
const DEFAULT_UPGRADE_URL = "https://scanlead.io/billing";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "app.noAccess" });
  return { title: t("title"), robots: { index: false } };
}

export default async function NoAccessPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const { organization } = await requireSession(locale);
  if (organization.hasAccess) redirect(`/${locale}/app`);
  const t = await getTranslations({ locale, namespace: "app.noAccess" });
  const entitlements = organization.entitlements as LeadEntitlements | null;
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
