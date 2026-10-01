import { getTranslations } from "next-intl/server";
import type { Lock } from "@/components/app/ProLock";
import { type Access, type OrgPlan, type Tier, upgradeUrl } from "./plans";

/** Verrou à afficher pour une formule donnée : marque, raison, lien vers la formule qui l'ouvre. */
export async function planLock(
  locale: string,
  org: OrgPlan,
  upgradeTo: Tier | null,
  reason: string,
): Promise<Lock> {
  const t = await getTranslations({ locale, namespace: "app.plan" });
  const tier = upgradeTo === "pro" || upgradeTo === "proplus" ? upgradeTo : null;
  return {
    tier,
    reason,
    upgrade: tier
      ? { label: t(tier === "proplus" ? "upgradePlus" : "upgrade"), href: upgradeUrl(org) }
      : null,
  };
}

/** Verrou d'un accès refusé (null s'il est permis). */
export async function lockFor(
  locale: string,
  org: OrgPlan,
  access: Access,
  reason: string,
): Promise<Lock | null> {
  return access.allowed ? null : planLock(locale, org, access.upgradeTo, reason);
}

/** Raison type d'une fonction réservée : « Fonction Pro. Passez à Pro pour l'utiliser. » */
export async function lockedReason(locale: string, tier: Tier | null): Promise<string> {
  const t = await getTranslations({ locale, namespace: "app.plan" });
  return t(tier === "proplus" ? "lockedPlus" : "locked");
}
