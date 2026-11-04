import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { attachLeadIdentity } from "@/server/auth/attach";
import { users } from "@/server/db/schema";
import { markTourSeen } from "@/server/tour";
import { claims } from "../support/claims";
import { testDb } from "../support/db";

/**
 * Visite guidée (04.11.2026) : due au premier passage d'une personne créée après la migration 0050,
 * jamais pour une personne d'avant, retenue une fois ouverte, sans toucher aux autres personnes.
 */
const t = testDb();
const db = t.database;

beforeAll(() => {
  process.env.APP_URL = "http://localhost:3000";
});
beforeEach(() => t.reset());
afterAll(() => t.close());

const pending = async (id: string) =>
  (await db.select().from(users).where(eq(users.id, id)))[0]?.tourPending;

describe("Visite guidée (04.11.2026)", () => {
  it("une personne neuve (première connexion par le Compte Lead) a la visite due", async () => {
    const { user } = await attachLeadIdentity(db, claims());
    expect(user.tourPending).toBe(true);
    expect(user.tourSeenAt).toBeNull();
  });

  it("une fois ouverte, la visite n'est plus due, sur tous les appareils ; le second appel ne fait rien", async () => {
    const { user } = await attachLeadIdentity(db, claims());
    expect(await markTourSeen(db, user.id)).toBe(true);
    const [row] = await db.select().from(users).where(eq(users.id, user.id));
    expect(row?.tourPending).toBe(false);
    expect(row?.tourSeenAt).toBeInstanceOf(Date);
    expect(await markTourSeen(db, user.id)).toBe(false);
    expect(await pending(user.id)).toBe(false);
  });

  it("une autre personne de la même entreprise reste intacte", async () => {
    const a = await attachLeadIdentity(db, claims());
    const b = await attachLeadIdentity(
      db,
      claims({ sub: "sub-bob", email: "bob@atelier.test", name: "Bob" }),
    );
    expect(b.organization.id).toBe(a.organization.id);
    await markTourSeen(db, a.user.id);
    expect(await pending(b.user.id)).toBe(true);
  });

  it("une nouvelle connexion ne rend pas la visite due à nouveau", async () => {
    const { user } = await attachLeadIdentity(db, claims());
    await markTourSeen(db, user.id);
    await attachLeadIdentity(db, claims({ name: "Ada Neu" }));
    expect(await pending(user.id)).toBe(false);
  });

  it("la migration 0050 : les personnes d'avant à faux, les suivantes à vrai, rejouable", async () => {
    // Une table « users » d'avant la visite, dans un schéma jetable : la migration telle qu'elle part en production.
    const sql = readFileSync(
      new URL("../../drizzle/0050_visite_guidee.sql", import.meta.url),
      "utf8",
    );
    expect(sql.startsWith("-- Rejouable")).toBe(true);
    const statements = sql.split("--> statement-breakpoint");
    const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 1 });
    const c = await pool.connect();
    try {
      await c.query("drop schema if exists visite_avant cascade; create schema visite_avant");
      await c.query("set search_path to visite_avant");
      await c.query("create table users (id serial primary key, email text not null)");
      await c.query("insert into users (email) values ('avant@atelier.test')");
      for (const s of statements) await c.query(s);
      await c.query("insert into users (email) values ('apres@atelier.test')");
      for (const s of statements) await c.query(s); // rejouée : rien ne change
      const rows = (
        await c.query("select email, tour_pending, tour_seen_at from users order by id")
      ).rows;
      expect(rows).toEqual([
        { email: "avant@atelier.test", tour_pending: false, tour_seen_at: null },
        { email: "apres@atelier.test", tour_pending: true, tour_seen_at: null },
      ]);
    } finally {
      await c.query("set search_path to public").catch(() => {});
      await c.query("drop schema if exists visite_avant cascade").catch(() => {});
      c.release();
      await pool.end();
    }
  });
});
