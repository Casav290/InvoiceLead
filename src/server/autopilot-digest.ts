import { and, eq, inArray } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { autopilotSummary } from "./autopilot";
import type { Db } from "./db";
import { memberships, organizations, users } from "./db/schema";
import { emailConfigured, sendEmail } from "./email";
import { env } from "./env";
import { featureAccess } from "./plans";

/**
 * Récapitulatif du lundi : à chaque administrateur d'une entreprise au pilote automatique, ce qui a
 * été comptabilisé seul pendant la semaine et ce qui attend une personne. Rien n'est envoyé quand il
 * n'y a rien à dire.
 */
export async function sendAutopilotDigests(database: Db, today: string): Promise<number> {
  if (!emailConfigured()) return 0;
  const orgs = await database.select().from(organizations).where(eq(organizations.autopilot, true));
  let sent = 0;
  for (const org of orgs) {
    // Le récapitulatif fait partie de la formule Pro ; le pilote lui-même est ouvert à tous.
    if (!featureAccess(org, "autopilotDigest").allowed) continue;
    const s = await autopilotSummary(database, org.id, today);
    if (s.autoWeek + s.toApprove + s.toReview + s.anomalies === 0) continue;
    const admins = await database
      .select({ email: users.email, locale: users.locale })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(
        and(
          eq(memberships.organizationId, org.id),
          inArray(memberships.role, ["admin", "manager"]),
        ),
      );
    for (const a of admins) {
      const locale = a.locale === "fr" || a.locale === "en" ? a.locale : "de";
      const t = await getTranslations({ locale, namespace: "app.review.digest" });
      try {
        await sendEmail({
          to: a.email,
          subject: t("subject", { company: org.legalName ?? org.name }),
          text: t("body", {
            company: org.legalName ?? org.name,
            auto: s.autoWeek,
            approve: s.toApprove,
            review: s.toReview,
            anomalies: s.anomalies,
            link: `${env().APP_URL}/${locale}/app/accounting/review`,
          }),
        });
        sent += 1;
      } catch (e) {
        console.error(
          "[autopilot] récapitulatif non envoyé",
          e instanceof Error ? e.message : "inconnu",
        );
      }
    }
  }
  return sent;
}
