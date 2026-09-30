import { AppHeader } from "@/components/app/AppHeader";
import { leadAppItems } from "@/lib/lead-apps";
import { APP_CODE } from "@/server/auth/attach";
import { requireAppSession } from "@/server/auth/guard";
import type { LeadEntitlements } from "@/server/lead-id/leadId";

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
  return (
    <div className="flex min-h-screen flex-col">
      <AppHeader
        locale={locale}
        orgName={organization.name}
        user={{ name: user.name, email: user.email }}
        planCode={entitlements?.plan?.code ?? organization.leadPlan}
        planName={entitlements?.plan?.name ?? organization.leadPlan}
        apps={leadAppItems(APP_CODE, entitlements?.apps)}
      />
      <main className="flex-1">{children}</main>
    </div>
  );
}
