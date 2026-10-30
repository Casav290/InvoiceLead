import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { GoogleRelay } from "@/components/native/LeadAppAuth";
import { issuerOrigin, relayTargets } from "@/lib/lead-app-auth";

/**
 * Page relais de « Continuer avec Google » dans l'app Android / iOS (lib/lead-app-auth.ts) : ERPlead y
 * envoie la vue web de l'app (`/lead-auth/google?start&back`, la langue posée par le proxy). Publique,
 * sans session : seuls `start` et `back` venus de l'émetteur du Compte Lead sont repris.
 */
export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "leadAppAuth" });
  return { title: t("relayTitle"), robots: { index: false, follow: false } };
}

const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ start?: string | string[]; back?: string | string[] }>;
}) {
  const { locale } = await params;
  const q = await searchParams;
  const t = await getTranslations({ locale, namespace: "leadAppAuth" });
  const issuer = issuerOrigin(process.env.LEAD_ID_ISSUER);
  const targets = relayTargets(issuer, one(q.start), one(q.back));
  return (
    <GoogleRelay
      issuer={issuer}
      start={targets?.start ?? null}
      back={targets?.back ?? null}
      locale={locale}
      title={t("relayTitle")}
      body={t("relayBody")}
      safariBody={t("relaySafari")}
      backLabel={t("back")}
    />
  );
}
