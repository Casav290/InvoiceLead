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
const NEON_PROJECT = "tiny-shape-39858234";
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
    for (const m of read(f).matchAll(/^export async function (\w+)/gm)) out.push({ file: f, name: m[1] });
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
    for (const m of read(f).matchAll(/export const (\w+) = defineOp\(\{\s*id: "(\w+)"/g)) ids.set(m[1], m[2]);
  const ops = read("src/server/ai-assistant/operations.ts");
  const block = ops.slice(ops.indexOf("export const OPERATIONS"), ops.indexOf("] as Operation[]"));
  const names = [...block.matchAll(/^\s+(\w+Op),$/gm)].map((m) => m[1]);
  return { ids: names.map((n) => ids.get(n)).filter(Boolean), unknown: names.filter((n) => !ids.has(n)) };
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
    if (!line.startsWith("|") || /^\|\s*-/.test(line) || /^\|\s*(Écran|Demande)\s*\|/.test(line)) continue;
    const cells = line.split("|").slice(1, -1).map((c) => c.trim());
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
  if (forbidden) return CATEGORIES.includes(forbidden[1]) ? { kind: "forbidden", category: forbidden[1] } : { kind: "error", why: `catégorie inconnue « ${forbidden[1]} »` };
  const screen = /^écran : (\w+)$/.exec(assistant);
  if (screen) return SCREEN_ONLY.includes(screen[1]) ? { kind: "screen", why: screen[1] } : { kind: "error", why: `écran « ${screen[1]} »` };
  if (assistant === "lecture") return { kind: "read" };
  return { kind: "error", why: `disposition illisible « ${assistant} »` };
}

/** Couverture : chaque action et route a sa ligne, chaque ligne une disposition valide. */
function coverage(doc, actions, routes, registered) {
  const problems = [];
  const rows = inventoryRows(doc);
  const cited = new Set(rows.flatMap((r) => r.fns));
  for (const a of actions) if (!cited.has(a.name)) problems.push(`action ${a.name} (${a.file}) absente`);
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
  for (const t of registered) if (!tools.has(t)) problems.push(`outil ${t} sans ligne dans l'inventaire`);
  return { problems, rows };
}

function vitestJson(files, db, label, extra = []) {
  migrateLocal(db);
  const out = join(TMP, `${label}.json`);
  const res = sh("npx", ["vitest", "run", ...files, "--reporter=json", `--outputFile=${out}`, ...extra], {
    env: { ...process.env, TEST_DATABASE_URL: LOCAL_PG(db) },
    timeout: 1_800_000,
  });
  if (!existsSync(out)) return { ok: false, tests: [], log: `${res.stdout}\n${res.stderr}`.slice(-2000) };
  const report = JSON.parse(readFileSync(out, "utf8"));
  const tests = report.testResults.flatMap((f) =>
    f.assertionResults.map((a) => ({ name: [...a.ancestorTitles, a.title].join(" > "), status: a.status })),
  );
  return { ok: res.status === 0, tests, failedFiles: report.testResults.filter((f) => f.status !== "passed").map((f) => relative(ROOT, f.name)) };
}

/** Base locale dédiée à une porte (créée au besoin), migrée comme en CI. */
function migrateLocal(db) {
  if (!/^invoicelead_actions_\w+$/.test(db)) throw new Error(`base ${db}`);
  const exists = sh("psql", [LOCAL_PG("postgres"), "-Atc", `select 1 from pg_database where datname = '${db}'`]);
  if (exists.stdout.trim() !== "1") {
    const created = sh("psql", [LOCAL_PG("postgres"), "-c", `create database ${db}`]);
    if (created.status !== 0) throw new Error(`création de ${db} : ${created.stderr.slice(0, 200)}`);
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
  check("routes d'écriture appelées par les écrans relevées", routes.length >= 3, routes.join(", "));
  const reg = registeredOperations();
  check("registre lisible (chaque opération listée a son identifiant)", reg.unknown.length === 0 && reg.ids.length >= 30, `${reg.ids.length} opérations${reg.unknown.length ? `, inconnues : ${reg.unknown}` : ""}`);
  const registered = new Set([...reg.ids.map((id) => `propose_${id}`), "propose_batch"]);
  const { problems, rows } = coverage(doc, actions, routes, registered);
  check("chaque action et route des écrans a sa ligne, chaque ligne une disposition valide, chaque outil sa ligne", problems.length === 0, problems.slice(0, 8).join(" ; ") || `${rows.length} lignes`);
  const allowed = rows.filter((r) => disposition(r.assistant).kind === "tool");
  check("chaque ligne permise pointe vers un outil propose_* enregistré", allowed.every((r) => disposition(r.assistant).tools.every((t) => registered.has(t))), `${allowed.length} lignes permises`);

  // Contrôles positifs : le même contrôle échoue sur un inventaire amputé ou faussé.
  const firstAction = actions.find((a) => a.name === "saveContact");
  const amputated = doc.split("\n").filter((l) => !l.includes("`saveContact`")).join("\n");
  check("contrôle positif : une action retirée de l'inventaire est détectée", firstAction && coverage(amputated, actions, routes, registered).problems.some((p) => p.includes("saveContact")));
  const invented = doc.replace("interdit : supprimer (l'archivage", "interdit : archiver (l'archivage");
  check("contrôle positif : une catégorie d'interdit inventée est refusée", coverage(invented, actions, routes, registered).problems.some((p) => p.includes("archiver")));
  const unknownTool = doc.replace("`propose_create_contact`", "`propose_create_kontakt`");
  check("contrôle positif : un outil inconnu du registre est refusé", coverage(unknownTool, actions, routes, registered).problems.some((p) => p.includes("propose_create_kontakt")));

  // Les outils réellement donnés au modèle (buildTools) = registre = inventaire (test Vitest).
  const v = vitestJson(["tests/unit/assistant-actions.test.ts"], "invoicelead_actions_g1", "g1", ["-t", "inventaire|chaque opération du registre"]);
  const wanted = ["nomme chaque outil propose_* donné au modèle", "chaque opération du registre a sa scène"];
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
    check(`${id} : proposition sans écriture, autres 403, confirmation exacte, rejeu 403`, passed(`> ${id} : proposition sans écriture`));
  const named = [
    ["lecture par l'IA : proposition sans lecture, lecture au clic", "propose sans lire, lit au clic"],
    ["scénario phare : carte exacte, brouillon de devis écrit au clic, rien envoyé", "la carte montre les lignes et le total exacts"],
    ["lot : proposition sans écriture puis tout écrit au clic (clés locales)", "nouveau client + son devis + un article"],
    ["lot : échec au milieu à la confirmation, rien d'écrit", "échec au milieu du lot à la confirmation"],
    ["lot : échec au milieu à la proposition, rien d'écrit", "échec au milieu du lot à la proposition"],
    ["lot : référence vers une opération plus loin refusée", "une référence vers une opération plus loin"],
    ["lot : plafond de 150 opérations", "plafond : 150 opérations"],
    ["lot : clés en double, mauvais type, lecture IA refusées", "refuse les clés en double"],
    ["lot : droit retiré avant le clic = 403, jeton gardé", "un lot dont une opération n'est plus permise"],
    ["droits : lecture seule", "lecture seule : aucune proposition"],
    ["droits : comptabilité seule", "comptabilité seule"],
    ["CRMlead : rien envoyé à la proposition, envoyé après validation", "rien en file ni envoyé à la proposition"],
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
  check("aucun test de l'assistant en échec ou sauté", v.ok && failed.length === 0 && v.tests.length >= 60, `${v.tests.length} tests, ${failed.length} non passés${failed.length ? ` : ${failed.slice(0, 3).map((t) => t.name).join(" | ")}` : ""}`);
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
      else if (st.size < 20_000_000 && KEY.test(readFileSync(p, "latin1"))) hits.push(relative(ROOT, p));
    }
  };
  walk(dir);
  return hits;
}

async function g3() {
  const log = (name, res) => writeFileSync(join(TMP, `g3-${name}.log`), `${res.stdout ?? ""}\n${res.stderr ?? ""}`);
  const step = (name, cmd, args, opts = {}) => {
    const res = sh(cmd, args, { timeout: 3_600_000, ...opts });
    log(name, res);
    return res;
  };
  const biome = step("biome", "npx", ["biome", "ci", "."]);
  check("Biome (lint et format, comme la CI)", biome.status === 0, biome.status === 0 ? "" : `${biome.stdout}`.slice(-300));
  const tsc = step("tsc", "npx", ["tsc", "--noEmit"]);
  check("TypeScript", tsc.status === 0, `${tsc.stdout}`.slice(0, 300));
  const v = vitestJson([], "invoicelead_actions_g3", "g3-vitest");
  const failed = v.tests.filter((t) => t.status !== "passed");
  check("Vitest complet", v.ok && failed.length === 0 && v.tests.length > 500, `${v.tests.length} tests, ${failed.length} non passés ${failed.slice(0, 3).map((t) => t.name).join(" | ")}`);
  const build = step("build", "npx", ["next", "build"], { env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" } });
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
  check("Playwright complet (bulle, audit Trait net, écrans)", e2e.status === 0 && !failedE2e, `${summary ?? 0} passés${failedE2e ? `, ${failedE2e} en échec` : ""}`);

  // Clés : contrôle positif d'abord (le balayage trouve une clé plantée), puis le code livré.
  const planted = join(TMP, "temoin-cle");
  mkdirSync(planted, { recursive: true });
  writeFileSync(join(planted, "chunk.js"), `const k="sk-ant-api03-${randomBytes(24).toString("hex")}";`);
  check("contrôle positif : le balayage trouve une clé plantée", scanKeys(planted).length === 1);
  check("aucune clé d'Anthropic dans le code livré au navigateur (.next/static)", existsSync(join(ROOT, ".next/static")) && scanKeys(join(ROOT, ".next/static")).length === 0);
  const tracked = git("ls-files").split("\n").filter((f) => f && existsSync(join(ROOT, f)) && !f.endsWith(".png"));
  const trackedHits = tracked.filter((f) => KEY.test(readFileSync(join(ROOT, f), "latin1")));
  check("aucune clé dans les fichiers du dépôt", trackedHits.length === 0, trackedHits.join(", "));
  const history = sh("git", ["log", "-p", `${PROD_BASE}..HEAD`]);
  check("aucune clé dans l'historique de la branche", history.status === 0 && !KEY.test(history.stdout), `depuis ${PROD_BASE.slice(0, 7)}`);
  const clientFiles = filesUnder("src", (f) => /\.(ts|tsx)$/.test(f)).filter((f) => /^\s*["']use client["']/m.test(read(f)));
  const readers = filesUnder("src", (f) => /\.(ts|tsx)$/.test(f)).filter((f) => read(f).includes("ANTHROPIC_API_KEY"));
  check("la clé n'est lue que côté serveur", readers.length > 0 && readers.every((f) => f.startsWith("src/server/") && !clientFiles.includes(f)), readers.join(", "));
  finish("ASSISTANT_ACTIONS_G3_OK");
}

// ---------------------------------------------------------------------------------------------
// Point d'entrée
// ---------------------------------------------------------------------------------------------

const GATES = { G1: g1, G2: g2, G3: g3 };
const gate = process.argv[2];
if (!GATES[gate]) {
  console.log(`usage : node scripts/assistant-actions-gates.mjs ${Object.keys(GATES).join("|")}`);
  process.exit(2);
}
assertWorktree();
await GATES[gate]();
