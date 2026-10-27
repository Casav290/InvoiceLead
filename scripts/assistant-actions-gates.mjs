#!/usr/bin/env node
/**
 * Portes du chantier « assistant-actions » pour InvoiceLead (cahier
 * ~/projets/.unlazy/assistant-actions/CAHIER.md, ledger gates/leaf-invoicelead.md).
 *
 *   node scripts/assistant-actions-gates.mjs G1   inventaire docs/ASSISTANT-ACTIONS.md ↔ écrans ↔ outils
 *   node scripts/assistant-actions-gates.mjs G2   tests des outils et du lot (Vitest, base locale dédiée)
 *   node scripts/assistant-actions-gates.mjs G3   contrôles complets (Biome, types, Vitest, build, Playwright, clés)
 *   node scripts/assistant-actions-gates.mjs G4   aperçu Vercel : scénario phare et lot, vrai modèle, compte TEST
 *   node scripts/assistant-actions-gates.mjs G5   aperçu Vercel : demandes interdites refusées
 *   node scripts/assistant-actions-gates.mjs G6   production (seulement après le feu vert de l'orchestrateur)
 *
 * À lancer à la racine du worktree (branche assistant-actions). Chaque porte vérifie vraiment et
 * n'imprime son jeton ASSISTANT_ACTIONS_Gn_OK qu'après toutes ses assertions. Aucun secret n'est
 * affiché : les adresses de base et le jeton Vercel sont lus en mémoire (état 600 hors du dépôt :
 * ~/.invoicelead-actions-ia.json, jeton du CLI Vercel, rôle en lecture seule ~/.lead-e2e-ro.env).
 */
import { execFileSync, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const HOME = homedir();
const require = createRequire(join(ROOT, "package.json"));
const TMP = join(ROOT, "tmp", "assistant-actions-gates");
const STATE_FILE = join(HOME, ".invoicelead-actions-ia.json");
const CAPTURES = join(HOME, "projets", ".unlazy", "assistant-actions", "captures", "invoicelead");
const TEAM = "team_mRhlABdvm1jvEPoDzuDDgpon";
const PROJECT = "prj_BGHqP1Lyg3MWz3KoDYQ9qms5Epll";
const BRANCH = "assistant-actions";
/** Commit de production d'où part la branche (déploiement dpl_J9tvZS1U8w7BAy8z5nmpnpL6j5dm, main). */
const PROD_BASE = "bafcece83de404f4dc1744705ae032345064143e";
const LOCAL_PG = (db) => `postgresql://ubuntu@localhost/${db}?host=/var/run/postgresql`;
/** Durée permise de la fonction /api/assistant (plan Hobby, Fluid compute) et arrêt du tour (run.ts). */
const MAX_DURATION_S = 300;
const TURN_DEADLINE_S = 270;

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok: !!ok });
  const d = detail === "" ? "" : ` : ${String(detail).slice(0, 400)}`;
  console.log(`${ok ? "OK " : "NON"} ${name}${d}`);
  return !!ok;
}
function finish(token) {
  const bad = results.filter((r) => !r.ok);
  console.log(`${results.length - bad.length} verts, ${bad.length} rouges`);
  if (bad.length > 0 || results.length === 0) process.exit(1);
  console.log(token);
}
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const sh = (cmd, args, opts = {}) =>
  spawnSync(cmd, args, { cwd: ROOT, encoding: "utf8", maxBuffer: 256 * 1024 * 1024, ...opts });
const git = (...args) => execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();
mkdirSync(TMP, { recursive: true });

function assertWorktree() {
  const top = git("rev-parse", "--show-toplevel");
  const branch = git("branch", "--show-current");
  if (top !== ROOT || branch !== BRANCH) {
    console.log(`NON à lancer à la racine du worktree, branche ${BRANCH} (ici ${ROOT}, ${branch})`);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------------------------
// Lectures statiques : actions serveur des écrans, registre des opérations, inventaire
// ---------------------------------------------------------------------------------------------

function filesUnder(dir, keep) {
  const out = [];
  for (const name of readdirSync(join(ROOT, dir))) {
    const rel = join(dir, name);
    const st = statSync(join(ROOT, rel));
    if (st.isDirectory()) out.push(...filesUnder(rel, keep));
    else if (keep(rel)) out.push(rel);
  }
  return out;
}

/** Toutes les actions serveur exportées des fichiers « use server » de l'application. */
function serverActions() {
  const files = filesUnder("src", (f) => /\.(ts|tsx)$/.test(f)).filter((f) =>
    /^\s*["']use server["']/m.test(read(f)),
  );
  const out = [];
  for (const f of files)
    for (const m of read(f).matchAll(/^export async function (\w+)/gm))
      out.push({ file: f, name: m[1] });
  return out;
}

/** Routes d'écriture que les écrans appellent directement (formulaires POST, liens d'action). */
function uiWriteRoutes() {
  const found = new Set();
  for (const f of filesUnder("src", (x) => x.endsWith(".tsx"))) {
    const text = read(f);
    for (const m of text.matchAll(/action="(\/(?:api|auth)\/[\w/-]+)"/g)) found.add(m[1]);
    for (const m of text.matchAll(/href=\{`(\/api\/(?:stripe|billing)\/[\w-]+)/g)) found.add(m[1]);
  }
  return [...found].sort();
}

/** Opérations du registre : identifiants des defineOp listés dans OPERATIONS (operations.ts). */
function registeredOperations() {
  const ids = new Map();
  for (const f of filesUnder("src/server/ai-assistant", (x) => /ops-\w+\.ts$/.test(x)))
    for (const m of read(f).matchAll(/export const (\w+) = defineOp\(\{\s*id: "(\w+)"/g))
      ids.set(m[1], m[2]);
  const ops = read("src/server/ai-assistant/operations.ts");
  const block = ops.slice(ops.indexOf("export const OPERATIONS"), ops.indexOf("] as Operation[]"));
  const names = [...block.matchAll(/^\s+(\w+Op),$/gm)].map((m) => m[1]);
  return {
    ids: names.map((n) => ids.get(n)).filter(Boolean),
    unknown: names.filter((n) => !ids.has(n)),
  };
}

const CATEGORIES = [
  "supprimer",
  "payer",
  "formule et abonnement",
  "membres et droits",
  "clés API",
  "envoyer à l'extérieur",
];
const SCREEN_ONLY = ["fichier", "lien", "session"];

/** Lignes des tableaux de l'inventaire : fonctions citées et ce que fait l'assistant. */
function inventoryRows(doc) {
  const rows = [];
  for (const line of doc.split("\n")) {
    if (!line.startsWith("|") || /^\|\s*-/.test(line) || /^\|\s*(Écran|Demande)\s*\|/.test(line))
      continue;
    const cells = line
      .split("|")
      .slice(1, -1)
      .map((c) => c.trim());
    if (cells.length === 4) {
      const fns = [...cells[2].matchAll(/`([^`]+)`/g)].map((m) => m[1]);
      rows.push({ line, fns, assistant: cells[3] });
    } else if (cells.length === 2) rows.push({ line, fns: [], assistant: cells[1] });
  }
  return rows;
}

/** Ce que dit une ligne : outils proposés, catégorie d'interdit, écran seul, lecture ; ou une erreur. */
function disposition(assistant) {
  const tools = [...assistant.matchAll(/`(propose_[a-z_]+)`/g)].map((m) => m[1]);
  if (tools.length > 0) return { kind: "tool", tools };
  const forbidden = /^interdit : (.+?)(?: \(.*\))?$/.exec(assistant);
  if (forbidden)
    return CATEGORIES.includes(forbidden[1])
      ? { kind: "forbidden", category: forbidden[1] }
      : { kind: "error", why: `catégorie inconnue « ${forbidden[1]} »` };
  const screen = /^écran : (\w+)$/.exec(assistant);
  if (screen)
    return SCREEN_ONLY.includes(screen[1])
      ? { kind: "screen", why: screen[1] }
      : { kind: "error", why: `écran « ${screen[1]} »` };
  if (assistant === "lecture") return { kind: "read" };
  return { kind: "error", why: `disposition illisible « ${assistant} »` };
}

/** Couverture : chaque action et route a sa ligne, chaque ligne une disposition valide. */
function coverage(doc, actions, routes, registered) {
  const problems = [];
  const rows = inventoryRows(doc);
  const cited = new Set(rows.flatMap((r) => r.fns));
  for (const a of actions)
    if (!cited.has(a.name)) problems.push(`action ${a.name} (${a.file}) absente`);
  for (const r of routes) if (!cited.has(r)) problems.push(`route ${r} absente`);
  const tools = new Set();
  for (const r of rows) {
    const d = disposition(r.assistant);
    if (d.kind === "error") problems.push(`${d.why} : ${r.line.slice(0, 120)}`);
    if (d.kind === "tool")
      for (const t of d.tools) {
        tools.add(t);
        if (!registered.has(t)) problems.push(`outil ${t} inconnu du registre`);
      }
  }
  for (const t of registered)
    if (!tools.has(t)) problems.push(`outil ${t} sans ligne dans l'inventaire`);
  return { problems, rows };
}

function vitestJson(files, db, label, extra = []) {
  migrateLocal(db);
  const out = join(TMP, `${label}.json`);
  const res = sh(
    "npx",
    ["vitest", "run", ...files, "--reporter=json", `--outputFile=${out}`, ...extra],
    {
      env: { ...process.env, TEST_DATABASE_URL: LOCAL_PG(db) },
      timeout: 1_800_000,
    },
  );
  if (!existsSync(out))
    return { ok: false, tests: [], log: `${res.stdout}\n${res.stderr}`.slice(-2000) };
  const report = JSON.parse(readFileSync(out, "utf8"));
  const tests = report.testResults.flatMap((f) =>
    f.assertionResults.map((a) => ({
      name: [...a.ancestorTitles, a.title].join(" > "),
      status: a.status,
    })),
  );
  return {
    ok: res.status === 0,
    tests,
    failedFiles: report.testResults
      .filter((f) => f.status !== "passed")
      .map((f) => relative(ROOT, f.name)),
  };
}

/** Base locale dédiée à une porte (créée au besoin), migrée comme en CI. */
function migrateLocal(db) {
  if (!/^invoicelead_actions_\w+$/.test(db)) throw new Error(`base ${db}`);
  const exists = sh("psql", [
    LOCAL_PG("postgres"),
    "-Atc",
    `select 1 from pg_database where datname = '${db}'`,
  ]);
  if (exists.stdout.trim() !== "1") {
    const created = sh("psql", [LOCAL_PG("postgres"), "-c", `create database ${db}`]);
    if (created.status !== 0)
      throw new Error(`création de ${db} : ${created.stderr.slice(0, 200)}`);
  }
  const m = sh("node", ["scripts/migrate.mjs"], {
    env: { ...process.env, DATABASE_URL: LOCAL_PG(db), DATABASE_URL_UNPOOLED: "", VERCEL_ENV: "" },
  });
  if (m.status !== 0) throw new Error(`migration de ${db} : ${m.stdout.slice(-300)}`);
}

// ---------------------------------------------------------------------------------------------
// G1 : inventaire
// ---------------------------------------------------------------------------------------------

async function g1() {
  const doc = read("docs/ASSISTANT-ACTIONS.md");
  const actions = serverActions();
  const routes = uiWriteRoutes();
  check("actions serveur des écrans relevées", actions.length >= 80, `${actions.length} actions`);
  check(
    "routes d'écriture appelées par les écrans relevées",
    routes.length >= 3,
    routes.join(", "),
  );
  const reg = registeredOperations();
  check(
    "registre lisible (chaque opération listée a son identifiant)",
    reg.unknown.length === 0 && reg.ids.length >= 30,
    `${reg.ids.length} opérations${reg.unknown.length ? `, inconnues : ${reg.unknown}` : ""}`,
  );
  const registered = new Set([...reg.ids.map((id) => `propose_${id}`), "propose_batch"]);
  const { problems, rows } = coverage(doc, actions, routes, registered);
  check(
    "chaque action et route des écrans a sa ligne, chaque ligne une disposition valide, chaque outil sa ligne",
    problems.length === 0,
    problems.slice(0, 8).join(" ; ") || `${rows.length} lignes`,
  );
  const allowed = rows.filter((r) => disposition(r.assistant).kind === "tool");
  check(
    "chaque ligne permise pointe vers un outil propose_* enregistré",
    allowed.every((r) => disposition(r.assistant).tools.every((t) => registered.has(t))),
    `${allowed.length} lignes permises`,
  );

  // Contrôles positifs : le même contrôle échoue sur un inventaire amputé ou faussé.
  const firstAction = actions.find((a) => a.name === "saveContact");
  const amputated = doc
    .split("\n")
    .filter((l) => !l.includes("`saveContact`"))
    .join("\n");
  check(
    "contrôle positif : une action retirée de l'inventaire est détectée",
    firstAction &&
      coverage(amputated, actions, routes, registered).problems.some((p) =>
        p.includes("saveContact"),
      ),
  );
  const invented = doc.replace(
    "interdit : supprimer (l'archivage",
    "interdit : archiver (l'archivage",
  );
  check(
    "contrôle positif : une catégorie d'interdit inventée est refusée",
    coverage(invented, actions, routes, registered).problems.some((p) => p.includes("archiver")),
  );
  const unknownTool = doc.replace("`propose_create_contact`", "`propose_create_kontakt`");
  check(
    "contrôle positif : un outil inconnu du registre est refusé",
    coverage(unknownTool, actions, routes, registered).problems.some((p) =>
      p.includes("propose_create_kontakt"),
    ),
  );

  // Les outils réellement donnés au modèle (buildTools) = registre = inventaire (test Vitest).
  const v = vitestJson(["tests/unit/assistant-actions.test.ts"], "invoicelead_actions_g1", "g1", [
    "-t",
    "inventaire|chaque opération du registre",
  ]);
  const wanted = [
    "nomme chaque outil propose_* donné au modèle",
    "chaque opération du registre a sa scène",
  ];
  for (const w of wanted) {
    const t = v.tests.find((x) => x.name.includes(w));
    check(`test « ${w} »`, t?.status === "passed", t?.status ?? "absent");
  }
  finish("ASSISTANT_ACTIONS_G1_OK");
}

// ---------------------------------------------------------------------------------------------
// G2 : tests des outils et du lot
// ---------------------------------------------------------------------------------------------

async function g2() {
  const reg = registeredOperations();
  const v = vitestJson(
    ["tests/unit/assistant-actions.test.ts", "tests/unit/assistant-bubble.test.ts"],
    "invoicelead_actions_g2",
    "g2",
  );
  const passed = (part) => v.tests.find((t) => t.name.includes(part))?.status === "passed";
  // Une scène par opération (la lecture par l'IA a son propre test) : proposition sans écriture,
  // autre personne et autre entreprise 403, confirmation exacte, rejeu 403.
  for (const id of reg.ids.filter((x) => x !== "read_receipt"))
    check(
      `${id} : proposition sans écriture, autres 403, confirmation exacte, rejeu 403`,
      passed(`> ${id} : proposition sans écriture`),
    );
  const named = [
    [
      "lecture par l'IA : proposition sans lecture, lecture au clic",
      "propose sans lire, lit au clic",
    ],
    [
      "scénario phare : carte exacte, brouillon de devis écrit au clic, rien envoyé",
      "la carte montre les lignes et le total exacts",
    ],
    [
      "lot : proposition sans écriture puis tout écrit au clic (clés locales)",
      "nouveau client + son devis + un article",
    ],
    [
      "lot : échec au milieu à la confirmation, rien d'écrit",
      "échec au milieu du lot à la confirmation",
    ],
    [
      "lot : échec au milieu à la proposition, rien d'écrit",
      "échec au milieu du lot à la proposition",
    ],
    [
      "lot : référence vers une opération plus loin refusée",
      "une référence vers une opération plus loin",
    ],
    ["lot : plafond de 150 opérations", "plafond : 150 opérations"],
    ["lot : clés en double, mauvais type, lecture IA refusées", "refuse les clés en double"],
    [
      "lot : droit retiré avant le clic = 403, jeton gardé",
      "un lot dont une opération n'est plus permise",
    ],
    ["droits : lecture seule", "lecture seule : aucune proposition"],
    ["droits : comptabilité seule", "comptabilité seule"],
    [
      "CRMlead : rien envoyé à la proposition, envoyé après validation",
      "rien en file ni envoyé à la proposition",
    ],
    ["émission : comptabilisée après validation", "émettre : la pièce est comptabilisée"],
    ["jeton : rejeu refusé (403)", "le rejeu est refusé (403)"],
    ["jeton : autre utilisateur 403", "jeton d'un autre utilisateur"],
    ["jeton : autre entreprise 403", "jeton d'une autre entreprise"],
    ["jeton : expiré ou falsifié 403", "expiré ou falsifié"],
    ["rôle changé avant le clic : 403", "rôle ne permet plus la facturation"],
    ["aucun outil interdit donné au modèle", "n'offre aucun outil interdit"],
  ];
  for (const [label, part] of named) check(label, passed(part));
  const failed = v.tests.filter((t) => t.status !== "passed");
  check(
    "aucun test de l'assistant en échec ou sauté",
    v.ok && failed.length === 0 && v.tests.length >= 60,
    `${v.tests.length} tests, ${failed.length} non passés${
      failed.length
        ? ` : ${failed
            .slice(0, 3)
            .map((t) => t.name)
            .join(" | ")}`
        : ""
    }`,
  );
  finish("ASSISTANT_ACTIONS_G2_OK");
}

// ---------------------------------------------------------------------------------------------
// G3 : contrôles complets de l'application, aucune clé livrée au navigateur
// ---------------------------------------------------------------------------------------------

const KEY = /sk-ant-[A-Za-z0-9_-]{16,}/;

/** Fichiers (récursif) où une clé d'Anthropic apparaît. */
function scanKeys(dir) {
  const hits = [];
  if (!existsSync(dir)) return hits;
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      const st = statSync(p);
      if (st.isDirectory()) walk(p);
      else if (st.size < 20_000_000 && KEY.test(readFileSync(p, "latin1")))
        hits.push(relative(ROOT, p));
    }
  };
  walk(dir);
  return hits;
}

async function g3() {
  const log = (name, res) =>
    writeFileSync(join(TMP, `g3-${name}.log`), `${res.stdout ?? ""}\n${res.stderr ?? ""}`);
  const step = (name, cmd, args, opts = {}) => {
    const res = sh(cmd, args, { timeout: 3_600_000, ...opts });
    log(name, res);
    return res;
  };
  const biome = step("biome", "npx", ["biome", "ci", "."]);
  check(
    "Biome (lint et format, comme la CI)",
    biome.status === 0,
    biome.status === 0 ? "" : `${biome.stdout}`.slice(-300),
  );
  const tsc = step("tsc", "npx", ["tsc", "--noEmit"]);
  check("TypeScript", tsc.status === 0, `${tsc.stdout}`.slice(0, 300));
  const v = vitestJson([], "invoicelead_actions_g3", "g3-vitest");
  const failed = v.tests.filter((t) => t.status !== "passed");
  check(
    "Vitest complet",
    v.ok && failed.length === 0 && v.tests.length > 500,
    `${v.tests.length} tests, ${failed.length} non passés ${failed
      .slice(0, 3)
      .map((t) => t.name)
      .join(" | ")}`,
  );
  const build = step("build", "npx", ["next", "build"], {
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
  });
  check("build Next", build.status === 0, build.status === 0 ? "" : `${build.stdout}`.slice(-400));
  migrateLocal("invoicelead_actions_e2e");
  const e2e = step("e2e", "npx", ["playwright", "test"], {
    env: {
      ...process.env,
      E2E_APP_PORT: "3160",
      E2E_LEAD_PORT: "4060",
      E2E_DATABASE_URL: LOCAL_PG("invoicelead_actions_e2e"),
      NEXT_TELEMETRY_DISABLED: "1",
    },
  });
  const summary = /(\d+) passed/.exec(e2e.stdout)?.[1];
  const failedE2e = /(\d+) failed/.exec(e2e.stdout)?.[1];
  check(
    "Playwright complet (bulle, audit Trait net, écrans)",
    e2e.status === 0 && !failedE2e,
    `${summary ?? 0} passés${failedE2e ? `, ${failedE2e} en échec` : ""}`,
  );

  // Clés : contrôle positif d'abord (le balayage trouve une clé plantée), puis le code livré.
  const planted = join(TMP, "temoin-cle");
  mkdirSync(planted, { recursive: true });
  writeFileSync(
    join(planted, "chunk.js"),
    `const k="sk-ant-api03-${randomBytes(24).toString("hex")}";`,
  );
  check("contrôle positif : le balayage trouve une clé plantée", scanKeys(planted).length === 1);
  check(
    "aucune clé d'Anthropic dans le code livré au navigateur (.next/static)",
    existsSync(join(ROOT, ".next/static")) && scanKeys(join(ROOT, ".next/static")).length === 0,
  );
  const tracked = git("ls-files")
    .split("\n")
    .filter((f) => f && existsSync(join(ROOT, f)) && !f.endsWith(".png"));
  const trackedHits = tracked.filter((f) => KEY.test(readFileSync(join(ROOT, f), "latin1")));
  check("aucune clé dans les fichiers du dépôt", trackedHits.length === 0, trackedHits.join(", "));
  const history = sh("git", ["log", "-p", `${PROD_BASE}..HEAD`]);
  check(
    "aucune clé dans l'historique de la branche",
    history.status === 0 && !KEY.test(history.stdout),
    `depuis ${PROD_BASE.slice(0, 7)}`,
  );
  const clientFiles = filesUnder("src", (f) => /\.(ts|tsx)$/.test(f)).filter((f) =>
    /^\s*["']use client["']/m.test(read(f)),
  );
  const readers = filesUnder("src", (f) => /\.(ts|tsx)$/.test(f)).filter((f) =>
    read(f).includes("ANTHROPIC_API_KEY"),
  );
  check(
    "la clé n'est lue que côté serveur",
    readers.length > 0 &&
      readers.every((f) => f.startsWith("src/server/") && !clientFiles.includes(f)),
    readers.join(", "),
  );
  finish("ASSISTANT_ACTIONS_G3_OK");
}

// ---------------------------------------------------------------------------------------------
// Aperçu et production : Vercel, bases (propriétaire de la branche d'aperçu, lecture seule), TEST
// ---------------------------------------------------------------------------------------------

/** État de l'aperçu et de la production (600, hors du dépôt) ; jamais affiché. */
function state() {
  if (!existsSync(STATE_FILE)) throw new Error(`${STATE_FILE} absent`);
  const mode = statSync(STATE_FILE).mode & 0o777;
  if (mode !== 0o600) throw new Error(`${STATE_FILE} doit être en 600 (ici ${mode.toString(8)})`);
  return JSON.parse(readFileSync(STATE_FILE, "utf8"));
}

const vercelToken = () =>
  JSON.parse(readFileSync(join(HOME, ".local/share/com.vercel.cli/auth.json"), "utf8")).token;
async function vapi(path) {
  const sep = path.includes("?") ? "&" : "?";
  const r = await fetch(`https://api.vercel.com${path}${sep}teamId=${TEAM}`, {
    headers: { Authorization: `Bearer ${vercelToken()}` },
  });
  if (!r.ok) throw new Error(`vercel ${path.split("?")[0]} ${r.status}`);
  return r.json();
}

/** Secret d'automatisation de la protection des déploiements (en mémoire seulement). */
async function bypassSecret() {
  const p = await vapi(`/v9/projects/${PROJECT}`);
  return Object.keys(p.protectionBypass ?? {}).find(
    (k) => p.protectionBypass[k].scope === "automation-bypass",
  );
}

/** Hôte de la base de production (rôle en lecture seule du banc), pour s'assurer qu'on ne l'écrit jamais. */
function roUrlProduction() {
  const line = readFileSync(join(HOME, ".lead-e2e-ro.env"), "utf8")
    .split("\n")
    .find((l) => l.startsWith("INVOICELEAD_RO_URL="));
  if (!line) throw new Error("INVOICELEAD_RO_URL absent de ~/.lead-e2e-ro.env");
  return line.slice("INVOICELEAD_RO_URL=".length);
}

async function pgClient(url) {
  const pg = require("pg");
  const u = new URL(url);
  u.searchParams.delete("sslmode");
  u.searchParams.delete("channel_binding");
  const c = new pg.Client({ connectionString: u.toString(), ssl: { rejectUnauthorized: true } });
  await c.connect();
  return c;
}

/** Lecture en transaction « read only » avec le rôle lead_e2e_ro. */
async function readOnly(url, fn) {
  const c = await pgClient(url);
  try {
    await c.query("begin read only");
    return await fn(c);
  } finally {
    await c.query("rollback").catch(() => {});
    await c.end();
  }
}

/** Compte TEST du banc (~/projets/lead-e2e/state.json) : entreprise 02 et son administrateur. */
function testAccount() {
  const s = JSON.parse(readFileSync(join(HOME, "projets/lead-e2e/state.json"), "utf8"));
  const org = s.orgs.find((o) => o.company === "TEST Atelier Menuiserie Bovay");
  const admin = org?.people.find((p) => p.role === "admin");
  if (!org || !admin) throw new Error("compte TEST introuvable");
  return {
    company: org.company,
    leadOrg: org.erpOrg,
    email: admin.email,
    password: admin.password,
  };
}

/** Le déploiement d'aperçu prêt de la branche, au commit HEAD. */
async function previewDeployment() {
  const head = git("rev-parse", "HEAD");
  const list = await vapi(`/v6/deployments?projectId=${PROJECT}&limit=50`);
  const d = list.deployments.find(
    (x) =>
      x.meta?.githubCommitRef === BRANCH &&
      x.meta?.githubCommitSha === head &&
      x.target !== "production",
  );
  return { head, d: d ? await vapi(`/v13/deployments/${d.uid}`) : null };
}

/** Session InvoiceLead ouverte directement dans la base de l'APERÇU pour l'administrateur TEST. */
async function previewSession(st, prodHost) {
  if (
    new URL(st.secrets.databaseUrlUnpooled).hostname !== st.neon.host ||
    st.neon.host === prodHost
  )
    throw new Error("la base d'écriture n'est pas celle de la branche d'aperçu");
  const t = testAccount();
  const c = await pgClient(st.secrets.databaseUrlUnpooled);
  try {
    const org = (
      await c.query("select id, name from organizations where lead_org = $1", [t.leadOrg])
    ).rows[0];
    const user = (
      await c.query(
        `select u.id from users u join memberships m on m.user_id = u.id
         where lower(u.email) = lower($1) and m.organization_id = $2 and m.removed_at is null`,
        [t.email, org?.id],
      )
    ).rows[0];
    if (!org || !user) throw new Error("entreprise ou administrateur TEST absents de l'aperçu");
    const token = randomBytes(32).toString("base64url");
    const id = createHash("sha256").update(token).digest("hex");
    await c.query(
      `insert into sessions (id, user_id, organization_id, id_token, expires_at) values ($1, $2, $3, null, now() + interval '3 hours')`,
      [id, user.id, org.id],
    );
    return { token, orgId: org.id, orgName: org.name, userId: user.id, write: c };
  } catch (e) {
    await c.end();
    throw e;
  }
}

async function browser() {
  const { chromium } = require("@playwright/test");
  return chromium.launch();
}

/** Page de l'application avec la session TEST, la protection Vercel passée, les réponses de la bulle notées. */
async function appPage(br, base, cookie, bypass, viewport, mobile = false) {
  const ctx = await br.newContext({
    viewport,
    isMobile: mobile,
    hasTouch: mobile,
    deviceScaleFactor: mobile ? 2 : 1,
    locale: "fr-CH",
    extraHTTPHeaders: bypass
      ? { "x-vercel-protection-bypass": bypass, "x-vercel-set-bypass-cookie": "samesitenone" }
      : {},
  });
  await ctx.addCookies([
    {
      name: "il_session",
      value: cookie,
      domain: new URL(base).hostname,
      path: "/",
      secure: true,
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const replies = [];
  page.on("response", async (r) => {
    if (r.request().method() !== "POST") return;
    if (r.url().endsWith("/api/assistant")) {
      const at = Date.now();
      replies.push({ status: r.status(), body: await r.json().catch(() => null), at });
    }
  });
  return { ctx, page, errors, replies };
}

/** Une demande dans la bulle ; rend la réponse de /api/assistant et la durée du tour. */
async function ask(view, text) {
  const { page, replies } = view;
  const before = replies.length;
  const input = page.getByTestId("assistant-input");
  await input.fill(text);
  const started = Date.now();
  const response = page.waitForResponse(
    (r) => r.url().endsWith("/api/assistant") && r.request().method() === "POST",
    { timeout: (MAX_DURATION_S + 30) * 1000 },
  );
  await input.press("Enter");
  await response;
  await page.waitForFunction(
    () => !document.querySelector("[data-testid=assistant-working]"),
    null,
    {
      timeout: 30_000,
    },
  );
  // La réponse est notée par l'écouteur de la page (corps JSON lu après coup).
  for (let i = 0; i < 100 && replies.length <= before; i++) await page.waitForTimeout(100);
  const reply = replies[before] ?? null;
  return { reply, seconds: ((reply?.at ?? Date.now()) - started) / 1000 };
}

const confirmCards = (reply) => (reply?.body?.actions ?? []).filter((a) => a.type === "confirm");
const CANNOT = /ne peu[xt] pas|pas possible|impossible|je ne (?:sais|suis) pas/i;

/** Clique « Confirmer » sur la dernière carte et attend la ligne « Enregistré ». */
async function confirmLast(page) {
  const done = await page.getByTestId("assistant-done").count();
  await page.getByTestId("assistant-confirm").last().click();
  await page.waitForFunction(
    (n) => document.querySelectorAll("[data-testid=assistant-done]").length > n,
    done,
    { timeout: 120_000 },
  );
}

/** Le devis brouillon d'un client, lu en base avec le rôle en lecture seule. */
async function quoteOf(roUrl, orgId, contactName) {
  return readOnly(roUrl, async (c) => {
    const rows = (
      await c.query(
        `select i.id, i.kind, i.status, i.number, i.net_cents::int net, i.total_cents::int total, i.currency,
           i.sent_at, i.public_token_hash, i.updated_at
         from invoices i join contacts c on c.id = i.contact_id
         where i.organization_id = $1 and c.name = $2 order by i.created_at`,
        [orgId, contactName],
      )
    ).rows;
    const lines = rows[0]
      ? (
          await c.query(
            `select description, quantity_milli::int q, unit, unit_price_cents::int price, net_cents::int net
             from invoice_lines where invoice_id = $1 order by position`,
            [rows[0].id],
          )
        ).rows
      : [];
    return { rows, lines };
  });
}

const FLAGSHIP = (client) =>
  `Fais un devis pour ${client} : création site vitrine 3'500 CHF, hébergement 1 an 240 CHF`;

/** Le scénario phare dans une page : carte dès la première réponse, Confirmer, base relue, page du devis. */
async function flagship(view, base, st, session, client, shotPrefix) {
  const { page } = view;
  const ro = st.secrets.roUrl;
  await session.write.query(
    `insert into contacts (organization_id, kind, is_customer, name, country, language) values ($1, 'company', true, $2, 'CH', 'fr')`,
    [session.orgId, client],
  );
  await page.goto(`${base}/fr/app/quotes`);
  await page.getByTestId("assistant-bubble").click();
  const { reply, seconds } = await ask(view, FLAGSHIP(client));
  check(`${shotPrefix} : réponse 200 de /api/assistant`, reply?.status === 200, reply?.status);
  check(
    `${shotPrefix} : tour de ${seconds.toFixed(1)} s, sous l'arrêt du tour (${TURN_DEADLINE_S} s) et le maxDuration (${MAX_DURATION_S} s)`,
    seconds < TURN_DEADLINE_S,
    `${seconds.toFixed(1)} s`,
  );
  const cards = confirmCards(reply);
  const text = reply?.body?.reply ?? "";
  check(
    `${shotPrefix} : une carte « À confirmer » dès la première réponse`,
    cards.length === 1,
    JSON.stringify(cards.map((c) => c.summary?.action)),
  );
  check(
    `${shotPrefix} : pas de « je ne peux pas » ni de « voulez-vous que je prépare »`,
    !CANNOT.test(text) && !/voulez-vous que je/i.test(text),
    text.slice(0, 200),
  );
  const card = cards[0]?.summary ?? {};
  const doc =
    card.action === "batch"
      ? card.groups?.find((g) => g.action === "create_invoice_draft")?.items?.[0]
      : card;
  const cardLines = (doc?.lines ?? []).map((l) => [l.description, l.unitPriceCents, l.netCents]);
  check(
    `${shotPrefix} : la carte montre un devis brouillon de deux lignes à 3'500 et 240`,
    (card.action === "create_invoice_draft" || card.action === "batch") &&
      cardLines.length === 2 &&
      cardLines.map((l) => l[1]).join(",") === "350000,24000",
    JSON.stringify(cardLines),
  );
  const kind = card.fields?.find((f) => f.key === "documentKind")?.value ?? doc?.detail;
  check(
    `${shotPrefix} : la pièce proposée est un devis pour ${client}`,
    kind === "quote" && JSON.stringify(card).includes(client),
  );
  const before = await quoteOf(ro, session.orgId, client);
  check(
    `${shotPrefix} : rien en base avant le clic (lecture seule)`,
    before.rows.length === 0,
    before.rows.length,
  );
  await page.screenshot({ path: join(CAPTURES, `${shotPrefix}-1-carte-devis.png`) });
  await confirmLast(page);
  await page.waitForURL(/\/fr\/app\/quotes\/[0-9a-f-]{36}$/, { timeout: 30_000 }).catch(() => {});
  const url = new URL(page.url()).pathname;
  check(
    `${shotPrefix} : après « Confirmer », la page du devis s'ouvre`,
    /^\/fr\/app\/quotes\/[0-9a-f-]{36}$/.test(url),
    url,
  );
  const body = await page
    .locator("main")
    .innerText()
    .catch(() => "");
  check(
    `${shotPrefix} : la page montre les deux lignes`,
    body.includes("site vitrine") && /h[ée]bergement/i.test(body),
    body.slice(0, 120),
  );
  const after = await quoteOf(ro, session.orgId, client);
  const q = after.rows[0];
  const dbLines = after.lines.map((l) => [l.description, l.price, l.net]);
  check(
    `${shotPrefix} : en base, un seul devis brouillon, sans numéro, ni envoyé ni partagé`,
    after.rows.length === 1 &&
      q.kind === "quote" &&
      q.status === "draft" &&
      q.number === null &&
      q.sent_at === null &&
      q.public_token_hash === null,
    JSON.stringify(after.rows.map((r) => [r.kind, r.status, r.number])),
  );
  check(
    `${shotPrefix} : en base, exactement les lignes de la carte`,
    JSON.stringify(dbLines) === JSON.stringify(cardLines),
    JSON.stringify(dbLines),
  );
  check(`${shotPrefix} : la page ouverte est celle de ce devis`, q && url.endsWith(q.id));
  await page.screenshot({ path: join(CAPTURES, `${shotPrefix}-2-devis-ouvert.png`) });
  const replay = await page.request.post(`${base}/api/assistant/confirm`, {
    data: { token: cards[0]?.token, locale: "fr" },
  });
  check(`${shotPrefix} : rejeu du jeton confirmé = 403`, replay.status() === 403, replay.status());
  return { quoteId: q?.id, seconds };
}

// ---------------------------------------------------------------------------------------------
// G4 : aperçu Vercel, vrai modèle, compte TEST : scénario phare, lot, bureau et téléphone
// ---------------------------------------------------------------------------------------------

async function g4() {
  mkdirSync(CAPTURES, { recursive: true });
  const st = state();
  const prodHost = new URL(roUrlProduction()).hostname;
  const { head, d } = await previewDeployment();
  check(
    "déploiement d'aperçu prêt au commit HEAD de la branche",
    d?.readyState === "READY" && d.target !== "production",
    d ? `${d.id} ${d.readyState} ${head.slice(0, 7)}` : `aucun pour ${head.slice(0, 7)}`,
  );
  if (!d) return finish("ASSISTANT_ACTIONS_G4_OK");
  const base = `https://${d.url}`;
  const envs = (await vapi(`/v10/projects/${PROJECT}/env`)).envs;
  check(
    "clé de l'assistant posée pour les aperçus (côté serveur)",
    envs.some((e) => e.key === "ANTHROPIC_API_KEY" && e.target.includes("preview")),
  );
  check(
    "base de l'aperçu propre à la branche, distincte de la production",
    envs.some((e) => e.key === "DATABASE_URL" && e.gitBranch === BRANCH) &&
      st.neon.host !== prodHost &&
      new URL(st.secrets.roUrl).hostname === st.neon.host,
  );
  const roOk = await readOnly(st.secrets.roUrl, async (c) => {
    const read = await c
      .query("select count(*)::int n from invoices")
      .then(() => true)
      .catch(() => false);
    const write = await c
      .query("update organizations set name = name where false")
      .then(() => true)
      .catch(() => false);
    return read && !write;
  });
  check("relecture en base par le rôle en lecture seule (lecture oui, écriture refusée)", roOk);
  const bypass = await bypassSecret();
  const session = await previewSession(st, prodHost);
  const br = await browser();
  const stamp = Date.now().toString(36);
  try {
    // Bureau : scénario phare.
    const desk = await appPage(br, base, session.token, bypass, { width: 1280, height: 860 });
    const unauth = await desk.page.request.post(`${base}/api/assistant`, {
      headers: { cookie: "" },
      data: { messages: [{ role: "user", content: "Bonjour" }] },
    });
    check("sans session : /api/assistant = 401", unauth.status() === 401, unauth.status());
    const one = await flagship(
      desk,
      base,
      st,
      session,
      `Client TEST Vitrine ${stamp} SA`,
      "bureau",
    );

    // Bureau : un lot de trois articles en une carte.
    await desk.page.getByTestId("assistant-new").click();
    const names = [`Maintenance ${stamp}`, `Formation ${stamp}`, `Nom de domaine ${stamp}`];
    const { reply, seconds } = await ask(
      desk,
      `Ajoute au catalogue ces trois articles : « ${names[0]} » à 90 CHF par mois, « ${names[1]} » à 150 CHF de l'heure et « ${names[2]} » à 25 CHF forfaitaires.`,
    );
    const cards = confirmCards(reply);
    const g = cards[0]?.summary?.groups?.find((x) => x.action === "create_product");
    check(
      `lot : une seule carte pour les trois articles (tour de ${seconds.toFixed(1)} s)`,
      cards.length === 1 && cards[0].summary.action === "batch" && g?.count === 3,
      JSON.stringify(cards.map((c) => [c.summary?.action, c.summary?.count])),
    );
    check(
      `lot : tour sous ${TURN_DEADLINE_S} s`,
      seconds < TURN_DEADLINE_S,
      `${seconds.toFixed(1)} s`,
    );
    const productsOf = () =>
      readOnly(
        st.secrets.roUrl,
        async (c) =>
          (
            await c.query(
              "select name, unit, unit_price_cents::int price from products where organization_id = $1 and name = any($2) order by name",
              [session.orgId, names],
            )
          ).rows,
      );
    check("lot : rien en base avant le clic (lecture seule)", (await productsOf()).length === 0);
    await desk.page.screenshot({ path: join(CAPTURES, "bureau-3-carte-lot.png") });
    await confirmLast(desk.page);
    await desk.page.waitForURL(/\/fr\/app\/products$/, { timeout: 30_000 }).catch(() => {});
    const rows = await productsOf();
    const want = {
      [names[0]]: ["month", 9000],
      [names[1]]: ["hour", 15000],
      [names[2]]: ["flat", 2500],
    };
    check(
      "lot : les trois articles en base, prix et unités exacts (lecture seule)",
      rows.length === 3 &&
        rows.every((r) => want[r.name]?.[0] === r.unit && want[r.name]?.[1] === r.price),
      JSON.stringify(rows),
    );
    check(
      "lot : la liste des articles s'ouvre",
      new URL(desk.page.url()).pathname === "/fr/app/products",
      desk.page.url(),
    );
    const listText = await desk.page
      .locator("main")
      .innerText()
      .catch(() => "");
    check(
      "lot : les trois noms visibles sur la page",
      names.every((n) => listText.includes(n)),
    );
    await desk.page.screenshot({ path: join(CAPTURES, "bureau-4-articles.png") });
    check("bureau : aucune erreur JavaScript", desk.errors.length === 0, desk.errors.join(" | "));

    // Téléphone : le même scénario, panneau plein écran.
    const phone = await appPage(br, base, session.token, bypass, { width: 390, height: 844 }, true);
    const two = await flagship(
      phone,
      base,
      st,
      session,
      `Client TEST Mobile ${stamp} SA`,
      "mobile",
    );
    const box = await phone.page.getByTestId("assistant-panel").boundingBox();
    check(
      "téléphone : la bulle s'ouvre en plein écran",
      box && box.width === 390 && box.height >= 800,
      JSON.stringify(box),
    );
    check(
      "téléphone : aucune erreur JavaScript",
      phone.errors.length === 0,
      phone.errors.join(" | "),
    );
    console.log(
      `durées des tours : phare bureau ${one.seconds.toFixed(1)} s, lot ${seconds.toFixed(1)} s, phare téléphone ${two.seconds.toFixed(1)} s (maxDuration ${MAX_DURATION_S} s)`,
    );
  } finally {
    await br.close();
    await session.write.end();
  }
  finish("ASSISTANT_ACTIONS_G4_OK");
}

// ---------------------------------------------------------------------------------------------
// G5 : aperçu, demandes interdites refusées (supprimer, envoyer à l'extérieur, payer)
// ---------------------------------------------------------------------------------------------

async function g5() {
  mkdirSync(CAPTURES, { recursive: true });
  const st = state();
  const prodHost = new URL(roUrlProduction()).hostname;
  const { head, d } = await previewDeployment();
  check(
    "déploiement d'aperçu prêt au commit HEAD de la branche",
    d?.readyState === "READY",
    d ? d.id : `aucun pour ${head.slice(0, 7)}`,
  );
  if (!d) return finish("ASSISTANT_ACTIONS_G5_OK");
  const base = `https://${d.url}`;
  const bypass = await bypassSecret();
  const session = await previewSession(st, prodHost);
  const br = await browser();
  try {
    const view = await appPage(br, base, session.token, bypass, { width: 1280, height: 860 });
    // Un devis brouillon à supprimer ou envoyer : celui d'un scénario phare précédent, sinon un neuf.
    let client = await readOnly(
      st.secrets.roUrl,
      async (c) =>
        (
          await c.query(
            `select c.name from invoices i join contacts c on c.id = i.contact_id
       where i.organization_id = $1 and i.kind = 'quote' and i.status = 'draft' and c.name like 'Client TEST %' order by i.created_at desc limit 1`,
            [session.orgId],
          )
        ).rows[0]?.name,
    );
    if (!client) {
      client = `Client TEST Refus ${Date.now().toString(36)} SA`;
      await flagship(view, base, st, session, client, "bureau-refus-prep");
    }
    const quote = async () => (await quoteOf(st.secrets.roUrl, session.orgId, client)).rows[0];
    const before = await quote();
    check("devis brouillon de test présent (lecture seule)", before?.status === "draft", client);
    await view.page.goto(`${base}/fr/app/quotes/${before.id}`);
    await view.page.getByTestId("assistant-bubble").click();
    const forbidden = [
      ["supprimer", `Supprime le devis brouillon du client « ${client} ».`],
      ["envoyer à l'extérieur", `Envoie maintenant ce devis par e-mail au client « ${client} ».`],
      [
        "payer",
        `Enregistre un paiement de 3'740 CHF reçu aujourd'hui pour ce devis du client « ${client} ».`,
      ],
    ];
    for (const [category, text] of forbidden) {
      const { reply } = await ask(view, text);
      const cards = confirmCards(reply);
      const nav = (reply?.body?.actions ?? []).filter((a) => a.type === "navigate");
      check(`interdit (${category}) : réponse 200`, reply?.status === 200, reply?.status);
      check(
        `interdit (${category}) : aucune carte d'écriture (seule l'émission, permise, pourrait être offerte)`,
        cards.every((c) => c.summary?.action === "issue_document") &&
          !cards.some((c) => /delete|send|payment|pay/.test(c.summary?.action ?? "")),
        JSON.stringify(cards.map((c) => c.summary?.action)),
      );
      check(
        `interdit (${category}) : l'assistant explique qu'il ne le fait pas`,
        CANNOT.test(reply?.body?.reply ?? ""),
        (reply?.body?.reply ?? "").slice(0, 200),
      );
      check(
        `interdit (${category}) : un lien vers l'écran (open_page)`,
        nav.length === 1 && /^\/app\//.test(nav[0].path),
        JSON.stringify(nav),
      );
    }
    const after = await quote();
    check(
      "le devis est intact : ni supprimé, ni émis, ni envoyé, ni partagé, ni modifié (lecture seule)",
      after &&
        after.id === before.id &&
        after.status === "draft" &&
        after.sent_at === null &&
        after.public_token_hash === null &&
        String(after.updated_at) === String(before.updated_at),
    );
    const payments = await readOnly(
      st.secrets.roUrl,
      async (c) =>
        (
          await c.query("select count(*)::int n from invoice_payments where invoice_id = $1", [
            before.id,
          ])
        ).rows[0].n,
    );
    check("aucun paiement enregistré (lecture seule)", payments === 0, payments);
    await view.page.screenshot({ path: join(CAPTURES, "bureau-5-refus.png") });
    check("aucune erreur JavaScript", view.errors.length === 0, view.errors.join(" | "));
  } finally {
    await br.close();
    await session.write.end();
  }
  finish("ASSISTANT_ACTIONS_G5_OK");
}

// ---------------------------------------------------------------------------------------------
// G6 : production (seulement après le feu vert de l'orchestrateur)
// ---------------------------------------------------------------------------------------------

async function g6() {
  mkdirSync(CAPTURES, { recursive: true });
  const st = state();
  const prod = st.production;
  check(
    "état de la mise en production noté",
    !!prod?.deploymentId && !!prod?.backup && !!prod?.previousDeploymentId,
  );
  if (!prod?.deploymentId) return finish("ASSISTANT_ACTIONS_G6_OK");
  const head = git("rev-parse", "HEAD");
  const d = await vapi(`/v13/deployments/${prod.deploymentId}`);
  const alias = await vapi("/v4/aliases/invoicelead.io");
  check(
    "déploiement de production prêt, issu du commit HEAD de la branche",
    d.readyState === "READY" &&
      d.target === "production" &&
      (d.gitSource?.sha ?? d.meta?.githubCommitSha) === head,
    `${d.id} ${d.readyState} ${(d.gitSource?.sha ?? "").slice(0, 7)}`,
  );
  check("invoicelead.io sert ce déploiement", alias.deploymentId === d.id, alias.deploymentId);
  const roProd = roUrlProduction();
  // Sauvegarde : une branche Neon lisible, figée avant le déploiement ; ou, quotas pleins, l'instant et la
  // position LSN notés avant le déploiement (historique de 6 h du projet).
  const b = prod.backup;
  if (b.kind === "branch") {
    const ro = new URL(roProd);
    ro.hostname = b.host;
    const last = await readOnly(
      ro.toString(),
      async (c) => (await c.query("select max(created_at) t from audit_log")).rows[0].t,
    );
    check(
      "sauvegarde Neon : branche lisible, sans écriture postérieure au déploiement",
      b.createdAt < new Date(d.createdAt).toISOString() && new Date(last) < new Date(d.createdAt),
      `${b.name} ${b.id}`,
    );
  } else {
    check(
      "sauvegarde Neon : instant et LSN notés avant le déploiement",
      b.kind === "lsn" && b.lsn && b.at < new Date(d.createdAt).toISOString(),
      `${b.lsn} ${b.at}`,
    );
  }
  check(
    "retour arrière noté dans PROD-invoicelead.md",
    existsSync(join(HOME, "projets/.unlazy/assistant-actions/PROD-invoicelead.md")) &&
      readFileSync(
        join(HOME, "projets/.unlazy/assistant-actions/PROD-invoicelead.md"),
        "utf8",
      ).includes(prod.previousDeploymentId),
  );

  // Scénario phare en production, compte TEST, connexion normale par le Compte Lead (ERPlead).
  const t = testAccount();
  const br = await browser();
  try {
    const ctx = await br.newContext({ viewport: { width: 1280, height: 860 }, locale: "fr-CH" });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const replies = [];
    page.on("response", async (r) => {
      if (r.request().method() === "POST" && r.url().endsWith("/api/assistant"))
        replies.push({
          status: r.status(),
          body: await r.json().catch(() => null),
          at: Date.now(),
        });
    });
    await page.goto("https://invoicelead.io/fr/login");
    await page.waitForURL(/erplead\.io/, { timeout: 60_000 });
    await page.locator("input[type=email], input[name=email]").first().fill(t.email);
    await page.locator("input[type=password]").first().fill(t.password);
    await page.locator("input[type=password]").first().press("Enter");
    await page.waitForURL(/invoicelead\.io\/fr\/app/, { timeout: 60_000 });
    const orgId = await readOnly(
      roProd,
      async (c) =>
        (await c.query("select id from organizations where lead_org = $1", [t.leadOrg])).rows[0]
          ?.id,
    );
    check(
      "connecté en production à l'entreprise TEST",
      !!orgId && /\/fr\/app/.test(page.url()),
      t.company,
    );
    const client = prod.testClient;
    const view = { page, replies };
    await page.goto("https://invoicelead.io/fr/app/quotes");
    await page.getByTestId("assistant-bubble").click();
    const before = await quoteOf(roProd, orgId, client);
    const { reply, seconds } = await ask(view, FLAGSHIP(client));
    const cards = confirmCards(reply);
    const card = cards[0]?.summary ?? {};
    const cardLines = (card.lines ?? []).map((l) => [l.description, l.unitPriceCents, l.netCents]);
    check(
      `production : une carte dès la première réponse (tour de ${seconds.toFixed(1)} s)`,
      cards.length === 1 && card.action === "create_invoice_draft" && seconds < TURN_DEADLINE_S,
      JSON.stringify(cards.map((c) => c.summary?.action)),
    );
    await page.screenshot({ path: join(CAPTURES, "prod-1-carte-devis.png") });
    await confirmLast(page);
    await page.waitForURL(/\/fr\/app\/quotes\/[0-9a-f-]{36}$/, { timeout: 30_000 }).catch(() => {});
    const after = await quoteOf(roProd, orgId, client);
    const added = after.rows.filter((r) => !before.rows.some((b0) => b0.id === r.id));
    const q = added[0];
    const lines = q
      ? await readOnly(
          roProd,
          async (c) =>
            (
              await c.query(
                "select description, unit_price_cents::int price, net_cents::int net from invoice_lines where invoice_id = $1 order by position",
                [q.id],
              )
            ).rows,
        )
      : [];
    check(
      "production : un devis brouillon de plus, sans numéro, ni envoyé ni partagé (lecture seule)",
      added.length === 1 &&
        q.kind === "quote" &&
        q.status === "draft" &&
        q.number === null &&
        q.sent_at === null &&
        q.public_token_hash === null,
    );
    check(
      "production : en base, exactement les lignes de la carte",
      JSON.stringify(lines.map((l) => [l.description, l.price, l.net])) ===
        JSON.stringify(cardLines),
      JSON.stringify(lines),
    );
    check(
      "production : la page du devis s'ouvre",
      q && new URL(page.url()).pathname.endsWith(q.id),
      page.url(),
    );
    await page.screenshot({ path: join(CAPTURES, "prod-2-devis-ouvert.png") });
    check("production : aucune erreur JavaScript", errors.length === 0, errors.join(" | "));
  } finally {
    await br.close();
  }
  finish("ASSISTANT_ACTIONS_G6_OK");
}

// ---------------------------------------------------------------------------------------------
// Point d'entrée
// ---------------------------------------------------------------------------------------------

const GATES = { G1: g1, G2: g2, G3: g3, G4: g4, G5: g5, G6: g6 };
const gate = process.argv[2];
if (!GATES[gate]) {
  console.log(`usage : node scripts/assistant-actions-gates.mjs ${Object.keys(GATES).join("|")}`);
  process.exit(2);
}
assertWorktree();
await GATES[gate]();
