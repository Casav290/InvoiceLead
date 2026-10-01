import { getSession } from "@/server/auth/session";
import { markOf } from "@/server/current-plan";
import { featureAccess } from "@/server/plans";
import { SettingsTabs } from "./SettingsTabs";

/** Onglets des réglages ; l'onglet API porte la marque « Pro+ » en dessous de Pro+. */
export async function SettingsNav() {
  const session = await getSession();
  const api = session ? markOf(featureAccess(session.organization, "api")) : null;
  return <SettingsTabs marks={api ? { api } : {}} />;
}
