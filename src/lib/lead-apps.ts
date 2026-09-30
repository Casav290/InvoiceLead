/** Les applications de la famille Lead, telles que les montre le sélecteur à 9 points. */
export type LeadAppState = "current" | "open" | "soon" | "upgrade";

export type LeadAppItem = {
  code: string;
  name: string;
  mark: string;
  href: string | null;
  state: LeadAppState;
};

type EntitlementApp = {
  access?: boolean;
  name?: string;
  url?: string | null;
  status?: string;
  upgrade_url?: string | null;
};

const KNOWN: { code: string; name: string; mark: string; url: string | null }[] = [
  { code: "scanlead", name: "Scanlead", mark: "SL", url: "https://scanlead.io" },
  { code: "crmlead", name: "CRMlead", mark: "CL", url: "https://crmlead.io" },
  { code: "projectlead", name: "ProjectLead", mark: "PL", url: null },
  { code: "invoicelead", name: "InvoiceLead", mark: "IL", url: null },
];

function loginUrl(base: string): string {
  return `${base.replace(/\/+$/, "")}/login`;
}

/**
 * Construit la liste à partir des droits du Compte Lead (`claims.lead.apps`). Sans droits connus,
 * les applications sœurs s'ouvrent sur leur écran de connexion, les autres restent « Bientôt ».
 */
export function leadAppItems(
  current: string,
  apps: Record<string, EntitlementApp> | null | undefined,
): LeadAppItem[] {
  const codes = [...KNOWN.map((k) => k.code), ...Object.keys(apps ?? {})].filter(
    (code, i, all) => all.indexOf(code) === i,
  );
  return codes.map((code) => {
    const known = KNOWN.find((k) => k.code === code);
    const app = apps?.[code];
    const name = app?.name || known?.name || code;
    const mark = known?.mark ?? name.slice(0, 2).toUpperCase();
    const url = app?.url ?? known?.url ?? null;
    if (code === current) return { code, name, mark, href: null, state: "current" };
    if (app?.status === "soon" || !url) return { code, name, mark, href: null, state: "soon" };
    if (app && app.access === false) {
      return { code, name, mark, href: app.upgrade_url ?? null, state: "upgrade" };
    }
    return { code, name, mark, href: loginUrl(url), state: "open" };
  });
}
