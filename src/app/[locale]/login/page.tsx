import type { Metadata } from "next";
import { redirect as nextRedirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { LeadLoginPanel } from "@/components/public/LeadLoginPanel";
import { PublicFooter } from "@/components/public/PublicFooter";
import { PublicHeader } from "@/components/public/PublicHeader";
import { routing } from "@/i18n/routing";
import { invitePath, safeInvite, safeNext } from "@/server/auth/login-cookie";
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
  searchParams: Promise<{ erreur?: string; next?: string; invite?: string }>;
}) {
  const { locale } = await params;
  const q = await searchParams;
  // Une invitation de fiduciaire à accepter passe avant la page demandée.
  const invite = safeInvite(q.invite);
  const next = invite ? undefined : safeNext(q.next);
  // Déjà connecté : directement dans l'application, sur la page demandée s'il y en a une.
  if (await getSession())
    nextRedirect(invite ? invitePath(locale, invite) : (next ?? `/${locale}/app`));
  const error = q.erreur === "lead" || q.erreur === "session" ? q.erreur : undefined;
  // Pas d'écran intermédiaire : tout droit vers la connexion commune du Compte Lead. L'écran
  // ne reste que pour dire une erreur et proposer de réessayer.
  if (!error) {
    nextRedirect(
      `/auth/lead/start?${new URLSearchParams({ locale, ...(invite ? { invite } : next ? { next } : {}) })}`,
    );
  }
  // Tous les liens de l'écran ramènent à la page demandée (ou à l'invitation), pas seulement le bouton :
  // « Connexion » et « Créer un compte » de l'en-tête et du pied de page, et le choix de la langue, qui
  // garde l'écran d'erreur et la même page dans l'autre langue.
  const back: Record<string, string> = invite ? { invite } : next ? { next } : {};
  const langQuery = Object.fromEntries(
    routing.locales.map((l) => {
      const moved = next ? safeNext(next.replace(/^\/(de|fr|en)\//, `/${l}/`)) : undefined;
      return [l, { erreur: error, ...(invite ? { invite } : moved ? { next: moved } : {}) }];
    }),
  );
  return (
    <div className="flex min-h-screen flex-col">
      <PublicHeader back={back} langQuery={langQuery} />
      <main className="flex flex-1 items-start px-4 py-14 sm:py-20">
        <LeadLoginPanel mode="login" locale={locale} error={error} next={next} invite={invite} />
      </main>
      <PublicFooter back={back} />
    </div>
  );
}
