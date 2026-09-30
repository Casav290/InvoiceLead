import { and, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "../db";
import { auditLog, memberships, organizations, users } from "../db/schema";
import type { LeadClaims } from "../lead-id/leadId";

export const APP_CODE = "invoicelead";
const LOCALES = ["de", "fr", "en"] as const;

function appLocale(locale: string | undefined): string {
  const short = (locale ?? "").slice(0, 2).toLowerCase();
  return (LOCALES as readonly string[]).includes(short) ? short : "de";
}

/** InvoiceLead est-il ouvert pour cette organisation, d'après les droits du Compte Lead ? */
export function hasInvoiceLeadAccess(claims: Pick<LeadClaims, "lead">): boolean {
  return claims.lead?.apps?.[APP_CODE]?.access === true;
}

/**
 * Rattache la personne du Compte Lead à un utilisateur et à une organisation locaux (LEAD-ID.md, étape 5) :
 * par `sub` d'abord, puis par l'email seulement s'il est vérifié, sinon création. Même règle pour
 * l'organisation avec `org`. Met à jour nom, email, langue et droits à chaque connexion.
 */
export async function attachLeadIdentity(database: Db, claims: LeadClaims) {
  if (!claims.sub || !claims.org || !claims.email) throw new Error("lead_id:incomplete_claims");
  const locale = appLocale(claims.locale);

  return database.transaction(async (tx) => {
    let [user] = await tx.select().from(users).where(eq(users.leadSub, claims.sub)).limit(1);
    if (!user && claims.email_verified === true) {
      [user] = await tx
        .select()
        .from(users)
        .where(and(sql`lower(${users.email}) = lower(${claims.email})`, isNull(users.leadSub)))
        .limit(1);
    }
    if (user) {
      [user] = await tx
        .update(users)
        .set({
          leadSub: claims.sub,
          email: claims.email,
          name: claims.name ?? user.name,
          locale,
          updatedAt: new Date(),
        })
        .where(eq(users.id, user.id))
        .returning();
    } else {
      [user] = await tx
        .insert(users)
        .values({ leadSub: claims.sub, email: claims.email, name: claims.name ?? "", locale })
        .returning();
    }
    if (!user) throw new Error("lead_id:user_not_saved");

    const orgValues = {
      name: claims.org_name || claims.org,
      leadPlan: claims.lead?.plan?.code ?? "free",
      hasAccess: hasInvoiceLeadAccess(claims),
      entitlements: claims.lead ?? null,
      entitlementsAt: new Date(),
      updatedAt: new Date(),
    };
    const [org] = await tx
      .insert(organizations)
      .values({ ...orgValues, leadOrg: claims.org, defaultLocale: locale })
      .onConflictDoUpdate({ target: organizations.leadOrg, set: orgValues })
      .returning();
    if (!org) throw new Error("lead_id:org_not_saved");

    await tx
      .insert(memberships)
      .values({ organizationId: org.id, userId: user.id, role: claims.org_role ?? "user" })
      .onConflictDoUpdate({
        target: [memberships.organizationId, memberships.userId],
        set: { role: claims.org_role ?? "user" },
      });

    await tx.insert(auditLog).values({
      organizationId: org.id,
      userId: user.id,
      action: "auth.login",
      data: { plan: orgValues.leadPlan, access: orgValues.hasAccess },
    });

    return { user, organization: org };
  });
}
