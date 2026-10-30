import { createTranslator } from "next-intl";
import { type AppLocale, htmlLang, isLocale } from "@/i18n/locales";
import { RETURN_PATH } from "@/lib/lead-app-auth";
import { localeFromRequest } from "@/server/auth/login-cookie";

/**
 * Page de repli `https://invoicelead.io/lead-auth/return` (contrat d'ERPlead docs/GOOGLE-APP.md § 3c) :
 * l'adresse du lien de retour de « Continuer avec Google », quand elle ne s'est PAS ouverte dans l'app
 * (app pas à jour, vérification Android pas encore faite, fichier d'association pas encore chargé par
 * iOS). Elle dit quoi faire, sans aucun bouton qui porte le code (un lien du même domaine n'ouvrirait de
 * toute façon pas l'app).
 *
 * - Servie telle quelle par une route (src/app/lead-auth/return/route.ts) : 200, aucune redirection, aucun
 *   préfixe de langue (hors du proxy), `Cache-Control: no-store`, `Referrer-Policy: no-referrer`,
 *   `X-Robots-Tag: noindex`.
 * - HTML minimal, aucun script tiers. Seul script, en tête : hors de l'app, `history.replaceState` retire
 *   le code de l'adresse et de l'historique ; dans l'app (pont Capacitor natif), la vue web est menée à
 *   `/<langue>/lead-auth/return` avec les mêmes paramètres, où l'adresse suit les règles du lien de retour
 *   (lib/lead-app-auth.ts, followReturnPage).
 * - Langue : `locale` de l'adresse, sinon celle du navigateur ; phrase Android pour un agent Android ;
 *   remède d'iOS pour un iPhone, un iPad (en mode ordinateur, l'agent dit `Macintosh`) ou un iPod : iOS
 *   retient pour le domaine le choix « ouvrir dans le navigateur » (appui long sur « Ouvrir InvoiceLead »,
 *   puis « Ouvrir dans InvoiceLead »), et seul Safari est sûr d'ouvrir un lien vérifié touché.
 */

const MESSAGES = {
  de: () => import("../../messages/de.json"),
  fr: () => import("../../messages/fr.json"),
  en: () => import("../../messages/en.json"),
  it: () => import("../../messages/it.json"),
  es: () => import("../../messages/es.json"),
} satisfies Record<AppLocale, () => Promise<unknown>>;

/** En-têtes de la page de repli (aussi posés par next.config.ts pour cette adresse). */
export const RETURN_PAGE_HEADERS = {
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex",
} as const;

const esc = (s: string) =>
  s.replace(
    /[<>&"']/g,
    (ch) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" })[ch] ?? ch,
  );

/** La langue de la page : `locale` de l'adresse, sinon le cookie de langue du site, sinon le navigateur. */
export function returnPageLocale(
  asked: string | null,
  cookie: string | undefined,
  acceptLanguage: string | null,
): AppLocale {
  return isLocale(asked) ? asked : localeFromRequest(cookie, acceptLanguage);
}

/**
 * Le seul script de la page : dans l'app, la page de l'app qui suit le lien ; ailleurs, le code quitte
 * l'adresse et l'historique. La langue est l'une des cinq (jamais un texte de l'adresse).
 */
export function returnPageScript(locale: AppLocale): string {
  return `(function(){try{var c=window.Capacitor;if(c&&typeof c.isNativePlatform==="function"&&c.isNativePlatform()===true){document.documentElement.className="app";location.replace("/${locale}${RETURN_PATH}"+location.search);return}}catch(e){}try{history.replaceState(null,"","${RETURN_PATH}")}catch(e){}})();`;
}

/** Le téléphone d'après son agent : Android, ou iOS (iPhone, iPad, iPad en mode ordinateur, iPod). */
export function returnPageAgent(userAgent: string | null | undefined): {
  android: boolean;
  ios: boolean;
} {
  const ua = userAgent ?? "";
  const android = /\bAndroid\b/i.test(ua);
  return { android, ios: !android && /\b(?:iPhone|iPad|iPod|Macintosh)\b/.test(ua) };
}

export async function returnPageHtml(opts: {
  locale: AppLocale;
  android: boolean;
  ios?: boolean;
}): Promise<string> {
  const { locale, android, ios = false } = opts;
  const t = createTranslator({
    locale,
    messages: (await MESSAGES[locale]()).default,
    namespace: "leadAppReturn",
  });
  /** Les paragraphes, avec leur marque (phrase Android, remède d'iOS). */
  const lines: [string, string][] = [
    [t("body"), ""],
    ...(android ? [[t("android"), " data-android"] as [string, string]] : []),
    ...(ios ? [[t("ios"), " data-ios"] as [string, string]] : []),
    [t("notAsked"), ""],
  ];
  return `<!doctype html>
<html lang="${htmlLang(locale)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<meta name="robots" content="noindex, nofollow">
<title>${esc(t("title"))}</title>
<script>${returnPageScript(locale)}</script>
<style>
html.app body{visibility:hidden}
body{margin:0;background:#eceae7;color:#1c1b1a;font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
main{max-width:440px;margin:56px auto;padding:0 16px}
section{background:#fff;border:1px solid #c9c5bf;padding:20px 24px}
h1{font-size:24px;line-height:1.2;margin:0 0 12px}
p{font-size:15px;margin:10px 0 0;color:#3d3a37}
</style>
</head>
<body>
<main data-lead-auth-return>
<section>
<h1>${esc(t("title"))}</h1>
${lines.map(([l, mark]) => `<p${mark}>${esc(l)}</p>`).join("\n")}
</section>
</main>
</body>
</html>
`;
}
