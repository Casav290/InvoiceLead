#!/usr/bin/env node
/**
 * Portes du chantier « gratuit-invoicelead » (ledger ~/projets/.unlazy/gratuit-invoicelead/GATES.md).
 *
 * Demande d'Ève du 29.10.2026 : « en mode gratuit, limite 10 lectures de justificatifs par mois et
 * 5 factures par mois ». Formule gratuite d'InvoiceLead : 5 factures émises par mois (avant 10) et
 * 10 lectures de pièces par l'IA par mois (avant 20) ; rien d'autre ne change.
 *
 *   node scripts/free-limits-gates.mjs G1   code : PLANS (Gratuit 5 et 10, Pro et Pro+ comme en
 *                                           production) et tests des formules et des barrières
 *   node scripts/free-limits-gates.mjs G2   plus aucun ancien chiffre dans InvoiceLead (5 langues,
 *                                           docs, consigne de l'assistant) ni dans ERPlead ;
 *                                           contre-épreuve sur la production 682bd09 / 1d44f1f
 *   node scripts/free-limits-gates.mjs G3   contrôles complets : InvoiceLead (Biome, types, Vitest,
 *                                           build, Playwright) et ERPlead (types, build, Vitest)
 *   node scripts/free-limits-gates.mjs G4   aperçus Vercel : tarifs et FAQ d'InvoiceLead en 5 langues,
 *                                           accueil d'ERPlead en 5 langues, entreprise TEST gratuite
 *                                           de la base d'APERÇU : compteur « x sur 5 », 6e facture
 *                                           refusée avec l'offre Pro ; captures
 *   node scripts/free-limits-gates.mjs G5   production (après la mise en ligne seulement) : lecture
 *                                           seule de invoicelead.io et erplead.io, PROD.md
 *
 * À lancer à la racine du worktree ~/projets/invoicelead-gratuit (branche gratuit-5-10) ; ERPlead
 * est lu dans ~/projets/erplead-gratuit-5-10 (branche gratuit-5-10). Chaque porte n'imprime son
 * jeton FREE_LIMITS_Gn_OK qu'après toutes ses assertions. Aucun secret n'est affiché : les adresses
 * de base, le jeton du CLI Vercel et le secret de contournement de la protection des aperçus sont
 * lus en mémoire seulement (~/.invoicelead-actions-ia.json en 600, ~/.lead-e2e-ro.env, auth du CLI).
 *
 * Écritures : G4 n'écrit que dans la base d'APERÇU d'InvoiceLead (branche Neon du chantier
 * assistant-actions, vérifiée différente de la production avant toute écriture), pour une entreprise
 * TEST ; l'aperçu d'ERPlead, qui lit la base de production, n'est que lu (GET de l'accueil). G5 ne
 * fait que des lectures.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join, relative } from "node:path";
import { isDeepStrictEqual } from "node:util";

const ROOT = process.cwd();
const HOME = homedir();
const require = createRequire(join(ROOT, "package.json"));
const BRANCH = "gratuit-5-10";
const ERP = join(HOME, "projets", "erplead-gratuit-5-10");
/** Production au départ (relue par l'API Vercel le 29.10.2026 avant de créer les worktrees). */
const IL_PROD = "682bd09a8136e6dc069171641996e01901da3b11";
const ERP_PROD = "1d44f1f5ea2828e3b71275c8dc865c6dd9bc7d95";
const IL_PROD_DPL = "dpl_HUALHm8mQiqNpYpKzGRRJL1Yitw3";
const ERP_PROD_DPL = "dpl_GMJR1pgtDshuunsz3ARsiX4q2hFh";
const TEAM = "team_mRhlABdvm1jvEPoDzuDDgpon";
const IL_PROJECT = "prj_BGHqP1Lyg3MWz3KoDYQ9qms5Epll";
const ERP_PROJECT = "prj_ZIWBlmDtMeoPupyeG103XenXAXdV";
const LEDGER_DIR = join(HOME, "projets", ".unlazy", "gratuit-invoicelead");
const CAPTURES = join(LEDGER_DIR, "captures");
const STATE_FILE = join(HOME, ".invoicelead-actions-ia.json");
const LOCALES = ["fr", "de", "en", "it", "es"];
const TMP = join(ROOT, "tmp", "free-limits-gates");
const LOCAL_PG = (db) => `postgresql://ubuntu@localhost/${db}?host=/var/run/postgresql`;
/**
 * Entreprises TEST gratuites de la base d'aperçu (banc lead-e2e, « abonnement par app »), dans
 * l'ordre : G4 prend la première qui n'a pas encore émis 5 factures ce mois, pour rejouer tout le
 * parcours (compteur de 0 à 5, puis la 6e) ; si toutes sont à 5, seule la 6e est rejouée.
 */
const TEST_ORGS = [
  "TEST Par app ProjectLead seul",
  "TEST Par app CRMlead + ProjectLead",
  "TEST Par app ScanLead seul",
];

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok: !!ok });
  const d = detail === "" ? "" : ` : ${String(detail).slice(0, 500)}`;
  console.log(`${ok ? "OK " : "NON"} ${name}${d}`);
  return !!ok;
}
const note = (text) => console.log(`    ${text}`);
function finish(token) {
  const bad = results.filter((r) => !r.ok);
  console.log(`${results.length - bad.length} verts, ${bad.length} rouges`);
  if (bad.length > 0 || results.length === 0) process.exit(1);
  console.log(token);
}

const sh = (cmd, args, opts = {}) =>
  spawnSync(cmd, args, { cwd: ROOT, encoding: "utf8", maxBuffer: 512 * 1024 * 1024, ...opts });
const gitIn = (dir, ...args) =>
  execFileSync("git", args, { cwd: dir, encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).trim();
const git = (...args) => gitIn(ROOT, ...args);
/** JSON lisible : l'infini (sans limite) s'écrit « ∞ » au lieu de null. */
const show = (v) => JSON.stringify(v, (_k, x) => (x === Infinity ? "∞" : x));
const isAncestor = (dir, a, b) =>
  spawnSync("git", ["merge-base", "--is-ancestor", a, b], { cwd: dir }).status === 0;
mkdirSync(TMP, { recursive: true });

/** Les deux worktrees, sur leur branche, partis de la production. Rend les deux HEAD. */
function worktrees() {
  const ilTop = git("rev-parse", "--show-toplevel");
  const ilBranch = git("branch", "--show-current");
  if (ilTop !== ROOT || ilBranch !== BRANCH) {
    console.log(
      `NON à lancer à la racine du worktree InvoiceLead, branche ${BRANCH} (ici ${ROOT}, ${ilBranch})`,
    );
    process.exit(1);
  }
  const erpBranch = existsSync(ERP) ? gitIn(ERP, "branch", "--show-current") : "";
  if (erpBranch !== BRANCH) {
    console.log(`NON worktree ERPlead ${ERP} absent ou pas sur ${BRANCH} (${erpBranch})`);
    process.exit(1);
  }
  const il = git("rev-parse", "HEAD");
  const erp = gitIn(ERP, "rev-parse", "HEAD");
  console.log(`InvoiceLead ${il.slice(0, 7)} (${BRANCH}), ERPlead ${erp.slice(0, 7)} (${BRANCH})`);
  check(
    "les deux branches partent de la production (682bd09 et 1d44f1f en sont des ancêtres)",
    isAncestor(ROOT, IL_PROD, il) && isAncestor(ERP, ERP_PROD, erp),
  );
  return { il, erp };
}

/** Fichiers modifiés ou non suivis (hors fichiers ignorés) : la preuve doit porter sur un commit. */
function dirty(dir) {
  return gitIn(dir, "status", "--porcelain").split("\n").filter(Boolean);
}

// ---------------------------------------------------------------------------------------------
// Lecture des formules (src/server/plans.ts) d'une version donnée
// ---------------------------------------------------------------------------------------------

/**
 * Le littéral `PLANS` du fichier, évalué sans rien importer : commentaires retirés, seuls des noms,
 * nombres, deux-points, virgules et accolades permis (aucun appel, aucune chaîne), UNLIMITED = ∞.
 */
function plansOf(source) {
  const head = "export const PLANS: Record<Tier, Plan> = ";
  const start = source.indexOf(head);
  if (start < 0) throw new Error("PLANS introuvable");
  const open = start + head.length;
  if (source[open] !== "{") throw new Error("PLANS : accolade attendue");
  let depth = 0;
  let end = open;
  for (; end < source.length; end++) {
    if (source[end] === "{") depth++;
    else if (source[end] === "}" && --depth === 0) break;
  }
  const literal = source.slice(open, end + 1).replace(/\/\/[^\n]*/g, "");
  if (!/^[\s\w:{},]*$/.test(literal)) throw new Error("PLANS : littéral inattendu");
  return Function(`"use strict"; const UNLIMITED = Infinity; return (${literal});`)();
}

// ---------------------------------------------------------------------------------------------
// Vitest (base locale dédiée, migrée comme en CI)
// ---------------------------------------------------------------------------------------------

function migrateLocal(db) {
  if (!/^invoicelead_gratuit_\w+$/.test(db)) throw new Error(`base ${db}`);
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

function vitestJson(dir, files, env, label) {
  const out = join(TMP, `${label}.json`);
  const res = sh("npx", ["vitest", "run", ...files, "--reporter=json", `--outputFile=${out}`], {
    cwd: dir,
    env: { ...process.env, ...env },
    timeout: 3_600_000,
  });
  writeFileSync(join(TMP, `${label}.log`), `${res.stdout ?? ""}\n${res.stderr ?? ""}`);
  if (!existsSync(out) || statSync(out).mtimeMs < Date.now() - 4_000_000)
    return { ok: false, tests: [], report: null, why: `${res.stderr ?? ""}`.slice(-1500) };
  const report = JSON.parse(readFileSync(out, "utf8"));
  const tests = report.testResults.flatMap((f) =>
    f.assertionResults.map((a) => ({
      name: [...a.ancestorTitles, a.title].join(" > "),
      file: relative(dir, f.name),
      title: a.title,
      status: a.status,
      failure: (a.failureMessages ?? []).join(" ").split("\n")[0],
    })),
  );
  return {
    ok: res.status === 0 && report.success,
    tests,
    report,
    why: res.status === 0 ? "" : `code ${res.status}`,
  };
}

// ---------------------------------------------------------------------------------------------
// G1 : le code applique 5 factures et 10 lectures en Gratuit, Pro et Pro+ inchangés
// ---------------------------------------------------------------------------------------------

async function g1() {
  worktrees();
  const now = plansOf(git("show", "HEAD:src/server/plans.ts"));
  const before = plansOf(git("show", `${IL_PROD}:src/server/plans.ts`));
  // Contre-épreuve : la lecture distingue bien les deux versions (production : 10 et 20).
  check(
    "contre-épreuve : la production 682bd09 donne 10 factures et 20 lectures en Gratuit",
    before.free.quotas.invoices === 10 && before.free.quotas.aiReads === 20,
    JSON.stringify(before.free.quotas),
  );
  check(
    "Gratuit : 5 factures émises par mois",
    now.free.quotas.invoices === 5,
    now.free.quotas.invoices,
  );
  check(
    "Gratuit : 10 lectures de pièces par l'IA par mois",
    now.free.quotas.aiReads === 10,
    now.free.quotas.aiReads,
  );
  const others = (p) => {
    const { invoices: _i, aiReads: _a, ...rest } = p.quotas;
    return { ...p, quotas: rest };
  };
  check(
    "Gratuit : toutes les autres allocations, les places et la mention inchangées",
    isDeepStrictEqual(others(now.free), others(before.free)),
    JSON.stringify(others(now.free)),
  );
  check("Pro identique à la production", isDeepStrictEqual(now.pro, before.pro), show(now.pro));
  check(
    "Pro+ identique à la production",
    isDeepStrictEqual(now.proplus, before.proplus),
    show(now.proplus),
  );
  check(
    "mêmes formules et mêmes allocations qu'en production",
    isDeepStrictEqual(Object.keys(now), Object.keys(before)) &&
      isDeepStrictEqual(Object.keys(now.free.quotas), Object.keys(before.free.quotas)),
  );

  const db = "invoicelead_gratuit_g1";
  migrateLocal(db);
  const files = [
    "tests/unit/plans.test.ts",
    "tests/unit/plan-gates.test.ts",
    "tests/unit/plan-actions.test.ts",
    "tests/unit/bills.test.ts",
    "tests/unit/api-plan-limit.test.ts",
    "tests/unit/messages.test.ts",
  ];
  const v = vitestJson(ROOT, files, { TEST_DATABASE_URL: LOCAL_PG(db) }, "g1-vitest");
  const failed = v.tests.filter((t) => t.status !== "passed");
  check(
    `tests des formules et des barrières verts (${files.length} fichiers)`,
    v.ok && v.tests.length >= 80 && failed.length === 0,
    `${v.tests.length} tests, ${failed.length} non passés ${failed
      .slice(0, 3)
      .map((t) => `${t.name} : ${t.failure}`)
      .join(" | ")} ${v.why}`,
  );
  // Les tests qui portent la décision : chacun présent et vert.
  const required = [
    [
      /allocations du 1er octobre 2026, factures et lectures révisées le 29\.10\.2026/,
      "PLANS : Gratuit 5 et 10, Pro et Pro+ exacts",
    ],
    [
      /la 6e facture est refusée, devis et avoirs passent/,
      "6e facture du mois refusée (issueInvoice, « planLimit »), brouillon intact",
    ],
    [
      /deux émissions simultanées à 4 sur 5 n'en laissent passer qu'une/,
      "deux émissions simultanées à 4 sur 5 : une seule passe",
    ],
    [/403 plan_limit pour la 6e facture du mois/, "API : 6e facture → 403 plan_limit"],
    [
      /laisse en brouillon la facture du jour quand les 5 factures du mois sont émises/,
      "récurrence : 6e facture laissée en brouillon",
    ],
    [
      /lectures de pièces : 10 en Gratuit \(la 11e refusée\)/,
      "compteur des lectures : 10, la 11e refusée",
    ],
    [
      /comptent chaque lecture et relecture, refusent la 11e/,
      "lecture d'un justificatif : la 11e refusée sans appel à l'IA",
    ],
    [
      /la 10e lecture passe, la 11e photo est refusée/,
      "facture fournisseur en photo : la 11e refusée",
    ],
    [
      /au-delà des 10 lectures, un dépôt forgé est refusé/,
      "dépôt forgé au-delà de 10 lectures refusé",
    ],
    [/« Scanner un ticket » au-delà des 10 lectures/, "ticket au-delà de 10 lectures refusé"],
  ];
  for (const [re, label] of required) {
    const t = v.tests.filter((x) => re.test(x.name));
    check(
      `test présent et vert : ${label}`,
      t.length === 1 && t[0].status === "passed",
      t.map((x) => `${x.file} › ${x.status}`).join(", "),
    );
  }
  for (const l of LOCALES) {
    const t = v.tests.find((x) => x.title === `reprennent les chiffres de PLANS (${l})`);
    check(
      `tarifs et FAQ (${l}) reprennent les chiffres de PLANS`,
      t?.status === "passed",
      t?.status ?? "absent",
    );
  }
  finish("FREE_LIMITS_G1_OK");
}

// ---------------------------------------------------------------------------------------------
// G2 : plus aucun ancien chiffre, contre-épreuve sur la production
// ---------------------------------------------------------------------------------------------

/**
 * Les anciens chiffres de la formule gratuite, dans les cinq langues, en chiffres et en lettres, et
 * dans le code (PLANS, commentaires, tests). Chaque motif vise la formule gratuite d'InvoiceLead :
 * « 10 questions » (assistant, inchangé) ou « 10 jours » n'y répondent pas.
 */
const OLD = [
  ["fr : 10 factures", /\b(10|dix) factures\b(?! récurrentes)/i],
  ["fr : 20 pièces / lectures / justificatifs", /\b(20|vingt) (pièces|lectures|justificatifs)\b/i],
  ["fr : (Gratuit 20)", /\bGratuit 20\b/],
  ["de : 10 Rechnungen", /\b(10|zehn) Rechnungen\b/i],
  [
    "de : 20 Belege / Beleglesungen",
    /\b(20|zwanzig) (von der KI gelesene Belege|Beleglesungen|Belege)\b/i,
  ],
  ["en : 10 invoices", /\b(10|ten) invoices\b/i],
  [
    "en : 20 documents / receipt scans / reads",
    /\b(20|twenty) (documents read|receipt scans|reads|receipts)\b/i,
  ],
  ["it : 10 fatture", /\b(10|dieci) fatture\b/i],
  ["it : 20 documenti / letture", /\b(20|venti) (documenti letti|letture)\b/i],
  ["es : 10 facturas", /\b(10|diez) facturas\b/i],
  ["es : 20 documentos / lecturas", /\b(20|veinte) (documentos leídos|lecturas)\b/i],
  ["code : invoices: 10", /\binvoices: 10\b/],
  ["code : aiReads: 20", /\baiReads: 20\b/],
  ["tests : compteur « sur 20 »", /\b\d+ sur 20\b/],
  [
    "tests : 21e lecture / 11e facture / 9 sur 10",
    /\b21e\b|\b11e facture|\bKunde 11\b|\b9 sur 10\b/,
  ],
];
const TEXT_FILE = /\.(ts|tsx|mts|mjs|js|json|md|css|html|txt|ya?ml|sql)$/;
/** Ce script cite les anciens motifs pour les chercher : il est le seul fichier écarté du balayage. */
const SELF = "scripts/free-limits-gates.mjs";

/** Contenu de fichiers d'une révision git, lus d'un coup (git cat-file --batch). */
function filesAt(dir, rev) {
  const names = gitIn(dir, "ls-tree", "-r", "--name-only", rev)
    .split("\n")
    .filter((f) => TEXT_FILE.test(f) && !f.endsWith("package-lock.json") && f !== SELF);
  const res = spawnSync("git", ["cat-file", "--batch"], {
    cwd: dir,
    input: `${names.map((n) => `${rev}:${n}`).join("\n")}\n`,
    maxBuffer: 1024 * 1024 * 1024,
  });
  const buf = res.stdout;
  const out = new Map();
  let at = 0;
  for (const name of names) {
    const nl = buf.indexOf(10, at);
    const header = buf.subarray(at, nl).toString("utf8").split(" ");
    const size = Number(header[2]);
    out.set(name, buf.subarray(nl + 1, nl + 1 + size).toString("utf8"));
    at = nl + 1 + size + 1;
  }
  return out;
}

function scan(files) {
  const hits = [];
  for (const [file, text] of files) {
    const lines = text.split("\n");
    lines.forEach((line, i) => {
      for (const [label, re] of OLD)
        if (re.test(line)) hits.push({ file, line: i + 1, label, text: line.trim() });
    });
  }
  return hits;
}

/** Une note datée de la révision (docs/PLAN.md, ligne qui porte « 29.10.2026 ») cite l'ancien chiffre comme passé. */
const datedNote = (h) => h.file === "docs/PLAN.md" && h.text.includes("29.10.2026");
const numbers = (text) => (text.match(/\d+/g) ?? []).map(Number);
const flatJson = (o, p = "") =>
  typeof o === "object" && o !== null
    ? Object.entries(o).flatMap(([k, v]) => flatJson(v, p ? `${p}.${k}` : k))
    : [[p, o]];

async function g2() {
  const { il, erp } = worktrees();
  check(
    "InvoiceLead : arbre propre (la recherche porte sur le commit)",
    dirty(ROOT).length === 0,
    dirty(ROOT).join(", "),
  );
  check(
    "ERPlead : arbre propre (la recherche porte sur le commit)",
    dirty(ERP).length === 0,
    dirty(ERP).join(", "),
  );

  // Contre-épreuve d'abord : le même balayage trouve l'ancien texte dans la production.
  const ilOld = scan(filesAt(ROOT, IL_PROD));
  const erpOld = scan(filesAt(ERP, ERP_PROD));
  const at = (hits, file) => hits.filter((h) => h.file === file);
  for (const l of LOCALES)
    check(
      `contre-épreuve : messages/${l}.json de 682bd09 cite l'ancienne formule (tarifs et FAQ)`,
      at(ilOld, `messages/${l}.json`).length >= 3,
      at(ilOld, `messages/${l}.json`)
        .map((h) => `${h.line} ${h.label}`)
        .join(" ; "),
    );
  check(
    "contre-épreuve : src/server/plans.ts de 682bd09 (10 factures, 20 lectures)",
    at(ilOld, "src/server/plans.ts").length >= 2,
  );
  check("contre-épreuve : docs/PLAN.md de 682bd09", at(ilOld, "docs/PLAN.md").length >= 2);
  check(
    "contre-épreuve : tests de 682bd09",
    ilOld.filter((h) => h.file.startsWith("tests/")).length >= 10,
  );
  check(
    "contre-épreuve : src/landingText.ts d'ERPlead 1d44f1f (5 langues, carte et tableau)",
    at(erpOld, "src/landingText.ts").length === 10,
    at(erpOld, "src/landingText.ts").length,
  );
  note(`production : ${ilOld.length} lignes dans InvoiceLead, ${erpOld.length} dans ERPlead`);

  // La branche : plus rien, sauf les notes datées de la révision dans docs/PLAN.md (nommées ici).
  const ilFiles = filesAt(ROOT, il);
  const ilHits = scan(ilFiles);
  const erpHits = scan(filesAt(ERP, erp));
  const notes = ilHits.filter(datedNote);
  for (const n of notes) note(`note datée gardée : docs/PLAN.md:${n.line} (${n.label})`);
  const noteLines = new Set(notes.map((n) => n.line));
  check(
    "au plus deux lignes datées du 29.10.2026 dans docs/PLAN.md (révision de la section 9, journal des lots)",
    noteLines.size <= 2,
    [...noteLines].join(", "),
  );
  const left = ilHits.filter((h) => !datedNote(h));
  check(
    `InvoiceLead (${ilFiles.size} fichiers : textes des 5 langues, src, docs, tests, consigne de l'assistant) : aucun ancien chiffre`,
    left.length === 0,
    left
      .slice(0, 8)
      .map((h) => `${h.file}:${h.line} ${h.label}`)
      .join(" | "),
  );
  check(
    "ERPlead : aucun ancien chiffre",
    erpHits.length === 0,
    erpHits
      .slice(0, 8)
      .map((h) => `${h.file}:${h.line} ${h.label}`)
      .join(" | "),
  );

  // Les nouveaux chiffres sont là, et rien d'autre n'a changé dans les textes.
  for (const l of LOCALES) {
    const now = JSON.parse(ilFiles.get(`messages/${l}.json`));
    const old = JSON.parse(git("show", `${IL_PROD}:messages/${l}.json`));
    const f = now.pricing.plans.free.features;
    const faq = now.faq.items[7]?.a ?? "";
    check(
      `${l} : tarifs « ${f[1]} » et « ${f[5].slice(0, 40)}… »`,
      numbers(f[1])[0] === 5 && numbers(f[5])[0] === 10,
    );
    check(
      `${l} : FAQ « que comprend la formule gratuite » = 5, 10, 10, 5, 1, 50, 1`,
      isDeepStrictEqual(numbers(faq), [5, 10, 10, 5, 1, 50, 1]),
      numbers(faq).join(", "),
    );
    const a = new Map(flatJson(old));
    const b = new Map(flatJson(now));
    const changed = [...new Set([...a.keys(), ...b.keys()])].filter((k) => a.get(k) !== b.get(k));
    check(
      `${l} : seuls ces trois textes changent (Pro, Pro+ et le reste identiques à la production)`,
      isDeepStrictEqual(changed.sort(), [
        "faq.items.7.a",
        "pricing.plans.free.features.1",
        "pricing.plans.free.features.5",
      ]),
      changed.join(", "),
    );
  }
  // Consigne de l'assistant : elle ne cite aucun chiffre de formule (les limites viennent de l'écran).
  const prompt = ilFiles.get("src/server/ai-assistant/prompt.ts") ?? "";
  const planLine = prompt.split("\n").find((x) => /Free plan limits/.test(x)) ?? "";
  check(
    "consigne de l'assistant : la phrase sur la formule gratuite ne cite aucun chiffre",
    planLine !== "" && !/\d/.test(planLine.replace(/^.*?Free plan/, "")),
    planLine.slice(-140),
  );
  // ERPlead : les deux endroits, dans les cinq langues, par son test, et un diff limité à eux.
  const erpDiff = gitIn(ERP, "diff", "-U0", ERP_PROD, erp, "--", "src/landingText.ts")
    .split("\n")
    .filter((x) => /^[-+](?![-+])/.test(x));
  check(
    "ERPlead : src/landingText.ts ne change que la ligne gratuite d'InvoiceLead (carte et tableau, 5 langues)",
    erpDiff.length === 20 && erpDiff.every((x) => /^[-+]\s*il(_free)?: /.test(x)),
    erpDiff.filter((x) => !/^[-+]\s*il(_free)?: /.test(x)).join(" | "),
  );
  const t = vitestJson(ERP, ["tests/invoicelead-gratuit.test.ts"], {}, "g2-erplead");
  check(
    "ERPlead : tests/invoicelead-gratuit.test.ts vert (10 lectures dans les 5 langues, aucun « 20 »)",
    t.ok && t.tests.length === 2 && t.tests.every((x) => x.status === "passed"),
    t.tests.map((x) => `${x.title} ${x.status}`).join(" | ") || t.why,
  );
  // Aucun changement de base : ni migration InvoiceLead, ni migration ERPlead.
  const ilChanged = git("diff", "--name-only", IL_PROD, il).split("\n").filter(Boolean);
  const erpChanged = gitIn(ERP, "diff", "--name-only", ERP_PROD, erp).split("\n").filter(Boolean);
  note(`InvoiceLead : ${ilChanged.length} fichiers changés ; ERPlead : ${erpChanged.join(", ")}`);
  check(
    "aucune migration ni dépendance changée (drizzle/, db/, package*.json)",
    !ilChanged.some((f) => /^drizzle\/|^package(-lock)?\.json$/.test(f)) &&
      !erpChanged.some((f) => /^db\/|^package(-lock)?\.json$/.test(f)),
  );
  finish("FREE_LIMITS_G2_OK");
}

// ---------------------------------------------------------------------------------------------
// G3 : contrôles complets des deux applications
// ---------------------------------------------------------------------------------------------

async function g3() {
  worktrees();
  check(
    "InvoiceLead : arbre propre avant les contrôles",
    dirty(ROOT).length === 0,
    dirty(ROOT).join(", "),
  );
  check(
    "ERPlead : arbre propre avant les contrôles",
    dirty(ERP).length === 0,
    dirty(ERP).join(", "),
  );
  const step = (dir, name, cmd, args, opts = {}) => {
    const res = sh(cmd, args, { cwd: dir, timeout: 5_400_000, ...opts });
    writeFileSync(join(TMP, `g3-${name}.log`), `${res.stdout ?? ""}\n${res.stderr ?? ""}`);
    return res;
  };
  // InvoiceLead
  const biome = step(ROOT, "biome", "npx", ["biome", "ci", "."]);
  check(
    "InvoiceLead : Biome (lint et format, comme la CI)",
    biome.status === 0,
    `${biome.stdout}${biome.stderr}`.slice(-300),
  );
  const tsc = step(ROOT, "tsc", "npx", ["tsc", "--noEmit"]);
  check("InvoiceLead : TypeScript", tsc.status === 0, `${tsc.stdout}`.slice(0, 300));
  migrateLocal("invoicelead_gratuit_g3");
  const v = vitestJson(
    ROOT,
    [],
    { TEST_DATABASE_URL: LOCAL_PG("invoicelead_gratuit_g3") },
    "g3-vitest",
  );
  const failed = v.tests.filter((t) => t.status !== "passed");
  check(
    "InvoiceLead : Vitest complet",
    v.ok && failed.length === 0 && v.tests.length >= 565,
    `${v.tests.length} tests, ${failed.length} non passés ${failed
      .slice(0, 3)
      .map((t) => t.name)
      .join(" | ")} ${v.why}`,
  );
  const i18n = v.tests.filter((t) =>
    /tests\/unit\/(messages|cinq-langues)\.test\.ts$/.test(t.file),
  );
  check(
    "InvoiceLead : i18n (mêmes clés et variables dans les 5 langues, PDF dans chaque langue)",
    i18n.length >= 10 && i18n.every((t) => t.status === "passed"),
    `${i18n.length} tests`,
  );
  const build = step(ROOT, "build", "npx", ["next", "build"], {
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
  });
  check(
    "InvoiceLead : build Next",
    build.status === 0,
    build.status === 0 ? "" : `${build.stdout}`.slice(-400),
  );
  migrateLocal("invoicelead_gratuit_e2e");
  const e2e = step(ROOT, "e2e", "npx", ["playwright", "test"], {
    env: {
      ...process.env,
      E2E_APP_PORT: "3172",
      E2E_LEAD_PORT: "4072",
      E2E_DATABASE_URL: LOCAL_PG("invoicelead_gratuit_e2e"),
      NEXT_TELEMETRY_DISABLED: "1",
    },
  });
  const passed = /(\d+) passed/.exec(e2e.stdout)?.[1];
  const failedE2e = /(\d+) failed/.exec(e2e.stdout)?.[1];
  check(
    "InvoiceLead : Playwright complet (dont la 6e facture refusée à l'écran et par le serveur)",
    e2e.status === 0 && !failedE2e && Number(passed) > 0,
    `${passed ?? 0} passés${failedE2e ? `, ${failedE2e} en échec` : ""}`,
  );
  check(
    "InvoiceLead : le test « cinq factures émises par mois » a tourné",
    /cinq factures émises par mois, la sixième reste en brouillon/.test(e2e.stdout) &&
      !/✘[^\n]*cinq factures émises par mois/.test(e2e.stdout),
  );

  // ERPlead
  const erpTsc = step(ERP, "erp-tsc", "npx", ["tsc", "--noEmit"]);
  check("ERPlead : types (tsc --noEmit)", erpTsc.status === 0, `${erpTsc.stdout}`.slice(0, 300));
  const erpBuild = step(ERP, "erp-build", "npm", ["run", "-s", "build"]);
  check(
    "ERPlead : build (npm run build)",
    erpBuild.status === 0,
    `${erpBuild.stdout}`.slice(0, 300),
  );
  const erpDb = {
    TEST_DATABASE_URL: "postgres://il_test:il_test@localhost:5432/erplead_test_gratuit",
  };
  const full = vitestJson(ERP, [], erpDb, "g3-erplead");
  const TIMING = /^temps constant/;
  const erpFailed = full.tests.filter((t) => t.status !== "passed" && t.status !== "pending");
  const others = erpFailed.filter((t) => !TIMING.test(t.title));
  check(
    `ERPlead : suite complète (${full.tests.length} tests), aucun échec hors tests de temps constant`,
    full.report &&
      others.length === 0 &&
      full.tests.length >= 290 &&
      full.report.numPendingTests === 0,
    others.map((t) => `${t.file} › ${t.title} : ${t.failure}`).join(" | ") || full.why,
  );
  // Les tests de temps constant (écart moyen < 20 %) dépendent de la charge : leur fichier est rejoué en entier.
  for (const file of [
    ...new Set(erpFailed.filter((t) => TIMING.test(t.title)).map((t) => t.file)),
  ]) {
    let ok = false;
    for (let i = 1; i <= 3 && !ok; i++) {
      const again = vitestJson(ERP, [file], erpDb, `g3-erplead-timing-${i}`);
      ok = again.ok && again.tests.length >= 10 && again.tests.every((t) => t.status === "passed");
      note(`fichier rejoué (${i}/3) : ${file} → ${ok ? "vert" : "rouge"}`);
    }
    check(`ERPlead : fichier du test de temps constant rejoué en entier et vert : ${file}`, ok);
  }
  check(
    "ERPlead : le test de l'accueil (formule gratuite d'InvoiceLead) est dans la suite et vert",
    full.tests.filter(
      (t) => t.file === "tests/invoicelead-gratuit.test.ts" && t.status === "passed",
    ).length === 2,
  );
  finish("FREE_LIMITS_G3_OK");
}

// ---------------------------------------------------------------------------------------------
// Vercel, bases, navigateur (G4 et G5)
// ---------------------------------------------------------------------------------------------

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
/** Secret d'automatisation de la protection des aperçus d'un projet (en mémoire seulement). */
async function bypassSecret(project) {
  const p = await vapi(`/v9/projects/${project}`);
  return (
    Object.keys(p.protectionBypass ?? {}).find(
      (k) => p.protectionBypass[k].scope === "automation-bypass",
    ) ?? null
  );
}
const shaOf = (d) => d.meta?.githubCommitSha ?? d.meta?.gitCommitSha ?? null;

/** Le déploiement d'aperçu prêt d'un projet, construit exactement depuis `sha` (arbre propre). */
async function previewAt(project, sha) {
  const list = await vapi(`/v6/deployments?projectId=${project}&limit=100`);
  const d = list.deployments.find(
    (x) =>
      shaOf(x) === sha &&
      x.target !== "production" &&
      x.meta?.gitDirty !== "1" &&
      (x.readyState ?? x.state) === "READY",
  );
  return d ? vapi(`/v13/deployments/${d.uid}`) : null;
}

function state() {
  if (!existsSync(STATE_FILE)) throw new Error(`${STATE_FILE} absent`);
  const mode = statSync(STATE_FILE).mode & 0o777;
  if (mode !== 0o600) throw new Error(`${STATE_FILE} doit être en 600 (ici ${mode.toString(8)})`);
  return JSON.parse(readFileSync(STATE_FILE, "utf8"));
}
/** Hôte de la base de PRODUCTION d'InvoiceLead (rôle en lecture seule du banc) : jamais écrite ici. */
function prodDbHost() {
  const line = readFileSync(join(HOME, ".lead-e2e-ro.env"), "utf8")
    .split("\n")
    .find((l) => l.startsWith("INVOICELEAD_RO_URL="));
  if (!line) throw new Error("INVOICELEAD_RO_URL absent de ~/.lead-e2e-ro.env");
  return new URL(line.slice("INVOICELEAD_RO_URL=".length)).hostname;
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

const clean = (s) => String(s).replace(/[  ]/g, " ").replace(/\s+/g, " ").trim();
const decode = (html) =>
  html
    .replace(/&#x27;|&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
/** Les textes de la formule gratuite (tarifs : lignes 2 et 6 ; FAQ : réponse 8) d'une version. */
function freeTexts(messages) {
  const f = messages.pricing.plans.free.features;
  return { invoices: f[1], reads: f[5], faq: messages.faq.items[7].a };
}
function erpFreeText(rev, l) {
  const src = gitIn(ERP, "show", `${rev}:src/landingText.ts`);
  // Le bloc de chaque langue commence par « const <l> = { » (fr) ou « const <l>: LandingText = { ».
  const start = src.search(new RegExp(`^const ${l}(: LandingText)? = \\{`, "m"));
  if (start < 0) throw new Error(`bloc ${l} introuvable`);
  const block = src.slice(start);
  const m = /il_free: '([^']+)'/.exec(block);
  if (!m) throw new Error(`il_free ${l}`);
  return m[1];
}

async function browser() {
  const { chromium } = require("@playwright/test");
  return chromium.launch();
}
const headersFor = (bypass) =>
  bypass
    ? { "x-vercel-protection-bypass": bypass, "x-vercel-set-bypass-cookie": "samesitenone" }
    : {};

// ---------------------------------------------------------------------------------------------
// G4 : aperçus
// ---------------------------------------------------------------------------------------------

async function g4() {
  const { il, erp } = worktrees();
  mkdirSync(CAPTURES, { recursive: true });
  const ilD = await previewAt(IL_PROJECT, il);
  const erpD = await previewAt(ERP_PROJECT, erp);
  check(
    "InvoiceLead : déploiement d'aperçu prêt, construit depuis le HEAD de la branche",
    ilD?.readyState === "READY",
    ilD ? `${ilD.id} (branche Git ${ilD.meta?.githubCommitRef})` : "absent",
  );
  check(
    "ERPlead : déploiement d'aperçu prêt, construit depuis le HEAD de la branche (arbre propre)",
    erpD?.readyState === "READY",
    erpD ? erpD.id : "absent",
  );
  if (!ilD || !erpD) return finish("FREE_LIMITS_G4_OK");
  check(
    "aucun des deux n'est la production",
    ilD.target !== "production" && erpD.target !== "production",
  );
  const ilBase = `https://${ilD.url}`;
  const erpBase = `https://${erpD.url}`;
  note(`aperçus : ${ilBase} ; ${erpBase}`);

  // Base de l'aperçu d'InvoiceLead : la branche Neon du chantier, jamais la production.
  const st = state();
  const prodHost = prodDbHost();
  const envs = (await vapi(`/v10/projects/${IL_PROJECT}/env`)).envs;
  const branchDb = envs.some(
    (e) => e.key === "DATABASE_URL" && e.gitBranch === ilD.meta?.githubCommitRef,
  );
  check(
    "InvoiceLead : la branche Git de l'aperçu a sa propre base (DATABASE_URL de branche) ; base d'aperçu ≠ production",
    branchDb &&
      st.gitBranch === ilD.meta?.githubCommitRef &&
      st.neon.host !== prodHost &&
      new URL(st.secrets.databaseUrlUnpooled).hostname === st.neon.host &&
      new URL(st.secrets.roUrl).hostname === st.neon.host,
    `branche ${ilD.meta?.githubCommitRef}, base ${st.neon.branchId}`,
  );

  const now = {};
  const old = {};
  for (const l of LOCALES) {
    now[l] = freeTexts(JSON.parse(git("show", `${il}:messages/${l}.json`)));
    old[l] = freeTexts(JSON.parse(git("show", `${IL_PROD}:messages/${l}.json`)));
  }
  const ilBypass = await bypassSecret(IL_PROJECT);
  const erpBypass = await bypassSecret(ERP_PROJECT);
  const br = await browser();
  try {
    // Tarifs et FAQ d'InvoiceLead, cinq langues.
    const ctx = await br.newContext({
      viewport: { width: 1280, height: 900 },
      extraHTTPHeaders: headersFor(ilBypass),
    });
    const page = await ctx.newPage();
    for (const l of LOCALES) {
      const r = await page.goto(`${ilBase}/${l}/pricing`, { waitUntil: "networkidle" });
      const card = clean(await page.getByTestId("plan-free").innerText());
      const body = clean(await page.locator("body").innerText());
      check(
        `InvoiceLead ${l}/pricing : « ${clean(now[l].invoices)} » et « ${clean(now[l].reads).slice(0, 36)}… », plus l'ancien texte`,
        r?.status() === 200 &&
          card.includes(clean(now[l].invoices)) &&
          card.includes(clean(now[l].reads)) &&
          !body.includes(clean(old[l].invoices)) &&
          !body.includes(clean(old[l].reads)),
        r?.status(),
      );
      await page
        .getByTestId("plan-free")
        .screenshot({ path: join(CAPTURES, `invoicelead-tarifs-${l}.png`) });
      const f = await page.goto(`${ilBase}/${l}/faq`, { waitUntil: "networkidle" });
      const faq = clean(await page.locator("body").textContent());
      check(
        `InvoiceLead ${l}/faq : la réponse « formule gratuite » dit 5 factures et 10 lectures`,
        f?.status() === 200 && faq.includes(clean(now[l].faq)) && !faq.includes(clean(old[l].faq)),
      );
    }
    await ctx.close();

    // Accueil d'ERPlead, cinq langues : lecture seule (l'aperçu lit la base de production).
    const ectx = await br.newContext({
      viewport: { width: 1280, height: 900 },
      extraHTTPHeaders: headersFor(erpBypass),
    });
    const epage = await ectx.newPage();
    const posts = [];
    epage.on("request", (q) => {
      if (q.method() !== "GET" && q.method() !== "HEAD") posts.push(`${q.method()} ${q.url()}`);
    });
    for (const l of LOCALES) {
      const want = erpFreeText(erp, l);
      const was = erpFreeText(ERP_PROD, l);
      const r = await epage.goto(`${erpBase}/?locale=${l}`, { waitUntil: "networkidle" });
      const html = decode(await epage.content());
      const shown = html.split(want).length - 1;
      check(
        `ERPlead /?locale=${l} : « ${want} » (carte et tableau), plus « ${was} »`,
        r?.status() === 200 &&
          shown === 2 &&
          !html.includes(was) &&
          (await epage.locator("html").getAttribute("lang")) === l,
        `${r?.status()}, ${shown} fois`,
      );
      await epage.screenshot({ path: join(CAPTURES, `erplead-accueil-${l}.png`), fullPage: true });
    }
    check(
      "ERPlead : aucune requête autre que GET envoyée à l'aperçu (aucune écriture)",
      posts.length === 0,
      posts.join(", "),
    );
    await ectx.close();

    // Entreprise TEST gratuite, base d'APERÇU : compteur, 5 émissions, 6e refusée avec l'offre Pro.
    await freeCompanyScenario(br, ilBase, ilBypass, st, prodHost);
  } finally {
    await br.close();
  }
  finish("FREE_LIMITS_G4_OK");
}

/** Factures émises ce mois (UTC) par l'entreprise, lues avec le rôle en lecture seule de l'aperçu. */
async function issuedThisMonth(roUrl, orgId) {
  return readOnly(roUrl, async (c) =>
    Number(
      (
        await c.query(
          `select count(*)::int n from invoices where organization_id = $1 and kind = 'invoice'
             and status = 'issued' and issued_at >= date_trunc('month', now() at time zone 'utc') at time zone 'utc'`,
          [orgId],
        )
      ).rows[0].n,
    ),
  );
}

async function freeCompanyScenario(br, base, bypass, st, prodHost) {
  const writeUrl = st.secrets.databaseUrlUnpooled;
  if (new URL(writeUrl).hostname !== st.neon.host || st.neon.host === prodHost)
    throw new Error("la base d'écriture n'est pas celle de l'aperçu");
  const w = await pgClient(writeUrl);
  let sessionId = null;
  try {
    const orgs = (
      await w.query(
        `select id, name, lead_plan, entitlements->'plan'->>'code' code, billing_plan
           from organizations where name = any($1::text[])`,
        [TEST_ORGS],
      )
    ).rows.sort((a, b) => TEST_ORGS.indexOf(a.name) - TEST_ORGS.indexOf(b.name));
    let org = orgs[0];
    for (const o of orgs)
      if ((await issuedThisMonth(st.secrets.roUrl, o.id)) < 5) {
        org = o;
        break;
      }
    const user = org
      ? (
          await w.query(
            `select u.id from users u join memberships m on m.user_id = u.id
              where m.organization_id = $1 and m.removed_at is null and m.role = 'admin' order by m.created_at limit 1`,
            [org.id],
          )
        ).rows[0]
      : null;
    check(
      `entreprise TEST « ${org?.name} » de la base d'aperçu, en formule gratuite, avec son administrateur`,
      org && user && org.code === "free" && !org.billing_plan,
      org ? `${org.lead_plan} / ${org.code}` : "absente",
    );
    if (!org || !user) return;
    const token = randomBytes(32).toString("base64url");
    sessionId = createHash("sha256").update(token).digest("hex");
    await w.query(
      `insert into sessions (id, user_id, organization_id, id_token, expires_at) values ($1, $2, $3, null, now() + interval '2 hours')`,
      [sessionId, user.id, org.id],
    );
    const ctx = await br.newContext({
      viewport: { width: 1280, height: 900 },
      locale: "fr-CH",
      extraHTTPHeaders: headersFor(bypass),
    });
    await ctx.addCookies([
      {
        name: "il_session",
        value: token,
        domain: new URL(base).hostname,
        path: "/",
        secure: true,
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);
    const page = await ctx.newPage();
    page.setDefaultTimeout(60_000);
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const usage = async () => {
      await page.goto(`${base}/fr/app`);
      return clean(await page.getByTestId("plan-usage").innerText());
    };
    const counter = (n) => new RegExp(`Formule gratuite : ${n} factures? sur 5 ce mois-ci`);

    const n0 = await issuedThisMonth(st.secrets.roUrl, org.id);
    check("au départ : 5 factures émises ce mois au plus", n0 <= 5, n0);
    const first = await usage();
    check(`tableau de bord : compteur « ${n0} sur 5 » au départ`, counter(n0).test(first), first);
    const reads = clean(await page.getByTestId("quota-aiReads").innerText());
    check(
      "tableau de bord : « Pièces lues par l'IA : x sur 10 ce mois-ci »",
      /Pièces lues par l'IA : \d+ sur 10 ce mois-ci/.test(reads),
      reads,
    );
    await page.screenshot({ path: join(CAPTURES, `invoicelead-apercu-compteur-${n0}-sur-5.png`) });

    // Réglages de l'entreprise (une émission les exige) et un client d'essai, par les écrans.
    await page.goto(`${base}/fr/app/settings/company`);
    const company = page.getByTestId("company-form");
    await company.getByLabel("Raison sociale").fill(`${org.name} Sàrl`);
    await company.getByLabel("Forme juridique").selectOption("gmbh");
    await company.getByLabel("Rue").fill("Rue du Test");
    await company.getByLabel("Numéro", { exact: true }).fill("5");
    await company.getByLabel("NPA").fill("1204");
    await company.getByLabel("Localité").fill("Genève");
    await company.getByLabel("IBAN", { exact: true }).fill("CH93 0076 2011 6238 5295 7");
    await page.getByTestId("company-save").click();
    await page.getByText("Réglages enregistrés.").waitFor();
    const client = `TEST Client gratuit ${Date.now()}`;
    await page.goto(`${base}/fr/app/contacts/new`);
    await page.getByTestId("contact-form").getByLabel("Nom ou raison sociale").fill(client);
    await page.getByTestId("contact-save").click();
    await page.waitForURL(/\/fr\/app\/contacts\?saved=1$/);

    const draft = async (i) => {
      await page.goto(`${base}/fr/app/invoices/new`);
      await page
        .getByTestId("invoice-form")
        .getByLabel("Client", { exact: true })
        .selectOption({ label: client });
      const line = page.getByTestId("invoice-line-0");
      await line.getByLabel("Désignation").fill(`Prestation d'essai ${i}`);
      await line.getByLabel(/Prix unitaire/).fill("100");
      await page.getByTestId("invoice-save").click();
      await page.waitForURL(/\/fr\/app\/invoices\/[0-9a-f-]{36}\?saved=1$/);
      return new URL(page.url()).pathname.split("/").pop();
    };
    for (let i = n0 + 1; i <= 5; i++) {
      await draft(i);
      const lockBefore = await page.getByTestId("issue-lock").count();
      await page.getByTestId("document-issue").click();
      await page.waitForURL(/\?issued=1$/);
      const status = clean(await page.getByTestId("document-status").innerText());
      const text = await usage();
      check(
        `facture ${i} : « Émettre » ouvert, facture émise, compteur « ${i} sur 5 »`,
        lockBefore === 0 && status === "Émise" && counter(i).test(text),
        `${status} ; ${text}`,
      );
    }
    await page.screenshot({ path: join(CAPTURES, "invoicelead-apercu-compteur-5-sur-5.png") });
    const full = await usage();
    const upgrade = page.getByTestId("plan-usage").getByRole("link", { name: "Passer à Pro" });
    check(
      "tableau de bord : « 5 factures sur 5 ce mois-ci », marque Pro et lien « Passer à Pro »",
      counter(5).test(full) &&
        (await page.getByTestId("plan-usage").getByTestId("pro-badge").innerText()) === "Pro" &&
        (await upgrade.getAttribute("href")) === "/fr/app/settings/plan?plan=pro",
      full,
    );

    // La 6e : brouillon enregistré, « Émettre » grisé avec la marque Pro, la phrase et l'offre.
    const sixth = await draft(6);
    const lock = page.getByTestId("issue-lock");
    const lockText = clean(await lock.innerText());
    const offer = lock.getByRole("link", { name: "Passer à Pro" });
    check(
      "6e facture : « Émettre » grisé, marque Pro, « Vos 5 factures gratuites de ce mois sont émises. », lien vers l'offre Pro",
      (await lock.locator("fieldset").first().getAttribute("aria-disabled")) === "true" &&
        (await page.getByTestId("document-issue").isDisabled()) &&
        (await lock.getByTestId("pro-badge").last().innerText()) === "Pro" &&
        lockText.includes("Vos 5 factures gratuites de ce mois sont émises.") &&
        (await offer.getAttribute("href")) === "/fr/app/settings/plan?plan=pro",
      lockText,
    );
    await page.screenshot({ path: join(CAPTURES, "invoicelead-apercu-6e-facture-grisee.png") });
    // Demande forgée : le bouton réactivé dans la page envoie quand même ; le serveur refuse.
    await lock
      .locator("fieldset")
      .first()
      .evaluate((f) => {
        f.removeAttribute("disabled");
        f.removeAttribute("aria-disabled");
      });
    await page.getByTestId("document-issue").click();
    await page.waitForURL(/error=planLimit/);
    const alert = clean(await page.getByRole("alert").first().innerText());
    check(
      "6e facture forcée : refusée par le serveur (« Vous avez atteint les 5 factures du mois… Passez à Pro… »), reste en brouillon",
      alert.includes(
        "Vous avez atteint les 5 factures du mois de la formule gratuite. Passez à Pro pour facturer sans limite.",
      ) && clean(await page.getByTestId("document-status").innerText()) === "Brouillon",
      alert,
    );
    await page.screenshot({ path: join(CAPTURES, "invoicelead-apercu-6e-facture-refusee.png") });
    // L'offre de mise à niveau : la page Formule, Pro présélectionné (rien n'est cliqué ni payé).
    const plan = await page.goto(`${base}/fr/app/settings/plan?plan=pro`);
    const planText = clean(await page.locator("main").innerText());
    check(
      "l'offre : la page Formule s'ouvre et propose Pro (aucun clic, aucun paiement)",
      plan?.status() === 200 && /Pro/.test(planText) && /Gratuit/.test(planText),
      planText.slice(0, 160),
    );
    await page.screenshot({ path: join(CAPTURES, "invoicelead-apercu-offre-pro.png") });

    // La base de l'aperçu relue avec le rôle en lecture seule : 5 émises, la 6e brouillon sans numéro.
    const n = await issuedThisMonth(st.secrets.roUrl, org.id);
    const row = await readOnly(
      st.secrets.roUrl,
      async (c) =>
        (
          await c.query(
            "select status, number, kind from invoices where id = $1 and organization_id = $2",
            [sixth, org.id],
          )
        ).rows[0],
    );
    check(
      "base d'aperçu (lecture seule) : 5 factures émises ce mois, la 6e en brouillon sans numéro",
      n === 5 && row?.status === "draft" && row?.number === null && row?.kind === "invoice",
      `${n} émises ; 6e ${JSON.stringify(row)}`,
    );
    check("aucune erreur JavaScript dans les pages", errors.length === 0, errors.join(" | "));
    await ctx.close();
  } finally {
    if (sessionId) await w.query("delete from sessions where id = $1", [sessionId]).catch(() => {});
    await w.end();
  }
}

// ---------------------------------------------------------------------------------------------
// G5 : production (lecture seule ; seulement après la mise en ligne par l'orchestrateur)
// ---------------------------------------------------------------------------------------------

async function g5() {
  const { il, erp } = worktrees();
  const ilP = (await vapi(`/v9/projects/${IL_PROJECT}`)).targets?.production;
  const erpP = (await vapi(`/v9/projects/${ERP_PROJECT}`)).targets?.production;
  const ilSha = shaOf(ilP ?? {});
  const erpSha = shaOf(erpP ?? {});
  check(
    "InvoiceLead : la production contient le HEAD de la branche (et n'est plus 682bd09)",
    ilP?.readyState === "READY" && ilSha && ilSha !== IL_PROD && isAncestor(ROOT, il, ilSha),
    `${ilP?.id} ${ilSha?.slice(0, 7)}`,
  );
  check(
    "ERPlead : la production contient le HEAD de la branche (arbre propre)",
    erpP?.readyState === "READY" &&
      erpSha &&
      erpSha !== ERP_PROD &&
      erpP.meta?.gitDirty !== "1" &&
      isAncestor(ERP, erp, erpSha),
    `${erpP?.id} ${erpSha?.slice(0, 7)}`,
  );
  for (const l of LOCALES) {
    const now = freeTexts(JSON.parse(git("show", `${il}:messages/${l}.json`)));
    const old = freeTexts(JSON.parse(git("show", `${IL_PROD}:messages/${l}.json`)));
    const pricing = clean(
      decode(await (await fetch(`https://invoicelead.io/${l}/pricing`)).text()),
    );
    check(
      `invoicelead.io/${l}/pricing : nouveaux chiffres, plus l'ancien texte`,
      pricing.includes(clean(now.invoices)) &&
        pricing.includes(clean(now.reads)) &&
        !pricing.includes(clean(old.invoices)) &&
        !pricing.includes(clean(old.reads)),
    );
    const faq = clean(decode(await (await fetch(`https://invoicelead.io/${l}/faq`)).text()));
    check(
      `invoicelead.io/${l}/faq : nouvelle réponse, plus l'ancienne`,
      faq.includes(clean(now.faq)) && !faq.includes(clean(old.faq)),
    );
    const home = decode(await (await fetch(`https://erplead.io/?locale=${l}`)).text());
    const want = erpFreeText(erp, l);
    const was = erpFreeText(ERP_PROD, l);
    check(
      `erplead.io/?locale=${l} : « ${want} » deux fois, plus « ${was} »`,
      home.split(want).length - 1 === 2 && !home.includes(was),
    );
  }
  const prodMd = join(LEDGER_DIR, "PROD.md");
  const text = existsSync(prodMd) ? readFileSync(prodMd, "utf8") : "";
  check(
    "PROD.md : retour arrière noté (déploiements d'avant à promouvoir) et déploiements nouveaux nommés",
    /retour arrière/i.test(text) &&
      text.includes(IL_PROD_DPL) &&
      text.includes(ERP_PROD_DPL) &&
      !!ilP?.id &&
      text.includes(ilP.id) &&
      !!erpP?.id &&
      text.includes(erpP.id),
    existsSync(prodMd) ? "" : "absent",
  );
  finish("FREE_LIMITS_G5_OK");
}

const gates = { G1: g1, G2: g2, G3: g3, G4: g4, G5: g5 };
const which = process.argv[2];
if (!gates[which]) {
  console.log("usage : node scripts/free-limits-gates.mjs G1|G2|G3|G4|G5");
  process.exit(2);
}
gates[which]().catch((e) => {
  console.log(`NON erreur : ${e?.message ?? e}`);
  process.exit(1);
});
