"use client";

import { Check, Globe } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { DropdownMenu } from "radix-ui";
import { useTransition } from "react";
import { chooseLocaleAction } from "@/app/[locale]/app/locale-actions";
import { LOCALE_MENU, LOCALE_NAMES } from "@/i18n/locales";
import { Link, usePathname, useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

const ITEM =
  "flex cursor-pointer items-center justify-between gap-3 px-2 py-2 font-semibold outline-hidden data-[highlighted]:bg-accent-veil data-[highlighted]:outline-2 data-[highlighted]:outline-accent data-[highlighted]:-outline-offset-2";

/**
 * Choix de la langue (Français, Deutsch, English, Italiano, Español) : la même page dans l'autre
 * langue, tout de suite.
 *
 * - Pages publiques : de simples liens (`query` garde, pour chaque langue, la recherche d'une page qui
 *   en dépend, comme l'écran d'erreur de la connexion ; jamais useSearchParams, les pages restent
 *   statiques). La langue suit l'adresse et le cookie NEXT_LOCALE de next-intl.
 * - Espace connecté (`account`) : la langue est d'abord gardée dans le compte (chooseLocaleAction),
 *   puis la page s'ouvre dans la nouvelle langue avec sa recherche (filtres, onglet).
 * - Pages dynamiques dont la recherche porte la page (`keepSearch` : invitation et son jeton, refus
 *   d'accès) : la même adresse, recherche comprise, dans l'autre langue.
 */
export function LocaleMenu({
  className,
  query,
  account = false,
  keepSearch = false,
}: {
  className?: string;
  query?: Partial<Record<string, Record<string, string>>>;
  account?: boolean;
  keepSearch?: boolean;
}) {
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const t = useTranslations("nav");
  const [pending, startTransition] = useTransition();
  const current = LOCALE_NAMES[locale as keyof typeof LOCALE_NAMES] ?? locale;

  const choose = (l: string) => {
    if (l === locale) return;
    startTransition(async () => {
      if (account) await chooseLocaleAction(l).catch(() => false);
      const search = typeof window === "undefined" ? "" : window.location.search;
      router.replace(`${pathname}${search}`, { locale: l });
    });
  };

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          data-testid="locale-menu"
          aria-label={`${t("language")} (${current})`}
          aria-busy={pending || undefined}
          className={cn(
            "flex h-8 items-center gap-1.5 border border-line-strong bg-panel px-2 text-[12px] font-bold text-ink hover:bg-muted",
            className,
          )}
        >
          <Globe aria-hidden className="size-4 shrink-0" strokeWidth={2} />
          {/* Nom natif quand la barre a la place (pages publiques, espace sous 1280 px où la navigation
              passe à la ligne, grands écrans) ; sinon le code, sans déborder. */}
          <span
            className={cn("uppercase", account ? "sm:hidden xl:inline 2xl:hidden" : "sm:hidden")}
          >
            {locale}
          </span>
          <span className={cn("hidden sm:inline", account && "xl:hidden 2xl:inline")}>
            {current}
          </span>
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={6}
          data-testid="locale-options"
          className="z-50 w-[180px] border border-line-strong bg-panel p-1 font-sans text-[13px] text-ink"
        >
          <DropdownMenu.Label className="px-2 pt-1 pb-1.5 text-[12px] text-ink-muted">
            {t("language")}
          </DropdownMenu.Label>
          {LOCALE_MENU.map((l) => {
            const active = l === locale;
            const label = (
              <>
                <span lang={l}>{LOCALE_NAMES[l]}</span>
                {active ? <Check aria-hidden className="size-4 text-accent-dark" /> : null}
              </>
            );
            if (account || keepSearch)
              return (
                <DropdownMenu.Item
                  key={l}
                  data-locale={l}
                  aria-current={active ? "true" : undefined}
                  onSelect={() => choose(l)}
                  className={cn(ITEM, active && "text-accent-dark")}
                >
                  {label}
                </DropdownMenu.Item>
              );
            const kept = query?.[l];
            return (
              <DropdownMenu.Item key={l} asChild className={cn(ITEM, active && "text-accent-dark")}>
                <Link
                  href={kept ? { pathname, query: kept } : pathname}
                  locale={l}
                  hrefLang={l}
                  data-locale={l}
                  aria-current={active ? "true" : undefined}
                >
                  {label}
                </Link>
              </DropdownMenu.Item>
            );
          })}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
