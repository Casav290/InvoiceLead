import { headers } from "next/headers";
import { isAppAuthAgent, isNativeAgent } from "@/lib/native";

/** La page est-elle ouverte dans l'app Android / iOS d'InvoiceLead (lib/native.ts) ? */
export async function inNativeApp(): Promise<boolean> {
  return isNativeAgent((await headers()).get("user-agent"));
}

/** Dans l'app, une version qui reçoit le lien de retour de Google (LeadAppAuth/1, lib/lead-app-auth.ts) ? */
export async function inAppAuthApp(): Promise<boolean> {
  return isAppAuthAgent((await headers()).get("user-agent"));
}
