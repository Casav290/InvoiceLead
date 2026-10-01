import type { Metadata } from "next";
import { redirect as nextRedirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { LeadLoginPanel } from "@/components/public/LeadLoginPanel";
import { PublicFooter } from "@/components/public/PublicFooter";
import { PublicHeader } from "@/components/public/PublicHeader";
import { redirect } from "@/i18n/navigation";
import { safeNext } from "@/server/auth/login-cookie";
import { getSession } from "@/server/auth/session";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "auth" });
  return { title: t("loginTitle") };
}

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ erreur?: string; next?: string }>;
}) {
  const { locale } = await params;
  // Déjà connecté : directement dans l'application.
  if (await getSession()) redirect({ href: "/app", locale });
  const { erreur, next } = await searchParams;
  const error = erreur === "lead" || erreur === "session" ? erreur : undefined;
  // Pas d'écran intermédiaire : tout droit vers la connexion commune du Compte Lead. L'écran
  // ne reste que pour dire une erreur et proposer de réessayer.
  if (!error) {
    const back = safeNext(next);
    nextRedirect(
      `/auth/lead/start?${new URLSearchParams({ locale, ...(back ? { next: back } : {}) })}`,
    );
  }
  return (
    <div className="flex min-h-screen flex-col">
      <PublicHeader />
      <main className="flex flex-1 items-start px-4 py-14 sm:py-20">
        <LeadLoginPanel mode="login" locale={locale} error={error} />
      </main>
      <PublicFooter />
    </div>
  );
}
