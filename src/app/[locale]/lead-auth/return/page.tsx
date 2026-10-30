import type { Metadata } from "next";
import { LeadAppReturnPage } from "@/components/native/LeadAppAuth";
import { issuerOrigin } from "@/lib/lead-app-auth";

/**
 * Le lien de retour de « Continuer avec Google » ouvert par la vue web de l'app elle-même : la page de
 * repli `/lead-auth/return` y mène l'app (même recherche), où l'adresse suit les règles du lien de retour
 * (lib/lead-app-auth.ts, followReturnPage). Hors de l'app, retour à la page de repli.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return <LeadAppReturnPage issuer={issuerOrigin(process.env.LEAD_ID_ISSUER)} locale={locale} />;
}
