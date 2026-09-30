import "server-only";
import { attachDatabasePool } from "@vercel/functions";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { env } from "../env";
import * as schema from "./schema";

export type Db = NodePgDatabase<typeof schema>;

const globalForDb = globalThis as unknown as { invoiceleadPool?: Pool; invoiceleadDb?: Db };

/** Base de données, ouverte au premier besoin. Un seul pool par instance (Fluid compute sur Vercel). */
export function db(): Db {
  if (!globalForDb.invoiceleadDb) {
    const pool = new Pool({ connectionString: env().DATABASE_URL, max: 5 });
    attachDatabasePool(pool);
    globalForDb.invoiceleadPool = pool;
    globalForDb.invoiceleadDb = drizzle(pool, { schema });
  }
  return globalForDb.invoiceleadDb;
}
