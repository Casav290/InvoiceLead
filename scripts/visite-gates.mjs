#!/usr/bin/env node
/**
 * Portes du chantier « visite guidée » d'InvoiceLead (04.11.2026), une sous-commande par porte de
 * ~/projets/.unlazy/visites-suite/invoicelead/GATES.md : `node scripts/visite-gates.mjs g1` … `g9`. Dernière ligne :
 * VISITE_G<n>_OK, sinon la raison. Aucun secret affiché.
 *
 * Fichiers hors dépôt (600), dans ~/projets/.unlazy/visites-suite/invoicelead/ : testdb.url (base de test locale),
 * local.env (variables du build local, factices), comptes.json (sessions des comptes test+visite-invoicelead<n>,
 * écrit par comptes.mjs du même dossier), preview.json (relevé de scripts/visite-apercu.mjs), PROD.md.
 * Base d'aperçu : ~/.invoicelead-actions-ia.json (br-purple-rice) ; production en lecture : ~/.lead-e2e-ro.env.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const H = homedir();
const U = join(H, "projets/.unlazy/visites-suite/invoicelead");
const TEAM = "team_mRhlABdvm1jvEPoDzuDDgpon";
const PROJECT = "prj_BGHqP1Lyg3MWz3KoDYQ9qms5Epll";
const PROD_HOST = "ep-young-queen";
const gate = process.argv[2];
const pg = createRequire(join(ROOT, "package.json"))("pg");
const readEnv = (f) =>
  Object.fromEntries(
    readFileSync(f, "utf8")
      .split("\n")
      .filter((l) => /^[A-Z_]+=/.test(l))
      .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
  );
const run = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    timeout: 1_800_000,
    ...opts,
  });
  return { code: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
};
const fail = (why) => {
  console.log(`ÉCHEC ${gate} : ${why}`);
  process.exit(1);
};
const ok = (n) => {
  console.log(`VISITE_${n}_OK`);
  process.exit(0);
};
const head = () =>
  execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
const token = () =>
  JSON.parse(readFileSync(join(H, ".local/share/com.vercel.cli/auth.json"), "utf8")).token;
async function vapi(path) {
  const r = await fetch(
    `https://api.vercel.com${path}${path.includes("?") ? "&" : "?"}teamId=${TEAM}`,
    {
      headers: { Authorization: `Bearer ${token()}` },
    },
  );
  if (!r.ok) throw new Error(`vercel ${path.split("?")[0]} ${r.status}`);
  return r.json();
}
async function bypass() {
  const p = await vapi(`/v9/projects/${PROJECT}`);
  return Object.keys(p.protectionBypass ?? {}).find(
    (k) => p.protectionBypass[k].scope === "automation-bypass",
  );
}
const IA = () => JSON.parse(readFileSync(join(H, ".invoicelead-actions-ia.json"), "utf8"));
const roProd = () => readEnv(join(H, ".lead-e2e-ro.env")).INVOICELEAD_RO_URL;
const comptes = () => JSON.parse(readFileSync(join(U, "comptes.json"), "utf8"));
async function q(url, text, params) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    return (await c.query(text, params)).rows;
  } finally {
    await c.end();
  }
}

/**
 * Le détecteur de tiret long : pages publiques et écrans connectés (cookie de session), HTML (donc le flux RSC
 * inclus) et tous les scripts chargés, y compris ceux qu'un script charge à son tour.
 */
const hasDash = (t) => t.includes("—") || /\\u2014/i.test(t);
async function dashScan(base, headers, cookie) {
  const pub = ["/fr", "/de", "/en", "/fr/pricing", "/fr/faq", "/fr/login"];
  const app = [
    "",
    "/quotes",
    "/invoices",
    "/time",
    "/expenses",
    "/contacts",
    "/products",
    "/accounting",
    "/settings/company",
  ];
  const pages = [...pub, ...["fr", "de"].flatMap((l) => app.map((p) => `/${l}/app${p}`))];
  const seen = new Set();
  const hits = [];
  const queue = [];
  let connected = 0;
  let tour = 0;
  for (const p of pages) {
    const isApp = p.includes("/app");
    const r = await fetch(base + p, {
      headers: { ...headers, ...(isApp ? { cookie: `il_session=${cookie}` } : {}) },
      redirect: "manual",
    });
    const html = await r.text();
    if (isApp && r.status === 200 && html.includes('data-tour="profile"')) connected++;
    if (hasDash(html)) hits.push(`${p} (HTML)`);
    for (const m of html.matchAll(/\/_next\/static\/[\w./~-]+?\.js/g)) queue.push(m[0]);
  }
  while (queue.length) {
    const a = queue.shift();
    if (seen.has(a)) continue;
    seen.add(a);
    const js = await (await fetch(base + a, { headers })).text();
    if (hasDash(js)) hits.push(a);
    if (js.includes("data-tour-step")) tour++;
    for (const m of js.matchAll(/static\/(?:immutable\/)?chunks\/[\w.~-]+?\.js/g))
      queue.push(`/_next/${m[0]}`);
  }
  return { hits, scripts: seen.size, connected, appPages: app.length * 2, tour };
}

if (gate === "g1") {
  const env = { ...process.env, ...readEnv(join(U, "local.env")) };
  const testUrl = readFileSync(join(U, "testdb.url"), "utf8").trim();
  for (const [cmd, args, tok, e] of [
    ["npm", ["run", "lint"], "Checked", process.env],
    ["npm", ["run", "typecheck"], null, process.env],
    ["npm", ["run", "build"], "Proxy (Middleware)", env],
    [
      "npx",
      ["vitest", "run", "tests/unit/messages.test.ts"],
      "passed",
      { ...process.env, TEST_DATABASE_URL: testUrl },
    ],
  ]) {
    const r = run(cmd, args, { env: e });
    if (r.code !== 0 || (tok && !r.out.includes(tok)) || / failed/.test(r.out))
      fail(`${cmd} ${args.join(" ")} (code ${r.code}) ${r.out.slice(-600)}`);
    console.log(`  ✓ ${cmd} ${args.join(" ")}`);
  }
  ok("G1");
}

if (gate === "g2") {
  const url = readFileSync(join(U, "testdb.url"), "utf8").trim();
  if (!/\/invoicelead_visite_test\?host=\/var\/run\/postgresql$/.test(url))
    fail("base de test inattendue");
  // Base neuve, migrée de 0000 à 0050 : les personnes des tests naissent après la migration.
  const r0 = run("sudo", [
    "-n",
    "-u",
    "postgres",
    "psql",
    "-q",
    "-c",
    "drop database if exists invoicelead_visite_test",
    "-c",
    "create database invoicelead_visite_test owner ubuntu",
  ]);
  if (r0.code !== 0) fail(`base neuve : ${r0.out}`);
  const m = run("node", ["scripts/migrate.mjs"], { env: { ...process.env, DATABASE_URL: url } });
  if (m.code !== 0) fail(`migration : ${m.out.slice(-300)}`);
  const t = run("npm", ["test", "--", "--reporter=verbose"], {
    env: { ...process.env, TEST_DATABASE_URL: url },
  });
  const files = t.out.match(/Test Files\s+(.*)/)?.[1] ?? "";
  const tests = t.out.match(/Tests\s+(.*)/)?.[1] ?? "";
  const n = t.out.split("\n").filter((l) => /✓ .*visite\.test\.ts > Visite guidée/.test(l)).length;
  const vis = n ? [null, String(n)] : null;
  if (t.code !== 0 || / failed/.test(files + tests) || !vis || Number(vis[1]) < 5)
    fail(`npm test : ${files} / ${tests} ; visite ${vis?.[1] ?? 0}/5 ${t.out.slice(-500)}`);
  console.log(
    `  ✓ npm test : fichiers ${files.trim()}, contrôles ${tests.trim()} (visite.test.ts : ${vis[1]})`,
  );
  ok("G2");
}

/** Une passe du navigateur avec deux comptes neufs et le compte d'avant (comptes.mjs prépare les sessions). */
function e2e(where, base, db, extra = []) {
  const prep = run("node", [
    join(U, "comptes.mjs"),
    where === "apercu" ? "apercu-neufs" : "prod-neufs",
  ]);
  if (prep.code !== 0) fail(`comptes neufs (${where}) : ${prep.out.slice(-400)}`);
  const c = comptes()[where];
  if (!c?.old || (c?.fresh?.length ?? 0) < 2) fail(`comptes.json : ${where} incomplet`);
  const [a, b] = c.fresh.slice(-2);
  const env = {
    ...process.env,
    VISITE_NEW_COOKIE: a.cookie,
    VISITE_NEW_ID: a.id,
    VISITE_NEW_COOKIE_MOBILE: b.cookie,
    VISITE_OLD_COOKIE: c.old.cookie,
    VISITE_OLD_ID: c.old.id,
    VISITE_DB: db,
  };
  const r = run("node", ["scripts/e2e-visite.mjs", "--url", base, ...extra], { env });
  console.log(
    r.out
      .split("\n")
      .filter((l) => /✗|verts|ROUGE|E2E_VISITE_OK/.test(l))
      .join("\n"),
  );
  if (r.code !== 0 || !/^E2E_VISITE_OK$/m.test(r.out)) fail("e2e-visite rouge");
}
const preview = () => JSON.parse(readFileSync(join(U, "preview.json"), "utf8"));

if (gate === "g3") {
  const p = preview();
  // L'aperçu sert HEAD, ou un commit dont HEAD ne diffère que par les scripts des portes (rien de servi).
  const diff = execFileSync("git", ["diff", "--name-only", p.commit, "HEAD"], {
    cwd: ROOT,
    encoding: "utf8",
  })
    .split("\n")
    .filter(Boolean);
  if (p.commit !== head() && diff.some((f) => !/^scripts\/(visite-gates|e2e-visite)\.mjs$/.test(f)))
    fail(
      `l'aperçu sert ${p.commit?.slice(0, 7)}, HEAD est ${head().slice(0, 7)} : ${diff.join(", ")}`,
    );
  const st = IA();
  if (p.database?.branchId !== st.neon.branchId || st.secrets.roUrl.includes(PROD_HOST))
    fail("base d'aperçu inattendue");
  e2e("apercu", p.alias, st.secrets.roUrl, [
    "--bypass",
    await bypass(),
    "--out",
    join(U, "captures/apercu"),
  ]);
  ok("G3");
}

if (gate === "g4" || gate === "g7") {
  // Contre-épreuve : le même test de texte trouve un tiret long planté.
  if (!hasDash("texte témoin — planté") || !hasDash('x = "\\u2014"') || hasDash("texte – sans"))
    fail("contre-épreuve");
  const bad = [];
  for (const l of ["fr", "de", "en", "it", "es"]) {
    const t = JSON.stringify(
      JSON.parse(readFileSync(join(ROOT, `messages/${l}.json`), "utf8")).app.tour,
    );
    if (t.includes("—")) bad.push(`messages ${l} (app.tour)`);
  }
  const g4 = gate === "g4";
  const base = g4 ? preview().alias : "https://invoicelead.io";
  const headers = g4 ? { "x-vercel-protection-bypass": await bypass() } : {};
  const c = comptes()[g4 ? "apercu" : "prod"];
  const cookie = c?.fresh?.at(-1)?.cookie ?? c?.old?.cookie;
  if (!cookie) fail("aucune session pour les écrans connectés");
  const { hits, scripts, connected, appPages, tour } = await dashScan(base, headers, cookie);
  if (!tour)
    fail("le script de la visite (chargé à la demande) n'a pas été lu : détecteur aveugle");
  if (scripts < 20) fail(`trop peu de scripts lus (${scripts}) : détecteur aveugle`);
  if (connected < appPages) fail(`écrans connectés lus : ${connected}/${appPages}`);
  if (bad.length || hits.length) fail(`tiret long : ${[...bad, ...hits].join(", ")}`);
  console.log(
    `  ✓ ${scripts} scripts, 6 pages publiques et ${connected} écrans connectés lus sur ${base}, aucun « — » ; contre-épreuve trouvée`,
  );
  ok(gate.toUpperCase());
}

if (gate === "g5") {
  const prod = readFileSync(join(U, "PROD.md"), "utf8");
  const lsn = prod.match(/LSN (\S+) à (\S+) UTC/);
  const dump = prod.match(/pg_dump : (\S+)/);
  const pushed = prod.match(/Poussé à (\S+) UTC/);
  if (!lsn || !dump || !pushed)
    fail("PROD.md : point Neon, copie ou heure de mise en ligne manquants");
  if (!(Date.parse(lsn[2]) < Date.parse(pushed[1])))
    fail("le point Neon n'est pas antérieur à la mise en ligne");
  if (!existsSync(dump[1]) || statSync(dump[1]).size < 100_000)
    fail("copie pg_dump absente ou trop petite");
  const live = (await vapi(`/v9/projects/${PROJECT}`)).targets?.production;
  const sha = live?.meta?.githubCommitSha;
  const served = await vapi("/v13/deployments/invoicelead.io");
  const origin = execFileSync("git", ["rev-parse", "origin/main"], {
    cwd: ROOT,
    encoding: "utf8",
  }).trim();
  if (
    sha !== origin ||
    served.id !== live.id ||
    served.readyState !== "READY" ||
    !prod.includes(origin.slice(0, 7))
  )
    fail(
      `production ${sha?.slice(0, 7)} (${served.id}) ≠ origin/main ${origin.slice(0, 7)} (ou absent de PROD.md)`,
    );
  const ro = roProd();
  if (!ro.includes(PROD_HOST)) fail("adresse de production inattendue");
  // Le journal de Drizzle n'est pas lisible par le rôle en lecture seule : adresse du propriétaire, lue chez Vercel en
  // mémoire (lead-e2e/lib-db-urls.mjs), pour une lecture seulement.
  const { writeUrl } = await import(join(H, "projets/lead-e2e/lib-db-urls.mjs"));
  const owner = await writeUrl("invoicelead");
  if (!owner.includes(PROD_HOST)) fail("adresse de production inattendue");
  const mig = await q(
    owner,
    "select hash, created_at from drizzle.__drizzle_migrations order by created_at desc limit 2",
  );
  const journal = JSON.parse(
    readFileSync(join(ROOT, "drizzle/meta/_journal.json"), "utf8"),
  ).entries;
  const last = journal.at(-1);
  if (
    last.tag !== "0050_visite_guidee" ||
    Number(mig[0].created_at) !== last.when ||
    Number(mig[1].created_at) !== journal.at(-2).when
  )
    fail(`migrations : ${mig.map((m) => m.created_at).join(", ")}`);
  const cols = await q(
    ro,
    "select column_name, column_default from information_schema.columns where table_name = 'users' and column_name like 'tour%'",
  );
  if (
    cols.length !== 2 ||
    !/true/.test(cols.find((x) => x.column_name === "tour_pending")?.column_default ?? "")
  )
    fail(JSON.stringify(cols));
  const pushedAt = pushed[1];
  const before = (
    await q(
      ro,
      `select count(*)::int n, count(*) filter (where tour_pending)::int due from users
        where created_at < $1::timestamptz - interval '10 minutes'`,
      [pushedAt],
    )
  )[0];
  if (before.due !== 0 || before.n < 1)
    fail(`${before.due} personnes d'avant ont la visite due (sur ${before.n})`);
  console.log(
    `  ✓ production = ${sha.slice(0, 7)} (${live.id}) ; 0050 seule nouvelle ; colonnes présentes ; ${before.n} personnes d'avant, 0 due`,
  );
  ok("G5");
}

if (gate === "g6") {
  e2e("prod", "https://invoicelead.io", roProd(), ["--out", join(U, "captures"), "--video"]);
  ok("G6");
}

if (gate === "g8") {
  const like = "test+visite-invoicelead%";
  const a = (await q(roProd(), "select count(*)::int n from users where email like $1", [like]))[0]
    .n;
  const o = (
    await q(
      roProd(),
      "select count(*)::int n from organizations where name like 'TEST Visite IL %'",
    )
  )[0].n;
  const e = readEnv(join(H, ".lead-e2e-ro.env")).ERPLEAD_RO_URL;
  const b = (await q(e, "select count(*)::int n from users where email like $1", [like]))[0].n;
  const eo = (await q(e, "select count(*)::int n from orgs where name like 'TEST Visite IL %'"))[0]
    .n;
  const p = (
    await q(IA().secrets.roUrl, "select count(*)::int n from users where email like $1", [like])
  )[0].n;
  const po = (
    await q(
      IA().secrets.roUrl,
      "select count(*)::int n from organizations where name like 'TEST Visite IL %'",
    )
  )[0].n;
  if (a || o || b || eo || p || po)
    fail(
      `restent : InvoiceLead ${a} personnes / ${o} entreprises, ERPlead ${b} / ${eo}, aperçu ${p} / ${po}`,
    );
  console.log(
    "  ✓ 0 compte test+visite-invoicelead (InvoiceLead, ERPlead, base d'aperçu), 0 entreprise « TEST Visite IL »",
  );
  ok("G8");
}

if (gate === "g9") {
  if (!existsSync(join(U, "PROD.md"))) fail("PROD.md absent");
  const prod = readFileSync(join(U, "PROD.md"), "utf8");
  if (!/promote dpl_\w+/.test(prod) || !/Commit précédent : [0-9a-f]{7}/.test(prod))
    fail("PROD.md : commit précédent ou commande de retour arrière absents");
  const cap = join(U, "captures");
  const vids = readdirSync(cap).filter(
    (f) => /^visite-(bureau-1440|mobile-390)\.mp4$/.test(f) && statSync(join(cap, f)).size > 50_000,
  );
  const shots = readdirSync(cap).filter((f) => f.endsWith(".png"));
  if (vids.length !== 2) fail(`vidéos : ${vids.join(", ")}`);
  if (shots.length < 20) fail(`${shots.length} captures seulement`);
  console.log(`  ✓ ${vids.join(", ")} ; ${shots.length} captures`);
  ok("G9");
}

fail("porte inconnue (g1 à g9)");
