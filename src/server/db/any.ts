import { type AnyColumn, type SQL, sql } from "drizzle-orm";

/**
 * « colonne = any($1::uuid[]) » : une liste d'identifiants passée en un seul paramètre. Avec
 * inArray, la requête grandirait avec la liste ; une tâche quotidienne qui parcourt des milliers
 * d'entreprises resterait alors à la merci de la limite de 65 535 paramètres de Postgres.
 */
export function anyUuid(column: AnyColumn, ids: string[]): SQL {
  return sql`${column} = any(${sql.param(ids)}::uuid[])`;
}
