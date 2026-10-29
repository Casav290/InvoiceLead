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
import { assistantBudget, budgetView, tierOf, upgradeUrl } from "@/server/plans";
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
  // Formule gratuite : ce qui reste de l'assistant IA ce mois-ci (null sans limite, sans lecture).
  const budget = bubble ? budgetView(await assistantBudget(db(), organization)) : null;
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
        {/* Bulle « Assistant IA » : place gardée sous la page pour qu'elle ne cache jamais sa fin
            (B9 : 96 px = bulle 56 + bord 24 + 16, plus la zone sûre du téléphone ; rien à l'impression). */}
        <main
          className={
            bubble ? "flex-1 pb-[calc(6rem+env(safe-area-inset-bottom))] print:pb-0" : "flex-1"
          }
        >
          {children}
        </main>
        {/* B10 : le fil de l'onglet est propre à l'entreprise ET à la personne. */}
        {bubble && (
          <AssistantBubble
            storageKey={`il-assistant:${organization.id}:${user.id}`}
            budget={budget}
            // Lien vers les formules quand le budget gratuit est atteint (jamais dans l'app mobile).
            plansHref={upgrade?.href ?? null}
          />
        )}
      </div>
    </CountryProvider>
  );
}
