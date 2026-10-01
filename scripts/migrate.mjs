/**
 * Applique les migrations SQL de `drizzle/` avant le build Vercel.
 *
 * - Production (VERCEL_ENV=production) : DATABASE_URL obligatoire, toute erreur arrête le déploiement.
 * - Prévisualisation : seulement si ALLOW_PREVIEW_MIGRATIONS=1 (base de prévisualisation dédiée, par
 *   exemple une branche Neon par PR). Sinon on ne touche à rien : une PR non fusionnée ne doit jamais
 *   modifier la base de production.
 * - Hors Vercel (local, CI) : migre si DATABASE_URL est présent.
 *
 * Connexion directe (DATABASE_URL_UNPOOLED, posée par Neon) de préférence : le pooler de Neon ne convient
 * pas aux migrations. À défaut, DATABASE_URL.
 *
 * Migrations sautées. Le migrateur de Drizzle n'applique que les migrations datées (`when` du journal)
 * après la dernière appliquée, sans regarder les autres. Deux branches parties du même `main`, chacune
 * avec sa migration, fusionnées dans l'ordre inverse de leurs dates : la plus ancienne n'est jamais
 * appliquée, en silence, et l'application tombe sur une colonne absente. Après Drizzle, chaque entrée
 * du journal dont la date manque dans `drizzle.__drizzle_migrations` est donc rattrapée :
 * - si son fichier commence par « -- Rejouable » (chaque objet n'est créé que s'il manque, rien n'est
 *   effacé), elle est exécutée ici, dans une transaction, puis inscrite comme Drizzle l'aurait fait ;
 * - sinon le déploiement échoue, avec le nom de la migration à redater, au lieu d'annoncer « à jour ».
 * La clé est la date et non l'empreinte du fichier : une migration appliquée puis retouchée (un
 * commentaire, une colonne ajoutée en cours de branche) n'a plus la même empreinte, et ne doit pas être
 * rejouée pour autant. Une empreinte identique sous une autre date vaut aussi « appliquée ».
 */
import { readFileSync } from "node:fs";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

const FOLDER = "drizzle";
const REPLAYABLE = "-- Rejouable";

const env = process.env.VERCEL_ENV;
const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;

if (env === "preview" && process.env.ALLOW_PREVIEW_MIGRATIONS !== "1") {
  console.log("[migrate] prévisualisation : migrations ignorées (ALLOW_PREVIEW_MIGRATIONS absent)");
  process.exit(0);
}
if (!url) {
  if (env === "production") {
    console.error("[migrate] DATABASE_URL manquant en production");
    process.exit(1);
  }
  console.log("[migrate] DATABASE_URL absent : rien à migrer");
  process.exit(0);
}

/**
 * Rattrape les migrations du journal que Drizzle a sautées (voir l'en-tête). Rend le nombre de
 * migrations sautées qui ne peuvent pas être rattrapées : elles doivent arrêter le déploiement.
 */
async function catchUp(pool) {
  const { entries } = JSON.parse(readFileSync(`${FOLDER}/meta/_journal.json`, "utf8"));
  // Même ordre que le journal : l'empreinte et les instructions exactement comme Drizzle les calcule.
  const migrations = readMigrationFiles({ migrationsFolder: FOLDER });
  const { rows } = await pool.query("select hash, created_at from drizzle.__drizzle_migrations");
  const dates = new Set(rows.map((row) => Number(row.created_at)));
  const hashes = new Set(rows.map((row) => row.hash));
  let blocked = 0;
  for (const [index, entry] of entries.entries()) {
    const migration = migrations[index];
    if (dates.has(migration.folderMillis) || hashes.has(migration.hash)) continue;
    const text = readFileSync(`${FOLDER}/${entry.tag}.sql`, "utf8");
    if (!text.startsWith(REPLAYABLE)) {
      console.error(
        `[migrate] ${entry.tag} datée avant la dernière migration appliquée et jamais exécutée : ` +
          `redater son « when » dans ${FOLDER}/meta/_journal.json après la dernière appliquée, ` +
          `ou la rendre rejouable (première ligne « ${REPLAYABLE} »)`,
      );
      blocked += 1;
      continue;
    }
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      for (const statement of migration.sql) await client.query(statement);
      await client.query(
        'insert into drizzle.__drizzle_migrations ("hash", "created_at") values ($1, $2)',
        [migration.hash, migration.folderMillis],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => null);
      throw error;
    } finally {
      client.release();
    }
    console.log(`[migrate] migration rattrapée : ${entry.tag}`);
  }
  return blocked;
}

const pool = new pg.Pool({ connectionString: url, max: 1 });
try {
  await migrate(drizzle(pool), { migrationsFolder: FOLDER });
  const blocked = await catchUp(pool);
  if (blocked > 0) {
    console.error(`[migrate] échec : ${blocked} migration(s) jamais appliquée(s)`);
    process.exitCode = 1;
  } else {
    console.log("[migrate] migrations à jour");
  }
} catch (error) {
  console.error("[migrate] échec", error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await pool.end();
}
