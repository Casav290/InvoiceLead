"use client";

import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

const ITEMS = [
  { href: "/app", key: "dashboard", exact: true },
  { href: "/app/contacts", key: "contacts", exact: false },
  { href: "/app/products", key: "products", exact: false },
  { href: "/app/settings/company", key: "settings", exact: false },
] as const;

export function AppNav() {
  const t = useTranslations("app.nav");
  const pathname = usePathname();
  return (
    <nav className="order-last flex w-full items-stretch border-t border-line sm:order-none sm:w-auto sm:border-t-0">
      {ITEMS.map((item) => {
        const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex min-h-10 min-w-0 flex-1 items-center justify-center border-r border-line-strong px-1 text-center text-[11px] font-semibold last:border-r-0 sm:flex-none sm:px-4 sm:text-[13px] sm:last:border-r",
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
