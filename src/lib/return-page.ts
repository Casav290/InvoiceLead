/**
 * Page où revenir après une reconnexion, pour l'adresse demandée (`pathname` + `search`). C'est
 * l'adresse elle-même, sauf pour un fichier à télécharger (export DATEV, FEC, XML TVA, XRechnung) :
 * ramené là par la connexion, le fichier se téléchargerait mais l'onglet resterait sur l'écran du
 * Compte Lead. On revient alors sur la page de son formulaire ou de son lien, comme pour l'export des
 * paiements (POST seulement). Seuls quelques paramètres de recherche connus sont gardés.
 *
 * Sans dépendance au serveur : le proxy s'en sert aussi.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

function decoded(pathname: string): string {
  try {
    return decodeURIComponent(pathname);
  } catch {
    return pathname;
  }
}

function withParam(path: string, name: string, value: string | null, valid: RegExp): string {
  return value && valid.test(value) ? `${path}?${name}=${value}` : path;
}

export function returnPage(pathname: string, search: string): string {
  const path = decoded(pathname);
  const q = new URLSearchParams(search);
  const app = /^\/(de|fr|en)\/app\/(.+?)\/?$/i.exec(path);
  if (app) {
    const locale = (app[1] ?? "de").toLowerCase();
    const rest = app[2] ?? "";
    if (/^accounting\/reports\/(datev|fec)$/i.test(rest))
      return withParam(`/${locale}/app/accounting/reports`, "year", q.get("year"), UUID);
    if (/^accounting\/vat\/xml$/i.test(rest))
      return withParam(`/${locale}/app/accounting/vat`, "period", q.get("period"), DAY);
    if (/^accounting\/bills\/export$/i.test(rest)) return `/${locale}/app/accounting/bills`;
    const doc = /^(invoices|credit-notes)\/([^/]+)\/xrechnung$/i.exec(rest);
    if (doc) {
      const section = (doc[1] ?? "invoices").toLowerCase();
      const id = doc[2] ?? "";
      return UUID.test(id) ? `/${locale}/app/${section}/${id}` : `/${locale}/app/${section}`;
    }
  }
  return `${pathname}${search}`;
}
