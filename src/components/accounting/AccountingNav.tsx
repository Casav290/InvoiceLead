"use client";

import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

const ITEMS = [
  { href: "/app/accounting/bank", key: "bank" },
  { href: "/app/accounting", key: "journal" },
] as const;

/** Onglets de la comptabilité : banque (à valider), journal. */
export function AccountingNav() {
  const t = useTranslations("app.accountingHome.tabs");
  const pathname = usePathname();
  return (
    <nav aria-label={t("label")} className="mb-8 flex flex-wrap border-b border-line-strong">
      {ITEMS.map((item) => {
        const active = pathname === item.href;
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
