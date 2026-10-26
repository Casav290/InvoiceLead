import { Pool } from "pg";
import { leadPlan } from "../support/lead-plan";

/**
 * Base de l'application lancée pour les tests de bout en bout (adresse posée par la configuration
 * Playwright). Sert seulement à préparer un état long à obtenir par l'écran : une allocation du
 * mois déjà utilisée, 50 contacts, un retour à la formule gratuite. Tout le reste passe par
 * l'application.
 */
let pool: Pool | null = null;
function base(): Pool {
  pool ??= new Pool({ connectionString: process.env.E2E_DATABASE_URL, max: 1 });
  return pool;
}

/** Allocation du mois en cours déjà utilisée à hauteur de `used` pour l'organisation du Compte Lead. */
export async function useQuota(leadOrg: string, key: string, used: number) {
  const period = new Date().toISOString().slice(0, 7);
  const { rowCount } = await base().query(
    `insert into plan_usage (organization_id, period, key, used)
     select id, $2, $3, $4 from organizations where lead_org = $1
     on conflict (organization_id, period, key) do update set used = excluded.used`,
    [leadOrg, period, key, used],
  );
  if (rowCount !== 1) throw new Error(`organisation ${leadOrg} introuvable`);
}

/**
 * L'organisation a déjà ouvert cette application avec le Compte Lead (`apps[code].used` d'ERPlead),
 * comme si les droits venaient d'être relus.
 */
export async function markAppUsed(leadOrg: string, app: string) {
  const { rowCount } = await base().query(
    `update organizations set entitlements = jsonb_set(coalesce(entitlements, '{}'::jsonb), '{apps}',
       coalesce(entitlements->'apps', '{}'::jsonb) || jsonb_build_object($2::text, jsonb_build_object('used', true)))
     where lead_org = $1`,
    [leadOrg, app],
  );
  if (rowCount !== 1) throw new Error(`organisation ${leadOrg} introuvable`);
}

/** Ajoute `count` contacts actifs à l'organisation du Compte Lead. */
export async function addContacts(leadOrg: string, count: number) {
  const { rowCount } = await base().query(
    `insert into contacts (organization_id, name)
     select o.id, 'Client ' || g from organizations o, generate_series(1, $2::int) g
     where o.lead_org = $1`,
    [leadOrg, count],
  );
  if (rowCount !== count) throw new Error(`organisation ${leadOrg} introuvable`);
}

/**
 * Formule de l'organisation du Compte Lead ramenée à une autre (0 Gratuit, 1 Pro, 2 Pro+), telle
 * qu'ERPlead la donne (code, rang 0, 10 ou 20, places), comme le ferait une résiliation lue par
 * l'application ; la date de lecture reste celle de la connexion.
 */
export async function setPlanRank(leadOrg: string, tier: number) {
  const { rowCount } = await base().query(
    `update organizations
     set entitlements = jsonb_set(coalesce(entitlements, '{}'::jsonb), '{plan}', $2::jsonb),
         lead_plan = $3
     where lead_org = $1`,
    [leadOrg, JSON.stringify(leadPlan(tier)), leadPlan(tier).code],
  );
  if (rowCount !== 1) throw new Error(`organisation ${leadOrg} introuvable`);
}

export async function closeDb() {
  await pool?.end();
  pool = null;
}

/** Sessions InvoiceLead d'une personne du Compte Lead : le `sid` (navigateur du Compte Lead) de chacune. */
export async function leadSidsOf(sub: string): Promise<(string | null)[]> {
  const { rows } = await base().query(
    `select s.lead_sid from sessions s join users u on u.id = s.user_id
      where u.lead_sub = $1 order by s.created_at`,
    [sub],
  );
  return rows.map((r: { lead_sid: string | null }) => r.lead_sid);
}
