import { getTranslations } from "next-intl/server";
import type { Lock } from "@/components/app/ProLock";
import { inNativeApp } from "./native";
import { type Access, type Tier, upgradeUrl } from "./plans";

/**
 * Verrou à afficher pour une formule donnée : marque, raison, lien vers la page Formule
 * d'InvoiceLead, la formule qui l'ouvre présélectionnée.
 */
export async function planLock(
  locale: string,
  upgradeTo: Tier | null,
  reason: string,
): Promise<Lock> {
  const t = await getTranslations({ locale, namespace: "app.plan" });
  const tier = upgradeTo === "pro" || upgradeTo === "proplus" ? upgradeTo : null;
  return {
    tier,
    reason,
    // Dans l'app Android / iOS : verrou sans lien d'achat (lib/native.ts).
    upgrade:
      tier && !(await inNativeApp())
        ? {
            label: t(tier === "proplus" ? "upgradePlus" : "upgrade"),
            href: upgradeUrl(locale, tier),
          }
        : null,
  };
}

/** Verrou d'un accès refusé (null s'il est permis). */
export async function lockFor(
  locale: string,
  access: Access,
  reason: string,
): Promise<Lock | null> {
  return access.allowed ? null : planLock(locale, access.upgradeTo, reason);
}

/** Raison type d'une fonction réservée : « Fonction Pro. Passez à Pro pour l'utiliser. » */
export async function lockedReason(locale: string, tier: Tier | null): Promise<string> {
  const t = await getTranslations({ locale, namespace: "app.plan" });
  return t(tier === "proplus" ? "lockedPlus" : "locked");
}
