import { useTranslations } from "next-intl";
import { switchOrgAction } from "@/app/[locale]/app/org-actions";

export type OrgItem = { id: string; name: string; role: string };

/**
 * Choix de l'entreprise, affiché seulement quand la personne en a plusieurs (fiduciaire). Avec `next`
 * (écran « sans accès » arrivé d'une page demandée), le changement ramène sur cette page.
 */
export function OrgSwitcher({
  locale,
  current,
  orgs,
  next,
}: {
  locale: string;
  current: { id: string; name: string };
  orgs: OrgItem[];
  next?: string;
}) {
  const t = useTranslations("app.orgSwitch");
  return (
    <details className="relative" data-testid="org-switcher">
      <summary
        className="flex max-w-[220px] cursor-pointer list-none items-center gap-1 truncate text-[13px] font-semibold text-ink-3 hover:text-ink"
        aria-label={t("switch")}
      >
        <span className="truncate" data-testid="org-name">
          {current.name}
        </span>
        <span aria-hidden="true">▾</span>
      </summary>
      <div className="absolute right-0 z-20 mt-2 w-64 border border-line-strong bg-panel py-1">
        <p className="px-3 py-1.5 text-[10.5px] font-extrabold tracking-[0.09em] text-ink-muted uppercase">
          {t("label")}
        </p>
        {orgs.map((o) => (
          <form key={o.id} action={switchOrgAction}>
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="organizationId" value={o.id} />
            {next ? <input type="hidden" name="next" value={next} /> : null}
            <button
              type="submit"
              disabled={o.id === current.id}
              aria-current={o.id === current.id ? "true" : undefined}
              className="block w-full px-3 py-2 text-left text-[13px] hover:bg-head disabled:font-semibold disabled:text-accent-dark"
            >
              {o.name}
              {o.role === "fiduciary" ? (
                <span className="ml-1 text-[11px] text-ink-muted">({t("client")})</span>
              ) : null}
            </button>
          </form>
        ))}
      </div>
    </details>
  );
}
