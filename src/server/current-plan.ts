import "server-only";
import { cache } from "react";
import { db } from "./db";
import { type Access, organizationPlan, planUsageOf, type Quota } from "./plans";

/**
 * Allocations de l'entreprise pour le rendu en cours, lues une seule fois même si les onglets, le
 * tableau de bord et la page les demandent tous.
 */
export const currentPlanUsage = cache(
  async (organizationId: string): Promise<Record<Quota, Access> | null> => {
    const org = await organizationPlan(db(), organizationId);
    return org ? planUsageOf(db(), org) : null;
  },
);

/** Marque à poser sur un onglet : la formule qui ouvre (ou relève) ce qui est grisé. */
export function markOf(access: Access | undefined): "pro" | "proplus" | null {
  if (!access || access.allowed) return null;
  return access.upgradeTo === "pro" || access.upgradeTo === "proplus" ? access.upgradeTo : null;
}
