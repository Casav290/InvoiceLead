import { getSession } from "@/server/auth/session";
import { currentPlanUsage, markOf } from "@/server/current-plan";
import { featureAccess } from "@/server/plans";
import { AccountingTabs, type TabMarks } from "./AccountingTabs";

/**
 * Onglets de la comptabilité, avec la marque « Pro » sur ceux dont la fonction principale est grisée :
 * le décompte TVA, et la banque ou les justificatifs une fois l'allocation du mois utilisée. Une
 * commande secondaire grisée (scanner un ticket dans les frais) porte sa marque à sa place, pas dans
 * le menu ; les factures fournisseurs n'ont rien de grisé (e-factures lues sans IA, hors compteur).
 */
export async function AccountingNav() {
  const session = await getSession();
  const marks: TabMarks = {};
  if (session) {
    const org = session.organization;
    const usage = await currentPlanUsage(org.id);
    const vat = markOf(featureAccess(org, "vatReturn"));
    if (vat) marks.vat = vat;
    const bank = markOf(usage?.bankImports);
    if (bank) marks.bank = bank;
    const receipts = markOf(usage?.aiReads);
    if (receipts) marks.receipts = receipts;
  }
  return <AccountingTabs marks={marks} />;
}
