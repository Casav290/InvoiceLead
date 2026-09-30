import { notFound } from "next/navigation";
import * as rootParams from "next/root-params";
import { hasLocale } from "next-intl";
import { getRequestConfig } from "next-intl/server";
import { routing } from "./routing";

/**
 * Langue lue dans le segment racine `[locale]` (next/root-params). Hors pages (route handlers,
 * actions serveur, PDF d'une facture), passer la langue explicitement : getTranslations({ locale, … }).
 */
export default getRequestConfig(async ({ locale: requested }) => {
  let locale = requested;
  if (!locale) {
    const param = await rootParams.locale();
    if (!hasLocale(routing.locales, param)) notFound();
    locale = param;
  }
  if (!hasLocale(routing.locales, locale)) locale = routing.defaultLocale;
  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
  };
});
