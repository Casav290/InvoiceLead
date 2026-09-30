/**
 * Applique les migrations SQL de `drizzle/` avant le build Vercel.
 *
 * - Production (VERCEL_ENV=production) : DATABASE_URL obligatoire, toute erreur arrête le déploiement.
 * - Prévisualisation : seulement si ALLOW_PREVIEW_MIGRATIONS=1 (base de prévisualisation dédiée, par
 *   exemple une branche Neon par PR). Sinon on ne touche à rien : une PR non fusionnée ne doit jamais
 *   modifier la base de production.
 * - Hors Vercel (local, CI) : migre si DATABASE_URL est présent.
 */
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

const env = process.env.VERCEL_ENV;
const url = process.env.DATABASE_URL;

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

const pool = new pg.Pool({ connectionString: url, max: 1 });
try {
  await migrate(drizzle(pool), { migrationsFolder: "drizzle" });
  console.log("[migrate] migrations à jour");
} catch (error) {
  console.error("[migrate] échec", error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await pool.end();
}
