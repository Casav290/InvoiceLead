"use client";

import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

const ITEMS = [
  { href: "/app", key: "dashboard", exact: true, match: "/app" },
  { href: "/app/quotes", key: "quotes", exact: false, match: "/app/quotes" },
  { href: "/app/invoices", key: "invoices", exact: false, match: "/app/invoices" },
  { href: "/app/time", key: "time", exact: false, match: "/app/time" },
  { href: "/app/expenses", key: "expenses", exact: false, match: "/app/expenses" },
  { href: "/app/contacts", key: "contacts", exact: false, match: "/app/contacts" },
  { href: "/app/products", key: "products", exact: false, match: "/app/products" },
  { href: "/app/accounting", key: "accounting", exact: false, match: "/app/accounting" },
  { href: "/app/settings/company", key: "settings", exact: false, match: "/app/settings" },
] as const;

export function AppNav() {
  const t = useTranslations("app.nav");
  const pathname = usePathname();
  return (
    <nav className="order-last flex w-full items-stretch overflow-x-auto border-t border-line xl:order-none xl:w-auto xl:overflow-visible xl:border-t-0">
      {ITEMS.map((item) => {
        const active = item.exact ? pathname === item.href : pathname.startsWith(item.match);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex min-h-10 flex-1 shrink-0 items-center whitespace-nowrap justify-center border-r border-line-strong px-1 text-center text-[11px] font-semibold last:border-r-0 sm:px-4 sm:text-[13px] xl:flex-none xl:last:border-r",
              active
                ? "border-b-2 border-b-accent text-accent-dark"
                : "text-ink-muted hover:text-ink",
            )}
          >
            {t(item.key)}
          </Link>
        );
      })}
    </nav>
  );
}
