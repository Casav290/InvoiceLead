import "@fontsource-variable/archivo";
import "../globals.css";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { getLocale, getTranslations } from "next-intl/server";
import { routing } from "@/i18n/routing";

/** Seules /de et /fr existent : toute autre première partie d'adresse est un 404 statique, jamais mis en cache. */
export const dynamicParams = false;

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "meta" });
  // Les liens hreflang par page sont envoyés par le proxy de next-intl (en-têtes Link).
  return {
    title: { default: t("title"), template: "%s · InvoiceLead" },
    description: t("description"),
    metadataBase: new URL(process.env.APP_URL ?? "http://localhost:3000"),
  };
}

export default async function LocaleLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  if (!hasLocale(routing.locales, locale)) notFound();
  return (
    <html lang={locale === "en" ? "en-GB" : `${locale}-CH`}>
      <body className="min-h-screen">
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
