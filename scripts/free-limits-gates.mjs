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
 *                                           créée pour le passage dans la base d'APERÇU : compteur
 *                                           « x sur 5 », 6e facture refusée avec l'offre Pro ;
 *                                           entreprises du banc intactes ; branche GitHub
 *                                           assistant-actions remise en place ; captures
 *   node scripts/free-limits-gates.mjs AVANT   juste avant la mise en ligne, par qui met en ligne
 *                                           (lecture seule) : la production est contenue dans les deux
 *                                           branches (bon dossier ERPlead : erplead-gratuit-5-10),
 *                                           assistant-actions sans le chantier, aucune entreprise
 *                                           gratuite hors TEST déjà au-delà de 5 factures ou 10
 *                                           lectures ce mois-ci (base de production en lecture
 *                                           seule ; --apercu : essai sur la base d'aperçu, sans jeton)
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
 * et une personne TEST qu'elle crée à chaque passage (« TEST Gratuit G4 … », test+g4gratuit@…) et
 * qui y restent ; elle ne touche plus aux entreprises du banc. L'aperçu d'ERPlead, qui lit la base
 * de production, n'est que lu (GET de l'accueil). AVANT et G5 ne font que des lectures.
 *
 * Un aperçu d'InvoiceLead pour un nouveau HEAD : pousser HEAD sur la branche GitHub assistant-actions
 * (seule à avoir la base d'aperçu), attendre l'aperçu prêt, puis remettre assistant-actions sur la
 * production (git push --force-with-lease=assistant-actions:<HEAD> origin 682bd09:assistant-actions)
 * avant G4, qui le vérifie.
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
 * Entreprises TEST gratuites du banc lead-e2e (« abonnement par app ») dans la base d'aperçu. G4 n'y
 * écrit plus (relecture du 29.10.2026 : ses deux premiers passages y avaient réécrit les réglages et
 * émis 5 factures) : elle les relit avant et après pour prouver qu'elles sont intactes, et copie la
 * formule gratuite (droits du Compte Lead) de « ScanLead seul » sur l'entreprise qu'elle crée.
 */
const TEST_ORGS = [
  "TEST Par app ProjectLead seul",
  "TEST Par app CRMlead + ProjectLead",
  "TEST Par app ScanLead seul",
];
/** Entreprise et personne TEST créées par chaque passage de G4 dans la base d'aperçu (jamais ailleurs). */
const G4_ORG_PREFIX = "TEST Gratuit G4";
const G4_EMAIL = "test+g4gratuit@scanlead.io";
/** Branche GitHub qui porte la base d'aperçu ; remise sur la production après chaque aperçu. */
const PREVIEW_BRANCH = "assistant-actions";

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
 * Les anciens chiffres de la formule gratuite, dans les cinq langues, en chiffres et en lettres,
 * déclinés (« 20 Belegen »), en compteur (« 3 sur 20 », « 3 von 20 », « 3 of 20 », « 3 su 20 »,
 * « 3 de 20 ») et en ordinal (« 11e facture », « elfte Rechnung », « 21st receipt »…), et dans le
 * code (PLANS, commentaires, tests). Chaque motif vise la formule gratuite d'InvoiceLead :
 * « 10 questions » (assistant, inchangé), « 10 jours » ou le nouveau « 3 sur 10 » des lectures n'y
 * répondent pas (OLD_SAMPLES, contrôlé au début de G2).
 */
const OLD = [
  ["fr : 10 factures", /\b(10|dix) factures\b(?! récurrentes)/i],
  [
    "fr : 20 pièces / lectures / justificatifs / tickets",
    /\b(20|vingt) (pièces|lectures|justificatifs|tickets|reçus|documents)\b/i,
  ],
  ["fr : (Gratuit 20)", /\bGratuit 20\b/],
  ["de : 10 Rechnungen", /\b(10|zehn) Rechnungen\b/i],
  [
    "de : 20 Belege / Belegen / Beleglesungen / Quittungen",
    /\b(20|zwanzig) (von der KI gelesenen? )?(Beleg\w*|Quittung\w*|Dokument\w*|Lesung\w*)/i,
  ],
  ["en : 10 invoices", /\b(10|ten) invoices\b/i],
  [
    "en : 20 documents / receipts / scans / reads",
    /\b(20|twenty) (AI )?(documents?|receipts?|receipt scans?|scans|reads)\b/i,
  ],
  ["it : 10 fatture", /\b(10|dieci) fatture\b/i],
  [
    "it : 20 documenti / letture / scontrini / giustificativi",
    /\b(20|venti) (documenti|letture|scontrini|giustificativi|ricevute)\b/i,
  ],
  ["es : 10 facturas", /\b(10|diez) facturas\b/i],
  [
    "es : 20 documentos / lecturas / justificantes / tiques",
    /\b(20|veinte) (documentos|lecturas|justificantes|tiques|tickets|recibos|comprobantes)\b/i,
  ],
  ["code : invoices: 10", /\binvoices: 10\b/],
  ["code : aiReads: 20", /\baiReads: 20\b/],
  ["compteur « x sur 20 » (5 langues)", /\b\d+ (sur|von|of|su|de) 20\b/],
  [
    "compteur « x factures sur 10 » (5 langues)",
    /\b(factures?|Rechnungen|invoices?|fatture|fattura|facturas?) (sur|von|of|su|de) 10\b/i,
  ],
  [
    "ordinaux : 11e facture / 21e lecture (5 langues)",
    /\b(11e|11\.|onzième|elfte|11th|eleventh|11ª|11a|undicesima|undécima) (facture|Rechnung|invoice|fattura|factura)|\b(21e|21\.|vingt et unième|einundzwanzigste|21st|twenty-first|21ª|21a|ventunesima|vigésima primera) (lecture|pièce|Beleg|Lesung|read|receipt|document|scan|lettura|documento|lectura)/i,
  ],
  [
    "tests : 21e / 11e facture / Kunde 11 / 9 sur 10",
    /\b21e\b|\b11e facture|\bKunde 11\b|\b9 sur 10\b/,
  ],
];
/**
 * Contre-épreuve des motifs eux-mêmes : chaque ancienne tournure (dont celles que la relecture du
 * 29.10.2026 avait vues passer : datif, « von/of/su/de 20 », « 20 documents » seul, scontrini,
 * giustificativi, tiques, justificantes) est trouvée, et aucun des nouveaux textes ne l'est.
 */
const OLD_SAMPLES = {
  found: [
    "10 factures par mois",
    "20 lectures de justificatifs par mois",
    "20 tickets lus",
    "mit 20 Belegen pro Monat",
    "20 von der KI gelesene Belege",
    "20 Beleglesungen pro Monat",
    "3 von 20 Belegen",
    "3 of 20 documents",
    "20 documents each month",
    "twenty receipts",
    "3 su 20",
    "20 scontrini al mese",
    "20 giustificativi",
    "3 de 20 lecturas",
    "20 tiques al mes",
    "20 justificantes",
    "Pièces lues par l'IA : 12 sur 20 ce mois-ci",
    "9 factures sur 10 ce mois-ci",
    "die elfte Rechnung",
    "the 11th invoice",
    "21st receipt",
    "la 21e lecture",
    "invoices: 10,",
    "aiReads: 20,",
  ],
  clean: [
    "5 factures par mois, devis illimités",
    "10 pièces lues par l'IA chaque mois",
    "Pièces lues par l'IA : 3 sur 10 ce mois-ci",
    "Formule gratuite : 2 factures sur 5 ce mois-ci, 1 contact sur 50.",
    "10 questions à l'assistant",
    "10 Beleglesungen pro Monat",
    "10 receipt scans per month",
    "10 letture di giustificativi al mese",
    "10 lecturas de justificantes al mes",
    "payable à 10 jours",
    "TVA au taux de 20 %",
    "la 6e facture est refusée, la 11e lecture aussi",
  ],
};
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

  // Les motifs : chaque ancienne tournure trouvée, aucun nouveau texte pris pour elle.
  const hit = (s) => OLD.some(([, re]) => re.test(s));
  const missed = OLD_SAMPLES.found.filter((s) => !hit(s));
  const wrong = OLD_SAMPLES.clean.filter(hit);
  check(
    `motifs : les ${OLD_SAMPLES.found.length} anciennes tournures trouvées (datif, « von/of/su/de 20 », ordinaux, 5 langues), les ${OLD_SAMPLES.clean.length} nouveaux textes laissés`,
    missed.length === 0 && wrong.length === 0,
    `manquées : ${missed.join(" | ")} ; prises à tort : ${wrong.join(" | ")}`,
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

/** Suite Playwright d'InvoiceLead au 29.10.2026 : 217 tests ; moins, c'est qu'il en manque. */
const E2E_MIN = 217;
const E2E_FREE_TITLE =
  "formule gratuite : cinq factures émises par mois, la sixième reste en brouillon et le serveur la refuse";
/**
 * Lecture du rapport « list » de Playwright : le total annoncé (« Running N tests »), tous passés,
 * aucun sauté (« - » devant la ligne, « N skipped »), instable, interrompu, non lancé ni en échec, et
 * la ligne du test de la formule gratuite marquée ✓.
 */
function playwrightVerdict(out, status) {
  const planned = Number(/^Running (\d+) tests? using/m.exec(out)?.[1] ?? 0);
  const count = (word) => Number(new RegExp(`^\\s+(\\d+) ${word}\\b`, "m").exec(out)?.[1] ?? 0);
  const n = {
    passed: count("passed"),
    failed: count("failed"),
    skipped: count("skipped"),
    flaky: count("flaky"),
    interrupted: count("interrupted"),
    notRun: count("did not run"),
  };
  const title = E2E_FREE_TITLE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const freeRan = new RegExp(
    `^\\s*✓\\s+\\d+ \\[chromium\\] › tests/e2e/free-plan\\.spec\\.ts:\\d+:\\d+ › ${title}`,
    "m",
  ).test(out);
  const ok =
    status === 0 &&
    planned >= E2E_MIN &&
    n.passed === planned &&
    n.failed + n.skipped + n.flaky + n.interrupted + n.notRun === 0 &&
    freeRan;
  return {
    ok,
    freeRan,
    why: `prévus ${planned}, passés ${n.passed}, en échec ${n.failed}, sautés ${n.skipped}, instables ${n.flaky}, interrompus ${n.interrupted}, non lancés ${n.notRun}, code ${status}`,
  };
}

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
  // Le lecteur du rapport, essayé d'abord sur des sorties fabriquées : un test sauté, un test.only
  // oublié ou un total en baisse doivent faire échouer la porte.
  const sample = (mark, n, total) =>
    `\nRunning ${total} tests using 1 worker\n\n  ${mark}   67 [chromium] › tests/e2e/free-plan.spec.ts:353:1 › ${E2E_FREE_TITLE} (7.4s)\n\n  ${n}\n`;
  const fakes = [
    ["test sauté", sample("-", `216 passed (5.3m)\n  1 skipped`, E2E_MIN)],
    ["test.only (un seul test)", sample("✓", "1 passed (9s)", 1)],
    ["un test en échec", sample("✘", `216 passed (5.3m)\n  1 failed`, E2E_MIN)],
    ["test instable", sample("✓", `216 passed (5.3m)\n  1 flaky`, E2E_MIN)],
  ];
  const fooled = fakes.filter(([, out]) => playwrightVerdict(out, 0).ok);
  const plain = playwrightVerdict(sample("✓", `${E2E_MIN} passed (5.3m)`, E2E_MIN), 0);
  check(
    "contre-épreuve du lecteur Playwright : un test sauté, un test.only, un échec ou un test instable font échouer la porte, une suite complète la passe",
    fooled.length === 0 && plain.ok,
    `${fooled.map(([name]) => name).join(", ")} ${plain.why}`,
  );
  migrateLocal("invoicelead_gratuit_e2e");
  // --forbid-only : un test.only oublié fait échouer la suite au lieu de n'en lancer qu'un.
  const e2e = step(ROOT, "e2e", "npx", ["playwright", "test", "--forbid-only", "--reporter=list"], {
    env: {
      ...process.env,
      E2E_APP_PORT: "3172",
      E2E_LEAD_PORT: "4072",
      E2E_DATABASE_URL: LOCAL_PG("invoicelead_gratuit_e2e"),
      NEXT_TELEMETRY_DISABLED: "1",
    },
  });
  const verdict = playwrightVerdict(e2e.stdout, e2e.status);
  check(
    `InvoiceLead : Playwright complet, --forbid-only : tous les tests prévus passent (au moins ${E2E_MIN}), aucun sauté, instable, interrompu ni en échec`,
    verdict.ok,
    verdict.why,
  );
  check(
    "InvoiceLead : le test « cinq factures émises par mois, la sixième reste en brouillon » a tourné et passé (✓ sur sa ligne)",
    verdict.freeRan,
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

/**
 * Commits du chantier (production → HEAD) que porte encore la branche GitHub de l'aperçu, relue sur
 * GitHub. Elle n'y est avancée que le temps de construire l'aperçu, puis remise sur la production :
 * sinon, fusionner assistant-actions dans main mettrait les nouvelles limites en ligne sans décision.
 */
function chantierOnPreviewBranch(il) {
  execFileSync(
    "git",
    [
      "fetch",
      "--quiet",
      "origin",
      `+refs/heads/${PREVIEW_BRANCH}:refs/remotes/origin/${PREVIEW_BRANCH}`,
    ],
    { cwd: ROOT, stdio: "ignore" },
  );
  const remote = git("rev-parse", `refs/remotes/origin/${PREVIEW_BRANCH}`);
  const ours = git("rev-list", `${IL_PROD}..${il}`).split("\n").filter(Boolean);
  return { remote, ours, carried: ours.filter((c) => isAncestor(ROOT, c, remote)) };
}

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
  const pb = chantierOnPreviewBranch(il);
  check(
    `GitHub : la branche ${PREVIEW_BRANCH} est remise en place après l'aperçu (aucun des ${pb.ours.length} commits du chantier n'y est ; la fusionner dans main ne met rien en ligne)`,
    ilD.meta?.githubCommitRef === PREVIEW_BRANCH && pb.ours.length > 0 && pb.carried.length === 0,
    `${PREVIEW_BRANCH} = ${pb.remote.slice(0, 7)}${pb.carried.length ? ` ; porte encore ${pb.carried.map((c) => c.slice(0, 7)).join(", ")}` : ""}`,
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

/**
 * Les entreprises TEST du banc dans la base d'aperçu : réglages et colonnes de l'entreprise (hors
 * relecture des droits du Compte Lead), nombre de pièces, de contacts et de membres.
 */
async function bancSnapshot(roUrl) {
  return readOnly(
    roUrl,
    async (c) =>
      (
        await c.query(
          `select o.name,
                  to_jsonb(o) - array['entitlements', 'entitlements_at', 'updated_at', 'lead_plan', 'has_access'] as row,
                  (select count(*)::int from invoices i where i.organization_id = o.id) docs,
                  (select count(*)::int from contacts ct where ct.organization_id = o.id) contacts,
                  (select count(*)::int from memberships m where m.organization_id = o.id) members
             from organizations o where o.name = any($1::text[]) order by o.name`,
          [TEST_ORGS],
        )
      ).rows,
  );
}

async function freeCompanyScenario(br, base, bypass, st, prodHost) {
  const writeUrl = st.secrets.databaseUrlUnpooled;
  if (new URL(writeUrl).hostname !== st.neon.host || st.neon.host === prodHost)
    throw new Error("la base d'écriture n'est pas celle de l'aperçu");
  const bancBefore = await bancSnapshot(st.secrets.roUrl);
  check(
    "entreprises TEST du banc relues dans la base d'aperçu avant le parcours (G4 n'y écrit pas)",
    bancBefore.length === TEST_ORGS.length,
    bancBefore.map((r) => `${r.name} : ${r.docs} pièces`).join(" ; "),
  );
  const w = await pgClient(writeUrl);
  let sessionId = null;
  try {
    // Une entreprise et une personne TEST neuves, à elles seules : la formule gratuite (droits du
    // Compte Lead) est copiée de « TEST Par app ScanLead seul », relue « à l'instant » ; sans
    // lead_org, rien n'est jamais redemandé au Compte Lead pour elle. Elles restent dans la base
    // d'aperçu après le passage (des pièces émises ne s'effacent pas : journal en ajout seul).
    const earlier = (
      await w.query("select count(*)::int n from organizations where name like $1", [
        `${G4_ORG_PREFIX} %`,
      ])
    ).rows[0].n;
    note(`entreprises « ${G4_ORG_PREFIX} … » des passages précédents : ${earlier}`);
    const name = `${G4_ORG_PREFIX} ${new Date().toISOString().slice(0, 16).replace("T", " ")}`;
    await w.query("begin");
    const org = (
      await w.query(
        `insert into organizations (name, country, currency, default_locale, lead_plan, has_access, entitlements, entitlements_at)
           select $1, 'CH', 'CHF', 'fr', 'free', true, entitlements, now() from organizations
            where name = $2 and entitlements->'plan'->>'code' = 'free'
         returning id, name, lead_org, lead_plan, entitlements->'plan'->>'code' code, billing_plan`,
        [name, TEST_ORGS[2]],
      )
    ).rows[0];
    if (!org) {
      await w.query("rollback");
      throw new Error(`formule gratuite de « ${TEST_ORGS[2]} » introuvable`);
    }
    const user = (
      await w.query(
        `insert into users (lead_sub, email, name, locale) values ($1, $2, 'Contrôle Gratuit G4', 'fr') returning id`,
        [`test-g4-gratuit-${randomBytes(6).toString("hex")}`, G4_EMAIL],
      )
    ).rows[0];
    await w.query(
      "insert into memberships (organization_id, user_id, role, created_at) values ($1, $2, 'admin', now())",
      [org.id, user.id],
    );
    await w.query("commit");
    check(
      `entreprise TEST neuve « ${org.name} » dans la base d'aperçu, en formule gratuite, sans lien au Compte Lead, administrée par sa personne TEST (${G4_EMAIL})`,
      org.code === "free" && org.lead_plan === "free" && !org.billing_plan && org.lead_org === null,
      `${org.lead_plan} / ${org.code}`,
    );
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
    check("au départ : aucune facture émise (entreprise neuve)", n0 === 0, n0);
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
  // Les entreprises du banc n'ont pas bougé : mêmes réglages, mêmes pièces, contacts et membres.
  const bancAfter = await bancSnapshot(st.secrets.roUrl);
  const moved = bancAfter.filter((r, i) => !isDeepStrictEqual(r, bancBefore[i]));
  check(
    "entreprises TEST du banc intactes dans la base d'aperçu (réglages, pièces, contacts, membres identiques avant et après)",
    bancAfter.length === bancBefore.length && moved.length === 0,
    moved.map((r) => r.name).join(", "),
  );
}

// ---------------------------------------------------------------------------------------------
// AVANT : juste avant la mise en ligne, lecture seule, par qui met en ligne
// ---------------------------------------------------------------------------------------------

/**
 * Entreprises au-delà des nouvelles limites gratuites ce mois-ci (mois UTC, comme l'application) :
 * factures émises (comme countIssued) et lectures de pièces (plan_usage « aiReads »), formule de
 * chaque entreprise calculée par tierOf de src/server/plans.ts (tsx), sans recopier sa règle.
 * Lecture seule ; seuls les noms des entreprises TEST sont rendus.
 */
async function freeUsage(url) {
  const rows = await readOnly(
    url,
    async (c) =>
      (
        await c.query(
          `select o.name like 'TEST %' as test,
                  case when o.name like 'TEST %' then o.name end as test_name,
                  o.lead_plan "leadPlan", o.entitlements, o.entitlements_at "entitlementsAt",
                  o.billing_plan "billingPlan", o.billing_plan_until "billingPlanUntil",
                  (select count(*)::int from invoices i
                    where i.organization_id = o.id and i.kind = 'invoice' and i.status = 'issued'
                      and i.issued_at >= date_trunc('month', now() at time zone 'utc') at time zone 'utc') issued,
                  coalesce((select u.used from plan_usage u
                    where u.organization_id = o.id and u.key = 'aiReads'
                      and u.period = to_char(now() at time zone 'utc', 'YYYY-MM')), 0)::int reads
             from organizations o`,
        )
      ).rows,
  );
  const plans = rows.map(
    ({ leadPlan, entitlements, entitlementsAt, billingPlan, billingPlanUntil }) => ({
      leadPlan,
      entitlements,
      entitlementsAt,
      billingPlan,
      billingPlanUntil,
    }),
  );
  const res = sh(
    "npx",
    [
      "tsx",
      "-e",
      'import("./src/server/plans.ts").then(async (m) => { let s = ""; for await (const c of process.stdin) s += c; console.log(JSON.stringify(JSON.parse(s).map((o) => m.tierOf(o)))); })',
    ],
    { input: JSON.stringify(plans), timeout: 120_000 },
  );
  if (res.status !== 0) throw new Error(`tierOf : ${`${res.stderr}`.slice(-300)}`);
  const tiers = JSON.parse(res.stdout.trim().split("\n").pop());
  return rows
    .map((r, i) => ({
      test: r.test,
      name: r.test_name,
      issued: r.issued,
      reads: r.reads,
      tier: tiers[i],
    }))
    .filter((r) => r.tier === "free");
}

async function avant() {
  const apercu = process.argv.includes("--apercu");
  const { il, erp } = worktrees();
  check("InvoiceLead : arbre propre", dirty(ROOT).length === 0, dirty(ROOT).join(", "));
  check("ERPlead : arbre propre", dirty(ERP).length === 0, dirty(ERP).join(", "));

  // Ce qui est en ligne maintenant est contenu dans ce qu'on va mettre en ligne : rien n'est annulé.
  const ilP = (await vapi(`/v9/projects/${IL_PROJECT}`)).targets?.production;
  const erpP = (await vapi(`/v9/projects/${ERP_PROJECT}`)).targets?.production;
  const ilLive = shaOf(ilP ?? {});
  const erpLive = shaOf(erpP ?? {});
  check(
    `InvoiceLead : la production en ligne (${ilLive?.slice(0, 7)}) est un ancêtre du HEAD de ${BRANCH} (${il.slice(0, 7)})`,
    !!ilLive && isAncestor(ROOT, ilLive, il),
  );
  execFileSync("git", ["fetch", "--quiet", "origin", "+refs/heads/main:refs/remotes/origin/main"], {
    cwd: ROOT,
    stdio: "ignore",
  });
  const main = git("rev-parse", "refs/remotes/origin/main");
  check(
    `InvoiceLead : main sur GitHub (${main.slice(0, 7)}) est un ancêtre du HEAD : la pousser sur main est une avance rapide`,
    isAncestor(ROOT, main, il),
  );
  check(
    `ERPlead : la production en ligne (${erpLive?.slice(0, 7)}) est un ancêtre du HEAD de ${ERP} (${erp.slice(0, 7)}) : c'est ce dossier qui se met en ligne`,
    !!erpLive && isAncestor(ERP, erpLive, erp),
  );
  // Le dossier à ne pas prendre (relecture du 29.10.2026) : ~/projets/erplead-gratuit est la branche
  // gratuit-total du 21.10, sans la production ; la mettre en ligne annulerait des commits en ligne.
  const wrong = join(HOME, "projets", "erplead-gratuit");
  if (existsSync(join(wrong, ".git")) && erpLive) {
    const w = gitIn(wrong, "rev-parse", "HEAD");
    const behind = isAncestor(wrong, erpLive, w)
      ? 0
      : Number(gitIn(wrong, "rev-list", "--count", `${w}..${erpLive}`));
    note(
      `NE PAS mettre en ligne depuis ${wrong} (branche ${gitIn(wrong, "branch", "--show-current")}, ${w.slice(0, 7)}) : ${behind ? `${behind} commits de la production y manquent` : "contient la production, mais ce n'est pas la branche des portes"}`,
    );
  }
  const pb = chantierOnPreviewBranch(il);
  check(
    `GitHub : la branche ${PREVIEW_BRANCH} ne porte aucun commit du chantier (${pb.remote.slice(0, 7)})`,
    pb.ours.length > 0 && pb.carried.length === 0,
    pb.carried.map((c) => c.slice(0, 7)).join(", "),
  );

  // Mesure du mois en cours : une entreprise gratuite déjà au-delà verrait « 7 factures sur 5 » ou
  // « 15 sur 10 » jusqu'au 1er du mois suivant (même affichage qu'un retour de Pro à Gratuit).
  const url = apercu
    ? state().secrets.roUrl
    : readFileSync(join(HOME, ".lead-e2e-ro.env"), "utf8")
        .split("\n")
        .find((l) => l.startsWith("INVOICELEAD_RO_URL="))
        ?.slice("INVOICELEAD_RO_URL=".length);
  if (!url) throw new Error("adresse en lecture seule absente");
  if (!apercu && new URL(url).hostname === state().neon.host)
    throw new Error("la mesure de production lirait la base d'aperçu");
  const free = await freeUsage(url);
  const over = (r) => r.issued > 5 || r.reads > 10;
  const real = free.filter((r) => !r.test);
  const realOver = real.filter(over);
  note(
    `base ${apercu ? "d'APERÇU (essai)" : "de PRODUCTION"} : ${free.length} entreprises gratuites, dont ${real.length} hors TEST ; hors TEST au-delà : ${realOver.filter((r) => r.issued > 5).length} pour les factures, ${realOver.filter((r) => r.reads > 10).length} pour les lectures ; à la limite (5 factures ou 10 lectures) : ${real.filter((r) => !over(r) && (r.issued === 5 || r.reads === 10)).length}`,
  );
  for (const r of free.filter((x) => x.test && (x.issued >= 5 || x.reads >= 10)))
    note(`TEST : « ${r.name} » ${r.issued} factures émises, ${r.reads} lectures ce mois-ci`);
  check(
    "aucune entreprise gratuite hors TEST au-delà de 5 factures émises ou de 10 lectures ce mois-ci (sinon : en parler à Ève avant la mise en ligne)",
    realOver.length === 0,
    realOver.map((r) => `${r.issued} factures, ${r.reads} lectures`).join(" ; "),
  );
  check(
    "entreprises TEST gratuites du banc : aucune au-delà des nouvelles limites (listées ci-dessus à partir de la limite)",
    free.filter((r) => r.test && over(r)).length === 0,
    free
      .filter((r) => r.test && over(r))
      .map((r) => r.name)
      .join(", "),
  );
  if (apercu) {
    // Contre-épreuve du compte : les entreprises de G4 ont chacune 5 factures émises ce mois-ci.
    const g4 = free.filter((r) => r.name?.startsWith(`${G4_ORG_PREFIX} `));
    check(
      `contre-épreuve (aperçu) : les entreprises « ${G4_ORG_PREFIX} … » comptent chacune 5 factures émises ce mois-ci`,
      g4.length > 0 && g4.every((r) => r.issued === 5),
      g4.map((r) => `${r.name} : ${r.issued}`).join(" ; "),
    );
    const bad = results.filter((r) => !r.ok);
    console.log(`${results.length - bad.length} verts, ${bad.length} rouges`);
    console.log("essai sur la base d'aperçu : le jeton n'est donné que sur la production");
    process.exit(bad.length ? 1 : 0);
  }
  finish("FREE_LIMITS_AVANT_OK");
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

const gates = { G1: g1, G2: g2, G3: g3, G4: g4, AVANT: avant, G5: g5 };
const which = process.argv[2];
if (!gates[which]) {
  console.log("usage : node scripts/free-limits-gates.mjs G1|G2|G3|G4|AVANT [--apercu]|G5");
  process.exit(2);
}
gates[which]().catch((e) => {
  console.log(`NON erreur : ${e?.message ?? e}`);
  process.exit(1);
});
