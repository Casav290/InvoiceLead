"use client";

import { useTranslations } from "next-intl";
import { ProBadge } from "@/components/app/ProLock";
import { Link, usePathname } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

const ITEMS = [
  { href: "/app/settings/company", key: "company" },
  { href: "/app/settings/accounts", key: "accounts" },
  { href: "/app/settings/fiscal-years", key: "fiscalYears" },
  { href: "/app/settings/team", key: "team" },
  { href: "/app/settings/payments", key: "payments" },
  { href: "/app/settings/projectlead", key: "projectlead" },
  { href: "/app/settings/api", key: "api" },
] as const;

export type SettingsMarks = Partial<Record<(typeof ITEMS)[number]["key"], "pro" | "proplus">>;

/**
 * Onglets des réglages : entreprise, plan comptable, exercices, équipe, paiements, ProjectLead (toutes
 * formules), API. Un onglet marqué (fonction réservée) reste un lien, grisé, avec sa marque.
 */
export function SettingsTabs({ marks }: { marks: SettingsMarks }) {
  const t = useTranslations("app.settingsNav");
  const pathname = usePathname();
  return (
    <nav aria-label={t("label")} className="mb-8 flex flex-wrap border-b border-line-strong">
      {ITEMS.map((item) => {
        const active = pathname.startsWith(item.href);
        const mark = marks[item.key];
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            data-testid={`settings-tab-${item.key}`}
            className={cn(
              "-mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-[13px] font-semibold",
              active
                ? "border-b-accent text-accent-dark"
                : mark
                  ? // Onglet d'une fonction réservée : grisé (fond gris), sans effet au survol.
                    "border-b-transparent bg-muted text-ink-muted"
                  : "border-b-transparent text-ink-2 hover:text-ink",
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
