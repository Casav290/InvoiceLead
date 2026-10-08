import type { MetadataRoute } from "next";
import { routing } from "@/i18n/routing";
import { LEGAL_DOCS } from "@/lib/legal";

/** Adresse publique du site, sans barre finale. */
export function siteUrl(): string {
  return (process.env.APP_URL ?? "https://invoicelead.io").replace(/\/+$/, "");
}

/** Pages publiques, chacune avec ses trois langues (hreflang). */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = siteUrl();
  const pages = ["", "/pricing", "/faq", ...LEGAL_DOCS.map((doc) => `/legal/${doc}`)];
  return pages.flatMap((page) =>
    routing.locales.map((locale) => ({
      url: `${base}/${locale}${page}`,
      changeFrequency: page === "" ? ("weekly" as const) : ("monthly" as const),
      priority: page === "" ? 1 : page.startsWith("/legal") ? 0.3 : 0.7,
      alternates: {
        languages: Object.fromEntries(routing.locales.map((l) => [l, `${base}/${l}${page}`])),
      },
    })),
  );
}
