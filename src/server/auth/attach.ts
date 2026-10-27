import { and, eq, isNull, sql } from "drizzle-orm";
import { shortLocale } from "@/i18n/locales";
import { type RegionDefaults, regionDefaults } from "@/lib/region";
import type { Db } from "../db";
import { auditLog, memberships, organizations, users } from "../db/schema";
import type { LeadClaims } from "../lead-id/leadId";

export const APP_CODE = "invoicelead";

/** Langue du Compte Lead que connaît InvoiceLead (« fr-CH » → « fr », « it », « es »), ou undefined. */
function knownLocale(locale: string | undefined): string | undefined {
  return shortLocale(locale);
}

/**
 * Langue d'arrivée de la personne (users.locale) : celle du Compte Lead (de, fr, en, it, es) ;
 * absente ou inconnue : le français, repli commun de la famille Lead.
 */
export function appLocale(locale: string | undefined): string {
  return knownLocale(locale) ?? "fr";
}

/**
 * Langue par défaut des documents d'une nouvelle entreprise (organizations.default_locale : factures
 * et devis de l'API et du serveur MCP, nouveaux contacts) : celle du Compte Lead ; absente ou inconnue,
 * l'allemand comme avant (valeur par défaut du schéma). Le repli français d'appLocale ne la touche pas.
 */
function documentLocale(locale: string | undefined): string {
  return knownLocale(locale) ?? "de";
}

/** Pays et devise d'une nouvelle entreprise selon la région ; rien (CH, CHF du schéma) sans région. */
function regionValues(defaults: RegionDefaults | undefined) {
  if (!defaults) return {};
  return {
    country: defaults.country,
    currency: defaults.currency,
    regionCurrency: defaults.regionCurrency,
  };
}

/**
 * InvoiceLead est-il ouvert pour cette organisation ? Tout Compte Lead entre, en version gratuite par
 * défaut (limites de la formule Gratuit), quelle que soit l'application où il a été créé ; la formule
 * du Compte Lead (Pro, Pro+) ne fait que lever les limites. Seule une application retirée de la
 * famille ferme la porte.
 */
export function hasInvoiceLeadAccess(claims: Pick<LeadClaims, "lead">): boolean {
  const app = claims.lead?.apps?.[APP_CODE] as { status?: unknown } | undefined;
  return app?.status !== "retired";
}

/**
 * Rattache la personne du Compte Lead à un utilisateur et à une organisation locaux (LEAD-ID.md, étape 5) :
 * par `sub` d'abord, puis par l'email seulement s'il est vérifié, sinon création. Même règle pour
 * l'organisation avec `org`. Met à jour nom, email, langue et droits à chaque connexion.
 */
export async function attachLeadIdentity(
  database: Db,
  claims: LeadClaims,
  /**
   * Région de la personne (pays de l'IP, sinon d'Accept-Language ou de la langue du Compte Lead,
   * src/lib/region.ts) : pays et devise d'une entreprise créée à cette connexion. Une entreprise qui
   * existe déjà ne change pas.
   */
  region?: string,
) {
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
      .values({
        ...orgValues,
        ...regionValues(regionDefaults(region)),
        leadOrg: claims.org,
        defaultLocale: documentLocale(claims.locale),
      })
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
