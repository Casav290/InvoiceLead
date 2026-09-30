import { useTranslations } from "next-intl";
import { AppMark } from "@/components/brand/AppMark";
import { Link } from "@/i18n/navigation";
import type { LeadAppItem } from "@/lib/lead-apps";
import { AppNav } from "./AppNav";
import { AppSwitcher } from "./AppSwitcher";
import { type OrgItem, OrgSwitcher } from "./OrgSwitcher";
import { UserMenu } from "./UserMenu";

export function AppHeader({
  locale,
  orgId,
  orgName,
  orgs,
  user,
  planCode,
  planName,
  apps,
}: {
  locale: string;
  orgId: string;
  orgName: string;
  orgs: OrgItem[];
  user: { name: string; email: string };
  planCode: string;
  planName: string;
  apps: LeadAppItem[];
}) {
  const tPlans = useTranslations("app.user.plans");
  const planLabel = tPlans.has(planCode) ? tPlans(planCode) : planName;
  return (
    <header className="border-b border-line-strong bg-panel">
      <div className="flex min-h-[52px] flex-wrap items-stretch px-3 xl:flex-nowrap sm:px-5">
        <Link
          href="/app"
          className="flex min-h-[52px] items-center gap-2.5 border-r border-line-strong pr-4"
          aria-label="InvoiceLead"
        >
          <AppMark label="IL" />
          <span className="hidden text-[15px] font-extrabold tracking-[-0.025em] text-accent sm:inline">
            InvoiceLead
          </span>
        </Link>
        <AppNav />
        <div className="ml-auto flex items-center gap-2 pl-3">
          {orgs.length > 1 ? (
            <OrgSwitcher locale={locale} current={{ id: orgId, name: orgName }} orgs={orgs} />
          ) : (
            <span
              data-testid="org-name"
              className="hidden max-w-[220px] truncate text-[13px] font-semibold text-ink-3 md:inline"
            >
              {orgName}
            </span>
          )}
          <AppSwitcher items={apps} />
          <UserMenu name={user.name} email={user.email} planLabel={planLabel} locale={locale} />
        </div>
      </div>
    </header>
  );
}
