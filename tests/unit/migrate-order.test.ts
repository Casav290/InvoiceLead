import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Deux branches parties du même `main`, chacune avec sa migration, fusionnées dans un ordre ou dans
 * l'autre : `scripts/migrate.mjs` doit laisser la base complète dans les deux cas. Ici, la branche de
 * la connexion (`0039_login_return`, rejouable) et une autre branche dont la migration est datée après
 * elle (comme la `0038_plan_usage` des formules). Chaque cas sur une base jetable, effacée à la fin.
 */

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const SCRIPT = path.join(ROOT, "scripts/migrate.mjs");
const SOURCE = path.join(ROOT, "drizzle");
const LOGIN = "0039_login_return";

type Entry = { idx: number; version: string; when: number; tag: string; breakpoints: boolean };
const journal = JSON.parse(readFileSync(path.join(SOURCE, "meta/_journal.json"), "utf8")) as {
  version: string;
  dialect: string;
  entries: Entry[];
};
const position = journal.entries.findIndex((e) => e.tag === LOGIN);
const login = journal.entries[position] as Entry;
/** Le `main` commun aux deux branches. */
const base = journal.entries.slice(0, position);
/** La migration de l'autre branche : datée après celle de la connexion, et pas rejouable. */
const other: Entry = {
  ...login,
  idx: login.idx - 1,
  when: login.when + 7_990_947,
  tag: "0038_autre",
};
const OTHER_SQL = 'CREATE TABLE "autre_branche" ("id" integer PRIMARY KEY);';

const admin = new Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 1 });
const work = mkdtempSync(path.join(tmpdir(), "il-migrate-order-"));
const created: string[] = [];

/** Base jetable, vide. */
async function scratch(label: string) {
  const name = `il_migrate_order_${process.pid}_${label}`;
  await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${name}`);
  created.push(name);
  const url = new URL(process.env.TEST_DATABASE_URL ?? "");
  url.pathname = `/${name}`;
  return url.toString();
}

/** Dossier `drizzle/` d'une branche : le journal donné, les fichiers du dépôt, ou `sql` à la place. */
function folder(label: string, entries: Entry[], sql: Record<string, string> = {}) {
  const dir = path.join(work, label);
  mkdirSync(path.join(dir, "drizzle/meta"), { recursive: true });
  for (const entry of entries) {
    const target = path.join(dir, "drizzle", `${entry.tag}.sql`);
    if (sql[entry.tag] !== undefined) writeFileSync(target, sql[entry.tag] as string);
    else if (entry.tag === other.tag) writeFileSync(target, OTHER_SQL);
    else copyFileSync(path.join(SOURCE, `${entry.tag}.sql`), target);
  }
  writeFileSync(
    path.join(dir, "drizzle/meta/_journal.json"),
    JSON.stringify({ ...journal, entries }, null, 2),
  );
  return dir;
}

/** Le script tel que le build Vercel le lance, dans le dossier `cwd`. */
function run(cwd: string, url: string) {
  const result = spawnSync(process.execPath, [SCRIPT], {
    cwd,
    env: { ...process.env, DATABASE_URL: url, DATABASE_URL_UNPOOLED: "", VERCEL_ENV: "" },
    encoding: "utf8",
  });
  return { status: result.status, out: `${result.stdout}\n${result.stderr}` };
}

async function schema(url: string) {
  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    const one = async (text: string) => (await pool.query(text)).rows[0];
    return {
      column: Boolean(
        await one(
          "select 1 from information_schema.columns where table_name = 'users' and column_name = 'last_organization_id'",
        ),
      ),
      loginPages: (await one("select to_regclass('public.login_pages') as t")).t !== null,
      other: (await one("select to_regclass('public.autre_branche') as t")).t !== null,
      unmarked: (await one("select to_regclass('public.sans_en_tete') as t")).t !== null,
      rows: Number((await one("select count(*) as n from drizzle.__drizzle_migrations")).n),
    };
  } finally {
    await pool.end();
  }
}

const merged = [...base, other, login];

beforeAll(() => {
  expect(position).toBeGreaterThan(0);
  expect(other.when).toBeGreaterThan(login.when);
});

afterAll(async () => {
  for (const name of created) await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  await admin.end();
  rmSync(work, { recursive: true, force: true });
});

describe("migrations de deux branches parallèles", () => {
  it("l'autre branche publiée d'abord : la migration de la connexion est rattrapée", async () => {
    const url = await scratch("autre_dabord");
    const first = run(folder("autre-dabord", [...base, other]), url);
    expect(first.status, first.out).toBe(0);
    expect(await schema(url)).toMatchObject({ column: false, loginPages: false, other: true });

    // Fusion : Drizzle saute la 0039, datée avant la dernière appliquée. Le script la rattrape.
    const both = run(folder("fusion-a", merged), url);
    expect(both.status, both.out).toBe(0);
    expect(both.out).toContain(`[migrate] migration rattrapée : ${LOGIN}`);
    expect(both.out).toContain("[migrate] migrations à jour");
    expect(await schema(url)).toEqual({
      column: true,
      loginPages: true,
      other: true,
      unmarked: false,
      rows: merged.length,
    });

    // Deuxième passage : rien à faire.
    const again = run(folder("fusion-a", merged), url);
    expect(again.status, again.out).toBe(0);
    expect(again.out).not.toContain("rattrapée");
    expect((await schema(url)).rows).toBe(merged.length);

    // Migration appliquée puis retouchée (empreinte changée, même date) : jamais rejouée.
    const touched = `${readFileSync(path.join(SOURCE, `${LOGIN}.sql`), "utf8")}\n-- retouche\n`;
    const edited = run(folder("retouchee", merged, { [LOGIN]: touched }), url);
    expect(edited.status, edited.out).toBe(0);
    expect(edited.out).not.toContain("rattrapée");
    expect((await schema(url)).rows).toBe(merged.length);

    // Migration sautée sans l'en-tête « -- Rejouable » : le déploiement échoue en la nommant.
    const late: Entry = {
      ...login,
      idx: login.idx + 1,
      when: login.when - 1,
      tag: "0040_sans_en_tete",
    };
    const blocked = run(
      folder("sans-en-tete", [...merged, late], {
        [late.tag]: 'CREATE TABLE "sans_en_tete" ("id" integer PRIMARY KEY);',
      }),
      url,
    );
    expect(blocked.status, blocked.out).toBe(1);
    expect(blocked.out).toContain(`[migrate] ${late.tag} datée avant la dernière migration`);
    expect(blocked.out).not.toContain("migrations à jour");
    expect(await schema(url)).toMatchObject({ unmarked: false, rows: merged.length });
  }, 120_000);

  it("la connexion publiée d'abord : l'autre branche passe ensuite, rien à rattraper", async () => {
    const url = await scratch("connexion_dabord");
    const first = run(folder("connexion-dabord", [...base, login]), url);
    expect(first.status, first.out).toBe(0);
    expect(await schema(url)).toMatchObject({ column: true, loginPages: true, other: false });

    const both = run(folder("fusion-b", merged), url);
    expect(both.status, both.out).toBe(0);
    expect(both.out).not.toContain("rattrapée");
    expect(await schema(url)).toEqual({
      column: true,
      loginPages: true,
      other: true,
      unmarked: false,
      rows: merged.length,
    });
  }, 120_000);
});
