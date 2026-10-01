import { Pool } from "pg";

/**
 * Base de l'application lancée pour les tests de bout en bout (adresse posée par la configuration
 * Playwright). Sert seulement à préparer un état long à obtenir par l'écran : une allocation du
 * mois déjà utilisée, 50 contacts. Tout le reste passe par l'application.
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

export async function closeDb() {
  await pool?.end();
  pool = null;
}
