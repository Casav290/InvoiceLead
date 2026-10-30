#!/usr/bin/env node
/**
 * Portes du chantier « Continuer avec Google dans les apps mobiles », part d'InvoiceLead (30.10.2026).
 * Ledger ~/projets/.unlazy/google-app/gates/leaf-invoicelead.md, cahier ../CAHIER.md, contrat d'ERPlead
 * ~/projets/erplead-google-app/docs/GOOGLE-APP.md, ici docs/GOOGLE-APP.md. À la racine du worktree
 * (branche google-app) :
 *
 *   node scripts/google-app-gates.mjs G1      essais du retour (tests/unit/lead-app-auth.test.ts, faux pont) et
 *                                             contre-épreuves (faute posée dans une COPIE du code : l'essai
 *                                             gardien échoue) ; contrôles complets (Biome, types, Vitest, build,
 *                                             Playwright dont tests/e2e/google-app.spec.ts)
 *   node scripts/google-app-gates.mjs G2      dépôt mobile ~/projets/invoicelead-mobile (branche google-app) :
 *                                             schéma iOS et Android, plugins synchronisés, agent LeadAppAuth/1,
 *                                             version et build augmentés, construction Android (AAB signé par la
 *                                             clé d'envoi, APK de contrôle), rien de soumis
 *   node scripts/google-app-gates.mjs APERCU  aperçu Vercel de HEAD (jamais la production), variables passées au
 *                                             déploiement (méthode ia-limites), alias invoicelead-google-app-test
 *   node scripts/google-app-gates.mjs G3      aperçu d'InvoiceLead + aperçu d'ERPlead, Chromium sans tête qui
 *                                             imite la vue web de l'app (agent LeadAppAuth/1, faux pont) : bouton
 *                                             Google, page relais, départ jusqu'à accounts.google.com, code préparé
 *                                             dans la base d'APERÇU d'ERPlead, lien de retour → rachat → personne TEST
 *                                             connectée, code OpenID rendu à InvoiceLead avec SA demande ; base remise
 *
 * Chaque porte n'imprime son jeton GOOGLE_APP_Gx_OK qu'à la fin, si aucun contrôle n'a échoué. Aucun secret affiché.
 * Jamais la production : aucune requête du navigateur ne part vers erplead.io ni invoicelead.io (interceptées et
 * menées vers les aperçus, ou arrêtées), aucun « vercel --prod », aucune variable du projet Vercel changée.
 */
import { execFileSync, execSync, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const HOME = homedir();
const require = createRequire(join(ROOT, "package.json"));
const COMMON = `${HOME}/projets/.unlazy/google-app`;
const CAPTURES = `${COMMON}/captures/invoicelead`;
const ERP_APERCU = `${COMMON}/captures/erplead/apercu.json`;
const ERP_REPO = `${HOME}/projets/erplead-google-app`;
const MOBILE = `${HOME}/projets/invoicelead-mobile`;
const MOBILE_BASE = "store-invoicelead";
const PUBLICATIONS = `${HOME}/projets/publications/invoicelead/android`;
const BRANCH = "google-app";
/** La production d'InvoiceLead d'où part la branche (dpl_HUALHm8mQiqNpYpKzGRRJL1Yitw3, API Vercel, 30.10.2026). */
const PROD = {
  id: "dpl_HUALHm8mQiqNpYpKzGRRJL1Yitw3",
  sha: "682bd09a8136e6dc069171641996e01901da3b11",
};
const TEAM = "team_mRhlABdvm1jvEPoDzuDDgpon";
const PROJECT = "prj_BGHqP1Lyg3MWz3KoDYQ9qms5Epll";
const ERP_PROJECT = "prj_ZIWBlmDtMeoPupyeG103XenXAXdV";
const SCOPE = "scanleads-projects";
const VERCEL_CLI = "vercel@65.2.0";
const PREVIEW_ALIAS = "invoicelead-google-app-test.vercel.app";
const STATE_FILE = join(HOME, ".invoicelead-actions-ia.json");
const APERCU_FILE = `${CAPTURES}/apercu.json`;
const ERP_DB_HOST = "ep-summer-pine-b95lk4iy"; // base d'APERÇU d'ERPlead (royal-firefly, données TEST)
const ERP_PROD_DB_HOST = "ep-noisy-rain-b1beeeks"; // production d'ERPlead : jamais lue ni écrite ici
/** Entreprise TEST du banc lead-e2e dont une personne (membre, sans double authentification) sert au rachat de G3. */
const ORG_INDEX = 5;
const LOCAL_PG = (db) => `postgresql://ubuntu@localhost/${db}?host=/var/run/postgresql`;
const UNIT_DB = "invoicelead_gapp_test";
const E2E_DB = "invoicelead_gapp_e2e";
const SCHEME = "io.invoicelead.app";
const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148";
const SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1";
const NEW_APP = `${IPHONE} InvoiceLeadApp LeadAppAuth/1`;
const OLD_APP = `${IPHONE} InvoiceLeadApp`;

// ------------------------------------------------------------------ sortie

let failures = 0;
const mask = (s) =>
  String(s ?? "")
    .replace(/postgres(ql)?:\/\/[^\s'"]+/g, "<adresse>")
    .replace(/lid_[\w-]+/g, "<secret>")
    .replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, "<jeton>")
    .replace(/x-vercel-protection-bypass=[\w-]+/g, "x-vercel-protection-bypass=<…>")
    .replace(/([?&](?:code|d|state|nonce|code_challenge|start|back)=)[\w.%-]{12,}/g, "$1<…>")
    .replace(/test\+[\w-]+@scanlead\.io/g, "test+…@scanlead.io");
function check(label, cond, detail) {
  if (cond) console.log(`ok  ${label}`);
  else {
    failures++;
    const d =
      detail === undefined
        ? ""
        : ` — ${mask(typeof detail === "string" ? detail : JSON.stringify(detail)).slice(0, 700)}`;
    console.log(`NON ${label}${d}`);
  }
  return !!cond;
}
function finish(gate) {
  if (failures) {
    console.log(`${gate} : ${failures} contrôle(s) en échec`);
    process.exit(1);
  }
  console.log(`GOOGLE_APP_${gate}_OK`);
}
const note = (s) => console.log(`    ${mask(s)}`);

// ------------------------------------------------------------------ petits outils

const run = (cmd, args, opts = {}) =>
  spawnSync(cmd, args, { cwd: ROOT, encoding: "utf8", maxBuffer: 256 * 1024 * 1024, ...opts });
const git = (args, cwd = ROOT) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
const tmp = mkdtempSync(join(tmpdir(), "invoicelead-google-app-"));
process.on("exit", () => {
  try {
    rmSync(tmp, { recursive: true, force: true });
  } catch {}
});
const sha256 = (s) => createHash("sha256").update(s).digest("hex");
const esc = (s) =>
  String(s ?? "").replace(
    /[<>&"']/g,
    (ch) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" })[ch],
  );
const readEnv = (file) =>
  Object.fromEntries(
    readFileSync(file, "utf8")
      .split("\n")
      .filter((l) => l.includes("=") && !l.startsWith("#"))
      .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
  );

function assertWorktree() {
  const top = git(["rev-parse", "--show-toplevel"]);
  const branch = git(["branch", "--show-current"]);
  if (top !== ROOT || branch !== BRANCH) {
    console.log(`NON à lancer à la racine du worktree, branche ${BRANCH} (ici ${top}, ${branch})`);
    process.exit(1);
  }
  check(
    `la branche ${BRANCH} part de la production (${PROD.sha.slice(0, 7)})`,
    run("git", ["merge-base", "--is-ancestor", PROD.sha, "HEAD"]).status === 0,
  );
}

/** Base locale dédiée (créée au besoin), migrée comme en CI. */
function localDb(db) {
  if (!/^invoicelead_gapp_\w+$/.test(db)) throw new Error(`base ${db}`);
  const exists = run("psql", [
    LOCAL_PG("postgres"),
    "-Atc",
    `select 1 from pg_database where datname = '${db}'`,
  ]);
  if (exists.stdout.trim() !== "1") {
    const created = run("psql", [LOCAL_PG("postgres"), "-c", `create database ${db}`]);
    if (created.status !== 0)
      throw new Error(`création de ${db} : ${created.stderr.slice(0, 200)}`);
  }
  const m = run("node", ["scripts/migrate.mjs"], {
    env: { ...process.env, DATABASE_URL: LOCAL_PG(db), DATABASE_URL_UNPOOLED: "", VERCEL_ENV: "" },
  });
  if (m.status !== 0) throw new Error(`migration de ${db} : ${m.stdout.slice(-300)}`);
  return LOCAL_PG(db);
}

/** vitest en JSON : le rapport, ou null. */
function vitest(args, name, cwd = ROOT) {
  const out = join(tmp, `${name}.json`);
  rmSync(out, { force: true });
  const r = run("npx", ["vitest", "run", ...args, "--reporter=json", `--outputFile=${out}`], {
    cwd,
    env: { ...process.env, TEST_DATABASE_URL: localDb(UNIT_DB) },
    timeout: 1_800_000,
  });
  return {
    status: r.status,
    report: existsSync(out) ? JSON.parse(readFileSync(out, "utf8")) : null,
    tail: `${r.stdout ?? ""}${r.stderr ?? ""}`.slice(-800),
  };
}
const titles = (report, status) =>
  new Set(
    (report?.testResults ?? []).flatMap((f) =>
      f.assertionResults.filter((a) => a.status === status).map((a) => a.title),
    ),
  );
const failedTests = (report) =>
  (report?.testResults ?? []).flatMap((f) =>
    f.assertionResults
      .filter((a) => a.status === "failed")
      .map((a) => `${f.name.split("/").pop()} : ${a.title}`),
  );

// ------------------------------------------------------------------ G1

const UNIT = "tests/unit/lead-app-auth.test.ts";
const E2E = "tests/e2e/google-app.spec.ts";
/** Ce que G1 exige de voir passer (ledger G1), essai par essai. */
const G1_UNIT = [
  [
    "schéma exact et chemin attendu",
    "lien de retour : schéma exact io.invoicelead.app, hôte lead-auth, code de 43 caractères → rachat d'ERPlead",
  ],
  [
    "appUrlOpen : rachat avec le code, une seule fois, Browser.close",
    "appUrlOpen pendant une connexion en cours (page relais) : le lien de l'app ferme le navigateur du téléphone et mène au rachat d'ERPlead avec le code, une seule fois",
  ],
  [
    "lien de lancement : une seule fois, pages suivantes comprises",
    "lien de lancement (app relancée par le lien) : rachat une seule fois, même si appUrlOpen le donne aussi et sur la page suivante",
  ],
  [
    "lien étranger ou mal formé ignoré",
    "liens étrangers ou mal formés ignorés : autre schéma, autre hôte, ancien io.crmlead.app://sso, adresse web",
  ],
  [
    "lien de l'app sans code valable",
    "lien de l'app sans code valable (error=expired, code abîmé) : écran de connexion gardé par la page relais, sinon connexion ordinaire",
  ],
  [
    "Browser.close en erreur",
    "Browser.close en erreur (Android : rien à fermer) : le rachat a lieu quand même",
  ],
  [
    "rien hors de l'app (écoute)",
    "hors de l'app (aucun pont natif) : aucune écoute, aucun lien suivi, aucune navigation",
  ],
  [
    "rien hors de l'app (page relais)",
    "page relais hors de l'app (navigateur ordinaire) : l'écran de connexion d'ERPlead, sans rien ouvrir",
  ],
  [
    "agent LeadAppAuth/1",
    "agent de l'app : LeadAppAuth/1 seulement avec InvoiceLeadApp ; anciennes versions et navigateurs comme avant",
  ],
  [
    "page relais : Browser.open, back",
    "page relais dans l'app : back gardé, navigateur du téléphone ouvert sur start ; refermé sans retour → back",
  ],
  [
    "navigateur refermé puis retour (Android)",
    "navigateur refermé puis lien de retour (Android) : le rachat l'emporte, pas de retour à l'écran de connexion",
  ],
  [
    "start ou back étrangers refusés",
    "page relais : start ou back étrangers → rien n'est ouvert, connexion ordinaire de l'app",
  ],
  [
    "page relais sans langue (proxy)",
    "/lead-auth/google sans langue → la page relais dans la langue de back, paramètres gardés",
  ],
  // Relecture du 30.10.2026.
  [
    "lien d'erreur suivi à chaque expiration",
    "deux demandes expirées de suite : le lien d'erreur (toujours le même) ramène chaque fois à l'écran de connexion",
  ],
  [
    "lien sans connexion en cours ignoré",
    "lien de l'app reçu sans connexion en cours (page web, courriel, autre app) : ignoré, ni navigateur fermé ni page quittée",
  ],
  [
    "ancien lien de lancement jamais suivi par la page relais",
    "page relais d'une nouvelle connexion : l'ancien lien que rend getLaunchUrl (app relancée) n'est jamais suivi ; le navigateur s'ouvre et le nouveau lien mène au rachat",
  ],
  [
    "lien de lancement en retard sur la page relais",
    "page relais : un lien de lancement rendu après le délai n'est jamais pris pour le retour de cette connexion",
  ],
  [
    "garde : écran de connexion de l'app sans session",
    "dans l'app (LeadAppAuth/1) : par l'écran de connexion de l'app, qui lit le lien de lancement ; ailleurs, tout droit vers le Compte Lead",
  ],
];
const G1_E2E = [
  "app (LeadAppAuth/1) : « Continuer avec Google » → page relais → navigateur du téléphone → lien de retour → connectée dans InvoiceLead, une seule fois",
  "navigateur du téléphone refermé sans retour : l'écran de connexion du Compte Lead revient",
  "app relancée par le lien de retour (lien de lancement) : connectée depuis l'écran de connexion de l'app, le lien n'est suivi qu'une fois",
  "liens étrangers ignorés dans l'app ; hors de l'app, la page relais ne fait que revenir à l'écran de connexion",
  "ancienne version de l'app (sans LeadAppAuth/1) et navigateur : l'écran de connexion part tout droit, comme avant",
  "app relancée par le lien de retour avec un cookie de session périmé : la garde passe par l'écran de connexion de l'app, qui suit le lien ; connectée du premier coup",
  "nouvelle connexion après une app relancée sans lecture du lien : l'ancien lien de lancement n'est pas suivi par la page relais, le nouveau connecte",
  "deux demandes expirées de suite : le lien d'erreur ramène chaque fois à l'écran de connexion du Compte Lead",
  "lien de l'app reçu sans connexion en cours (page de l'app ouverte) : ignoré, la page reste",
];
const LIB = "src/lib/lead-app-auth.ts";
const GUARD_TEST = "tests/unit/lead-app-guard.test.ts";
/** Contre-épreuves : une faute dans une COPIE du code, l'essai nommé doit échouer. */
const MUTATIONS = [
  {
    name: "lien avec code suivi plusieurs fois",
    file: LIB,
    from: '    if (link.kind === "code" && !firstTime(win, key)) return false;\n',
    to: "",
    breaks: G1_UNIT[2][1],
  },
  {
    name: "navigateur du téléphone jamais refermé",
    file: LIB,
    from: "    quietly(() => plugins.Browser?.close?.());\n",
    to: "",
    breaks: G1_UNIT[1][1],
  },
  {
    name: "schéma approché (tout lien io.invoicelead.app://)",
    file: LIB,
    // biome-ignore lint/suspicious/noTemplateCurlyInString: texte du code source à fausser, pas un gabarit
    from: "export const RETURN_PREFIX = `${APP_SCHEME}://lead-auth?`;",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: texte du code source à fausser, pas un gabarit
    to: "export const RETURN_PREFIX = `${APP_SCHEME}://`;",
    breaks: G1_UNIT[3][1],
  },
  {
    name: "pont non natif accepté (site web)",
    file: LIB,
    from: '    if (!cap || typeof cap.isNativePlatform !== "function" || cap.isNativePlatform() !== true)\n      return null;\n',
    to: "    if (!cap) return null;\n",
    breaks: G1_UNIT[6][1],
  },
  {
    name: "départ d'ERPlead non vérifié",
    file: LIB,
    from: '  if (!issuer || !fromIssuer(issuer, start, "/auth/google/app/start")) return null;\n',
    to: '  if (!issuer || typeof start !== "string") return null;\n',
    breaks: G1_UNIT[11][1],
  },
  {
    name: "navigateur refermé : retour à l'écran même après le lien",
    file: LIB,
    from: "    if (state?.received) return;\n    if (state) state.armed = false;\n",
    to: "    if (state) state.armed = false;\n",
    breaks: G1_UNIT[10][1],
  },
  {
    name: "lien de lancement non lu",
    file: LIB,
    from: '      return handle(r?.url, "launch");\n',
    to: "      return false;\n",
    breaks: G1_UNIT[2][1],
  },
  // Relecture du 30.10.2026.
  {
    name: "lien d'erreur gardé comme vu (toujours le même lien)",
    file: LIB,
    from: '    if (link.kind === "code" && !firstTime(win, key)) return false;\n',
    to: "    if (!firstTime(win, key)) return false;\n",
    breaks: G1_UNIT[13][1],
  },
  {
    name: "lien suivi sans connexion en cours",
    file: LIB,
    from: "    if (state.received || !expected(via, key)) return false;\n",
    to: "    if (state.received) return false;\n",
    breaks: G1_UNIT[14][1],
  },
  {
    name: "connexion en cours sans limite de temps",
    file: LIB,
    from: "    if (!(age >= 0 && age < PENDING_TTL_MS)) return null;\n",
    to: "    if (!(age >= 0)) return null;\n",
    breaks: G1_UNIT[14][1],
  },
  {
    name: "lien de lancement suivi sur la page relais",
    file: LIB,
    from: '    if (via === "launch" && state.relay) return false;\n',
    to: "",
    breaks: G1_UNIT[16][1],
  },
  {
    name: "ancien lien noté par la page relais suivi au rechargement",
    file: LIB,
    from: '    return !!pending && !(via === "launch" && pending.stale === key);\n',
    to: "    return !!pending;\n",
    breaks: G1_UNIT[15][1],
  },
  {
    name: "garde : tout droit vers le Compte Lead dans l'app",
    file: "src/server/auth/guard.ts",
    from: "  if (isAppAuthAgent(userAgent)) {\n",
    to: "  if (userAgent === undefined) {\n",
    breaks: G1_UNIT[17][1],
  },
];

/** Empreinte des fichiers du worktree : les contre-épreuves ne doivent rien y changer. */
const treePrint = () =>
  sha256(
    run("git", ["status", "--porcelain", "--", "src", "tests"]).stdout +
      run("git", ["diff", "HEAD", "--", "src", "tests"]).stdout,
  );

function counterProofs() {
  const before = treePrint();
  const copy = join(tmp, "copie");
  mkdirSync(copy, { recursive: true });
  for (const p of ["src", "tests", "messages", "package.json", "tsconfig.json", "vitest.config.ts"])
    cpSync(join(ROOT, p), join(copy, p), { recursive: true });
  symlinkSync(join(ROOT, "node_modules"), join(copy, "node_modules"));
  for (const m of MUTATIONS) {
    const file = join(copy, m.file);
    const original = readFileSync(file, "utf8");
    const n = original.split(m.from).length - 1;
    if (
      !check(
        `contre-épreuve « ${m.name} » : le texte à fausser se trouve une fois`,
        n === 1,
        `${n} fois`,
      )
    )
      continue;
    writeFileSync(file, original.replace(m.from, m.to));
    try {
      const r = vitest([UNIT, GUARD_TEST], `mutation-${MUTATIONS.indexOf(m)}`, copy);
      const failed = titles(r.report, "failed");
      check(
        `contre-épreuve « ${m.name} » : l'essai « ${m.breaks.slice(0, 60)}… » échoue`,
        r.report && failed.has(m.breaks),
        r.report ? `échecs : ${[...failed].join(" | ") || "aucun"}` : r.tail,
      );
    } finally {
      writeFileSync(file, original);
    }
  }
  check("le worktree n'a pas été touché par les contre-épreuves", treePrint() === before);
}

function gateG1() {
  assertWorktree();
  // 1. Le retour de la connexion Google, essai par essai.
  const u = vitest([UNIT, GUARD_TEST, "tests/unit/native-app.test.ts"], "g1-unit");
  const passed = titles(u.report, "passed");
  check(
    `${UNIT}, ${GUARD_TEST} et native-app.test.ts verts (${passed.size} essais)`,
    u.status === 0 && u.report?.numFailedTests === 0,
    failedTests(u.report).join(" | ") || u.tail,
  );
  for (const [what, title] of G1_UNIT)
    check(`G1 ${what}`, passed.has(title), `essai absent ou en échec : ${title}`);
  counterProofs();
  // 2. Contrôles complets de l'app.
  const biome = run("npx", ["biome", "ci", "."]);
  check(
    "Biome (lint et format, comme la CI)",
    biome.status === 0,
    `${biome.stdout}${biome.stderr}`.slice(-400),
  );
  const tsc = run("npx", ["tsc", "--noEmit"]);
  check("TypeScript (tsc --noEmit)", tsc.status === 0, `${tsc.stdout}`.slice(0, 400));
  // Délai des crochets relevé : sous charge, l'effacement des bases jetables de migrate-order dépasse 10 s.
  const all = vitest(["--hookTimeout=60000"], "g1-vitest");
  const total = all.report?.numTotalTests ?? 0;
  check(
    `Vitest complet : ${all.report?.numPassedTests ?? 0}/${total} essais, ${all.report?.numTotalTestSuites ?? 0} groupes, aucun en échec ni sauté`,
    all.status === 0 &&
      all.report?.success === true &&
      all.report?.numFailedTests === 0 &&
      all.report?.numPendingTests === 0 &&
      total >= 581,
    failedTests(all.report).join(" | ") || all.tail,
  );
  const build = run("npx", ["next", "build"], {
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
    timeout: 1_800_000,
  });
  check(
    "build Next (next build)",
    build.status === 0,
    `${build.stdout}${build.stderr}`.slice(-500),
  );
  check(
    "build : la page relais /[locale]/lead-auth/google est servie à la demande",
    /ƒ \/\[locale\]\/lead-auth\/google/.test(build.stdout ?? ""),
  );
  const report = join(tmp, "e2e.json");
  const e2e = run("npx", ["playwright", "test", "--reporter=json"], {
    env: {
      ...process.env,
      E2E_APP_PORT: "3170",
      E2E_LEAD_PORT: "4070",
      E2E_DATABASE_URL: localDb(E2E_DB),
      NEXT_TELEMETRY_DISABLED: "1",
      PLAYWRIGHT_JSON_OUTPUT_NAME: report,
    },
    timeout: 3_600_000,
  });
  const pw = existsSync(report) ? JSON.parse(readFileSync(report, "utf8")) : null;
  const specs = [];
  const walk = (s) => {
    for (const x of s?.suites ?? []) walk(x);
    for (const sp of s?.specs ?? []) specs.push({ title: sp.title, file: sp.file, ok: sp.ok });
  };
  walk(pw);
  const bad = specs.filter((s) => !s.ok);
  check(
    `Playwright complet : ${specs.length - bad.length}/${specs.length} scénarios verts`,
    e2e.status === 0 &&
      pw &&
      bad.length === 0 &&
      (pw.stats?.unexpected ?? 1) === 0 &&
      specs.length >= 100,
    bad.map((s) => `${s.file} : ${s.title}`).join(" | ") || `${e2e.stdout ?? ""}`.slice(-500),
  );
  for (const title of G1_E2E)
    check(
      `e2e ${title.slice(0, 80)}…`,
      specs.some((s) => E2E.endsWith(s.file) && s.title === title && s.ok),
    );
  // 3. La documentation suit le code.
  const doc = readFileSync(join(ROOT, "docs/GOOGLE-APP.md"), "utf8");
  for (const s of [
    `${SCHEME}://lead-auth?code=`,
    "/lead-auth/google?start=",
    "/auth/google/app/redeem?code=",
    "LeadAppAuth/1",
    "getLaunchUrl",
    "appUrlOpen",
    "Browser.close",
  ])
    check(`docs/GOOGLE-APP.md décrit « ${s} »`, doc.includes(s));
  const lib = readFileSync(join(ROOT, LIB), "utf8");
  const erp = readFileSync(join(ERP_REPO, "src/lib/appAuth.ts"), "utf8");
  check(
    "schéma et page relais : ceux de la liste fermée d'ERPlead (APP_LINKS)",
    lib.includes(`export const APP_SCHEME = "${SCHEME}";`) &&
      lib.includes('export const RELAY_PATH = "/lead-auth/google";') &&
      erp.includes(
        "invoicelead: { scheme: 'io.invoicelead.app', site: 'https://invoicelead.io' }",
      ) &&
      erp.includes("export const RELAY_PATH = '/lead-auth/google'") &&
      erp.includes("export const RETURN_HOST = 'lead-auth'"),
  );
  finish("G1");
}

// ------------------------------------------------------------------ G2

const mgit = (args) => git(args, MOBILE);
const mread = (p, ref) =>
  ref ? mgit(["show", `${ref}:${p}`]) : readFileSync(join(MOBILE, p), "utf8");
const semverGt = (a, b) => {
  const x = a.split(".").map(Number);
  const y = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0);
  return false;
};

function gateG2() {
  check(
    `dépôt mobile ${MOBILE} : branche ${BRANCH}, partie de ${MOBILE_BASE}, rien en cours (fichiers suivis)`,
    mgit(["branch", "--show-current"]) === BRANCH &&
      spawnSync("git", ["merge-base", "--is-ancestor", MOBILE_BASE, "HEAD"], { cwd: MOBILE })
        .status === 0 &&
      mgit(["status", "--porcelain", "--untracked-files=no"]) === "",
    mgit(["status", "--porcelain", "--untracked-files=no"]),
  );
  // Info.plist (lu comme une plist, pas comme du texte).
  const plist = spawnSync(
    "python3",
    [
      "-I",
      "-c",
      "import json,plistlib,sys;print(json.dumps(plistlib.load(open(sys.argv[1],'rb'))))",
      join(MOBILE, "ios/App/App/Info.plist"),
    ],
    { encoding: "utf8" },
  );
  const info = plist.status === 0 ? JSON.parse(plist.stdout) : null;
  const schemes = (info?.CFBundleURLTypes ?? []).flatMap((t) => t.CFBundleURLSchemes ?? []);
  check(
    `iOS Info.plist valable : CFBundleURLTypes → CFBundleURLSchemes = ${SCHEME}`,
    schemes.includes(SCHEME),
    plist.stderr || schemes,
  );
  const scene = mread("ios/App/App/SceneDelegate.swift");
  check(
    "iOS : le SceneDelegate passe les liens à Capacitor (openURLContexts et lancement → SceneDelegateProxy)",
    scene.includes("SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)") &&
      scene.includes(
        "SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)",
      ),
  );
  // AndroidManifest.xml : activité principale singleTask, intent-filter VIEW/DEFAULT/BROWSABLE + schéma + hôte.
  const manifest = mread("android/app/src/main/AndroidManifest.xml");
  const activity = /<activity[\s\S]*?<\/activity>/.exec(manifest)?.[0] ?? "";
  const filters = activity.match(/<intent-filter>[\s\S]*?<\/intent-filter>/g) ?? [];
  const link = filters.find((f) => f.includes(`android:scheme="${SCHEME}"`));
  check(
    `Android : activité principale singleTask avec intent-filter VIEW + DEFAULT + BROWSABLE, scheme ${SCHEME}, host lead-auth`,
    /android:name="\.MainActivity"/.test(activity) &&
      /android:launchMode="singleTask"/.test(activity) &&
      !!link &&
      link.includes('android.intent.action.VIEW"') &&
      link.includes('android.intent.category.DEFAULT"') &&
      link.includes('android.intent.category.BROWSABLE"') &&
      link.includes(`<data android:scheme="${SCHEME}" android:host="lead-auth" />`),
    link ?? "intent-filter absent",
  );
  // capacitor.config.ts
  const cfg = mread("capacitor.config.ts");
  const agent = /appendUserAgent:\s*'([^']*)'/.exec(cfg)?.[1] ?? "";
  check(
    `capacitor.config.ts : appId ${SCHEME}, appendUserAgent « ${agent} » (InvoiceLeadApp + LeadAppAuth/1), server.url https://invoicelead.io`,
    cfg.includes(`appId: '${SCHEME}'`) &&
      /(^|\s)InvoiceLeadApp(\s|$)/.test(agent) &&
      /(^|\s)LeadAppAuth\/1(\s|$)/.test(agent) &&
      cfg.includes("url: 'https://invoicelead.io'"),
  );
  check(
    "allowNavigation garde erplead.io et Apple",
    /allowNavigation:\s*\[[^\]]*'erplead\.io'[^\]]*'appleid\.apple\.com'[^\]]*\]/.test(cfg),
  );
  const web = readFileSync(join(ROOT, LIB), "utf8");
  check(
    "le schéma déclaré est celui qu'écoute le site (src/lib/lead-app-auth.ts) et celui de la liste d'ERPlead",
    web.includes(`export const APP_SCHEME = "${SCHEME}";`) &&
      readFileSync(join(ERP_REPO, "src/lib/appAuth.ts"), "utf8").includes(
        `invoicelead: { scheme: '${SCHEME}'`,
      ),
  );
  // Plugins présents, installés, synchronisés.
  const pkg = JSON.parse(mread("package.json"));
  const ver = (name) => {
    try {
      return JSON.parse(readFileSync(join(MOBILE, "node_modules", name, "package.json"), "utf8"))
        .version;
    } catch {
      return null;
    }
  };
  const core = ver("@capacitor/core");
  check(
    `@capacitor/app (${ver("@capacitor/app")}) et @capacitor/browser (${ver("@capacitor/browser")}) déclarés et installés, même version majeure que @capacitor/core (${core})`,
    pkg.dependencies?.["@capacitor/app"] &&
      pkg.dependencies?.["@capacitor/browser"] &&
      ["@capacitor/app", "@capacitor/browser"].every(
        (n) => ver(n)?.split(".")[0] === core?.split(".")[0],
      ),
  );
  const settings = mread("android/capacitor.settings.gradle");
  const appGradle = mread("android/app/capacitor.build.gradle");
  const spm = mread("ios/App/CapApp-SPM/Package.swift");
  check(
    "synchronisés (npx cap sync) : Android (capacitor.settings.gradle, capacitor.build.gradle) et iOS (CapApp-SPM)",
    ["capacitor-app", "capacitor-browser"].every(
      (p) =>
        settings.includes(`include ':${p}'`) &&
        appGradle.includes(`implementation project(':${p}')`),
    ) &&
      ['.product(name: "CapacitorApp"', '.product(name: "CapacitorBrowser"'].every((p) =>
        spm.includes(p),
      ),
  );
  for (const gen of [
    "android/app/src/main/assets/capacitor.config.json",
    "ios/App/App/capacitor.config.json",
  ]) {
    const j = existsSync(join(MOBILE, gen)) ? JSON.parse(mread(gen)) : null;
    check(
      `configuration recopiée par cap sync (${gen}) : appendUserAgent « ${j?.appendUserAgent} »`,
      j?.appendUserAgent === agent && j?.appId === SCHEME,
    );
  }
  // Versions : plus hautes que celles de la base (1.0.1, versionCode 2 publié, build iOS 2 dans TestFlight).
  const before = {
    pkg: JSON.parse(mread("package.json", MOBILE_BASE)).version,
    name: /versionName "([^"]+)"/.exec(mread("android/app/build.gradle", MOBILE_BASE))?.[1],
    mkt: /MARKETING: ([\d.]+)/.exec(mread("codemagic.yaml", MOBILE_BASE))?.[1],
  };
  const gradle = mread("android/app/build.gradle");
  const pbx = mread("ios/App/App.xcodeproj/project.pbxproj");
  const now = {
    pkg: pkg.version,
    name: /versionName "([^"]+)"/.exec(gradle)?.[1],
    code: Number(/\?: "(\d+)"\) as int\)/.exec(gradle)?.[1]),
    mkt: /MARKETING: ([\d.]+)/.exec(mread("codemagic.yaml"))?.[1],
    pbxMkt: [...pbx.matchAll(/MARKETING_VERSION = ([\d.]+);/g)].map((m) => m[1]),
    pbxBuild: [...pbx.matchAll(/CURRENT_PROJECT_VERSION = (\d+);/g)].map((m) => Number(m[1])),
  };
  check(
    `version augmentée : ${before.pkg} → ${now.pkg} (package.json, versionName ${now.name}, Codemagic ${now.mkt}, Xcode ${now.pbxMkt.join("/")})`,
    semverGt(now.pkg, before.pkg) &&
      now.name === now.pkg &&
      now.mkt === now.pkg &&
      semverGt(now.pkg, before.name ?? "9") &&
      semverGt(now.pkg, before.mkt ?? "9") &&
      now.pbxMkt.length === 2 &&
      now.pbxMkt.every((v) => v === now.pkg),
    { before, now },
  );
  check(
    `build augmenté : versionCode ${now.code} (Android, 1.0.1 = 2), CURRENT_PROJECT_VERSION ${now.pbxBuild.join("/")} (iOS, TestFlight 1.0.1 (2))`,
    now.code >= 3 && now.pbxBuild.length === 2 && now.pbxBuild.every((b) => b >= 3),
  );
  // Construction Android : AAB signé par la clé d'envoi d'InvoiceLead, APK de contrôle.
  const signing = readEnv(`${HOME}/.android-signing/invoicelead-upload.env`);
  const out = `${MOBILE}/android/app/build/outputs`;
  rmSync(`${out}/bundle/release/app-release.aab`, { force: true });
  rmSync(`${out}/apk/debug/app-debug.apk`, { force: true });
  const gradlew = spawnSync("./gradlew", ["--no-daemon", "bundleRelease", "assembleDebug"], {
    cwd: `${MOBILE}/android`,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    timeout: 1_800_000,
    env: { ...process.env, ...signing, VERSION_CODE: String(now.code) },
  });
  check(
    "construction Android : ./gradlew bundleRelease assembleDebug",
    gradlew.status === 0,
    `${gradlew.stdout}${gradlew.stderr}`.slice(-600),
  );
  const tools = execSync(`ls -d ${HOME}/android-sdk/build-tools/* | sort -V | tail -1`, {
    encoding: "utf8",
  }).trim();
  const badging =
    spawnSync(`${tools}/aapt2`, ["dump", "badging", `${out}/apk/debug/app-debug.apk`], {
      encoding: "utf8",
    }).stdout ?? "";
  check(
    `APK construit : ${/package: [^\n]*/.exec(badging)?.[0]?.split(" platformBuild")[0]}`,
    badging.includes(`name='${SCHEME}'`) &&
      badging.includes(`versionCode='${now.code}'`) &&
      badging.includes(`versionName='${now.pkg}'`),
  );
  const tree =
    spawnSync(
      `${tools}/aapt2`,
      ["dump", "xmltree", "--file", "AndroidManifest.xml", `${out}/apk/debug/app-debug.apk`],
      { encoding: "utf8" },
    ).stdout ?? "";
  check(
    "manifeste fusionné de l'APK : intent-filter VIEW / BROWSABLE, scheme io.invoicelead.app, host lead-auth ; activité du navigateur (@capacitor/browser)",
    tree.includes('"android.intent.action.VIEW"') &&
      tree.includes('"android.intent.category.BROWSABLE"') &&
      tree.includes(`scheme(0x01010027)="${SCHEME}"`) &&
      tree.includes('host(0x01010028)="lead-auth"') &&
      /com\.capacitorjs\.plugins\.browser\.\w+/.test(tree),
  );
  const aab = `${out}/bundle/release/app-release.aab`;
  const verify = spawnSync("jarsigner", ["-verify", "-certs", "-verbose:summary", aab], {
    encoding: "utf8",
  });
  const certOf = (text) => /SHA-256 digest: ([0-9A-F:]+)|SHA256: ([0-9A-F:]+)/i.exec(text ?? "");
  const ks = spawnSync(
    "keytool",
    [
      "-list",
      "-v",
      "-keystore",
      signing.ANDROID_KEYSTORE_PATH,
      "-alias",
      signing.ANDROID_KEY_ALIAS,
      "-storepass:env",
      "ANDROID_KEYSTORE_PASSWORD",
    ],
    {
      encoding: "utf8",
      env: { ...process.env, ANDROID_KEYSTORE_PASSWORD: signing.ANDROID_KEYSTORE_PASSWORD },
    },
  );
  const keyFp = (certOf(ks.stdout)?.[1] ?? certOf(ks.stdout)?.[2] ?? "").toUpperCase();
  const pr = spawnSync("keytool", ["-printcert", "-jarfile", aab], { encoding: "utf8" });
  const aabFp = (certOf(pr.stdout)?.[1] ?? certOf(pr.stdout)?.[2] ?? "").toUpperCase();
  check(
    `AAB signé par la clé d'envoi d'InvoiceLead (empreinte ${keyFp.slice(0, 8)}…${keyFp.slice(-5)})`,
    verify.status === 0 &&
      /jar verified/i.test(verify.stdout) &&
      keyFp.length > 60 &&
      aabFp === keyFp,
    { verify: verify.status, same: aabFp === keyFp },
  );
  const inAab = execSync(
    `unzip -p ${JSON.stringify(aab)} base/manifest/AndroidManifest.xml | strings`,
    { encoding: "utf8" },
  );
  check(
    "AAB : le manifeste porte le schéma et l'hôte du lien de retour",
    inAab.includes(SCHEME) && inAab.includes("lead-auth"),
  );
  mkdirSync(PUBLICATIONS, { recursive: true });
  const target = `${PUBLICATIONS}/invoicelead-${now.pkg}-${now.code}.aab`;
  copyFileSync(aab, target);
  check(
    `AAB rangé pour la publication : ${target}`,
    sha256(readFileSync(target)) === sha256(readFileSync(aab)),
  );
  // iOS : pas de Xcode ici ; la construction se fait chez Codemagic (workflow ios-testflight), qui téléverse vers
  // App Store Connect : elle n'est PAS lancée par cette porte.
  const cm = mread("codemagic.yaml");
  check(
    `iOS : codemagic.yaml prêt (bundle ${SCHEME}, MARKETING ${now.mkt}, build = dernier TestFlight + 1), sans déclenchement automatique`,
    cm.includes(`bundle_identifier: ${SCHEME}`) &&
      now.mkt === now.pkg &&
      !/^\s*triggering:/m.test(cm),
  );
  note(
    `iOS : xcodebuild ${spawnSync("which", ["xcodebuild"]).status === 0 ? "présent" : "absent (Linux)"} ; construction iOS = Codemagic, non lancée (téléversement vers App Store Connect = décision d'Ève)`,
  );
  // Rien de soumis : la branche mobile n'est pas poussée (aucune construction distante possible depuis elle).
  const remote = spawnSync("git", ["ls-remote", "origin", `refs/heads/${BRANCH}`], {
    cwd: MOBILE,
    encoding: "utf8",
    timeout: 60_000,
  });
  check(
    "rien de soumis : branche google-app du dépôt mobile non poussée (Codemagic ne peut pas la construire), AAB seulement rangé en local",
    remote.status === 0 && remote.stdout.trim() === "",
    remote.status === 0 ? remote.stdout : remote.stderr,
  );
  finish("G2");
}

// ------------------------------------------------------------------ Vercel

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
async function production() {
  const live = (await vapi(`/v9/projects/${PROJECT}`)).targets?.production;
  return { id: live?.id, sha: live?.meta?.githubCommitSha ?? live?.meta?.gitCommitSha };
}
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
/** Secret d'automatisation de la protection des déploiements d'InvoiceLead (en mémoire seulement). */
async function bypassSecret() {
  const p = await vapi(`/v9/projects/${PROJECT}`);
  return Object.keys(p.protectionBypass ?? {}).find(
    (k) => p.protectionBypass[k].scope === "automation-bypass",
  );
}
const scrub = (text, secrets) => {
  let out = String(text ?? "");
  for (const s of secrets) if (typeof s === "string" && s.length >= 8) out = out.split(s).join("…");
  return out;
};
const endpoint = (host) => host.split(".")[0].replace(/-pooler$/, "");

/**
 * APERÇU : même méthode que l'aperçu ia-limites (scripts/ia-limites-preview.mjs) : code exact de HEAD (git archive),
 * `vercel deploy --target preview` (jamais --prod), variables passées au déploiement (aucune variable du projet
 * changée), alias stable. Base : celle des aperçus d'InvoiceLead (branche Neon br-purple-rice). Compte Lead : l'émetteur
 * de la production (LEAD_ID_ISSUER=https://erplead.io), comme l'app le verra ; client invoicelead et adresse de retour
 * déclarée chez ERPlead, secret du client FACTICE : l'aperçu n'échange jamais de code (G3 arrête le retour OpenID avant
 * InvoiceLead et mène vers l'aperçu d'ERPlead tout ce que le navigateur enverrait à erplead.io). LEAD_ID_ISSUER est
 * aussi passé au build : les pages statiques portent l'écoute du lien de retour.
 */
async function deployPreview() {
  assertWorktree();
  const dirty = git(["status", "--porcelain"]);
  if (!check("arbre propre", dirty === "", dirty)) finish("APERCU");
  const commit = git(["rev-parse", "HEAD"]);
  const before = await production();
  if (
    !check(
      `production inchangée avant l'aperçu (${PROD.id}, ${PROD.sha.slice(0, 7)})`,
      before.id === PROD.id && before.sha === PROD.sha,
      before,
    )
  )
    finish("APERCU");
  if ((statSync(STATE_FILE).mode & 0o777) !== 0o600)
    throw new Error(`${STATE_FILE} doit être en 600`);
  const st = JSON.parse(readFileSync(STATE_FILE, "utf8"));
  const prodLine = readFileSync(join(HOME, ".lead-e2e-ro.env"), "utf8")
    .split("\n")
    .find((l) => l.startsWith("INVOICELEAD_RO_URL="));
  const prodHost = new URL(prodLine.slice("INVOICELEAD_RO_URL=".length)).hostname;
  const pooled = new URL(st.secrets.databaseUrl).hostname;
  const direct = new URL(st.secrets.databaseUrlUnpooled).hostname;
  if (
    !check(
      `base d'aperçu ${st.neon.branchId} (${endpoint(direct)}), jamais la production (${endpoint(prodHost)})`,
      String(st.neon.branchId).startsWith("br-purple-rice") &&
        pooled === st.neon.pooledHost &&
        direct === st.neon.host &&
        endpoint(direct) !== endpoint(prodHost) &&
        endpoint(pooled) !== endpoint(prodHost),
    )
  )
    finish("APERCU");
  const app = `https://${PREVIEW_ALIAS}`;
  const runtime = {
    DATABASE_URL: st.secrets.databaseUrl,
    DATABASE_URL_UNPOOLED: st.secrets.databaseUrlUnpooled,
    APP_URL: app,
    SESSION_SECRET: randomBytes(36).toString("base64url"),
    LEAD_ID_ISSUER: "https://erplead.io",
    LEAD_ID_CLIENT_ID: "invoicelead",
    LEAD_ID_CLIENT_SECRET: `apercu-factice-${randomBytes(18).toString("base64url")}`,
    LEAD_ID_REDIRECT_URI: "https://invoicelead.io/auth/lead/callback",
    LEAD_ID_APP: "invoicelead",
    CRMLEAD_URL: "https://crmlead.invalid",
    RESEND_API_KEY: "re_apercu_neutralise",
    RESEND_API_URL: "https://resend.invalid",
    STRIPE_API_URL: "https://stripe.invalid",
    STRIPE_CONNECT_URL: "https://stripe-connect.invalid",
  };
  const build = { LEAD_ID_ISSUER: "https://erplead.io" };
  const envBefore = await projectEnv();
  const EXPORT = join("/tmp", "invoicelead-google-app-apercu");
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
    `googleAppCommit=${commit}`,
    "-m",
    `googleAppBranch=${BRANCH}`,
    ...Object.entries(runtime).flatMap(([k, v]) => ["-e", `${k}=${v}`]),
    ...Object.entries(build).flatMap(([k, v]) => ["-b", `${k}=${v}`]),
  ];
  if (args.includes("--prod") || args[args.indexOf("--target") + 1] !== "preview")
    throw new Error("cible non « preview »");
  const env = { ...process.env, VERCEL_ORG_ID: TEAM, VERCEL_PROJECT_ID: PROJECT };
  const secrets = [vercelToken(), ...Object.values(runtime)];
  const started = Date.now();
  const r = spawnSync("npx", args, {
    cwd: "/tmp",
    encoding: "utf8",
    maxBuffer: 64 << 20,
    env,
    timeout: 1_800_000,
  });
  rmSync(EXPORT, { recursive: true, force: true });
  const url = scrub(r.stdout, secrets).match(/https:\/\/[a-z0-9-]+\.vercel\.app/)?.[0];
  if (
    !check(
      "déploiement d'aperçu terminé",
      r.status === 0 && !!url,
      scrub(`${r.stdout}\n${r.stderr}`, secrets).slice(-800),
    )
  )
    finish("APERCU");
  const dep = await vapi(`/v13/deployments/${new URL(url).host}`);
  check(
    `aperçu ${dep.id} : prêt, cible preview, commit ${commit.slice(0, 7)} en métadonnée`,
    dep.readyState === "READY" &&
      dep.target !== "production" &&
      dep.id !== PROD.id &&
      dep.meta?.googleAppCommit === commit,
    { state: dep.readyState, target: dep.target },
  );
  const alias = spawnSync(
    "npx",
    ["--yes", VERCEL_CLI, "alias", "set", url, PREVIEW_ALIAS, "--scope", SCOPE],
    { cwd: "/tmp", encoding: "utf8", env },
  );
  check(`alias ${PREVIEW_ALIAS}`, alias.status === 0, scrub(alias.stderr, secrets).slice(-300));
  const pointed = await vapi(`/v4/aliases/${PREVIEW_ALIAS}`);
  check("l'alias pointe sur ce déploiement", pointed.deploymentId === dep.id);
  check("variables du projet Vercel inchangées", isDeepStrictEqual(await projectEnv(), envBefore));
  const after = await production();
  check(
    "production inchangée après l'aperçu",
    after.id === PROD.id && after.sha === PROD.sha,
    after,
  );
  mkdirSync(CAPTURES, { recursive: true });
  writeFileSync(
    APERCU_FILE,
    `${JSON.stringify(
      {
        id: dep.id,
        url,
        alias: app,
        commit,
        branch: BRANCH,
        deployedAt: new Date().toISOString(),
        buildSeconds: Math.round((Date.now() - started) / 1000),
        database: { branchId: st.neon.branchId, host: st.neon.host },
        leadIdIssuer: runtime.LEAD_ID_ISSUER,
        leadIdRedirectUri: runtime.LEAD_ID_REDIRECT_URI,
        note: "Aperçu Vercel (cible preview, protégé) par la CLI, code de git archive HEAD, variables passées au déploiement (secret du client factice : aucun échange de code). Lu par G3.",
        projectEnv: `${envBefore.length} variables du projet, inchangées`,
        production: PROD.id,
      },
      null,
      2,
    )}\n`,
  );
  note(`aperçu ${url} → ${app} (${dep.id}), commit ${commit.slice(0, 7)}`);
  finish("APERCU");
}

// ------------------------------------------------------------------ G3

/** Une requête SQL en LECTURE SEULE sur la base d'aperçu d'ERPlead : la valeur JSON de la première colonne. */
function sqlRead(url, query, params = []) {
  if (!new URL(url).hostname.startsWith(ERP_DB_HOST))
    throw new Error("lecture refusée : base d'aperçu attendue");
  const sql = params.reduce(
    (s, p, i) => s.split(`$${i + 1}`).join(`'${String(p).replace(/'/g, "''")}'`),
    query,
  );
  const out = execFileSync(
    "psql",
    [
      url,
      "-X",
      "-At",
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      `begin read only; select replace(coalesce((${sql})::text, 'null'), E'\\n', ' '); commit;`,
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  return JSON.parse(out.split("\n").find((l) => l && l !== "BEGIN" && l !== "COMMIT") ?? "null");
}
/** Écriture dans la base d'APERÇU d'ERPlead, seulement autour d'une personne d'une entreprise TEST du banc. */
async function previewWrite(t, userId, fn) {
  if (!new URL(t.rw).hostname.startsWith(ERP_DB_HOST))
    throw new Error("écriture refusée : base d'aperçu attendue");
  const pg = require("pg");
  const db = new pg.Client({
    connectionString: t.rw.replace("sslmode=require", "sslmode=verify-full"),
  });
  await db.connect();
  try {
    await db.query("begin");
    const who = (
      await db.query(
        "select o.is_test, o.name, u.email from users u join orgs o on o.id = u.org_id where u.id = $1",
        [userId],
      )
    ).rows[0];
    if (
      !who?.is_test ||
      !/^TEST /.test(who.name) ||
      !/^test\+[a-z0-9-]+@scanlead\.io$/.test(who.email)
    )
      throw new Error("écriture refusée : personne TEST du banc attendue");
    const out = await fn(db);
    await db.query("commit");
    return out;
  } catch (e) {
    await db.query("rollback").catch(() => {});
    throw e;
  } finally {
    await db.end();
  }
}

async function targets() {
  const il = JSON.parse(readFileSync(APERCU_FILE, "utf8"));
  const d = await vapi(`/v13/deployments/${il.id}`);
  check(
    `aperçu d'InvoiceLead ${il.id} : prêt, cible preview, jamais la production`,
    d.readyState === "READY" && d.target !== "production" && il.id !== PROD.id,
    { state: d.readyState, target: d.target },
  );
  check(
    `aperçu d'InvoiceLead bâti depuis HEAD (${git(["rev-parse", "--short", "HEAD"])}) ou un commit au même code applicatif`,
    d.meta?.googleAppCommit &&
      run("git", [
        "diff",
        "--quiet",
        d.meta.googleAppCommit,
        "HEAD",
        "--",
        "src",
        "messages",
        "public",
        "package.json",
        "package-lock.json",
        "next.config.ts",
        "vercel.json",
        "drizzle",
      ]).status === 0,
    d.meta?.googleAppCommit,
  );
  const pointed = await vapi(`/v4/aliases/${PREVIEW_ALIAS}`);
  check(`${PREVIEW_ALIAS} pointe sur cet aperçu`, pointed.deploymentId === il.id);
  const prod = await production();
  check(
    `production d'InvoiceLead inchangée (${PROD.id})`,
    prod.id === PROD.id && prod.sha === PROD.sha,
    prod,
  );
  const erp = JSON.parse(readFileSync(ERP_APERCU, "utf8"));
  const tok = vercelToken();
  const ed = await (
    await fetch(`https://api.vercel.com/v13/deployments/${erp.deployment}?teamId=${TEAM}`, {
      headers: { Authorization: `Bearer ${tok}` },
    })
  ).json();
  check(
    `aperçu d'ERPlead ${erp.deployment} : prêt, cible preview (${erp.url})`,
    ed.readyState === "READY" && !ed.target && `https://${ed.url}` === erp.url,
  );
  const ep = await (
    await fetch(`https://api.vercel.com/v9/projects/${ERP_PROJECT}?teamId=${TEAM}`, {
      headers: { Authorization: `Bearer ${tok}` },
    })
  ).json();
  check(
    "la production d'ERPlead n'est pas cet aperçu",
    ep.targets?.production?.id && ep.targets.production.id !== erp.deployment,
  );
  const env = readEnv(`${HOME}/.erplead-apercu.env`);
  const ro = env.APERCU_RO_URL;
  const rw = env.APERCU_DATABASE_URL_UNPOOLED;
  check(
    "base d'ERPlead : celle de l'APERÇU (royal-firefly), lecture par lead_e2e_ro, jamais la production",
    new URL(ro).hostname.startsWith(ERP_DB_HOST) &&
      new URL(rw).hostname.startsWith(ERP_DB_HOST) &&
      !new URL(rw).hostname.startsWith(ERP_PROD_DB_HOST) &&
      new URL(ro).username === "lead_e2e_ro",
  );
  return {
    il: il.alias,
    erp: erp.url,
    ro,
    rw,
    ilBypass: await bypassSecret(),
    erpBypass: readFileSync(`${HOME}/.erplead-bypass`, "utf8").trim(),
  };
}

function benchPerson(t) {
  const state = JSON.parse(readFileSync(`${HOME}/projets/lead-e2e/state.json`, "utf8"));
  for (const p of state.orgs[ORG_INDEX].people.filter((x) => x.role !== "admin")) {
    const row = sqlRead(
      t.ro,
      `select json_build_object('id', u.id, 'email', u.email, 'name', u.name, 'org_name', o.name, 'is_test', o.is_test,
        'status', u.status, 'verified', u.email_verified, 'locale', u.locale, 'last_login_at', u.last_login_at,
        'totp', exists(select 1 from totp x where x.user_id = u.id and x.enabled))
      from users u join orgs o on o.id = u.org_id where lower(u.email) = lower($1)`,
      [p.email],
    );
    if (
      row?.is_test === true &&
      /^TEST /.test(row.org_name) &&
      row.status === "active" &&
      row.verified &&
      !row.totp
    )
      return row;
  }
  check(
    `personne TEST de l'entreprise ${ORG_INDEX + 1} du banc dans la base d'aperçu d'ERPlead`,
    false,
  );
  finish("G3");
}

async function gateG3() {
  assertWorktree();
  const t = await targets();
  if (failures) finish("G3");
  const who = benchPerson(t);
  const startedAt = new Date();
  mkdirSync(CAPTURES, { recursive: true });
  // Journal (audit) et frein des départs (rate_limits « gapp|<ip> ») d'ERPlead : ce que la porte y écrit
  // est relevé étape par étape (lignes repérées par leur numéro), puis effacé ou rendu à la fin.
  const auditMax = () => sqlRead(t.ro, "select coalesce(max(id), 0) from audit");
  const gappLimits = () =>
    sqlRead(
      t.ro,
      "select coalesce(json_object_agg(key, json_build_object('count', count, 'reset_at', reset_at)), '{}'::json) from rate_limits where key like 'gapp|%'",
    );
  const audits = []; // { step, ids } : les lignes de journal écrites par la porte
  /** Les lignes `action` (app, issue) écrites depuis `from` : celles de cette étape de la porte. */
  const auditSince = (from, step, action, app, outcome) => {
    const ids = sqlRead(
      t.ro,
      `select coalesce(json_agg(id order by id), '[]'::json) from audit where id > $1 and action = $2
        and coalesce(data->>'app', '') = $3 and coalesce(data->>'outcome', '') = $4`,
      [from, action, app ?? "", outcome ?? ""],
    );
    audits.push({ step, ids: ids.slice(0, 1) });
    return ids.length;
  };
  const limitsBefore = gappLimits();
  let limitsUndone = 0;
  const { chromium } = require("@playwright/test");
  const browser = await chromium.launch({ headless: true });
  const BRIDGE = readFileSync(join(ROOT, "tests/support/fake-capacitor.js"), "utf8");
  const PROD_ERP = "https://erplead.io";
  const PROD_IL = "https://invoicelead.io";
  const madeStates = [];
  const madeVh = [];
  const shots = [];
  const production = []; // requêtes du navigateur vers erplead.io / invoicelead.io : toutes interceptées, aucune envoyée
  const leaked = []; // requêtes réseau réelles vers la production (attendu : aucune)
  const callbacks = []; // retours OpenID vers InvoiceLead (arrêtés par la porte)
  const googleInWebview = [];
  const shot = async (page, name) => {
    await page.screenshot({ path: `${CAPTURES}/${name}.png`, fullPage: true });
    shots.push(`${name}.png`);
  };
  const meta = (to) => `<!doctype html><meta http-equiv="refresh" content="0;url=${esc(to)}">`;
  /** Ce que le navigateur enverrait à la production, mené vers l'aperçu équivalent (ou arrêté). */
  const toPreview = (u) =>
    u.startsWith(`${PROD_ERP}/`)
      ? t.erp + u.slice(PROD_ERP.length)
      : u.startsWith(`${PROD_IL}/lead-auth/`)
        ? t.il + u.slice(PROD_IL.length)
        : null;
  /**
   * Un contexte de navigateur (vue web de l'app, navigateur du téléphone, ordinateur). Jamais une redirection suivie par
   * le navigateur (route() ne verrait pas la suivante) : chaque réponse 3xx des aperçus est lue (fetch sans suivre) et
   * rendue en page 200 qui renvoie (meta refresh), ses cookies gardés ; chaque requête vers la production est
   * interceptée : menée vers l'aperçu, ou arrêtée (retour OpenID vers InvoiceLead).
   */
  async function context(ua, kind, launchUrl) {
    const ctx = await browser.newContext({
      userAgent: ua,
      viewport: kind === "desktop" ? { width: 1280, height: 900 } : { width: 390, height: 844 },
      deviceScaleFactor: kind === "desktop" ? 1 : 2,
      locale: "it-CH",
    });
    const calls = [];
    ctx.on("request", (r) => {
      if (/^https:\/\/accounts\.google\.com\//.test(r.url()) && kind === "webview")
        googleInWebview.push(r.url());
    });
    ctx.on("requestfinished", async (r) => {
      if (/^https:\/\/((www\.)?invoicelead\.io|erplead\.io)\//.test(r.url())) {
        const res = await r.response().catch(() => null);
        // Réponse fabriquée par la porte (route.fulfill) : en-tête x-gate ; toute autre viendrait du réseau.
        if (!res || (await res.headerValue("x-gate")) !== "1") leaked.push(r.url());
      }
    });
    if (kind === "webview") {
      await ctx.exposeBinding("__bridgeCall", ({ page }, name, arg) => {
        calls.push({ name, arg, url: page.url() });
      });
      if (launchUrl)
        await ctx.addInitScript((u) => {
          window.__FAKE_CAPACITOR = { launchUrl: u };
        }, launchUrl);
      await ctx.addInitScript({ content: BRIDGE });
      await ctx.route(/^https:\/\/accounts\.google\.com\//, (route) => route.abort());
    }
    await ctx.route(/^https:\/\/((www\.)?invoicelead\.io|erplead\.io)\//, async (route) => {
      const u = route.request().url();
      production.push(u);
      const headers = {
        "content-type": "text/html; charset=utf-8",
        "x-gate": "1",
        "cache-control": "no-store",
      };
      if (u.startsWith(`${PROD_IL}/auth/lead/callback`)) {
        callbacks.push(u);
        return route.fulfill({
          status: 200,
          headers,
          body: "<!doctype html><title>Arrêt de la porte</title><p data-gate-stop>Retour OpenID vers InvoiceLead (arrêté par la porte G3).</p>",
        });
      }
      const to = toPreview(u);
      if (!to || !route.request().isNavigationRequest())
        return route.fulfill({ status: 404, headers, body: "" });
      return route.fulfill({ status: 200, headers, body: meta(to) });
    });
    const previews = new RegExp(
      `^(${t.il.replace(/[.]/g, "\\.")}|${t.erp.replace(/[.]/g, "\\.")})/`,
    );
    await ctx.route(previews, async (route) => {
      let res;
      try {
        res = await route.fetch({ maxRedirects: 0 });
      } catch {
        return route.abort();
      }
      const loc = res.headers().location;
      if (res.status() >= 300 && res.status() < 400 && loc) {
        const abs = new URL(loc, route.request().url()).toString();
        const headers = { ...res.headers() };
        for (const h of [
          "location",
          "content-length",
          "content-encoding",
          "content-security-policy",
        ])
          delete headers[h];
        headers["content-type"] = "text/html; charset=utf-8";
        if (!route.request().isNavigationRequest())
          return route.fulfill({ status: 204, headers, body: "" });
        return route.fulfill({ status: 200, headers, body: meta(abs) });
      }
      return route.fulfill({ response: res });
    });
    const page = await ctx.newPage();
    // Protection des aperçus : cookies de contournement (les deux aperçus).
    await page.goto(
      `${t.il}/api/health?x-vercel-protection-bypass=${t.ilBypass}&x-vercel-set-bypass-cookie=samesitenone`,
    );
    await page.goto(
      `${t.erp}/healthz?x-vercel-protection-bypass=${t.erpBypass}&x-vercel-set-bypass-cookie=samesitenone`,
    );
    return { ctx, page, calls };
  }
  const named = (calls, n) => calls.filter((c) => c.name === n);
  const waitFor = async (fn, ms = 20_000) => {
    const until = Date.now() + ms;
    while (Date.now() < until) {
      const v = await fn();
      if (v) return v;
      await new Promise((r) => setTimeout(r, 150));
    }
    return null;
  };
  try {
    // --- 1. Vue web de la nouvelle version : écran de connexion d'InvoiceLead → Compte Lead.
    const wv = await context(NEW_APP, "webview");
    await wv.page.goto(`${t.il}/it/login`);
    await wv.page.waitForURL(`${t.erp}/login?**`, { timeout: 30_000 });
    const authorizeHop = production.find((u) => u.startsWith(`${PROD_ERP}/oauth/authorize?`));
    const asked = new URL(authorizeHop ?? "https://x.invalid");
    const ilState = asked.searchParams.get("state") ?? "";
    check(
      "l'écran de connexion de l'app (LeadAppAuth/1) lit le lien de lancement puis part vers le Compte Lead (client invoicelead, platform=app, adresse de retour déclarée)",
      named(wv.calls, "App.getLaunchUrl").length >= 1 &&
        asked.searchParams.get("client_id") === "invoicelead" &&
        asked.searchParams.get("platform") === "app" &&
        asked.searchParams.get("redirect_uri") === "https://invoicelead.io/auth/lead/callback" &&
        asked.searchParams.get("code_challenge_method") === "S256" &&
        ilState.length > 20,
      authorizeHop,
    );
    const g = wv.page.locator('a[href^="/auth/google/app?"]');
    check(
      "écran du Compte Lead dans la vue web : un bouton « Continuer avec Google » de l'app (/auth/google/app), Apple et le mot de passe",
      (await g.count()) === 1 &&
        (await wv.page.locator('a[href^="/auth/apple?"]').count()) === 1 &&
        (await wv.page.locator('input[name="password"]').count()) === 1 &&
        (await wv.page.locator("[data-google-app-hint]").count()) === 0,
    );
    await shot(wv.page, "g3-1-compte-lead-bouton-google");
    // --- 2. Clic : départ (cookie verifier de la vue web), puis la page relais d'InvoiceLead.
    const beforeStart = auditMax();
    await g.click();
    await wv.page.waitForURL(`${t.il}/it/lead-auth/google?**`, { timeout: 30_000 });
    const opened = await waitFor(() => named(wv.calls, "Browser.open")[0]);
    check(
      "journal d'ERPlead : le départ écrit une ligne google_app.start {app: invoicelead}, relevée pour la remise en état",
      auditSince(beforeStart, "départ", "google_app.start", "invoicelead", null) >= 1,
    );
    const start = String(opened?.arg ?? "");
    const relay = production.find((u) => u.startsWith(`${PROD_IL}/lead-auth/google?`)) ?? "";
    const back = new URL(relay || "https://x.invalid").searchParams.get("back") ?? "";
    check(
      "ERPlead envoie la vue web vers la page relais https://invoicelead.io/lead-auth/google (start, back), menée vers l'aperçu, dans la langue de l'écran (it)",
      relay.startsWith(`${PROD_IL}/lead-auth/google?start=`) &&
        back.startsWith(`${PROD_ERP}/login?`) &&
        new URL(wv.page.url()).pathname === "/it/lead-auth/google",
      relay,
    );
    await wv.page
      .getByRole("heading", { name: "Accesso con Google…" })
      .waitFor({ timeout: 10_000 })
      .catch(() => {});
    check(
      "page relais : « Accesso con Google… », lien « Indietro » vers l'écran de connexion d'ERPlead",
      (await wv.page.getByRole("heading", { name: "Accesso con Google…" }).count()) === 1 &&
        (await wv.page.locator("a[data-lead-auth-back]").getAttribute("href")) === back,
    );
    check(
      "page relais : Browser.open sur le départ d'ERPlead tel quel (https://erplead.io/auth/google/app/start?d=invoicelead.…), écoute du retour posée",
      start.startsWith(`${PROD_ERP}/auth/google/app/start?d=invoicelead.`) &&
        named(wv.calls, "App.addListener").some((c) => c.arg === "appUrlOpen") &&
        named(wv.calls, "Browser.addListener").some((c) => c.arg === "browserFinished"),
      start,
    );
    await shot(wv.page, "g3-2-page-relais-it");
    const cookie = (await wv.ctx.cookies(t.erp)).find((c) => c.name === "__Host-erp_gapp");
    check(
      "cookie verifier de la vue web __Host-erp_gapp : HttpOnly, Secure, Lax, 10 min (jamais lu par InvoiceLead)",
      cookie?.httpOnly &&
        cookie.secure &&
        cookie.sameSite === "Lax" &&
        Math.abs(cookie.expires - (Date.now() / 1000 + 600)) < 120,
    );
    const vh = cookie ? sha256(cookie.value) : "";
    madeVh.push(vh);
    const d = new URL(start || "https://x.invalid").searchParams.get("d") ?? "";
    const dep = sqlRead(
      t.ro,
      "select data from sso_states where state = $1 and expires_at > now()",
      [sha256(d)],
    );
    check(
      "départ dans la base d'APERÇU d'ERPlead : app invoicelead, empreinte du verifier, demande d'InvoiceLead (son state)",
      dep?.provider === "google-app-start" &&
        dep.app === "invoicelead" &&
        dep.vh === vh &&
        new URLSearchParams(dep.next?.split("?")[1]).get("state") === ilState,
    );
    // --- 3. Navigateur du téléphone (sans pont) : départ → accounts.google.com.
    const sys = await context(SAFARI, "system");
    const googleReq = [];
    sys.page.on("request", (r) => {
      if (r.url().startsWith("https://accounts.google.com/o/oauth2/v2/auth"))
        googleReq.push(r.url());
    });
    await sys.page.goto(toPreview(start), { waitUntil: "domcontentloaded" }).catch(() => {});
    await waitFor(() => googleReq.length > 0 && /accounts\.google\.com/.test(sys.page.url()));
    await sys.page.waitForLoadState("load").catch(() => {});
    const gu = googleReq[0] ? new URL(googleReq[0]) : null;
    const gstate = gu?.searchParams.get("state") ?? "";
    if (gstate) madeStates.push(sha256(gstate));
    const gText = await sys.page.content().catch(() => "");
    check(
      "navigateur du téléphone : le départ mène à accounts.google.com (redirect_uri https://erplead.io/auth/google/callback, state app.invoicelead.…, PKCE S256, hl=it), sans erreur Google",
      gu &&
        gu.searchParams.get("redirect_uri") === "https://erplead.io/auth/google/callback" &&
        gstate.startsWith("app.invoicelead.") &&
        gu.searchParams.get("code_challenge_method") === "S256" &&
        gu.searchParams.get("hl") === "it" &&
        new URL(sys.page.url()).host === "accounts.google.com" &&
        !/redirect_uri_mismatch|invalid_client|disallowed_useragent|Error 400|Errore 400/i.test(
          gText,
        ),
      googleReq[0] ?? sys.page.url(),
    );
    await shot(sys.page, "g3-3-google-navigateur-du-telephone");
    const gs = sqlRead(
      t.ro,
      "select data from sso_states where state = $1 and expires_at > now()",
      [sha256(gstate)],
    );
    check(
      "état Google de l'app en base d'APERÇU (même empreinte, même demande), départ consommé",
      gs?.provider === "google" &&
        gs.app === "invoicelead" &&
        gs.vh === vh &&
        gs.next === dep?.next &&
        sqlRead(t.ro, "select count(*) from sso_states where state = $1", [sha256(d)]) === 0,
    );
    // --- 4. Retour de Google imité : le code que le callback d'ERPlead aurait fait, pour la personne TEST.
    const code = randomBytes(32).toString("base64url");
    await previewWrite(t, who.id, async (db) => {
      await db.query("delete from sso_states where state = $1", [sha256(gstate)]);
      await db.query(
        "insert into sso_states (state, data, expires_at) values ($1, $2, now() + interval '5 minutes')",
        [
          sha256(code),
          JSON.stringify({
            provider: "google-app-code",
            app: "invoicelead",
            vh,
            next: gs?.next,
            locale: gs?.locale ?? "it",
            result: { profile: { email: who.email, name: who.name, locale: who.locale } },
          }),
        ],
      );
    });
    const link = `${SCHEME}://lead-auth?code=${code}`;
    const retUrl = `${t.erp}/auth/google/app/return?${new URLSearchParams({ app: "invoicelead", code, locale: "it" })}`;
    const retHtml = await (await sys.ctx.request.get(retUrl)).text();
    check(
      "page « Revenez dans InvoiceLead » d'ERPlead : lien io.invoicelead.app://lead-auth?code=… suivi tout seul et en bouton",
      retHtml.includes(`<meta http-equiv="refresh" content="0;url=${esc(link)}">`) &&
        retHtml.includes(`href="${esc(link)}"`),
    );
    const cap = await sys.ctx.newPage();
    await cap.route(
      retUrl,
      async (route) => {
        const res = await route.fetch();
        await route.fulfill({
          response: res,
          body: (await res.text()).replace(/<meta http-equiv="refresh"[^>]*>/, ""),
        });
      },
      { times: 1 },
    );
    await cap.goto(retUrl);
    await shot(cap, "g3-4-revenez-dans-invoicelead");
    await cap.close();
    await sys.ctx.close();
    // --- 5. Le lien de retour arrive dans l'app (appUrlOpen) : Browser.close, rachat, session, retour OpenID.
    const before = production.length;
    const beforeRedeem = auditMax();
    await wv.page.evaluate((u) => window.__fakeEmit("App.appUrlOpen", { url: u }), link);
    await waitFor(() => callbacks.length > 0, 40_000);
    check(
      "journal d'ERPlead : le rachat écrit une ligne google_app.redeem {app: invoicelead, outcome: ok}, relevée",
      auditSince(beforeRedeem, "rachat", "google_app.redeem", "invoicelead", "ok") >= 1,
    );
    const hops = production.slice(before);
    const redeemHops = hops.filter((u) => u.startsWith(`${PROD_ERP}/auth/google/app/redeem?`));
    check(
      "lien de retour : Browser.close une fois, puis la vue web va au rachat d'ERPlead avec le code, une fois",
      named(wv.calls, "Browser.close").length === 1 &&
        redeemHops.length === 1 &&
        redeemHops[0] === `${PROD_ERP}/auth/google/app/redeem?code=${code}`,
      { close: named(wv.calls, "Browser.close").length, redeem: redeemHops.length },
    );
    const cb = new URL(callbacks[0] ?? "https://x.invalid");
    check(
      "rachat → l'autorisation d'InvoiceLead reprend : retour OpenID https://invoicelead.io/auth/lead/callback avec un code et LE state de l'écran de connexion d'InvoiceLead (arrêté par la porte)",
      `${cb.origin}${cb.pathname}` === `${PROD_IL}/auth/lead/callback` &&
        /^[A-Za-z0-9_-]{43}$/.test(cb.searchParams.get("code") ?? "") &&
        cb.searchParams.get("state") === ilState &&
        cb.searchParams.get("iss") === PROD_ERP,
      cb.origin + cb.pathname,
    );
    const oidc = sqlRead(
      t.ro,
      `select json_build_object('client', client_id, 'uri', redirect_uri, 'user', user_id, 'used', used_at is not null)
        from codes where code_hash = $1`,
      [sha256(cb.searchParams.get("code") ?? "")],
    );
    check(
      "le code OpenID est celui de la personne TEST, pour InvoiceLead (client invoicelead, adresse de retour déclarée), pas encore utilisé",
      oidc?.client === "invoicelead" &&
        oidc.uri === `${PROD_IL}/auth/lead/callback` &&
        oidc.user === who.id &&
        oidc.used === false,
    );
    const sid = (await wv.ctx.cookies(t.erp)).find((c) => c.name === "__Host-erp_sid");
    check(
      "personne TEST connectée dans la vue web de l'app : session ERPlead (méthode google, agent InvoiceLeadApp LeadAppAuth/1), cookie verifier effacé",
      !!sid &&
        !(await wv.ctx.cookies(t.erp)).some((c) => c.name === "__Host-erp_gapp") &&
        sqlRead(
          t.ro,
          "select count(*) from sessions where user_id = $1 and method = 'google' and created_at >= $2 and user_agent like $3",
          [who.id, startedAt.toISOString(), "%InvoiceLeadApp LeadAppAuth/1%"],
        ) >= 1,
    );
    const acc = await wv.page.goto(`${t.erp}/account`);
    check(
      "Mon compte dans la vue web : la personne TEST",
      acc?.status() === 200 && (await wv.page.content()).includes(esc(who.email)),
    );
    await wv.page.evaluate(() => {
      for (const el of document.querySelectorAll("body *")) {
        if (el.children.length === 0 && /test\+[\w-]+@scanlead\.io/.test(el.textContent ?? ""))
          el.textContent = (el.textContent ?? "").replace(/test\+[\w-]+@/, "test+…@");
        // Adresse IP de la session (celle de la machine de la porte) : masquée sur la capture.
        if (el.children.length === 0 && /\b\d{1,3}(\.\d{1,3}){3}\b/.test(el.textContent ?? ""))
          el.textContent = (el.textContent ?? "").replace(/\b\d{1,3}(\.\d{1,3}){3}\b/g, "…");
      }
    });
    await shot(wv.page, "g3-5-connectee-mon-compte");
    // --- 5b. Un lien de l'app sans connexion en cours (page piégée, courriel) sur une page d'InvoiceLead :
    // rien ne se passe (ni navigateur fermé, ni page quittée, ni rachat).
    await wv.page.goto(`${t.il}/it/legal/terms`);
    await waitFor(() =>
      wv.page.evaluate(() => window.__fakeListeners?.("App.appUrlOpen") > 0).catch(() => false),
    );
    const trapFrom = production.length;
    const closes = named(wv.calls, "Browser.close").length;
    for (const u of [
      `${SCHEME}://lead-auth?code=${randomBytes(32).toString("base64url")}`,
      `${SCHEME}://lead-auth?error=expired`,
    ])
      await wv.page.evaluate((x) => window.__fakeEmit("App.appUrlOpen", { url: x }), u);
    await wv.page.waitForTimeout(1500);
    check(
      "lien de l'app reçu sans connexion en cours (code inconnu, error=expired) : ignoré sur la page ouverte (aucun rachat, aucune navigation, navigateur non refermé)",
      new URL(wv.page.url()).pathname === "/it/legal/terms" &&
        !production.slice(trapFrom).some((u) => u.includes("/auth/google/app/redeem")) &&
        named(wv.calls, "Browser.close").length === closes,
      {
        url: new URL(wv.page.url()).pathname,
        close: named(wv.calls, "Browser.close").length - closes,
      },
    );
    // --- 6. Le même lien, relu par la page suivante de la MÊME vue web (iOS le redonne à getLaunchUrl) : ignoré.
    await wv.ctx.addInitScript((u) => {
      window.__FAKE_CAPACITOR = { launchUrl: u };
    }, link);
    const reads = named(wv.calls, "App.getLaunchUrl").length;
    const n = production.length;
    await wv.page.goto(`${t.il}/it/legal/privacy`);
    await waitFor(() => named(wv.calls, "App.getLaunchUrl").length > reads, 10_000);
    await wv.page.waitForTimeout(1500);
    check(
      "le même lien relu par la page suivante de l'app (getLaunchUrl) : ignoré (aucun rachat, aucune navigation)",
      named(wv.calls, "App.getLaunchUrl").length > reads &&
        named(wv.calls, "App.getLaunchUrl").at(-1)?.arg === link &&
        !production.slice(n).some((u) => u.includes("/redeem")) &&
        new URL(wv.page.url()).pathname === "/it/legal/privacy" &&
        named(wv.calls, "Browser.close").length === 1,
    );
    // Rachat rejoué par la vue web : refusé (usage unique) — contrôle d'ERPlead, vu depuis l'app.
    const beforeReplay = auditMax();
    const replay = await wv.ctx.request.get(`${t.erp}/auth/google/app/redeem?code=${code}`, {
      maxRedirects: 0,
    });
    check(
      "le même code une seconde fois → écran de connexion, error=expired",
      replay.status() === 303 && /error=expired/.test(replay.headers().location ?? ""),
    );
    // Sans cookie ni vue, ERPlead ne sait plus de quelle app il s'agit : {app: null, outcome: expired}.
    check(
      "journal d'ERPlead : le rachat rejoué écrit une ligne google_app.redeem {app: null, outcome: expired}, relevée",
      auditSince(beforeReplay, "rachat rejoué", "google_app.redeem", null, "expired") >= 1,
    );
    await wv.ctx.close();
    check(
      "Google ne s'ouvre jamais dans la vue web",
      googleInWebview.length === 0,
      googleInWebview,
    );
    // --- 7. Ancienne version et navigateur : comme avant.
    const old = await context(OLD_APP, "webview");
    const r = await old.ctx.request.get(`${t.il}/it/login`, { maxRedirects: 0 });
    check(
      "ancienne version de l'app (sans LeadAppAuth/1) : /it/login part tout droit vers /auth/lead/start (redirection serveur, comme avant)",
      [303, 307].includes(r.status()) &&
        (r.headers().location ?? "").includes("/auth/lead/start?locale=it"),
      r.status(),
    );
    await old.ctx.close();
    const web = await context(
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
      "desktop",
    );
    await web.page.goto(`${t.il}/lead-auth/google?${new URLSearchParams({ start, back })}`);
    await web.page.waitForURL(`${t.erp}/login?**`, { timeout: 30_000 });
    check(
      "hors de l'app (navigateur d'ordinateur, aucun pont) : la page relais ne fait que revenir à l'écran de connexion d'ERPlead",
      new URL(web.page.url()).searchParams.get("locale") === "it",
    );
    const plainLogin = await web.ctx.request.get(`${t.il}/it/login`, { maxRedirects: 0 });
    check(
      "navigateur : /it/login inchangé (redirection serveur vers /auth/lead/start)",
      [303, 307].includes(plainLogin.status()),
    );
    await web.ctx.close();
    check(
      "aucune requête n'a atteint la production (erplead.io, invoicelead.io) : toutes interceptées par la porte",
      leaked.length === 0,
      leaked,
    );
  } finally {
    await browser.close();
    // --- Base d'APERÇU d'ERPlead remise comme avant (seulement ce que cette porte a fait).
    await previewWrite(t, who.id, async (db) => {
      const s = await db.query(
        "delete from sessions where user_id = $1 and created_at >= $2 and user_agent like $3",
        [who.id, startedAt, "%InvoiceLeadApp LeadAppAuth/1%"],
      );
      const c = await db.query(
        "delete from codes where user_id = $1 and client_id = 'invoicelead' and expires_at >= $2",
        [who.id, startedAt],
      );
      const st = await db.query(
        "delete from sso_states where state = any($1) or data->>'vh' = any($2) or state = any($3)",
        [madeStates, madeVh, madeVh.map((v) => `gapp-view:${v}`)],
      );
      const au = await db.query("delete from audit where id = any($1::bigint[])", [
        audits.flatMap((a) => a.ids),
      ]);
      // Frein des départs : le passage de la porte (un départ, donc +1) retiré du compteur de son IP.
      const limitsNow = (
        await db.query(
          "select key, count, reset_at from rate_limits where key like 'gapp|%' order by key",
        )
      ).rows;
      let undone = 0;
      for (const row of limitsNow) {
        const was = limitsBefore[row.key];
        // Fenêtre déjà échue avant la porte : le départ de la porte a remis le compteur à 1.
        const lapsed = was && new Date(was.reset_at).getTime() <= startedAt.getTime();
        const exact = was && (lapsed ? row.count === 1 : row.count === was.count + 1);
        if (was && !lapsed && row.count <= was.count) continue;
        if (exact) {
          undone += (
            await db.query(
              "update rate_limits set count = $2, reset_at = $3 where key = $1 and count = $4",
              [row.key, was.count, was.reset_at, row.count],
            )
          ).rowCount;
        } else if (!was && row.count <= 1) {
          undone += (
            await db.query("delete from rate_limits where key = $1 and count <= 1", [row.key])
          ).rowCount;
        } else if (row.count > 1) {
          // D'autres départs sont passés en même temps (autre porte) : seul celui de la porte est retiré.
          undone += (
            await db.query(
              "update rate_limits set count = count - 1 where key = $1 and count > 1",
              [row.key],
            )
          ).rowCount;
        }
      }
      limitsUndone = undone;
      await db.query("update users set last_login_at = $2, locale = $3 where id = $1", [
        who.id,
        who.last_login_at,
        who.locale,
      ]);
      note(
        `remise en état : ${s.rowCount} session(s), ${c.rowCount} code(s) OpenID, ${st.rowCount} état(s), ${au.rowCount} ligne(s) de journal sur ${audits.flatMap((a) => a.ids).length} écrite(s) effacées, ${undone} compteur(s) du frein des départs rendus ; dernière connexion et langue reprises`,
      );
    });
  }
  const after = sqlRead(
    t.ro,
    `select json_build_object('sessions', (select count(*) from sessions where user_id = $1 and created_at >= $2 and user_agent like '%InvoiceLeadApp LeadAppAuth/1%'),
      'states', (select count(*) from sso_states where data->>'vh' = any(string_to_array($3, ',')) or state = any(string_to_array($4, ','))),
      'last_login_at', (select last_login_at from users where id = $1), 'locale', (select locale from users where id = $1))`,
    [who.id, startedAt.toISOString(), madeVh.join(","), madeStates.join(",")],
  );
  check(
    "base d'APERÇU d'ERPlead remise comme avant (aucune session ni aucun état de la porte, dernière connexion et langue d'avant)",
    after.sessions === 0 &&
      after.states === 0 &&
      after.locale === who.locale &&
      after.last_login_at === who.last_login_at,
    after,
  );
  const written = audits.flatMap((a) => a.ids);
  check(
    `journal d'ERPlead remis comme avant : les ${written.length} ligne(s) écrites par la porte (départ, rachat, rachat rejoué) effacées`,
    written.length === 3 &&
      audits.every((a) => a.ids.length === 1) &&
      sqlRead(
        t.ro,
        "select count(*) from audit where id = any(string_to_array($1, ',')::bigint[])",
        [written.join(",")],
      ) === 0,
    audits.map((a) => `${a.step}: ${a.ids.length}`),
  );
  const limitsAfter = gappLimits();
  check(
    "frein des départs d'ERPlead (rate_limits « gapp|<ip> ») rendu comme avant la porte",
    limitsUndone >= 1 && isDeepStrictEqual(limitsAfter, limitsBefore),
    {
      avant: Object.keys(limitsBefore).length,
      après: Object.keys(limitsAfter).length,
      rendus: limitsUndone,
    },
  );
  note(`captures : ${CAPTURES}/ (${shots.length}) ${shots.join(", ")}`);
  finish("G3");
}

// ------------------------------------------------------------------ entrée

const gate = process.argv[2];
if (gate === "G1") gateG1();
else if (gate === "G2") gateG2();
else if (gate === "APERCU") await deployPreview();
else if (gate === "G3") await gateG3();
else {
  console.log("usage : node scripts/google-app-gates.mjs G1|G2|APERCU|G3");
  process.exit(2);
}
