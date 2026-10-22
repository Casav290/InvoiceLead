import { getSession } from "@/server/auth/session";
import { markOf } from "@/server/current-plan";
import { inNativeApp } from "@/server/native";
import { featureAccess } from "@/server/plans";
import { SettingsTabs } from "./SettingsTabs";

/**
 * Onglets des réglages ; l'onglet API porte la marque « Pro+ » en dessous de Pro+, l'onglet des
 * factures électroniques reçues n'apparaît qu'aux entreprises françaises.
 */
export async function SettingsNav() {
  const session = await getSession();
  const api = session ? markOf(featureAccess(session.organization, "api")) : null;
  const hidden: ("plan" | "einvoicing")[] = (await inNativeApp()) ? ["plan"] : [];
  // Réception par plateforme agréée : entreprises françaises seulement.
  if (session?.organization.country !== "FR") hidden.push("einvoicing");
  return <SettingsTabs marks={api ? { api } : {}} hidden={hidden} />;
}
