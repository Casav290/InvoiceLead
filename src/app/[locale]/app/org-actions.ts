"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/server/auth/guard";
import { pickLocale, safeNext } from "@/server/auth/login-cookie";
import { db } from "@/server/db";
import { switchOrganization } from "@/server/team";

/**
 * Change l'entreprise de la session (fiduciaire qui passe d'un client à l'autre). Avec `next` (lien
 * d'import de CRMlead ou pièce ouverts dans la mauvaise entreprise), on revient sur la même page dans
 * la nouvelle entreprise, sinon sur son tableau de bord. Seule une page de l'application, dans cette
 * langue, est suivie (safeNext).
 */
export async function switchOrgAction(form: FormData) {
  const locale = pickLocale(form.get("locale"));
  const session = await requireSession(locale);
  await switchOrganization(
    db(),
    session.session.id,
    session.user.id,
    String(form.get("organizationId") ?? ""),
  );
  const next = safeNext(String(form.get("next") ?? ""));
  revalidatePath(`/${locale}/app`, "layout");
  redirect(next?.startsWith(`/${locale}/app/`) ? next : `/${locale}/app`);
}
