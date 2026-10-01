import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { loadPage, pageRef, purgePages, savePage } from "@/server/auth/login-pages";
import { STATE_MAX_AGE_SECONDS } from "@/server/auth/login-state";
import { loginPages } from "@/server/db/schema";
import { testDb } from "../support/db";
import { setTestEnv } from "../support/env";

const t = testDb();
const db = t.database;
setTestEnv();
const SECRET = "s".repeat(40);
beforeEach(() => db.delete(loginPages));
afterAll(() => t.close());

const link = (n: number) => {
  const head = "/fr/app/import/crmlead?d=";
  return head + "e".repeat(n - head.length);
};

describe("pages longues gardées pour une connexion", () => {
  it("garde une page trop longue pour le state, et la rend par sa référence", async () => {
    const page = link(2400);
    const ref = await savePage(db, page, SECRET);
    expect(ref).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(await loadPage(db, ref, SECRET)).toBe(page);
    // Le même lien ne fait qu'une ligne.
    expect(await savePage(db, page, SECRET)).toBe(ref);
    expect(await db.select().from(loginPages)).toHaveLength(1);
  });

  it("ne garde ni une page courte ni une page hors de l'application", async () => {
    expect(await savePage(db, "/fr/app/quotes", SECRET)).toBeUndefined();
    expect(await savePage(db, `https://evil.example${link(500)}`, SECRET)).toBeUndefined();
    expect(await savePage(db, `/fr/app//evil${"e".repeat(400)}`, SECRET)).toBeUndefined();
    expect(await savePage(db, link(2401), SECRET)).toBeUndefined();
    expect(await db.select().from(loginPages)).toHaveLength(0);
  });

  it("refuse une référence inconnue, mal formée, d'un autre secret ou trop vieille", async () => {
    const page = link(900);
    const ref = await savePage(db, page, SECRET);
    expect(await loadPage(db, "A".repeat(22), SECRET)).toBeUndefined();
    expect(await loadPage(db, "../x", SECRET)).toBeUndefined();
    expect(await loadPage(db, undefined, SECRET)).toBeUndefined();
    expect(await loadPage(db, ref, "o".repeat(40))).toBeUndefined();
    const later = Date.now() + (STATE_MAX_AGE_SECONDS + 60) * 1000;
    expect(await loadPage(db, ref, SECRET, later)).toBeUndefined();
    // Ligne posée à côté de sa référence (contenu changé) : refusée.
    await db.insert(loginPages).values({ id: pageRef(link(700), SECRET), next: link(701) });
    expect(await loadPage(db, pageRef(link(700), SECRET), SECRET)).toBeUndefined();
  });

  it("au-delà du plafond horaire, la demande part sans référence", async () => {
    expect(await savePage(db, link(500), SECRET, 2)).toBeDefined();
    expect(await savePage(db, link(501), SECRET, 2)).toBeDefined();
    expect(await savePage(db, link(502), SECRET, 2)).toBeUndefined();
    expect(await db.select().from(loginPages)).toHaveLength(2);
  });

  it("le ménage efface les pages plus vieilles qu'un state", async () => {
    await savePage(db, link(600), SECRET);
    expect(await purgePages(db)).toBe(0);
    expect(await purgePages(db, Date.now() + (STATE_MAX_AGE_SECONDS + 60) * 1000)).toBe(1);
    expect(await db.select().from(loginPages)).toHaveLength(0);
  });
});
