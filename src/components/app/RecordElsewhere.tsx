import { getTranslations } from "next-intl/server";
import { switchOrgAction } from "@/app/[locale]/app/org-actions";
import { Button } from "@/components/ui/button";
import { db } from "@/server/db";
import { type OrganizationAccess, type RecordKind, recordOrganization } from "@/server/team";

/**
 * Fiche (ou page) d'une autre entreprise où la personne travaille : le passage vers elle, rien
 * d'autre, et la même page revient ensuite. Chez un client revenu en formule gratuite, l'accès
 * fiduciaire est suspendu : pas de passage, qui ne mènerait qu'à l'écran « accès suspendu », mais sa
 * raison, écrite ici.
 */
export async function RecordElsewhere({
  locale,
  organization,
  next,
  message = "recordElsewhere",
  testId = "record-elsewhere",
}: {
  locale: string;
  organization: OrganizationAccess;
  next: string;
  message?: "recordElsewhere" | "documentElsewhere" | "pageElsewhere";
  testId?: string;
}) {
  if (organization.suspended) {
    const tn = await getTranslations({ locale, namespace: "app.noAccess" });
    return (
      <div
        className="mx-auto max-w-3xl px-4 py-10 sm:px-8"
        data-testid={testId}
        data-suspended="true"
      >
        <h1 className="text-[22px] leading-tight">{tn("fiduciaryTitle")}</h1>
        <p className="mt-2 text-[15px] text-ink-2">
          {tn("fiduciaryBody", { org: organization.name })}
        </p>
      </div>
    );
  }
  const t = await getTranslations({ locale, namespace: "app.orgSwitch" });
  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-8" data-testid={testId}>
      <p className="text-[15px] text-ink-2">{t(message, { org: organization.name })}</p>
      <form action={switchOrgAction} className="mt-5">
        <input type="hidden" name="locale" value={locale} />
        <input type="hidden" name="organizationId" value={organization.id} />
        <input type="hidden" name="next" value={next} />
        <Button type="submit" data-testid={`${testId}-switch`}>
          {t("goTo", { org: organization.name })}
        </Button>
      </form>
    </div>
  );
}

/**
 * Fiche introuvable dans l'entreprise de la session : si elle appartient à une autre entreprise de
 * la personne (lien envoyé par un client, historique du navigateur, deux onglets sur deux clients),
 * l'écran qui propose d'y passer, sinon null (la page dit alors « introuvable »). Rien de la fiche
 * n'est montré avant le changement, et rien n'est révélé d'une entreprise où elle n'entre pas.
 */
export async function recordElsewhere({
  locale,
  userId,
  organizationId,
  kind,
  id,
  next,
}: {
  locale: string;
  userId: string;
  organizationId: string;
  kind: RecordKind;
  id: string;
  next: string;
}) {
  const owner = await recordOrganization(db(), userId, kind, id);
  if (!owner || owner.id === organizationId) return null;
  return <RecordElsewhere locale={locale} organization={owner} next={next} />;
}
