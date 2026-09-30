"use client";

import { useLocale, useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { cn } from "@/lib/utils";

export function LanguageSwitcher({ className }: { className?: string }) {
  const locale = useLocale();
  const pathname = usePathname();
  const t = useTranslations("nav");
  return (
    <nav aria-label={t("language")} className={cn("flex items-stretch", className)}>
      {routing.locales.map((l) => (
        <Link
          key={l}
          href={pathname}
          locale={l}
          hrefLang={l}
          aria-current={l === locale ? "true" : undefined}
          className={cn(
            "flex items-center px-2 text-[12px] font-bold uppercase",
            l === locale ? "text-accent" : "text-ink-muted hover:text-ink",
          )}
        >
          {l}
        </Link>
      ))}
    </nav>
  );
}
