import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  clientKey,
  clientNetwork,
  loadPage,
  PAGE_MAX_AGE_SECONDS,
  pageRef,
  purgePages,
  savePage,
} from "@/server/auth/login-pages";
import { encodeHandoff } from "@/server/crmlead";
import { loginPages } from "@/server/db/schema";
import { testDb } from "../support/db";
import { setTestEnv } from "../support/env";

const t = testDb();
const db = t.database;
setTestEnv();
const SECRET = "s".repeat(40);
const A = "client-a";
const B = "client-b";
beforeEach(() => db.delete(loginPages));
afterAll(() => t.close());

/** Un vrai lien d'import de CRMlead (lead `seed`), d'au moins `length` caractères. */
const link = (seed: string, length = 600) => {
  for (let size = 10; ; size += 10) {
    // Lignes de 400 caractères au plus (le lead en admet 500), la dernière ajustée.
    const lines = Array.from({ length: Math.floor(size / 400) + 1 }, (_, i) => ({
      description: "x".repeat(i < Math.floor(size / 400) ? 400 : (size % 400) + 1),
      quantity: 1,
      unitPriceCents: 125000,
    }));
    const d = encodeHandoff({
      v: 1,
      kind: "quote",
      lead: { id: seed, title: "Façade du bâtiment B" },
      contact: { name: "Menuiserie Dupont Sàrl" },
      lines,
    });
    const page = `/fr/app/import/crmlead?d=${d}`;
    if (page.length >= length) return page;
  }
};
const rows = () => db.select().from(loginPages);

describe("pages longues gardées pour une connexion", () => {
  it("garde un lien d'import trop long pour le state, et le rend par sa référence", async () => {
    const page = link("lead-1", 2300);
    expect(page.length).toBeLessThanOrEqual(2400);
    const ref = await savePage(db, page, SECRET, A);
    expect(ref).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(await loadPage(db, ref, SECRET)).toBe(page);
    // Le même lien ne fait qu'une ligne ; le client est gardé, jamais son adresse.
    expect(await savePage(db, page, SECRET, B)).toBe(ref);
    expect(await rows()).toEqual([expect.objectContaining({ id: ref, client: A })]);
  });

  it("ne garde que les liens d'import de CRMlead lisibles", async () => {
    expect(await savePage(db, "/fr/app/quotes", SECRET, A)).toBeUndefined();
    expect(await savePage(db, `https://evil.example${link("x")}`, SECRET, A)).toBeUndefined();
    expect(await savePage(db, `/fr/app//evil${"e".repeat(400)}`, SECRET, A)).toBeUndefined();
    // Recherche ou `d` quelconques, aussi longs qu'on veut : jamais écrits en base.
    expect(await savePage(db, `/fr/app/invoices?q=${"r".repeat(2300)}`, SECRET, A)).toBeUndefined();
    expect(
      await savePage(db, `/fr/app/import/crmlead?d=${"e".repeat(2300)}`, SECRET, A),
    ).toBeUndefined();
    expect(await savePage(db, `${link("y")}&z=1`, SECRET, A)).toBeUndefined();
    expect(await savePage(db, link("z", 2401), SECRET, A)).toBeUndefined();
    expect(await rows()).toHaveLength(0);
  });

  it("refuse une référence inconnue, mal formée, d'un autre secret ou trop vieille", async () => {
    const page = link("lead-2", 900);
    const ref = await savePage(db, page, SECRET, A);
    expect(await loadPage(db, "A".repeat(22), SECRET)).toBeUndefined();
    expect(await loadPage(db, "../x", SECRET)).toBeUndefined();
    expect(await loadPage(db, undefined, SECRET)).toBeUndefined();
    expect(await loadPage(db, ref, "o".repeat(40))).toBeUndefined();
    const later = Date.now() + (PAGE_MAX_AGE_SECONDS + 60) * 1000;
    expect(await loadPage(db, ref, SECRET, later)).toBeUndefined();
    // Ligne posée à côté de sa référence (contenu changé) : refusée.
    await db
      .insert(loginPages)
      .values({ id: pageRef(link("lead-3"), SECRET), next: link("lead-4") });
    expect(await loadPage(db, pageRef(link("lead-3"), SECRET), SECRET)).toBeUndefined();
  });

  it("au-delà du plafond horaire d'un client, lui seul part sans référence", async () => {
    const limits = { perClientHour: 2, max: 100 };
    expect(await savePage(db, link("a1"), SECRET, A, limits)).toBeDefined();
    expect(await savePage(db, link("a2"), SECRET, A, limits)).toBeDefined();
    expect(await savePage(db, link("a3"), SECRET, A, limits)).toBeUndefined();
    // Un autre réseau n'en souffre pas.
    expect(await savePage(db, link("b1"), SECRET, B, limits)).toBeDefined();
    // Le même lien rejoué par le client plafonné : rafraîchi, jamais refusé.
    expect(await savePage(db, link("a1"), SECRET, A, limits)).toBe(pageRef(link("a1"), SECRET));
    expect(await rows()).toHaveLength(3);
  });

  it("au-delà du plafond total, les nouvelles partent sans référence, les anciennes restent", async () => {
    const limits = { perClientHour: 100, max: 2 };
    const first = await savePage(db, link("m1"), SECRET, A, limits);
    expect(await savePage(db, link("m2"), SECRET, B, limits)).toBeDefined();
    expect(await savePage(db, link("m3"), SECRET, "client-c", limits)).toBeUndefined();
    expect(await loadPage(db, first, SECRET)).toBe(link("m1"));
    expect(await rows()).toHaveLength(2);
  });

  it("le ménage efface les pages de plus de huit jours", async () => {
    expect(PAGE_MAX_AGE_SECONDS).toBe(8 * 24 * 3600);
    await savePage(db, link("p1"), SECRET, A);
    expect(await purgePages(db)).toBe(0);
    expect(await purgePages(db, Date.now() + (PAGE_MAX_AGE_SECONDS + 60) * 1000)).toBe(1);
    expect(await rows()).toHaveLength(0);
  });
});

describe("clé du client", () => {
  const key = (h: Record<string, string>) => clientKey(new Headers(h), SECRET);

  it("prend x-real-ip d'abord, puis le premier x-forwarded-for, sinon « local »", () => {
    const real = key({ "x-real-ip": "203.0.113.7", "x-forwarded-for": "198.51.100.1" });
    expect(real).toBe(key({ "x-real-ip": "203.0.113.7" }));
    expect(real).not.toBe(key({ "x-forwarded-for": "198.51.100.1" }));
    expect(key({ "x-forwarded-for": "198.51.100.1, 10.0.0.1" })).toBe(
      key({ "x-forwarded-for": "198.51.100.1" }),
    );
    expect(key({})).toBe(key({ "x-real-ip": "local" }));
  });

  it("ne garde jamais l'adresse elle-même, et dépend du secret", () => {
    const k = key({ "x-real-ip": "203.0.113.7" });
    expect(k).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(k).not.toContain("203");
    expect(clientKey(new Headers({ "x-real-ip": "203.0.113.7" }), "o".repeat(40))).not.toBe(k);
  });

  it("une adresse IPv6 compte pour son préfixe /56", () => {
    expect(clientNetwork("2001:db8:1234:5678::1")).toBe("2001:0db8:1234:56/56");
    expect(clientNetwork("2001:db8:1234:56ff:aaaa::9")).toBe("2001:0db8:1234:56/56");
    expect(clientNetwork("[2001:DB8:1234:5600::1]")).toBe("2001:0db8:1234:56/56");
    expect(clientNetwork("2001:db8:1234:5700::1")).not.toBe(clientNetwork("2001:db8:1234:5600::1"));
    expect(clientNetwork("::ffff:203.0.113.7")).toBe("203.0.113.7");
    expect(clientNetwork("203.0.113.7")).toBe("203.0.113.7");
    expect(key({ "x-real-ip": "2001:db8:1234:5678::1" })).toBe(
      key({ "x-real-ip": "2001:db8:1234:56aa:ffff::2" }),
    );
  });
});
