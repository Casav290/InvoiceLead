import { getTranslations } from "next-intl/server";
import { AppHeader } from "@/components/app/AppHeader";
import { leadAppItems } from "@/lib/lead-apps";
import { APP_CODE } from "@/server/auth/attach";
import { requireAppSession } from "@/server/auth/guard";
import { db } from "@/server/db";
import type { LeadEntitlements } from "@/server/lead-id/leadId";
import { tierOf, upgradeUrl } from "@/server/plans";
import { listUserOrganizations } from "@/server/team";

export default async function AppLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const { user, organization } = await requireAppSession(locale);
  const entitlements = organization.entitlements as LeadEntitlements | null;
  const orgs = await listUserOrganizations(db(), user.id);
  const tier = tierOf(organization);
  const tp = await getTranslations({ locale, namespace: "app.plan" });
  const upgrade =
    tier === "proplus"
      ? null
      : {
          href: upgradeUrl(organization),
          label: tp(tier === "pro" ? "upgradePlus" : "upgrade"),
        };
  return (
    <div className="flex min-h-screen flex-col">
      <AppHeader
        locale={locale}
        orgId={organization.id}
        orgName={organization.name}
        orgs={orgs}
        user={{ name: user.name, email: user.email }}
        planCode={entitlements?.plan?.code ?? organization.leadPlan}
        planName={entitlements?.plan?.name ?? organization.leadPlan}
        apps={leadAppItems(APP_CODE, entitlements?.apps)}
        upgrade={upgrade}
      />
      <main className="flex-1">{children}</main>
    </div>
  );
}
