#!/usr/bin/env node
/**
 * Aperçu de la branche ia-limites d'InvoiceLead (chantier « Assistant IA : périmètre du logiciel et
 * limite des formules gratuites », ~/projets/.unlazy/ia-limites/CAHIER.md), pour les portes G3 et G4 de
 * scripts/ia-limites-gates.mjs.
 *
 *   node scripts/ia-limites-preview.mjs deploy   déploiement d'APERÇU par la CLI Vercel (jamais la
 *                                                production), puis l'alias invoicelead-ia-limites-test
 *
 * Même méthode que ScanLead (scripts/assistant-actions-preview.mjs) : l'aperçu de la branche Git n'a
 * aucune variable (pas de base), et les variables du projet Vercel ne sont pas modifiées. Les variables
 * de l'aperçu sont donc passées AU DÉPLOIEMENT (`-e`, exécution seulement) :
 * - DATABASE_URL et DATABASE_URL_UNPOOLED : la base d'APERÇU (branche Neon br-purple-rice), lues dans
 *   ~/.invoicelead-actions-ia.json (600), vérifiées différentes de la production avant l'envoi ;
 * - APP_URL : l'alias ; SESSION_SECRET : tiré au hasard à chaque déploiement, propre à l'aperçu ;
 * - Compte Lead (LEAD_ID_*), CRMlead et envoi d'e-mails (Resend), Stripe Connect : neutralisés (adresses
 *   en .invalid, clés factices) : l'aperçu ne joint aucun service réel, n'envoie rien.
 * ANTHROPIC_API_KEY et AI_API_KEY : celles de la cible « Preview » du projet, telles quelles. Aucune
 * variable de build : les migrations du build sont sautées (VERCEL_ENV=preview sans
 * ALLOW_PREVIEW_MIGRATIONS, scripts/migrate.mjs), la base d'aperçu est déjà à jour.
 *
 * Le code envoyé est exactement celui du commit HEAD (git archive dans un dossier temporaire hors du
 * worktree, arbre propre exigé), avec le commit et la branche en métadonnées du déploiement. La liste
 * des variables du projet est relue avant et après (identique) ; la production, avant et après
 * (inchangée). Aucune valeur secrète n'est affichée : les sorties de la CLI sont nettoyées des valeurs
 * passées. Le relevé du déploiement (sans secret) est écrit dans
 * ~/projets/.unlazy/ia-limites/captures/invoicelead/preview.json, que G3 et G4 relisent.
 */
import { execFileSync, execSync, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";

const ROOT = process.cwd();
const HOME = homedir();
const BRANCH = "ia-limites";
const TEAM = "team_mRhlABdvm1jvEPoDzuDDgpon";
const PROJECT = "prj_BGHqP1Lyg3MWz3KoDYQ9qms5Epll";
const SCOPE = "scanleads-projects";
const VERCEL_CLI = "vercel@65.2.0";
/** Production relue par l'API Vercel le 29.10.2026 : elle ne doit pas bouger. */
const PROD = {
  id: "dpl_HUALHm8mQiqNpYpKzGRRJL1Yitw3",
  sha: "682bd09a8136e6dc069171641996e01901da3b11",
};
const PREVIEW_ALIAS = "invoicelead-ia-limites-test.vercel.app";
const STATE_FILE = join(HOME, ".invoicelead-actions-ia.json");
const CAPTURES = join(HOME, "projets", ".unlazy", "ia-limites", "captures", "invoicelead");
const PREVIEW_FILE = join(CAPTURES, "preview.json");
const EXPORT = join("/tmp", "invoicelead-ia-limites-apercu");

function fail(message) {
  console.log(`NON ${message}`);
  process.exit(1);
}
const git = (...args) => execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();
const token = () =>
  JSON.parse(readFileSync(join(HOME, ".local/share/com.vercel.cli/auth.json"), "utf8")).token;
async function vapi(path) {
  const sep = path.includes("?") ? "&" : "?";
  const r = await fetch(`https://api.vercel.com${path}${sep}teamId=${TEAM}`, {
    headers: { Authorization: `Bearer ${token()}` },
  });
  if (!r.ok) throw new Error(`vercel ${path.split("?")[0]} ${r.status}`);
  return r.json();
}
/** Le texte sans aucune des valeurs passées (8 caractères et plus). */
function scrub(text, secrets) {
  let out = String(text ?? "");
  for (const s of secrets) if (typeof s === "string" && s.length >= 8) out = out.split(s).join("…");
  return out;
}
/** Le point de terminaison Neon d'une adresse (« ep-… », sans « -pooler »). */
const endpoint = (host) => host.split(".")[0].replace(/-pooler$/, "");

async function production() {
  const live = (await vapi(`/v9/projects/${PROJECT}`)).targets?.production;
  return { id: live?.id, sha: live?.meta?.githubCommitSha ?? live?.meta?.gitCommitSha };
}
/** Les variables du projet, sans leurs valeurs : de quoi voir qu'aucune n'a changé. */
async function projectEnv() {
  const { envs } = await vapi(`/v10/projects/${PROJECT}/env`);
  return envs
    .map((e) => [
      e.id,
      e.key,
      [...(e.target ?? [])].sort().join(","),
      e.gitBranch ?? "",
      e.updatedAt,
    ])
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
}

async function deploy() {
  // 1. Le commit HEAD de la branche, arbre propre, production comprise et inchangée.
  if (git("branch", "--show-current") !== BRANCH) fail(`branche ${BRANCH} attendue`);
  const dirty = git("status", "--porcelain");
  if (dirty) fail(`arbre non propre :\n${dirty}`);
  const commit = git("rev-parse", "HEAD");
  if (
    spawnSync("git", ["merge-base", "--is-ancestor", PROD.sha, commit], { cwd: ROOT }).status !== 0
  )
    fail("la branche ne contient pas le commit en production");
  const before = await production();
  if (before.id !== PROD.id || before.sha !== PROD.sha)
    fail(`la production a changé (${before.id}, ${before.sha?.slice(0, 7)}) : fusionner d'abord`);

  // 2. La base d'aperçu (br-purple-rice), jamais la production.
  if ((statSync(STATE_FILE).mode & 0o777) !== 0o600) fail(`${STATE_FILE} doit être en 600`);
  const st = JSON.parse(readFileSync(STATE_FILE, "utf8"));
  const prodLine = readFileSync(join(HOME, ".lead-e2e-ro.env"), "utf8")
    .split("\n")
    .find((l) => l.startsWith("INVOICELEAD_RO_URL="));
  if (!prodLine) fail("INVOICELEAD_RO_URL absent de ~/.lead-e2e-ro.env");
  const prodHost = new URL(prodLine.slice("INVOICELEAD_RO_URL=".length)).hostname;
  const pooled = new URL(st.secrets.databaseUrl).hostname;
  const direct = new URL(st.secrets.databaseUrlUnpooled).hostname;
  if (
    !String(st.neon.branchId).startsWith("br-purple-rice") ||
    pooled !== st.neon.pooledHost ||
    direct !== st.neon.host ||
    endpoint(direct) === endpoint(prodHost) ||
    endpoint(pooled) === endpoint(prodHost)
  )
    fail("base d'aperçu inattendue (br-purple-rice exigée, jamais la production)");
  console.log(
    `base d'aperçu ${st.neon.branchId} (${endpoint(direct)}), production ${endpoint(prodHost)} : différentes`,
  );

  // 3. Variables de l'aperçu, passées au déploiement (exécution) ; rien pour le build.
  const app = `https://${PREVIEW_ALIAS}`;
  const runtime = {
    DATABASE_URL: st.secrets.databaseUrl,
    DATABASE_URL_UNPOOLED: st.secrets.databaseUrlUnpooled,
    APP_URL: app,
    SESSION_SECRET: randomBytes(36).toString("base64url"),
    LEAD_ID_ISSUER: "https://compte-lead.invalid",
    LEAD_ID_CLIENT_ID: "invoicelead-apercu-ia-limites",
    LEAD_ID_CLIENT_SECRET: randomBytes(24).toString("base64url"),
    LEAD_ID_REDIRECT_URI: `${app}/auth/lead/callback`,
    LEAD_ID_APP: "invoicelead",
    CRMLEAD_URL: "https://crmlead.invalid",
    RESEND_API_KEY: "re_apercu_neutralise",
    RESEND_API_URL: "https://resend.invalid",
    STRIPE_API_URL: "https://stripe.invalid",
    STRIPE_CONNECT_URL: "https://stripe-connect.invalid",
  };
  const envBefore = await projectEnv();

  // 4. Le code exact du commit, hors du worktree.
  rmSync(EXPORT, { recursive: true, force: true });
  mkdirSync(EXPORT, { recursive: true });
  execSync(`git archive ${commit} | tar -x -C ${JSON.stringify(EXPORT)}`, { cwd: ROOT });
  const args = [
    "--yes",
    VERCEL_CLI,
    "deploy",
    EXPORT,
    "--target",
    "preview",
    "--yes",
    "--scope",
    SCOPE,
    "-m",
    `iaLimitesCommit=${commit}`,
    "-m",
    `iaLimitesBranch=${BRANCH}`,
    ...Object.entries(runtime).flatMap(([k, v]) => ["-e", `${k}=${v}`]),
  ];
  if (args.includes("--prod") || args[args.indexOf("--target") + 1] !== "preview")
    fail("cible non « preview »");
  const env = { ...process.env, VERCEL_ORG_ID: TEAM, VERCEL_PROJECT_ID: PROJECT };
  const secrets = [token(), ...Object.values(runtime)];
  const started = Date.now();
  console.log(`déploiement d'aperçu du commit ${commit.slice(0, 7)} (CLI ${VERCEL_CLI})…`);
  const r = spawnSync("npx", args, { cwd: "/tmp", encoding: "utf8", maxBuffer: 64 << 20, env });
  rmSync(EXPORT, { recursive: true, force: true });
  const out = scrub(`${r.stdout ?? ""}\n${r.stderr ?? ""}`, secrets);
  console.log(out.trim().split("\n").slice(-12).join("\n"));
  const url = scrub(r.stdout, secrets).match(/https:\/\/[a-z0-9-]+\.vercel\.app/)?.[0];
  if (r.status !== 0 || !url) fail("déploiement d'aperçu en échec");
  const dep = await vapi(`/v13/deployments/${new URL(url).host}`);
  if (dep.target === "production" || dep.id === PROD.id) fail("déploiement en production : arrêt");
  if (dep.meta?.iaLimitesCommit !== commit) fail("commit absent des métadonnées du déploiement");
  if (dep.readyState !== "READY") fail(`aperçu ${dep.id} ${dep.readyState}`);

  // 5. L'alias, puis les relectures : variables du projet et production inchangées.
  const alias = spawnSync(
    "npx",
    ["--yes", VERCEL_CLI, "alias", "set", url, PREVIEW_ALIAS, "--scope", SCOPE],
    { cwd: "/tmp", encoding: "utf8", env },
  );
  if (alias.status !== 0) fail(`alias : ${scrub(alias.stderr, secrets).slice(-400)}`);
  const pointed = await vapi(`/v4/aliases/${PREVIEW_ALIAS}`);
  if (pointed.deploymentId !== dep.id) fail("l'alias ne pointe pas sur ce déploiement");
  const envAfter = await projectEnv();
  if (!isDeepStrictEqual(envAfter, envBefore)) fail("les variables du projet ont changé");
  const after = await production();
  if (after.id !== PROD.id) fail("la production a bougé pendant le déploiement d'aperçu");

  mkdirSync(CAPTURES, { recursive: true });
  const info = {
    id: dep.id,
    url,
    alias: app,
    commit,
    branch: BRANCH,
    deployedAt: new Date().toISOString(),
    buildSeconds: Math.round((Date.now() - started) / 1000),
    database: { branchId: st.neon.branchId, host: st.neon.host, pooledHost: st.neon.pooledHost },
    projectEnv: `${envBefore.length} variables du projet, inchangées`,
    production: PROD.id,
  };
  writeFileSync(PREVIEW_FILE, `${JSON.stringify(info, null, 2)}\n`);
  console.log(
    `aperçu ${dep.id} (READY, cible preview) commit ${commit.slice(0, 7)} → ${app} ; ` +
      `${envBefore.length} variables du projet inchangées ; production inchangée (${after.id})`,
  );
  console.log("IA_LIMITES_PREVIEW_OK");
}

if (process.argv[2] === "deploy") {
  if (!existsSync(join(ROOT, "scripts", "ia-limites-preview.mjs")))
    fail("à lancer à la racine du worktree");
  deploy().catch((e) => fail(`erreur : ${e instanceof Error ? e.message : String(e)}`));
} else {
  console.log("usage : node scripts/ia-limites-preview.mjs deploy");
  process.exit(2);
}
