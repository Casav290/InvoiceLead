import type { Metadata } from "next";
import { redirect as nextRedirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { LeadLoginPanel } from "@/components/public/LeadLoginPanel";
import { PublicFooter } from "@/components/public/PublicFooter";
import { PublicHeader } from "@/components/public/PublicHeader";
import { redirect } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { getSession } from "@/server/auth/session";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "auth" });
  return { title: t("signupTitle") };
}

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ erreur?: string }>;
}) {
  const { locale } = await params;
  // Déjà connecté : directement dans l'application.
  if (await getSession()) redirect({ href: "/app", locale });
  const { erreur } = await searchParams;
  const error = erreur === "lead" || erreur === "session" ? erreur : undefined;
  // Pas d'écran intermédiaire : tout droit vers l'inscription commune du Compte Lead.
  if (!error) nextRedirect(`/auth/lead/start?${new URLSearchParams({ locale, signup: "1" })}`);
  // Changer de langue garde l'écran d'erreur, au lieu de repartir aussitôt vers l'inscription.
  const langQuery = Object.fromEntries(routing.locales.map((l) => [l, { erreur: error }]));
  return (
    <div className="flex min-h-screen flex-col">
      <PublicHeader langQuery={langQuery} />
      <main className="flex flex-1 items-start px-4 py-14 sm:py-20">
        <LeadLoginPanel mode="signup" locale={locale} error={error} />
      </main>
      <PublicFooter />
    </div>
  );
}
