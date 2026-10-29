import { createTranslator } from "next-intl";
import { forCountry, type Translator } from "@/i18n/country";
import { isLocale, LOCALE_PATTERN } from "@/i18n/locales";
import { routing } from "@/i18n/routing";
import { pageLabel as labelWith, openablePage } from "@/lib/assistant-pages";

/**
 * Libellés des écrans pour le serveur de la bulle (B5) : ce que open_page rend au modèle et ce que
 * la navigation emporte, dans la langue de l'interface et avec les mots du pays de l'entreprise
 * (« Angebote » en Allemagne), les mêmes que les titres des écrans.
 */
const MESSAGES: Record<string, () => Promise<{ default: unknown }>> = {
  de: () => import("../../../messages/de.json"),
  fr: () => import("../../../messages/fr.json"),
  en: () => import("../../../messages/en.json"),
  it: () => import("../../../messages/it.json"),
  es: () => import("../../../messages/es.json"),
};

async function translator(
  locale: string,
  country: string | null | undefined,
): Promise<(key: string) => string> {
  const lang = isLocale(locale) ? locale : routing.defaultLocale;
  const load = MESSAGES[lang] ?? MESSAGES[routing.defaultLocale];
  const messages = load ? (await load()).default : {};
  const t = createTranslator({
    locale: lang,
    messages: messages as never,
    namespace: "app" as never,
  }) as unknown as Translator;
  const tr = forCountry(t, country);
  return (key) => tr(key);
}

/** Libellé de l'écran (chemin sans la langue) ; celui du tableau de bord pour un chemin inconnu. */
export async function pageLabel(
  path: string,
  locale: string,
  country: string | null | undefined,
): Promise<string> {
  const t = await translator(locale, country);
  return labelWith(path, t) ?? labelWith("/app", t) ?? "InvoiceLead";
}

/**
 * Un chemin d'écran écrit par le modèle dans sa réponse (« /app/invoices », « /fr/app/quotes/<id> »,
 * « https://invoicelead.io/fr/app »), langue et adresse comprises.
 */
const RAW_PATH = new RegExp(
  `(?:(?:https?://)?(?:[\\w-]+\\.)+[a-z]{2,}(?::\\d+)?|(?<![\\w/.-]))(?:/(?:${LOCALE_PATTERN}))?/app(?![\\w-])(?:/[\\w:-]+)*/?`,
  "gi",
);

/** Le chemin sans adresse ni langue, raccourci jusqu'à un écran connu (« /app » au pire). */
function nearestPage(raw: string): string {
  let path = raw
    .replace(/^(?:https?:\/\/)?(?:[\w-]+\.)+[a-z]{2,}(?::\d+)?/i, "")
    .replace(new RegExp(`^/(?:${LOCALE_PATTERN})(?=/)`, "i"), "")
    .replace(/\/+$/, "");
  while (path && !openablePage(path)) path = path.slice(0, path.lastIndexOf("/"));
  return path || "/app";
}

/**
 * Aucun chemin brut dans le fil (B5) : un chemin d'écran écrit par le modèle malgré la consigne est
 * remplacé par le libellé de l'écran.
 */
export async function scrubPaths(
  text: string,
  locale: string,
  country: string | null | undefined,
): Promise<string> {
  const labels = new Map<string, string>();
  for (const raw of new Set(text.match(RAW_PATH) ?? []))
    labels.set(raw, await pageLabel(nearestPage(raw), locale, country));
  return labels.size === 0 ? text : text.replace(RAW_PATH, (raw) => labels.get(raw) ?? raw);
}
