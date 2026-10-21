import { headers } from "next/headers";
import { isNativeAgent } from "@/lib/native";

/** La page est-elle ouverte dans l'app Android / iOS d'InvoiceLead (lib/native.ts) ? */
export async function inNativeApp(): Promise<boolean> {
  return isNativeAgent((await headers()).get("user-agent"));
}
