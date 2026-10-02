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

/** Adresse de ProjectLead : sélecteur d'applications, page Temps, réglage de la liaison. */
export const PROJECTLEAD_URL = "https://projectlead.io";

/**
 * Applications connues. `url` : l'application est en ligne à cette adresse. Une application sœur en
 * ligne s'ouvre même si le Compte Lead la dit encore « Bientôt » ou ne donne pas son adresse : sa
 * fiche peut y être en retard sur le lancement (ProjectLead).
 */
const KNOWN: { code: string; name: string; mark: string; url: string | null }[] = [
  { code: "scanlead", name: "Scanlead", mark: "SL", url: "https://scanlead.io" },
  { code: "crmlead", name: "CRMlead", mark: "CL", url: "https://crmlead.io" },
  { code: "projectlead", name: "ProjectLead", mark: "PL", url: PROJECTLEAD_URL },
  { code: "invoicelead", name: "InvoiceLead", mark: "IL", url: null },
];

function loginUrl(base: string): string {
  return `${base.replace(/\/+$/, "")}/login`;
}

/**
 * Construit la liste à partir des droits du Compte Lead (`claims.lead.apps`). Sans droits connus,
 * les applications sœurs s'ouvrent sur leur écran de connexion, les autres restent « Bientôt ». Une
 * application que le Compte Lead réserve à une autre formule (`access: false`) mène à la mise à niveau.
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
    if ((app?.status === "soon" && !known?.url) || !url)
      return { code, name, mark, href: null, state: "soon" };
    if (app && app.access === false) {
      return { code, name, mark, href: app.upgrade_url ?? null, state: "upgrade" };
    }
    return { code, name, mark, href: loginUrl(url), state: "open" };
  });
}
