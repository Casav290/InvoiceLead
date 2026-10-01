"use client";

import { useTranslations } from "next-intl";
import { ProBadge } from "@/components/app/ProLock";
import { Link, usePathname } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

const ITEMS = [
  { href: "/app/accounting/bank", key: "bank" },
  { href: "/app/accounting/review", key: "review" },
  { href: "/app/accounting/receipts", key: "receipts" },
  { href: "/app/accounting/bills", key: "bills" },
  { href: "/app/accounting", key: "journal" },
  { href: "/app/accounting/reports", key: "reports" },
  { href: "/app/accounting/cashflow", key: "cashflow" },
  { href: "/app/accounting/vat", key: "vat" },
] as const;

export type TabMarks = Partial<Record<(typeof ITEMS)[number]["key"], "pro" | "proplus">>;

/** Onglets de la comptabilité ; un onglet marqué reste un lien, en gris, avec sa marque. */
export function AccountingTabs({ marks }: { marks: TabMarks }) {
  const t = useTranslations("app.accountingHome.tabs");
  const pathname = usePathname();
  return (
    <nav aria-label={t("label")} className="mb-8 flex flex-wrap border-b border-line-strong">
      {ITEMS.map((item) => {
        const active =
          pathname === item.href ||
          (item.href !== "/app/accounting" && pathname.startsWith(`${item.href}/`));
        const mark = marks[item.key];
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            data-testid={`accounting-tab-${item.key}`}
            className={cn(
              "-mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-[13px] font-semibold",
              active
                ? "border-b-accent text-accent-dark"
                : mark
                  ? "border-b-transparent text-ink-muted"
                  : "border-b-transparent text-ink-muted hover:text-ink",
            )}
          >
            {t(item.key)}
            {mark ? <ProBadge tier={mark} /> : null}
          </Link>
        );
      })}
    </nav>
  );
}
