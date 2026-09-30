import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import type { Db } from "@/server/db";
import * as schema from "@/server/db/schema";

/** Base de test migrée (`npm run db:migrate` sur TEST_DATABASE_URL), vidée avant chaque test. */
export function testDb() {
  const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 2 });
  const database = drizzle(pool, { schema }) as unknown as Db;
  return {
    database,
    reset: () =>
      database.execute(
        sql`truncate table audit_log, vat_returns, invoice_payments, bank_transactions, receipts, stored_files, sessions, memberships, organizations, users restart identity cascade`,
      ),
    close: () => pool.end(),
  };
}
