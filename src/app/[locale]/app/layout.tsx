import { AppHeader } from "@/components/app/AppHeader";
import { CountryProvider } from "@/components/app/CountryContext";
import { AssistantBubble } from "@/components/assistant/AssistantBubble";
import { leadAppItems } from "@/lib/lead-apps";
import { assistantConfigured } from "@/server/ai-assistant/auth";
import { APP_CODE } from "@/server/auth/attach";
import { requireAppSession } from "@/server/auth/guard";
import { getSessionCountryTranslations } from "@/server/country-translations";
import { db } from "@/server/db";
import { inNativeApp } from "@/server/native";
import { tierOf, upgradeUrl } from "@/server/plans";
import { listUserOrganizations } from "@/server/team";

export default async function AppLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const { user, organization } = await requireAppSession(locale);
  const orgs = await listUserOrganizations(db(), user.id);
  const tier = tierOf(organization);
  // Sans clé côté serveur, pas de bulle (et /api/assistant répond 503).
  const bubble = assistantConfigured();
  const tp = await getSessionCountryTranslations({ locale, namespace: "app.plan" });
  // Dans l'app Android / iOS : pas de « Passer à Pro » (lib/native.ts).
  const upgrade =
    tier === "proplus" || (await inNativeApp())
      ? null
      : {
          href: upgradeUrl(locale, tier === "pro" ? "proplus" : "pro"),
          label: tp(tier === "pro" ? "upgradePlus" : "upgrade"),
        };
  return (
    // data-lead-org : l'organisation du Compte Lead de l'espace ouvert (contrôle du passage entre
    // applications de la famille, ~/projets/lead-e2e/check-passage.mjs).
    // CountryProvider : les libellés des composants client suivent le pays de l'entreprise.
    <CountryProvider country={organization.country}>
      <div className="flex min-h-screen flex-col" data-lead-org={organization.leadOrg ?? undefined}>
        <AppHeader
          locale={locale}
          orgId={organization.id}
          orgName={organization.name}
          orgs={orgs}
          user={{ name: user.name, email: user.email }}
          // La formule DANS InvoiceLead (tierOf : Compte Lead et abonnement payé ici).
          planCode={tier === "proplus" ? "pro_plus" : tier}
          planName={tp(tier)}
          // La liste commune de la famille, jamais filtrée par les droits ni par la formule.
          apps={leadAppItems(APP_CODE, locale)}
          upgrade={upgrade}
        />
        {/* Bulle « Assistant IA » : place gardée sous la page pour qu'elle ne cache jamais sa fin. */}
        <main className={bubble ? "flex-1 pb-24" : "flex-1"}>{children}</main>
        {bubble && <AssistantBubble storageKey={`il-assistant:${organization.id}:${user.id}`} />}
      </div>
    </CountryProvider>
  );
}
