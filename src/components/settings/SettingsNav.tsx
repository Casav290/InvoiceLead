"use client";

import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

const ITEMS = [
  { href: "/app/settings/company", key: "company" },
  { href: "/app/settings/accounts", key: "accounts" },
  { href: "/app/settings/fiscal-years", key: "fiscalYears" },
  { href: "/app/settings/team", key: "team" },
] as const;

/** Onglets des réglages : entreprise, plan comptable, exercices, équipe. */
export function SettingsNav() {
  const t = useTranslations("app.settingsNav");
  const pathname = usePathname();
  return (
    <nav aria-label={t("label")} className="mb-8 flex flex-wrap border-b border-line-strong">
      {ITEMS.map((item) => {
        const active = pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-[13px] font-semibold",
              active
                ? "border-b-accent text-accent-dark"
                : "border-b-transparent text-ink-muted hover:text-ink",
            )}
          >
            {t(item.key)}
          </Link>
        );
      })}
    </nav>
  );
}
