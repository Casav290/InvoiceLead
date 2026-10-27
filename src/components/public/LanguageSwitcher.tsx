"use client";

import { LocaleMenu } from "@/components/LocaleMenu";

/**
 * Choix de la langue des pages publiques : la même page dans l'une des cinq langues (LocaleMenu).
 * `query` garde, pour chaque langue, la recherche d'une page qui en dépend (écran d'erreur de la
 * connexion : l'erreur, la page demandée ou l'invitation). Elle vient du serveur, jamais de
 * useSearchParams : les pages publiques restent statiques.
 */
export function LanguageSwitcher({
  className,
  query,
}: {
  className?: string;
  query?: Partial<Record<string, Record<string, string>>>;
}) {
  return (
    <div className={className}>
      <LocaleMenu query={query} />
    </div>
  );
}
