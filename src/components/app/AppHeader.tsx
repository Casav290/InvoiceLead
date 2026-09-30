import { useTranslations } from "next-intl";
import { AppMark } from "@/components/brand/AppMark";
import { Link } from "@/i18n/navigation";
import type { LeadAppItem } from "@/lib/lead-apps";
import { AppSwitcher } from "./AppSwitcher";
import { UserMenu } from "./UserMenu";

export function AppHeader({
  locale,
  orgName,
  user,
  plan,
  apps,
}: {
  locale: string;
  orgName: string;
  user: { name: string; email: string };
  plan: string;
  apps: LeadAppItem[];
}) {
  const t = useTranslations("app.nav");
  return (
    <header className="border-b border-line-strong bg-panel">
      <div className="flex min-h-[52px] items-stretch px-3 sm:px-5">
        <Link
          href="/app"
          className="flex items-center gap-2.5 border-r border-line-strong pr-4"
          aria-label="InvoiceLead"
        >
          <AppMark label="IL" />
          <span className="hidden text-[15px] font-extrabold tracking-[-0.025em] text-accent sm:inline">
            InvoiceLead
          </span>
        </Link>
        <nav className="flex items-stretch">
          <Link
            href="/app"
            className="flex items-center border-r border-line-strong border-b-2 border-b-accent px-4 text-[13px] font-semibold text-accent"
          >
            {t("dashboard")}
          </Link>
        </nav>
        <div className="ml-auto flex items-center gap-2 pl-3">
          <span
            data-testid="org-name"
            className="hidden max-w-[220px] truncate text-[13px] font-semibold text-ink-3 md:inline"
          >
            {orgName}
          </span>
          <AppSwitcher items={apps} />
          <UserMenu name={user.name} email={user.email} plan={plan} locale={locale} />
        </div>
      </div>
    </header>
  );
}
