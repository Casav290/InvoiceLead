"use client";

import { useLocale, useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { cn } from "@/lib/utils";

/**
 * Choix de la langue : la même page dans l'autre langue. `query` garde, pour chaque langue, la
 * recherche d'une page qui en dépend (écran d'erreur de la connexion : l'erreur, la page demandée ou
 * l'invitation). Elle vient du serveur, jamais de useSearchParams : les pages publiques restent
 * statiques.
 */
export function LanguageSwitcher({
  className,
  query,
}: {
  className?: string;
  query?: Partial<Record<string, Record<string, string>>>;
}) {
  const locale = useLocale();
  const pathname = usePathname();
  const t = useTranslations("nav");
  return (
    <nav aria-label={t("language")} className={cn("flex items-stretch", className)}>
      {routing.locales.map((l) => {
        const kept = query?.[l];
        return (
          <Link
            key={l}
            href={kept ? { pathname, query: kept } : pathname}
            locale={l}
            hrefLang={l}
            aria-current={l === locale ? "true" : undefined}
            className={cn(
              "flex items-center px-2 text-[12px] font-bold uppercase",
              l === locale
                ? "text-accent-dark underline decoration-2 underline-offset-4"
                : "text-ink-muted hover:text-ink",
            )}
          >
            {l}
          </Link>
        );
      })}
    </nav>
  );
}
