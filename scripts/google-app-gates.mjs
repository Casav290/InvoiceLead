#!/usr/bin/env node
/**
 * Portes du chantier « Continuer avec Google dans les apps mobiles », part d'InvoiceLead (30.10.2026, révisé le
 * même jour : liens VÉRIFIÉS, choix d'Ève). Ledger ~/projets/.unlazy/google-app/gates/leaf-invoicelead.md, cahier
 * ../CAHIER.md, contrat d'ERPlead ~/projets/erplead-google-app/docs/GOOGLE-APP.md, ici docs/GOOGLE-APP.md. À la
 * racine du worktree (branche google-app) :
 *
 *   node scripts/google-app-gates.mjs G1      essais du retour (tests/unit/lead-app-auth.test.ts, faux pont : lien
 *                                             vérifié https://invoicelead.io/lead-auth/return, module iOS
 *                                             LeadAuthSession, Custom Tab Android, page de repli, fichiers
 *                                             d'association) et contre-épreuves (faute posée dans une COPIE du code :
 *                                             l'essai gardien échoue) ; contrôles complets (Biome, types, Vitest,
 *                                             build, Playwright dont tests/e2e/google-app.spec.ts) ; contrat relu
 *   node scripts/google-app-gates.mjs G2      dépôt mobile ~/projets/invoicelead-mobile (branche google-app) : droits
 *                                             Associated Domains, module LeadAuthSession, intent-filter autoVerify,
 *                                             schéma propre retiré, agent LeadAppAuth/2, plugins synchronisés, version
 *                                             et build, construction Android (AAB signé par la clé d'envoi, APK de
 *                                             contrôle), empreintes du assetlinks.json (clé d'envoi, Play App Signing
 *                                             lu par l'API Play en lecture seule), rien de soumis
 *   node scripts/google-app-gates.mjs APERCU  aperçu Vercel de HEAD (jamais la production), variables passées au
 *                                             déploiement (méthode ia-limites), alias invoicelead-google-app-test
 *   node scripts/google-app-gates.mjs G3      aperçu d'InvoiceLead + aperçu d'ERPlead (GOOGLE_APP_ENABLED=1 sur cet
 *                                             aperçu seulement) : fichiers d'association et page de repli servis ;
 *                                             Chromium sans tête qui imite la vue web de l'app (agent LeadAppAuth/2,
 *                                             faux pont iOS ou Android) : bouton Google, page relais, départ jusqu'à
 *                                             accounts.google.com, VRAI retour « annulé » de l'aperçu d'ERPlead (session
 *                                             iOS, Custom Tab, Safari et son bouton), code préparé dans la base
 *                                             d'APERÇU d'ERPlead → personne TEST connectée, code OpenID rendu à
 *                                             InvoiceLead avec SA demande ; base, journal et frein remis comme avant
 *
 * Chaque porte n'imprime son jeton GOOGLE_APP_Gx_OK qu'à la fin, si aucun contrôle n'a échoué. Aucun secret affiché.
 * Jamais la production : aucune requête du navigateur ne part vers erplead.io ni invoicelead.io (interceptées et
 * menées vers les aperçus, ou arrêtées), aucun « vercel --prod », aucune variable du projet Vercel changée, aucun
 * compte Apple / Google modifié (l'API Play n'est que lue).
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
const CONTRACT = `${ERP_REPO}/docs/GOOGLE-APP.md`;
const MOBILE = `${HOME}/projets/invoicelead-mobile`;
const MOBILE_BASE = "store-invoicelead";
const PUBLICATIONS = `${HOME}/projets/publications/invoicelead/android`;
/** Lecture seule de l'API Play (certificat Play App Signing) : compte de service et paquet googleapis existants. */
const PLAY_KEY = `${HOME}/partage/Scanlead/scanlead-play-a42a3f2246fa.json`;
const PLAY_TOOLS = `${HOME}/projets/publications/scanlead/tools`;
const BUNDLETOOL = `${HOME}/outils/bundletool-all-1.18.1.jar`;
const BRANCH = "google-app";
/**
 * La production d'InvoiceLead que la branche contient (API Vercel, 30.10.2026) : d'abord dpl_HUALHm8mQiqNpYpKzGRRJL1Yitw3
 * (682bd09), puis dpl_AQR6hy6RXu9CYwvJvSSZd7GCferA (d63f01d, ia-limites), fusionnée dans google-app.
 */
const PROD = {
  id: "dpl_AQR6hy6RXu9CYwvJvSSZd7GCferA",
  sha: "d63f01df8e3f72e994f84e64ff46f1b7aaf9e852",
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
/** L'identifiant de l'app (appId Capacitor, bundle iOS, paquet Android). */
const APP_ID = "io.invoicelead.app";
/** Le lien de retour vérifié (contrat § 1) et le domaine associé. */
const DOMAIN = "invoicelead.io";
const RETOUR = `https://${DOMAIN}/lead-auth/return`;
const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148";
const ANDROID =
  "Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/140.0.0.0 Mobile Safari/537.36";
const SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1";
const CHROME_ANDROID =
  "Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36";
const NEW_APP = `${IPHONE} InvoiceLeadApp LeadAppAuth/2`;
const NEW_APP_ANDROID = `${ANDROID} InvoiceLeadApp LeadAppAuth/2`;
const FIRST_APP = `${IPHONE} InvoiceLeadApp LeadAppAuth/1`;
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

// ------------------------------------------------------------------ contrat d'ERPlead (relu, jamais recopié)

/**
 * Ce que le contrat d'ERPlead dit des fichiers d'association d'InvoiceLead (§ 1 et § 3d) : l'App ID iOS et le
 * paquet Android de la ligne InvoiceLead, les deux empreintes de la ligne invoicelead.io, et le modèle d'AASA
 * (exemple CRMlead, « les autres changent seulement l'appID »). Rend le JSON attendu, mot pour mot.
 */
function contractAssociation() {
  const doc = readFileSync(CONTRACT, "utf8");
  const row = doc.split("\n").find((l) => l.startsWith("| InvoiceLead | `invoicelead` |")) ?? "";
  const cells = row.split("|").map((c) => c.trim().replace(/^`|`$/g, ""));
  const fpRow = doc.split("\n").find((l) => l.startsWith(`| ${DOMAIN} | ${APP_ID} |`)) ?? "";
  const fps = [...fpRow.matchAll(/`((?:[0-9A-F]{2}:){31}[0-9A-F]{2})`/g)].map((m) => m[1]);
  const at = doc.indexOf("AASA (exemple CRMlead");
  const block = /```json\n([\s\S]*?)```/.exec(doc.slice(at))?.[1] ?? "null";
  const crm = JSON.parse(block);
  const appID = cells[4] ?? "";
  const aasa = JSON.parse(JSON.stringify(crm).split("X6K5247J6G.io.crmlead.app").join(appID));
  const assetlinks = [
    {
      relation: ["delegate_permission/common.handle_all_urls"],
      target: { namespace: "android_app", package_name: cells[5], sha256_cert_fingerprints: fps },
    },
  ];
  return { appID, packageName: cells[5], returnLink: cells[3], fps, aasa, assetlinks };
}

/** Les fichiers d'association tels que le site les sert (src/lib/app-links.ts, lu par tsx). */
function siteAssociation() {
  const r = run("npx", [
    "tsx",
    "-e",
    "import('./src/lib/app-links.ts').then((m)=>console.log(JSON.stringify({aasa:m.APPLE_APP_SITE_ASSOCIATION,assetlinks:m.ASSET_LINKS,fp:m.ANDROID_CERT_SHA256})))",
  ]);
  try {
    return JSON.parse(r.stdout.trim().split("\n").pop() ?? "null");
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------ G1

const UNIT = "tests/unit/lead-app-auth.test.ts";
const E2E = "tests/e2e/google-app.spec.ts";
/** Ce que G1 exige de voir passer (ledger G1), essai par essai. */
const U = {
  exact:
    "lien de retour : adresse exacte https://invoicelead.io/lead-auth/return, code de 43 caractères → rachat d'ERPlead ; schéma propre io.invoicelead.app refusé",
  android:
    "Android : appUrlOpen pendant une connexion en cours (page relais) : le lien ferme le Custom Tab et mène au rachat d'ERPlead avec le code, une seule fois",
  launch:
    "lien de lancement (app relancée par le lien) : rachat une seule fois, même si appUrlOpen le donne aussi et sur la page suivante",
  foreign:
    "liens étrangers ou mal formés ignorés : schéma propre, autre hôte, autre chemin, http, ancien io.crmlead.app://sso",
  noCode:
    "lien de retour sans code valable (error=expired, code abîmé) : écran de connexion gardé par la page relais, sinon connexion ordinaire",
  expiredTwice:
    "deux demandes expirées de suite : le lien d'erreur (toujours le même) ramène chaque fois à l'écran de connexion",
  noPending:
    "lien de retour reçu sans connexion en cours (page web, courriel, autre app) : ignoré, ni navigateur fermé ni page quittée",
  staleLaunch:
    "page relais d'une nouvelle connexion : l'ancien lien que rend getLaunchUrl (app relancée) n'est jamais suivi ; le navigateur s'ouvre et le nouveau lien mène au rachat",
  lateLaunch:
    "page relais : un lien de lancement rendu après le délai n'est jamais pris pour le retour de cette connexion",
  closeFails: "Browser.close en erreur (Android : rien à fermer) : le rachat a lieu quand même",
  iosSession:
    "iOS 17.4+ : la session s'ouvre sur start&m=auto, l'adresse rendue mène au rachat une seule fois, sans Browser.open ni Browser.close",
  iosCancel: "iOS : session annulée → écran de connexion d'ERPlead (back), connexion effacée",
  iosRefused:
    "iOS : session refusée (association absente, occupée…) → Safari sur start&m=tap ; le lien touché dans Safari (appUrlOpen) mène au rachat",
  iosOld:
    "iOS 15 à 17.3 : Safari sur start&m=tap, l'écran dit de toucher « Ouvrir InvoiceLead », puis le lien (appUrlOpen ou lancement) mène au rachat",
  iosNoModule:
    "iOS sans le module LeadAuthSession : écran de connexion d'ERPlead, rien n'est ouvert",
  iosForeign:
    "iOS : adresse rendue par la session qui n'est pas le lien de retour → écran de connexion, aucun rachat",
  outsideListen:
    "hors de l'app (aucun pont natif) : aucune écoute, aucun lien suivi, aucune navigation",
  outsideRelay:
    "page relais hors de l'app (navigateur ordinaire) : l'écran de connexion d'ERPlead, sans rien ouvrir",
  agent:
    "agent de l'app : LeadAppAuth/2 seulement avec InvoiceLeadApp ; LeadAppAuth/1, anciennes versions et navigateurs comme avant",
  androidRelay:
    "Android : page relais dans l'app : back gardé, Custom Tab ouvert sur start&m=auto ; refermé sans retour → back",
  finishedThenLink:
    "navigateur refermé puis lien de retour (Android) : le rachat l'emporte, pas de retour à l'écran de connexion",
  badTargets:
    "page relais : start ou back étrangers, ou start avec un mode déjà posé → rien n'est ouvert, connexion ordinaire de l'app",
  returnPage:
    "dans l'app : l'adresse de la page suit les règles du lien de retour (connexion en cours → rachat ; sinon l'app) ; hors de l'app → page de repli",
  fallback:
    "page de repli : 200 sans redirection, no-store, no-referrer, noindex, aucun script tiers, code jamais dans la page, cinq langues, phrase Android",
  fallbackScript:
    "page de repli : son script efface le code de l'adresse hors de l'app, et mène l'app à /<langue>/lead-auth/return avec la même recherche",
  wellKnown:
    "apple-app-site-association et assetlinks.json : JSON exact du contrat (App ID X6K5247J6G.io.invoicelead.app, paquet io.invoicelead.app, Play App Signing et clé d'envoi), application/json",
  proxyRelay:
    "/lead-auth/google sans langue → la page relais dans la langue de back, paramètres gardés",
  proxyMatcher:
    "proxy : /lead-auth/return et /.well-known/… hors du proxy (aucune langue, aucune redirection) ; la page relais et les pages de l'app y restent",
  guard:
    "dans l'app (LeadAppAuth/2) : par l'écran de connexion de l'app, qui lit le lien de lancement ; ailleurs (dont LeadAppAuth/1), tout droit vers le Compte Lead",
};
const G1_E2E = [
  "app Android (LeadAppAuth/2) : « Continuer avec Google » → page relais → Custom Tab (start&m=auto) → lien vérifié https://invoicelead.io/lead-auth/return → connectée dans InvoiceLead, une seule fois",
  "app iOS 17.4+ : la session LeadAuthSession (start&m=auto) rend le lien vérifié → connectée, sans Browser.open ni Browser.close",
  "app iOS 15 à 17.3 : Safari (start&m=tap), « Ouvrir InvoiceLead » dit sur la page relais, puis le lien touché (appUrlOpen) → connectée",
  "app iOS : session annulée → l'écran de connexion du Compte Lead revient ; session refusée → Safari",
  "navigateur du téléphone refermé sans retour (Android) : l'écran de connexion du Compte Lead revient",
  "app relancée par le lien de retour (lien de lancement) : connectée depuis l'écran de connexion de l'app, le lien n'est suivi qu'une fois",
  "app relancée par le lien de retour avec un cookie de session périmé : la garde passe par l'écran de connexion de l'app, qui suit le lien ; connectée du premier coup",
  "nouvelle connexion après une app relancée sans lecture du lien : l'ancien lien de lancement n'est pas suivi par la page relais, le nouveau connecte",
  "deux demandes expirées de suite : le lien d'erreur ramène chaque fois à l'écran de connexion du Compte Lead",
  "lien de retour reçu sans connexion en cours (page de l'app ouverte) : ignoré, la page reste",
  "liens étrangers (dont l'ancien schéma io.invoicelead.app) ignorés dans l'app ; hors de l'app, la page relais ne fait que revenir à l'écran de connexion",
  "ancienne version de l'app (sans LeadAppAuth/2, dont LeadAppAuth/1) et navigateur : l'écran de connexion part tout droit, comme avant",
  "page de repli /lead-auth/return hors de l'app : 200 sans redirection ni langue, no-referrer, no-store, code effacé de l'adresse, message dans la langue du lien",
  "lien de retour ouvert par la vue web de l'app (/lead-auth/return) : mené à la page de l'app, rachat pendant une connexion en cours",
  "fichiers d'association servis tels quels : /.well-known/apple-app-site-association et /.well-known/assetlinks.json (200, application/json, sans redirection, contenu du contrat)",
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
    breaks: U.launch,
  },
  {
    name: "Custom Tab jamais refermé (Android)",
    file: LIB,
    from: "    if (android) quietly(() => plugins.Browser?.close?.());\n",
    to: "",
    breaks: U.android,
  },
  {
    name: "lien approché (toute adresse de invoicelead.io)",
    file: LIB,
    // biome-ignore lint/suspicious/noTemplateCurlyInString: texte du code source à fausser, pas un gabarit
    from: "export const RETURN_PREFIX = `${RETURN_URL}?`;",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: texte du code source à fausser, pas un gabarit
    to: "export const RETURN_PREFIX = `${APP_ORIGIN}/`;",
    breaks: U.exact,
  },
  {
    name: "schéma propre io.invoicelead.app encore accepté",
    file: LIB,
    from: '  if (typeof url !== "string" || url.length > URL_MAX || !url.startsWith(RETURN_PREFIX))\n    return null;\n  const query = url.slice(RETURN_PREFIX.length).split("#")[0] ?? "";\n',
    to: '  if (typeof url !== "string" || url.length > URL_MAX) return null;\n  const legacy = "io.invoicelead.app://lead-auth?";\n  if (!url.startsWith(RETURN_PREFIX) && !url.startsWith(legacy)) return null;\n  const query = url.slice(url.indexOf("?") + 1).split("#")[0] ?? "";\n',
    breaks: U.exact,
  },
  {
    name: "pont non natif accepté (site web)",
    file: LIB,
    from: '    if (!cap || typeof cap.isNativePlatform !== "function" || cap.isNativePlatform() !== true)\n      return null;\n',
    to: "    if (!cap) return null;\n",
    breaks: U.outsideListen,
  },
  {
    name: "départ d'ERPlead non vérifié",
    file: LIB,
    from: '  if (!issuer || !fromIssuer(issuer, start, "/auth/google/app/start")) return null;\n  if (new URL(start).searchParams.has("m")) return null;\n',
    to: '  if (!issuer || typeof start !== "string") return null;\n',
    breaks: U.badTargets,
  },
  {
    name: "départ avec un mode déjà posé accepté",
    file: LIB,
    from: '  if (new URL(start).searchParams.has("m")) return null;\n',
    to: "",
    breaks: U.badTargets,
  },
  {
    name: "navigateur refermé : retour à l'écran même après le lien",
    file: LIB,
    from: "    if (state?.received) return;\n    if (state) state.armed = false;\n",
    to: "    if (state) state.armed = false;\n",
    breaks: U.finishedThenLink,
  },
  {
    name: "lien de lancement non lu",
    file: LIB,
    from: '      return follow(r?.url, "launch");\n',
    to: "      return false;\n",
    breaks: U.launch,
  },
  {
    name: "lien d'erreur gardé comme vu (toujours le même lien)",
    file: LIB,
    from: '    if (link.kind === "code" && !firstTime(win, key)) return false;\n',
    to: "    if (!firstTime(win, key)) return false;\n",
    breaks: U.expiredTwice,
  },
  {
    name: "lien suivi sans connexion en cours",
    file: LIB,
    from: "    if (state.received || !expected(via, key)) return false;\n",
    to: "    if (state.received) return false;\n",
    breaks: U.noPending,
  },
  {
    name: "connexion en cours sans limite de temps",
    file: LIB,
    from: "    if (!(age >= 0 && age < PENDING_TTL_MS)) return null;\n",
    to: "    if (!(age >= 0)) return null;\n",
    breaks: U.noPending,
  },
  {
    name: "lien de lancement suivi sur la page relais",
    file: LIB,
    from: '    if (via === "launch" && state.relay) return false;\n',
    to: "",
    breaks: U.lateLaunch,
  },
  {
    name: "ancien lien noté par la page relais suivi au rechargement",
    file: LIB,
    from: '    return !!pending && !(via === "launch" && pending.stale === key);\n',
    to: "    return !!pending;\n",
    breaks: U.staleLaunch,
  },
  {
    name: "session iOS annulée prise pour un refus (Safari au lieu de l'écran de connexion)",
    file: LIB,
    from: '          if (refusal(e) === "canceled") giveUp();\n          else safari();\n',
    to: "          safari();\n",
    breaks: U.iosCancel,
  },
  {
    name: "iOS 17.4+ : Safari d'emblée, session jamais ouverte",
    file: LIB,
    from: "        .then((r) => (r?.https === true ? iosSession() : safari()))\n",
    to: "        .then(() => safari())\n",
    breaks: U.iosSession,
  },
  {
    name: "iOS 15 à 17.3 : session tentée au lieu de Safari",
    file: LIB,
    from: "        .then((r) => (r?.https === true ? iosSession() : safari()))\n",
    to: "        .then(() => iosSession())\n",
    breaks: U.iosOld,
  },
  {
    name: "Safari ouvert en mode auto (aucune page à bouton, l'app ne s'ouvre pas)",
    file: LIB,
    from: '        ?.openExternal?.({ url: withMode(targets.start, "tap") })\n',
    to: '        ?.openExternal?.({ url: withMode(targets.start, "auto") })\n',
    breaks: U.iosRefused,
  },
  {
    name: "Custom Tab sans mode (page à bouton au lieu de l'App Link)",
    file: LIB,
    from: '        browser?.open?.({ url: withMode(targets.start, "auto") }).catch(giveUp);\n',
    to: "        browser?.open?.({ url: targets.start }).catch(giveUp);\n",
    breaks: U.androidRelay,
  },
  {
    name: "adresse rendue par la session suivie sans règles",
    file: LIB,
    from: '          if (!state?.follow?.(r?.url, "open")) giveUp();\n',
    to: "          if (r?.url) win.location.replace(String(r.url));\n          else giveUp();\n",
    breaks: U.iosForeign,
  },
  {
    name: "page de retour dans l'app suivie sans connexion en cours",
    file: LIB,
    from: '    if (via === "open" && state.armed) return true;\n',
    to: '    if ((via === "open" && state.armed) || via === "page") return true;\n',
    breaks: U.returnPage,
  },
  {
    name: "page de repli : code laissé dans l'adresse",
    file: "src/server/lead-app-return.ts",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: texte du code source à fausser, pas un gabarit
    from: 'try{history.replaceState(null,"","${RETURN_PATH}")}catch(e){}',
    to: "",
    breaks: U.fallbackScript,
  },
  {
    name: "page de repli : Referer envoyé",
    file: "src/server/lead-app-return.ts",
    from: '  "Referrer-Policy": "no-referrer",\n',
    to: "",
    breaks: U.fallback,
  },
  {
    name: "fichiers d'association : tout le site revendiqué",
    file: "src/lib/app-links.ts",
    from: 'export const CLAIMED_PATH = "/lead-auth/return";',
    to: 'export const CLAIMED_PATH = "/*";',
    breaks: U.wellKnown,
  },
  {
    name: "lien de retour repris par le proxy (préfixe de langue)",
    file: "src/proxy.ts",
    from: "_vercel|lead-auth/return|",
    to: "_vercel|",
    breaks: U.proxyMatcher,
  },
  {
    name: "garde : tout droit vers le Compte Lead dans l'app",
    file: "src/server/auth/guard.ts",
    from: "  if (isAppAuthAgent(userAgent)) {\n",
    to: "  if (userAgent === undefined) {\n",
    breaks: U.guard,
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
  for (const [what, title] of Object.entries(U))
    check(`G1 ${what} : ${title.slice(0, 90)}`, passed.has(title), `essai absent ou en échec`);
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
      total >= 608,
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
  for (const [route, kind] of [
    ["/[locale]/lead-auth/google", "ƒ"],
    ["/[locale]/lead-auth/return", "ƒ"],
    ["/lead-auth/return", "ƒ"],
    ["/.well-known/apple-app-site-association", "○"],
    ["/.well-known/assetlinks.json", "○"],
  ])
    check(
      `build : ${route} ${kind === "○" ? "statique (fichier d'association)" : "servie à la demande"}`,
      new RegExp(`${kind} ${route.replace(/[.[\]/]/g, "\\$&")}\\s`).test(build.stdout ?? ""),
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
      specs.length >= 230,
    bad.map((s) => `${s.file} : ${s.title}`).join(" | ") || `${e2e.stdout ?? ""}`.slice(-500),
  );
  for (const title of G1_E2E)
    check(
      `e2e ${title.slice(0, 80)}…`,
      specs.some((s) => E2E.endsWith(s.file) && s.title === title && s.ok),
    );
  // 3. La documentation suit le code, le code suit le contrat d'ERPlead.
  const doc = readFileSync(join(ROOT, "docs/GOOGLE-APP.md"), "utf8");
  for (const s of [
    `${RETOUR}?code=`,
    "/lead-auth/google?start=",
    "/auth/google/app/redeem?code=",
    "LeadAppAuth/2",
    "LeadAuthSession",
    "'&m=auto'",
    "'&m=tap'",
    "getLaunchUrl",
    "appUrlOpen",
    "Browser.close",
    "history.replaceState",
    "/.well-known/apple-app-site-association",
    "/.well-known/assetlinks.json",
  ])
    check(`docs/GOOGLE-APP.md décrit « ${s} »`, doc.includes(s));
  const lib = readFileSync(join(ROOT, LIB), "utf8");
  const erp = readFileSync(join(ERP_REPO, "src/lib/appAuth.ts"), "utf8");
  check(
    "lien de retour et page relais : ceux de la liste fermée d'ERPlead (APP_LINKS, RETURN_PATH, RELAY_PATH)",
    lib.includes(`export const APP_ORIGIN = "https://${DOMAIN}";`) &&
      lib.includes('export const RETURN_PATH = "/lead-auth/return";') &&
      lib.includes('export const RELAY_PATH = "/lead-auth/google";') &&
      erp.includes(`invoicelead: { site: 'https://${DOMAIN}' }`) &&
      erp.includes("export const RETURN_PATH = '/lead-auth/return'") &&
      erp.includes("export const RELAY_PATH = '/lead-auth/google'") &&
      !/["']io\.invoicelead\.app:\/\//.test(lib),
  );
  check(
    "agent : LeadAppAuth/2 comme première version du lien vérifié, chez ERPlead aussi",
    readFileSync(join(ROOT, "src/lib/native.ts"), "utf8").includes(
      "export const APP_AUTH_MIN = 2;",
    ) && /AGENT_MIN\s*=\s*2\b/.test(erp),
  );
  const contract = contractAssociation();
  const site = siteAssociation();
  check(
    `fichiers d'association du site = contrat d'ERPlead (§ 1, § 3d) : App ID ${contract.appID}, paquet ${contract.packageName}, ${contract.fps.length} empreintes, lien ${contract.returnLink}`,
    contract.appID === `X6K5247J6G.${APP_ID}` &&
      contract.packageName === APP_ID &&
      contract.returnLink === RETOUR &&
      contract.fps.length === 2 &&
      isDeepStrictEqual(site?.aasa, contract.aasa) &&
      isDeepStrictEqual(site?.assetlinks, contract.assetlinks),
    { site, contract: { aasa: contract.aasa, assetlinks: contract.assetlinks } },
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
/** Une plist (Info.plist, droits) lue comme une plist, pas comme du texte. */
const plist = (p) => {
  const r = spawnSync(
    "python3",
    [
      "-I",
      "-c",
      "import json,plistlib,sys;print(json.dumps(plistlib.load(open(sys.argv[1],'rb'))))",
      join(MOBILE, p),
    ],
    { encoding: "utf8" },
  );
  return r.status === 0 ? JSON.parse(r.stdout) : null;
};
const fpOf = (text) =>
  (/SHA-256 digest: ([0-9A-F:]+)|SHA256: ([0-9A-F:]+)/i.exec(text ?? "") ?? [])
    .slice(1)
    .find(Boolean)
    ?.toUpperCase() ?? "";

function gateG2() {
  const head = mgit(["rev-parse", "--short", "HEAD"]);
  check(
    `dépôt mobile ${MOBILE} : branche ${BRANCH} (${head}), partie de ${MOBILE_BASE}, rien en cours (fichiers suivis)`,
    mgit(["branch", "--show-current"]) === BRANCH &&
      spawnSync("git", ["merge-base", "--is-ancestor", MOBILE_BASE, "HEAD"], { cwd: MOBILE })
        .status === 0 &&
      mgit(["status", "--porcelain", "--untracked-files=no"]) === "",
    mgit(["status", "--porcelain", "--untracked-files=no"]),
  );
  // --- iOS : droits Associated Domains, plus de schéma propre.
  const ent = plist("ios/App/App/App.entitlements");
  const domains = ent?.["com.apple.developer.associated-domains"] ?? null;
  check(
    `iOS App.entitlements (plist) : com.apple.developer.associated-domains = ${JSON.stringify(domains)}`,
    isDeepStrictEqual(domains, [`applinks:${DOMAIN}`, `webcredentials:${DOMAIN}`]) &&
      Object.keys(ent ?? {}).length === 1,
  );
  const info = plist("ios/App/App/Info.plist");
  const schemes = (info?.CFBundleURLTypes ?? []).flatMap((t) => t.CFBundleURLSchemes ?? []);
  check(
    `iOS Info.plist (plist) : plus aucun schéma propre (CFBundleURLTypes ${JSON.stringify(schemes)})`,
    info && !info.CFBundleURLTypes && schemes.length === 0,
  );
  const pbx = (() => {
    const r = spawnSync(
      "node",
      [
        "-e",
        `const x=require(require.resolve("xcode",{paths:[process.argv[1]]}));const p=x.project(process.argv[2]);p.parseSync();const o=p.hash.project.objects;
const cfg=Object.values(o.XCBuildConfiguration).filter(c=>typeof c==="object"&&c.buildSettings.PRODUCT_BUNDLE_IDENTIFIER);
const src=Object.values(o.PBXSourcesBuildPhase).find(s=>typeof s==="object");
console.log(JSON.stringify({cfg:cfg.map(c=>({name:c.name,ent:c.buildSettings.CODE_SIGN_ENTITLEMENTS,bundle:c.buildSettings.PRODUCT_BUNDLE_IDENTIFIER,target:c.buildSettings.IPHONEOS_DEPLOYMENT_TARGET,mkt:String(c.buildSettings.MARKETING_VERSION),build:Number(c.buildSettings.CURRENT_PROJECT_VERSION)})),sources:src.files.map(f=>f.comment),files:Object.values(o.PBXFileReference).filter(f=>typeof f==="object").map(f=>f.path)}))`,
        MOBILE,
        join(MOBILE, "ios/App/App.xcodeproj/project.pbxproj"),
      ],
      { encoding: "utf8" },
    );
    try {
      return JSON.parse(r.stdout);
    } catch {
      return null;
    }
  })();
  check(
    "Xcode (project.pbxproj lu par le paquet xcode) : CODE_SIGN_ENTITLEMENTS = App/App.entitlements en Debug et Release de la cible App, LeadAuthSession.swift compilé, iOS 15.0 minimum",
    pbx?.cfg.length === 2 &&
      pbx.cfg.every(
        (c) =>
          c.ent === "App/App.entitlements" && c.bundle === APP_ID && String(c.target) === "15.0",
      ) &&
      pbx.sources.includes("LeadAuthSession.swift in Sources") &&
      pbx.files.includes("LeadAuthSession.swift") &&
      pbx.files.includes("App.entitlements"),
    pbx,
  );
  // --- iOS : le module LeadAuthSession (lu dans le source Swift, contrat § 1).
  const swift = mread("ios/App/App/LeadAuthSession.swift");
  const scene = mread("ios/App/App/SceneDelegate.swift");
  const swiftChecks = {
    déclaration:
      swift.includes("@objc(LeadAuthSessionPlugin)") &&
      swift.includes(
        "public class LeadAuthSessionPlugin: CAPPlugin, CAPBridgedPlugin, ASWebAuthenticationPresentationContextProviding",
      ) &&
      swift.includes('public let jsName = "LeadAuthSession"'),
    méthodes: ["isAvailable", "start", "openExternal"].every(
      (m) =>
        swift.includes(`CAPPluginMethod(name: "${m}", returnType: CAPPluginReturnPromise)`) &&
        swift.includes(`@objc func ${m}(_ call: CAPPluginCall)`),
    ),
    "iOS 17.4": (swift.match(/#available\(iOS 17\.4, \*\)/g) ?? []).length >= 2,
    "retour https écrit dans le code":
      swift.includes(`static let returnHost = "${DOMAIN}"`) &&
      swift.includes('static let returnPath = "/lead-auth/return"') &&
      swift.includes(
        "ASWebAuthenticationSession.Callback.https(host: Self.returnHost, path: Self.returnPath)",
      ) &&
      (swift.match(/call\.get\w+\(/g) ?? []).every((g) => g === "call.getString(") &&
      (swift.match(/call\.getString\("(\w+)"\)/g) ?? []).every((g) => g.includes('"url"')),
    "départ https d'ERPlead seulement":
      swift.includes('static let startPath = "/auth/google/app/start"') &&
      swift.includes('url.scheme == "https"') &&
      swift.includes("url.path == startPath") &&
      (swift.match(/Self\.startURL\(call\.getString\("url"\)\)/g) ?? []).length === 2,
    "comptes de Safari réutilisés": swift.includes(
      "session.prefersEphemeralWebBrowserSession = false",
    ),
    "une session à la fois": swift.includes("if session != nil {") && swift.includes('"busy"'),
    refus: ["canceled", "unavailable", "busy", "bad_url", "failed"].every((c) =>
      swift.includes(`, "${c}"`),
    ),
    annulation: swift.includes("error.code == .canceledLogin"),
    Safari: swift.includes("UIApplication.shared.open(url, options: [:])"),
    fenêtre: swift.includes("bridge?.viewController?.view.window"),
    inscription:
      swift.includes("class LeadBridgeViewController: CAPBridgeViewController") &&
      swift.includes("override open func capacitorDidLoad()") &&
      swift.includes("bridge?.registerPluginInstance(LeadAuthSessionPlugin())") &&
      scene.includes("window?.rootViewController = LeadBridgeViewController()"),
    "Universal Links remis à Capacitor":
      scene.includes("SceneDelegateProxy.shared.scene(scene, continue: userActivity)") &&
      scene.includes(
        "SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)",
      ),
  };
  for (const [what, ok] of Object.entries(swiftChecks))
    check(`iOS LeadAuthSession.swift / SceneDelegate : ${what}`, ok);
  note(
    `Swift : ${spawnSync("which", ["swiftc"]).status === 0 ? "swiftc présent" : "aucun compilateur Swift ici (Linux, pas de Xcode)"} ; la compilation iOS se fait chez Codemagic (non lancée)`,
  );
  // --- Android : App Link vérifié, plus de schéma propre.
  const manifest = mread("android/app/src/main/AndroidManifest.xml");
  const activity = /<activity[\s\S]*?<\/activity>/.exec(manifest)?.[0] ?? "";
  const filters = activity.match(/<intent-filter[\s\S]*?<\/intent-filter>/g) ?? [];
  const link = filters.find((f) => f.includes('android:autoVerify="true"'));
  check(
    `Android : activité principale singleTask avec intent-filter autoVerify VIEW + DEFAULT + BROWSABLE, https ${DOMAIN} /lead-auth/return`,
    /android:name="\.MainActivity"/.test(activity) &&
      /android:launchMode="singleTask"/.test(activity) &&
      filters.filter((f) => f.includes("autoVerify")).length === 1 &&
      !!link &&
      link.includes('android.intent.action.VIEW"') &&
      link.includes('android.intent.category.DEFAULT"') &&
      link.includes('android.intent.category.BROWSABLE"') &&
      link.includes(
        `<data android:scheme="https" android:host="${DOMAIN}" android:path="/lead-auth/return" />`,
      ) &&
      (link.match(/<data /g) ?? []).length === 1,
    link ?? "intent-filter absent",
  );
  check(
    "Android : plus aucun schéma propre ni autre hôte http(s) dans le manifeste",
    !manifest.includes(`android:scheme="${APP_ID}"`) &&
      (manifest.match(/android:host="[^"]+"/g) ?? []).every(
        (h) => h === `android:host="${DOMAIN}"`,
      ),
  );
  // --- Configuration Capacitor.
  const cfg = mread("capacitor.config.ts");
  const agent = /appendUserAgent:\s*'([^']*)'/.exec(cfg)?.[1] ?? "";
  check(
    `capacitor.config.ts : appId ${APP_ID}, appendUserAgent « ${agent} » (InvoiceLeadApp + LeadAppAuth/2), server.url https://${DOMAIN}`,
    cfg.includes(`appId: '${APP_ID}'`) &&
      /(^|\s)InvoiceLeadApp(\s|$)/.test(agent) &&
      /(^|\s)LeadAppAuth\/2(\s|$)/.test(agent) &&
      cfg.includes(`url: 'https://${DOMAIN}'`),
  );
  check(
    "allowNavigation garde erplead.io et Apple, jamais Google",
    /allowNavigation:\s*\[[^\]]*'erplead\.io'[^\]]*'appleid\.apple\.com'[^\]]*\]/.test(cfg) &&
      !/allowNavigation:\s*\[[^\]]*google/i.test(cfg),
  );
  // --- Le site et ERPlead parlent du même lien.
  const web = readFileSync(join(ROOT, LIB), "utf8");
  const links = readFileSync(join(ROOT, "src/lib/app-links.ts"), "utf8");
  check(
    "le lien déclaré par l'app est celui qu'écoute le site et celui de la liste d'ERPlead ; l'App ID et le paquet des fichiers d'association sont ceux de l'app",
    web.includes(`export const APP_ORIGIN = "https://${DOMAIN}";`) &&
      web.includes('export const RETURN_PATH = "/lead-auth/return";') &&
      readFileSync(join(ERP_REPO, "src/lib/appAuth.ts"), "utf8").includes(
        `invoicelead: { site: 'https://${DOMAIN}' }`,
      ) &&
      links.includes('export const APPLE_TEAM_ID = "X6K5247J6G";') &&
      links.includes(`export const APP_BUNDLE_ID = "${APP_ID}";`) &&
      links.includes('export const CLAIMED_PATH = "/lead-auth/return";'),
  );
  // --- Plugins présents, installés, synchronisés.
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
      j?.appendUserAgent === agent && j?.appId === APP_ID,
    );
  }
  // --- Versions : plus hautes que celles de la base (1.0.1, versionCode 2 publié, build iOS 2 dans TestFlight).
  const before = {
    pkg: JSON.parse(mread("package.json", MOBILE_BASE)).version,
    name: /versionName "([^"]+)"/.exec(mread("android/app/build.gradle", MOBILE_BASE))?.[1],
    mkt: /MARKETING: ([\d.]+)/.exec(mread("codemagic.yaml", MOBILE_BASE))?.[1],
  };
  const gradle = mread("android/app/build.gradle");
  const now = {
    pkg: pkg.version,
    name: /versionName "([^"]+)"/.exec(gradle)?.[1],
    code: Number(/\?: "(\d+)"\) as int\)/.exec(gradle)?.[1]),
    mkt: /MARKETING: ([\d.]+)/.exec(mread("codemagic.yaml"))?.[1],
    pbxMkt: (pbx?.cfg ?? []).map((c) => c.mkt),
    pbxBuild: (pbx?.cfg ?? []).map((c) => c.build),
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
  // --- Construction Android : AAB signé par la clé d'envoi d'InvoiceLead, APK de contrôle.
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
    badging.includes(`name='${APP_ID}'`) &&
      badging.includes(`versionCode='${now.code}'`) &&
      badging.includes(`versionName='${now.pkg}'`),
  );
  const tree =
    spawnSync(
      `${tools}/aapt2`,
      ["dump", "xmltree", "--file", "AndroidManifest.xml", `${out}/apk/debug/app-debug.apk`],
      { encoding: "utf8" },
    ).stdout ?? "";
  const schemesInApk = [...tree.matchAll(/scheme\(0x01010027\)="([^"]+)"/g)].map((m) => m[1]);
  const hostsInApk = [...tree.matchAll(/host\(0x01010028\)="([^"]+)"/g)].map((m) => m[1]);
  check(
    `manifeste fusionné de l'APK : intent-filter autoVerify https ${DOMAIN} /lead-auth/return, seuls schéma ${JSON.stringify(schemesInApk)} et hôte ${JSON.stringify(hostsInApk)} ; activité du navigateur (@capacitor/browser)`,
    tree.includes("autoVerify(0x010104ee)=true") &&
      tree.includes('path(0x0101002a)="/lead-auth/return"') &&
      isDeepStrictEqual(schemesInApk, ["https"]) &&
      isDeepStrictEqual(hostsInApk, [DOMAIN]) &&
      /com\.capacitorjs\.plugins\.browser\.\w+/.test(tree),
  );
  const aab = `${out}/bundle/release/app-release.aab`;
  const verify = spawnSync("jarsigner", ["-verify", "-certs", "-verbose:summary", aab], {
    encoding: "utf8",
  });
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
  const keyFp = fpOf(ks.stdout);
  const aabFp = fpOf(
    spawnSync("keytool", ["-printcert", "-jarfile", aab], { encoding: "utf8" }).stdout,
  );
  check(
    `AAB signé par la clé d'envoi d'InvoiceLead (empreinte ${keyFp.slice(0, 8)}…${keyFp.slice(-5)})`,
    verify.status === 0 &&
      /jar verified/i.test(verify.stdout) &&
      keyFp.length > 60 &&
      aabFp === keyFp,
    { verify: verify.status, same: aabFp === keyFp },
  );
  const aabManifest =
    spawnSync("java", ["-jar", BUNDLETOOL, "dump", "manifest", "--bundle", aab], {
      encoding: "utf8",
      maxBuffer: 64 << 20,
    }).stdout ?? "";
  check(
    "AAB (bundletool dump manifest) : le filtre autoVerify du lien vérifié, aucun schéma propre",
    /<intent-filter android:autoVerify="true">/.test(aabManifest) &&
      aabManifest.includes(
        `<data android:host="${DOMAIN}" android:path="/lead-auth/return" android:scheme="https"/>`,
      ) &&
      !aabManifest.includes(`android:scheme="${APP_ID}"`),
  );
  // --- Empreintes du assetlinks.json du site : clé d'envoi (keystore, AAB) et Play App Signing (API Play, lecture).
  const site = siteAssociation();
  const contract = contractAssociation();
  check(
    `assetlinks.json du site : la clé d'envoi est celle du keystore et de l'AAB (${keyFp.slice(0, 8)}…), comme au contrat`,
    site?.fp?.upload === keyFp && contract.fps[1] === keyFp,
    { site: site?.fp?.upload?.slice(0, 8), contract: contract.fps[1]?.slice(0, 8) },
  );
  const play = spawnSync(
    "node",
    [
      "-e",
      `const {google}=require(require.resolve("googleapis",{paths:[process.argv[1]]}));(async()=>{const auth=new google.auth.GoogleAuth({keyFile:process.argv[2],scopes:["https://www.googleapis.com/auth/androidpublisher"]});const ap=google.androidpublisher({version:"v3",auth});const r=await ap.generatedapks.list({packageName:"${APP_ID}",versionCode:2});console.log(JSON.stringify((r.data.generatedApks||[]).map(g=>g.certificateSha256Hash)))})().catch(e=>{console.log(JSON.stringify({erreur:String(e.code||e.message).slice(0,80)}));process.exit(1)})`,
      PLAY_TOOLS,
      PLAY_KEY,
    ],
    { encoding: "utf8", timeout: 120_000 },
  );
  const playCerts = (() => {
    try {
      return JSON.parse(play.stdout.trim());
    } catch {
      return null;
    }
  })();
  check(
    `Play App Signing (API Play, lecture seule : generatedapks.list de ${APP_ID} versionCode 2) = l'empreinte Play du assetlinks.json du site et du contrat (${String(playCerts?.[0]).slice(0, 8)}…)`,
    play.status === 0 &&
      Array.isArray(playCerts) &&
      playCerts.length >= 1 &&
      playCerts.every((c) => c === site?.fp?.playAppSigning) &&
      contract.fps[0] === site?.fp?.playAppSigning,
    playCerts,
  );
  mkdirSync(PUBLICATIONS, { recursive: true });
  const target = `${PUBLICATIONS}/invoicelead-${now.pkg}-${now.code}.aab`;
  copyFileSync(aab, target);
  check(
    `AAB rangé pour la publication : ${target}`,
    sha256(readFileSync(target)) === sha256(readFileSync(aab)),
  );
  // --- iOS : pas de Xcode ici ; la construction se fait chez Codemagic (workflow ios-testflight), qui téléverse
  // vers App Store Connect : elle n'est PAS lancée par cette porte.
  const cm = mread("codemagic.yaml");
  check(
    `iOS : codemagic.yaml prêt (bundle ${APP_ID}, MARKETING ${now.mkt}, build = dernier TestFlight + 1, contrôle des droits et de LeadAppAuth/2 avant la construction), sans déclenchement automatique`,
    cm.includes(`bundle_identifier: ${APP_ID}`) &&
      now.mkt === now.pkg &&
      cm.includes(`grep -q "applinks:${DOMAIN}"`) &&
      cm.includes(`grep -q "webcredentials:${DOMAIN}"`) &&
      cm.includes('"appendUserAgent": "InvoiceLeadApp LeadAppAuth/2"') &&
      !/^\s*triggering:/m.test(cm),
  );
  note(
    "iOS : construction = Codemagic, non lancée (téléversement vers App Store Connect = décision d'Ève) ; elle exige d'abord Associated Domains sur io.invoicelead.app et un profil App Store régénéré (comptes Apple : non touchés)",
  );
  // --- Rien de soumis : la branche mobile n'est pas poussée (aucune construction distante possible depuis elle).
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
  check(
    `aperçu d'ERPlead bâti depuis le contrat révisé (${String(erp.commit).slice(0, 7)}) : même code que la tête d'erplead-google-app (${git(["rev-parse", "--short", "HEAD"], ERP_REPO)})`,
    !!erp.commit &&
      run("git", ["diff", "--quiet", erp.commit, "HEAD", "--", "src"], { cwd: ERP_REPO }).status ===
        0 &&
      /GOOGLE_APP_ENABLED=1/.test(erp.note ?? ""),
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
  const contract = contractAssociation();
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
  let departs = 0;
  const { chromium } = require("@playwright/test");
  const browser = await chromium.launch({ headless: true });
  const BRIDGE = readFileSync(join(ROOT, "tests/support/fake-capacitor.js"), "utf8");
  const PROD_ERP = "https://erplead.io";
  const PROD_IL = `https://${DOMAIN}`;
  const madeStates = [];
  const madeVh = [];
  const shots = [];
  const production = []; // requêtes du navigateur vers erplead.io / invoicelead.io : toutes interceptées, aucune envoyée
  const leaked = []; // requêtes réseau réelles vers la production (attendu : aucune)
  const callbacks = []; // retours OpenID vers InvoiceLead (arrêtés par la porte)
  const googleInWebview = [];
  const ilNav = []; // pages de l'aperçu d'InvoiceLead ouvertes (chemins)
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
   * interceptée : menée vers l'aperçu, ou arrêtée (retour OpenID vers InvoiceLead). `bridge` : réglage du faux pont
   * (plateforme, module iOS), vue web seulement.
   */
  async function context(ua, kind, bridge = {}) {
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
      await ctx.addInitScript((c) => {
        window.__FAKE_CAPACITOR = c;
      }, bridge);
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
      if (route.request().isNavigationRequest() && route.request().url().startsWith(t.il))
        ilNav.push(new URL(route.request().url()).pathname);
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
  const onErpLogin = (error) => (u) =>
    u.href.startsWith(`${t.erp}/login?`) &&
    (error === undefined || u.searchParams.get("error") === error);
  /** L'écran de connexion d'ERPlead (vue web) → « Continuer avec Google » → page relais → ouverture relevée. */
  const startGoogle = async (wv, opener, step) => {
    const from = auditMax();
    const before = named(wv.calls, opener).length;
    await wv.page.locator('a[href^="/auth/google/app?"]').click();
    await wv.page.waitForURL(`${t.il}/it/lead-auth/google?**`, { timeout: 30_000 });
    const opened = await waitFor(() => named(wv.calls, opener)[before]);
    departs++;
    check(
      `${step} : le départ écrit une ligne google_app.start {app: invoicelead}, relevée pour la remise en état`,
      auditSince(from, `départ ${step}`, "google_app.start", "invoicelead", null) >= 1,
    );
    const cookie = (await wv.ctx.cookies(t.erp)).find((c) => c.name === "__Host-erp_gapp");
    const vh = cookie ? sha256(cookie.value) : "";
    if (vh) madeVh.push(vh);
    return { start: String(opened?.arg ?? ""), cookie, vh };
  };
  /** Le départ dans le navigateur du téléphone jusqu'à accounts.google.com ; rend la demande Google. */
  const toGoogle = async (sys, start) => {
    const googleReq = [];
    const listener = (r) => {
      if (r.url().startsWith("https://accounts.google.com/o/oauth2/v2/auth"))
        googleReq.push(r.url());
    };
    sys.page.on("request", listener);
    await sys.page.goto(toPreview(start), { waitUntil: "domcontentloaded" }).catch(() => {});
    await waitFor(() => googleReq.length > 0 && /accounts\.google\.com/.test(sys.page.url()));
    await sys.page.waitForLoadState("load").catch(() => {});
    sys.page.off("request", listener);
    const gu = googleReq[0] ? new URL(googleReq[0]) : null;
    const gstate = gu?.searchParams.get("state") ?? "";
    if (gstate) madeStates.push(sha256(gstate));
    const text = await sys.page.content().catch(() => "");
    const ok =
      !!gu &&
      gu.searchParams.get("redirect_uri") === "https://erplead.io/auth/google/callback" &&
      gstate.startsWith("app.invoicelead.") &&
      gu.searchParams.get("code_challenge_method") === "S256" &&
      gu.searchParams.get("hl") === "it" &&
      new URL(sys.page.url()).host === "accounts.google.com" &&
      !/redirect_uri_mismatch|invalid_client|disallowed_useragent|Error 400|Errore 400/i.test(text);
    return { gu, gstate, ok, url: googleReq[0] ?? sys.page.url() };
  };
  /** Le VRAI retour « annulé » de Google sur l'aperçu d'ERPlead (aucun appel à Google) : la redirection, lue. */
  const cancelled = async (sys, gstate, step) => {
    const from = auditMax();
    const r = await sys.ctx.request.get(
      `${t.erp}/auth/google/callback?${new URLSearchParams({ state: gstate, error: "access_denied" })}`,
      { maxRedirects: 0 },
    );
    check(
      `${step} : le retour annulé écrit une ligne google_app.code {app: invoicelead, outcome: google}, relevée`,
      auditSince(from, `code ${step}`, "google_app.code", "invoicelead", "google") >= 1,
    );
    return { status: r.status(), location: r.headers().location ?? "" };
  };
  const RETURN_RE = new RegExp(
    `^${RETOUR.replace(/[.]/g, "\\.").replace(/\//g, "\\/")}\\?code=[A-Za-z0-9_-]{43}&locale=it$`,
  );
  const bypass = { "x-vercel-protection-bypass": t.ilBypass };
  try {
    // --- 1. Fichiers d'association servis par l'aperçu (contrat § 3d), comme le CDN d'Apple et Android les lisent.
    for (const [path, expected] of [
      ["/.well-known/apple-app-site-association", contract.aasa],
      ["/.well-known/assetlinks.json", contract.assetlinks],
    ]) {
      const r = await fetch(`${t.il}${path}`, {
        redirect: "manual",
        headers: { ...bypass, "user-agent": "AASA-Bot/1.0.0" },
      });
      const body = await r.text();
      let json = null;
      try {
        json = JSON.parse(body);
      } catch {}
      check(
        `aperçu ${path} : 200, application/json, aucune redirection, JSON = contrat d'ERPlead`,
        r.status === 200 &&
          r.headers.get("content-type") === "application/json" &&
          !r.headers.get("location") &&
          isDeepStrictEqual(json, expected),
        { status: r.status, type: r.headers.get("content-type") },
      );
      // La commande du contrat (§ 8) : curl -A "AASA-Bot/1.0.0" -sI ; l'en-tête de contournement passe par l'entrée standard.
      const curl = spawnSync(
        "curl",
        ["-sI", "--max-time", "30", "-A", "AASA-Bot/1.0.0", "-H", "@-", `${t.il}${path}`],
        { input: `x-vercel-protection-bypass: ${t.ilBypass}\n`, encoding: "utf8" },
      );
      const status = /^HTTP\/[\d.]+ (\d+)/m.exec(curl.stdout ?? "")?.[1];
      check(
        `curl -A "AASA-Bot/1.0.0" -sI ${path} → ${status}, application/json, sans Location`,
        status === "200" &&
          /^content-type: application\/json\r?$/im.test(curl.stdout) &&
          !/^location:/im.test(curl.stdout),
      );
    }
    // --- 2. Page de repli /lead-auth/return hors de l'app (Safari et Chrome d'Android), sur l'aperçu.
    const stray = randomBytes(32).toString("base64url");
    const raw = await fetch(`${t.il}/lead-auth/return?code=${stray}&locale=it`, {
      redirect: "manual",
      headers: { ...bypass, "user-agent": SAFARI },
    });
    const rawHtml = await raw.text();
    const one = (h) => (raw.headers.get(h) ?? "").split(/,\s*/).filter(Boolean);
    check(
      "aperçu /lead-auth/return : 200 sans redirection ni langue, no-store, no-referrer, noindex, un seul script (en ligne), ni lien ni bouton, code jamais écrit, en italien",
      raw.status === 200 &&
        !raw.headers.get("location") &&
        one("cache-control").includes("no-store") &&
        one("referrer-policy").length > 0 &&
        one("referrer-policy").every((v) => v === "no-referrer") &&
        one("x-robots-tag").includes("noindex") &&
        !rawHtml.includes(stray) &&
        (rawHtml.match(/<script/g) ?? []).length === 1 &&
        !/<script[^>]*\bsrc=/.test(rawHtml) &&
        !/<a\b|<button|<form|<iframe|<img|<link/.test(rawHtml) &&
        rawHtml.includes("<h1>Torna su InvoiceLead</h1>"),
      {
        status: raw.status,
        cache: raw.headers.get("cache-control"),
        referrer: raw.headers.get("referrer-policy"),
        robots: raw.headers.get("x-robots-tag"),
      },
    );
    for (const [ua, name, android] of [
      [SAFARI, "g3l-repli-safari-it", false],
      [CHROME_ANDROID, "g3l-repli-android-it", true],
    ]) {
      const b = await context(ua, "system");
      const res = await b.page.goto(`${t.il}/lead-auth/return?code=${stray}&locale=it`);
      await b.page.waitForTimeout(300);
      check(
        `${android ? "Chrome d'Android" : "Safari"} sur la page de repli : le code a quitté l'adresse (${new URL(b.page.url()).pathname}${new URL(b.page.url()).search}), « Torna su InvoiceLead »${android ? ", phrase « Apri per impostazione predefinita »" : ""}`,
        res?.status() === 200 &&
          b.page.url() === `${t.il}/lead-auth/return` &&
          (await b.page.getByRole("heading", { name: "Torna su InvoiceLead" }).count()) === 1 &&
          !(await b.page.content()).includes(stray) &&
          (await b.page.locator("[data-android]").count()) === (android ? 1 : 0),
      );
      await shot(b.page, name);
      await b.ctx.close();
    }

    // --- 3. iOS 17.4+ : vue web de la nouvelle version (session LeadAuthSession).
    const wv = await context(NEW_APP, "webview", { platform: "ios", session: "https" });
    // 3a. Le lien de retour ouvert par la vue web elle-même, sans connexion en cours : la page de l'app l'ignore et
    // ouvre l'app, qui part (sans session) vers le Compte Lead par l'écran de connexion de l'app.
    await wv.page.goto(`${t.il}/lead-auth/return?code=${stray}&locale=it`);
    await wv.page.waitForURL(onErpLogin(), { timeout: 40_000 });
    const iReturn = ilNav.indexOf("/it/lead-auth/return");
    check(
      "vue web sur /lead-auth/return sans connexion en cours : menée à /it/lead-auth/return, lien ignoré (aucun rachat), puis l'app → écran de connexion de l'app → Compte Lead",
      ilNav.includes("/lead-auth/return") &&
        iReturn >= 0 &&
        ilNav.slice(iReturn).includes("/it/app") &&
        ilNav.slice(iReturn).includes("/it/login") &&
        !production.some((u) => u.includes("/auth/google/app/redeem")),
      ilNav,
    );
    const authorizeHop = production.find((u) => u.startsWith(`${PROD_ERP}/oauth/authorize?`));
    const asked = new URL(authorizeHop ?? "https://x.invalid");
    const ilState = asked.searchParams.get("state") ?? "";
    check(
      "l'écran de connexion de l'app (LeadAppAuth/2) lit le lien de lancement puis part vers le Compte Lead (client invoicelead, platform=app, adresse de retour déclarée)",
      named(wv.calls, "App.getLaunchUrl").length >= 1 &&
        asked.searchParams.get("client_id") === "invoicelead" &&
        asked.searchParams.get("platform") === "app" &&
        asked.searchParams.get("redirect_uri") === "https://invoicelead.io/auth/lead/callback" &&
        asked.searchParams.get("code_challenge_method") === "S256" &&
        ilState.length > 20,
      authorizeHop,
    );
    check(
      "écran du Compte Lead dans la vue web (LeadAppAuth/2) : un bouton « Continuer avec Google » de l'app (/auth/google/app), Apple et le mot de passe, aucune phrase",
      (await wv.page.locator('a[href^="/auth/google/app?"]').count()) === 1 &&
        (await wv.page.locator('a[href^="/auth/apple?"]').count()) === 1 &&
        (await wv.page.locator('input[name="password"]').count()) === 1 &&
        (await wv.page.locator("[data-google-app-hint]").count()) === 0,
    );
    await shot(wv.page, "g3l-1-compte-lead-bouton-google");
    // 3b. Premier départ : page relais → session iOS sur start&m=auto.
    const s1 = await startGoogle(wv, "LeadAuthSession.start", "iOS, 1er départ");
    const relay = production.find((u) => u.startsWith(`${PROD_IL}/lead-auth/google?`)) ?? "";
    const back = new URL(relay || "https://x.invalid").searchParams.get("back") ?? "";
    const plainStart = new URL(relay || "https://x.invalid").searchParams.get("start") ?? "";
    check(
      "ERPlead envoie la vue web vers la page relais https://invoicelead.io/lead-auth/google (start sans mode, back), menée vers l'aperçu, dans la langue de l'écran (it)",
      relay.startsWith(`${PROD_IL}/lead-auth/google?start=`) &&
        plainStart.startsWith(`${PROD_ERP}/auth/google/app/start?d=invoicelead.`) &&
        !new URL(plainStart || "https://x.invalid").searchParams.has("m") &&
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
      "iOS 17.4+ : LeadAuthSession.isAvailable() → https, puis LeadAuthSession.start sur le départ d'ERPlead + &m=auto, ni Browser.open ni Safari ; écoute du lien posée",
      s1.start === `${plainStart}&m=auto` &&
        named(wv.calls, "LeadAuthSession.isAvailable").some((c) => c.arg === true) &&
        named(wv.calls, "Browser.open").length === 0 &&
        named(wv.calls, "LeadAuthSession.openExternal").length === 0 &&
        named(wv.calls, "App.addListener").some((c) => c.arg === "appUrlOpen"),
      s1.start,
    );
    await shot(wv.page, "g3l-2-page-relais-session-ios");
    check(
      "cookie verifier de la vue web __Host-erp_gapp : HttpOnly, Secure, Lax, 10 min (jamais lu par InvoiceLead)",
      s1.cookie?.httpOnly &&
        s1.cookie.secure &&
        s1.cookie.sameSite === "Lax" &&
        Math.abs(s1.cookie.expires - (Date.now() / 1000 + 600)) < 120,
    );
    const d1 = new URL(s1.start || "https://x.invalid").searchParams.get("d") ?? "";
    const dep = sqlRead(
      t.ro,
      "select data from sso_states where state = $1 and expires_at > now()",
      [sha256(d1)],
    );
    check(
      "départ dans la base d'APERÇU d'ERPlead : app invoicelead, empreinte du verifier, demande d'InvoiceLead (son state)",
      dep?.provider === "google-app-start" &&
        dep.app === "invoicelead" &&
        dep.vh === s1.vh &&
        new URLSearchParams(dep.next?.split("?")[1]).get("state") === ilState,
    );
    // 3c. Navigateur sûr du téléphone (la session iOS, imitée par un contexte sans pont) : départ → Google.
    const sys = await context(SAFARI, "system");
    const g1 = await toGoogle(sys, s1.start);
    check(
      "navigateur du téléphone : start&m=auto mène à accounts.google.com (redirect_uri https://erplead.io/auth/google/callback, state app.invoicelead.…, PKCE S256, hl=it), sans erreur Google",
      g1.ok,
      g1.url,
    );
    await shot(sys.page, "g3l-3-google-navigateur-du-telephone");
    const gs1 = sqlRead(
      t.ro,
      "select data from sso_states where state = $1 and expires_at > now()",
      [sha256(g1.gstate)],
    );
    check(
      "état Google de l'app en base d'APERÇU : même empreinte, même demande, mode auto noté ; départ consommé",
      gs1?.provider === "google" &&
        gs1.app === "invoicelead" &&
        gs1.vh === s1.vh &&
        gs1.next === dep?.next &&
        gs1.open === "auto" &&
        sqlRead(t.ro, "select count(*) from sso_states where state = $1", [sha256(d1)]) === 0,
      { open: gs1?.open },
    );
    // 3d. VRAI retour « annulé » de Google (aucun appel à Google) : ERPlead redirige (m=auto) vers le lien vérifié.
    const c1 = await cancelled(sys, g1.gstate, "iOS annulé");
    check(
      `retour de Google annulé, m=auto : 303 EXACTEMENT vers ${RETOUR}?code=<43>&locale=it (redirection lue, jamais suivie)`,
      c1.status === 303 && RETURN_RE.test(c1.location),
      c1,
    );
    // La session iOS rend cette adresse : la vue web va au rachat, qui ramène l'écran de connexion avec l'erreur.
    let from = auditMax();
    let n = production.length;
    await wv.page.evaluate((u) => window.__fakeSession({ url: u }), c1.location);
    await wv.page.waitForURL(onErpLogin("google"), { timeout: 40_000 });
    const failCode = new URL(c1.location).searchParams.get("code");
    check(
      "session iOS : l'adresse rendue (lien vérifié) mène la vue web au rachat d'ERPlead avec le code, une fois, sans Browser.close ; échec chez Google → écran de connexion de l'app, error=google",
      production
        .slice(n)
        .filter((u) => u.startsWith(`${PROD_ERP}/auth/google/app/redeem?`))
        .join() === `${PROD_ERP}/auth/google/app/redeem?code=${failCode}` &&
        named(wv.calls, "Browser.close").length === 0 &&
        new URL(wv.page.url()).searchParams.get("locale") === "it",
      wv.page.url(),
    );
    check(
      "journal d'ERPlead : le rachat de l'échec écrit une ligne google_app.redeem {app: invoicelead, outcome: google}, relevée",
      auditSince(from, "rachat iOS annulé", "google_app.redeem", "invoicelead", "google") >= 1,
    );
    await shot(wv.page, "g3l-4-annule-ecran-de-connexion");
    // 3e. Second départ, cette fois réussi : code préparé dans la base d'APERÇU pour la personne TEST.
    const s2 = await startGoogle(wv, "LeadAuthSession.start", "iOS, 2e départ");
    const g2 = await toGoogle(sys, s2.start);
    check("2e départ : accounts.google.com, sans erreur Google", g2.ok, g2.url);
    const gs2 = sqlRead(
      t.ro,
      "select data from sso_states where state = $1 and expires_at > now()",
      [sha256(g2.gstate)],
    );
    const code = randomBytes(32).toString("base64url");
    await previewWrite(t, who.id, async (db) => {
      await db.query("delete from sso_states where state = $1", [sha256(g2.gstate)]);
      await db.query(
        "insert into sso_states (state, data, expires_at) values ($1, $2, now() + interval '5 minutes')",
        [
          sha256(code),
          JSON.stringify({
            provider: "google-app-code",
            app: "invoicelead",
            vh: s2.vh,
            next: gs2?.next,
            locale: gs2?.locale ?? "it",
            result: { profile: { email: who.email, name: who.name, locale: who.locale } },
          }),
        ],
      );
    });
    await sys.ctx.close();
    const link = `${RETOUR}?code=${code}&locale=it`;
    from = auditMax();
    n = production.length;
    await wv.page.evaluate((u) => window.__fakeSession({ url: u }), link);
    await waitFor(() => callbacks.length > 0, 40_000);
    check(
      "journal d'ERPlead : le rachat écrit une ligne google_app.redeem {app: invoicelead, outcome: ok}, relevée",
      auditSince(from, "rachat iOS réussi", "google_app.redeem", "invoicelead", "ok") >= 1,
    );
    const redeemHops = production
      .slice(n)
      .filter((u) => u.startsWith(`${PROD_ERP}/auth/google/app/redeem?`));
    check(
      "lien vérifié rendu par la session : la vue web va au rachat d'ERPlead avec le code, une fois",
      redeemHops.length === 1 &&
        redeemHops[0] === `${PROD_ERP}/auth/google/app/redeem?code=${code}`,
      { redeem: redeemHops.length },
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
      "personne TEST connectée dans la vue web de l'app : session ERPlead (méthode google, agent InvoiceLeadApp LeadAppAuth/2), cookie verifier effacé",
      !!sid &&
        !(await wv.ctx.cookies(t.erp)).some((c) => c.name === "__Host-erp_gapp") &&
        sqlRead(
          t.ro,
          "select count(*) from sessions where user_id = $1 and method = 'google' and created_at >= $2 and user_agent like $3",
          [who.id, startedAt.toISOString(), "%InvoiceLeadApp LeadAppAuth/2%"],
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
    await shot(wv.page, "g3l-5-connectee-mon-compte");
    // 3f. Un lien de retour sans connexion en cours (page piégée, courriel) sur une page d'InvoiceLead : rien ne se passe.
    await wv.page.goto(`${t.il}/it/legal/terms`);
    await waitFor(() =>
      wv.page.evaluate(() => window.__fakeListeners?.("App.appUrlOpen") > 0).catch(() => false),
    );
    const trapFrom = production.length;
    for (const u of [
      `${RETOUR}?code=${randomBytes(32).toString("base64url")}&locale=it`,
      `${RETOUR}?error=expired&locale=it`,
      `io.invoicelead.app://lead-auth?code=${randomBytes(32).toString("base64url")}`,
    ])
      await wv.page.evaluate((x) => window.__fakeEmit("App.appUrlOpen", { url: x }), u);
    await wv.page.waitForTimeout(1500);
    check(
      "lien vérifié reçu sans connexion en cours (code inconnu, error=expired) et ancien schéma propre : ignorés sur la page ouverte (aucun rachat, aucune navigation)",
      new URL(wv.page.url()).pathname === "/it/legal/terms" &&
        !production.slice(trapFrom).some((u) => u.includes("/auth/google/app/redeem")),
      new URL(wv.page.url()).pathname,
    );
    // 3g. Le même lien, relu par la page suivante de la MÊME vue web (getLaunchUrl) : ignoré.
    await wv.ctx.addInitScript((u) => {
      window.__FAKE_CAPACITOR = { ...(window.__FAKE_CAPACITOR || {}), launchUrl: u };
    }, link);
    const reads = named(wv.calls, "App.getLaunchUrl").length;
    n = production.length;
    await wv.page.goto(`${t.il}/it/legal/privacy`);
    await waitFor(() => named(wv.calls, "App.getLaunchUrl").length > reads, 10_000);
    await wv.page.waitForTimeout(1500);
    check(
      "le même lien relu par la page suivante de l'app (getLaunchUrl) : ignoré (aucun rachat, aucune navigation)",
      named(wv.calls, "App.getLaunchUrl").length > reads &&
        named(wv.calls, "App.getLaunchUrl").at(-1)?.arg === link &&
        !production.slice(n).some((u) => u.includes("/redeem")) &&
        new URL(wv.page.url()).pathname === "/it/legal/privacy",
    );
    // Rachat rejoué par la vue web : refusé (usage unique) — contrôle d'ERPlead, vu depuis l'app.
    from = auditMax();
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
      auditSince(from, "rachat rejoué", "google_app.redeem", null, "expired") >= 1,
    );
    await wv.ctx.close();

    // --- 4. Android : Custom Tab sur start&m=auto, VRAI retour annulé → App Link → rachat.
    const wa = await context(NEW_APP_ANDROID, "webview", { platform: "android" });
    await wa.page.goto(`${t.il}/it/login`);
    await wa.page.waitForURL(onErpLogin(), { timeout: 40_000 });
    const sa = await startGoogle(wa, "Browser.open", "Android");
    const plainA =
      new URL(
        production.filter((u) => u.startsWith(`${PROD_IL}/lead-auth/google?`)).at(-1) ??
          "https://x.invalid",
      ).searchParams.get("start") ?? "";
    check(
      "Android : Browser.open (Custom Tab) sur le départ d'ERPlead + &m=auto, écoute browserFinished posée, aucun module iOS",
      sa.start === `${plainA}&m=auto` &&
        named(wa.calls, "Browser.addListener").some((c) => c.arg === "browserFinished") &&
        named(wa.calls, "LeadAuthSession.start").length === 0,
      sa.start,
    );
    const sysA = await context(CHROME_ANDROID, "system");
    const gA = await toGoogle(sysA, sa.start);
    check("Android : Custom Tab → accounts.google.com, sans erreur Google", gA.ok, gA.url);
    const cA = await cancelled(sysA, gA.gstate, "Android annulé");
    check(
      "Android, retour annulé, m=auto : 303 vers le lien vérifié (App Link)",
      cA.status === 303 && RETURN_RE.test(cA.location),
      cA,
    );
    await sysA.ctx.close();
    from = auditMax();
    n = production.length;
    await wa.page.evaluate((u) => window.__fakeEmit("App.appUrlOpen", { url: u }), cA.location);
    await wa.page.waitForURL(onErpLogin("google"), { timeout: 40_000 });
    check(
      "Android : l'App Link (appUrlOpen) ferme le Custom Tab (Browser.close ×1) et mène au rachat, une fois → écran de connexion, error=google",
      named(wa.calls, "Browser.close").length === 1 &&
        production.slice(n).filter((u) => u.startsWith(`${PROD_ERP}/auth/google/app/redeem?`))
          .length === 1,
    );
    check(
      "journal d'ERPlead : rachat Android {app: invoicelead, outcome: google}, relevé",
      auditSince(from, "rachat Android", "google_app.redeem", "invoicelead", "google") >= 1,
    );
    await wa.ctx.close();

    // --- 5. iOS 15 à 17.3 : Safari sur start&m=tap, page « Torna su InvoiceLead » d'ERPlead et son bouton.
    const wt = await context(NEW_APP, "webview", { platform: "ios", session: "old" });
    await wt.page.goto(`${t.il}/it/login`);
    await wt.page.waitForURL(onErpLogin(), { timeout: 40_000 });
    const st = await startGoogle(wt, "LeadAuthSession.openExternal", "iOS Safari");
    const plainT =
      new URL(
        production.filter((u) => u.startsWith(`${PROD_IL}/lead-auth/google?`)).at(-1) ??
          "https://x.invalid",
      ).searchParams.get("start") ?? "";
    await wt.page
      .locator("[data-lead-auth-mode=safari]")
      .waitFor({ timeout: 10_000 })
      .catch(() => {});
    check(
      "iOS 15 à 17.3 : LeadAuthSession.openExternal (Safari) sur le départ + &m=tap, aucune session ; la page relais dit « Completa l'accesso in Safari, poi tocca «Apri InvoiceLead». »",
      st.start === `${plainT}&m=tap` &&
        named(wt.calls, "LeadAuthSession.start").length === 0 &&
        (await wt.page.locator("[data-lead-auth-mode=safari]").textContent()) ===
          "Completa l'accesso in Safari, poi tocca «Apri InvoiceLead».",
      st.start,
    );
    await shot(wt.page, "g3l-6-page-relais-safari");
    const sysT = await context(SAFARI, "system");
    const gT = await toGoogle(sysT, st.start);
    check("Safari : start&m=tap → accounts.google.com, sans erreur Google", gT.ok, gT.url);
    check(
      "état Google : mode tap noté",
      sqlRead(t.ro, "select data->>'open' from sso_states where state = $1", [
        sha256(gT.gstate),
      ]) === "tap",
    );
    const cT = await cancelled(sysT, gT.gstate, "Safari annulé");
    check(
      "Safari, retour annulé, m=tap : 303 vers la page « Revenez dans » d'erplead.io (/auth/google/app/return, app invoicelead), pas vers le lien",
      cT.status === 303 &&
        cT.location.startsWith("/auth/google/app/return?") &&
        new URLSearchParams(cT.location.split("?")[1]).get("app") === "invoicelead",
      cT.status,
    );
    const tapRes = await sysT.page.goto(`${t.erp}${cT.location}`);
    const button = sysT.page.locator("a[data-app-return]");
    const href = (await button.getAttribute("href").catch(() => null)) ?? "";
    const tapHtml = await sysT.page.content();
    check(
      "page d'ERPlead (Safari) : bouton « Apri InvoiceLead » vers le lien vérifié https://invoicelead.io/lead-auth/return?code=…&locale=it, sans redirection ni script, Referrer-Policy: no-referrer",
      tapRes?.status() === 200 &&
        (await button.count()) === 1 &&
        (await button.textContent())?.trim() === "Apri InvoiceLead" &&
        RETURN_RE.test(href) &&
        !/http-equiv="refresh"/i.test(tapHtml) &&
        (tapRes?.headers()["referrer-policy"] ?? "") === "no-referrer",
      href,
    );
    await shot(sysT.page, "g3l-7-safari-apri-invoicelead");
    // Le bouton touché quand l'app ne s'ouvre pas (Universal Link pas encore chargé) : la page de repli du site.
    await button.click();
    await sysT.page.waitForURL(`${t.il}/lead-auth/return`, { timeout: 30_000 }).catch(() => {});
    check(
      "bouton touché sans que l'app s'ouvre : la page de repli de l'aperçu, code effacé de l'adresse, « Torna su InvoiceLead », aucun rachat",
      sysT.page.url() === `${t.il}/lead-auth/return` &&
        (await sysT.page.getByRole("heading", { name: "Torna su InvoiceLead" }).count()) === 1 &&
        !production.some((u) =>
          u.startsWith(
            `${PROD_ERP}/auth/google/app/redeem?code=${new URL(href || "https://x.invalid").searchParams.get("code")}`,
          ),
        ),
      sysT.page.url(),
    );
    await shot(sysT.page, "g3l-8-repli-apres-le-bouton");
    await sysT.ctx.close();
    // Le même bouton, avec l'app : Universal Link → appUrlOpen sur la page relais → rachat.
    from = auditMax();
    n = production.length;
    await wt.page.evaluate((u) => window.__fakeEmit("App.appUrlOpen", { url: u }), href);
    await wt.page.waitForURL(onErpLogin("google"), { timeout: 40_000 });
    check(
      "iOS Safari : le lien touché (appUrlOpen) mène au rachat, une fois, sans Browser.close → écran de connexion, error=google",
      named(wt.calls, "Browser.close").length === 0 &&
        production.slice(n).filter((u) => u.startsWith(`${PROD_ERP}/auth/google/app/redeem?`))
          .length === 1,
    );
    check(
      "journal d'ERPlead : rachat Safari {app: invoicelead, outcome: google}, relevé",
      auditSince(from, "rachat Safari", "google_app.redeem", "invoicelead", "google") >= 1,
    );
    await wt.ctx.close();
    check(
      "Google ne s'ouvre jamais dans la vue web",
      googleInWebview.length === 0,
      googleInWebview,
    );

    // --- 6. Anciennes versions et navigateur : comme avant.
    for (const [ua, what] of [
      [OLD_APP, "version publiée (sans jeton)"],
      [FIRST_APP, "LeadAppAuth/1 (schéma propre, jamais publiée)"],
    ]) {
      const old = await context(ua, "webview", { platform: "ios", session: "none" });
      const r = await old.ctx.request.get(`${t.il}/it/login`, { maxRedirects: 0 });
      check(
        `${what} : /it/login part tout droit vers /auth/lead/start (redirection serveur, comme avant)`,
        [303, 307].includes(r.status()) &&
          (r.headers().location ?? "").includes("/auth/lead/start?locale=it"),
        r.status(),
      );
      if (ua === FIRST_APP) {
        await old.page.goto(`${t.il}/it/login`);
        await old.page.waitForURL(onErpLogin(), { timeout: 40_000 });
        check(
          "LeadAppAuth/1 sur l'écran du Compte Lead : la phrase « Password dimenticata? », aucun bouton Google",
          (await old.page.locator("[data-google-app-hint]").count()) === 1 &&
            (await old.page.locator('a[href*="/auth/google"]').count()) === 0,
        );
      }
      await old.ctx.close();
    }
    const web = await context(
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
      "desktop",
    );
    await web.page.goto(
      `${t.il}/lead-auth/google?${new URLSearchParams({ start: plainStart, back })}`,
    );
    await web.page.waitForURL(onErpLogin(), { timeout: 30_000 });
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
        [who.id, startedAt, "%InvoiceLeadApp LeadAppAuth/2%"],
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
      // Frein des départs : les `departs` passages de la porte retirés du compteur de son IP.
      const limitsNow = (
        await db.query(
          "select key, count, reset_at from rate_limits where key like 'gapp|%' order by key",
        )
      ).rows;
      let undone = 0;
      for (const row of limitsNow) {
        const was = limitsBefore[row.key];
        // Fenêtre déjà échue avant la porte : les départs de la porte ont remis le compteur à zéro.
        const lapsed = was && new Date(was.reset_at).getTime() <= startedAt.getTime();
        if (was && !lapsed && row.count <= was.count) continue;
        if (was && !lapsed && row.count === was.count + departs) {
          undone += (
            await db.query(
              "update rate_limits set count = $2, reset_at = $3 where key = $1 and count = $4",
              [row.key, was.count, was.reset_at, row.count],
            )
          ).rowCount;
        } else if (was && lapsed && row.count === departs) {
          undone += (
            await db.query(
              "update rate_limits set count = $2, reset_at = $3 where key = $1 and count = $4",
              [row.key, was.count, was.reset_at, row.count],
            )
          ).rowCount;
        } else if (!was && row.count <= departs) {
          undone += (
            await db.query("delete from rate_limits where key = $1 and count <= $2", [
              row.key,
              departs,
            ])
          ).rowCount;
        } else if (row.count > departs) {
          // D'autres départs sont passés en même temps (autre porte) : seuls ceux de la porte sont retirés.
          undone += (
            await db.query(
              "update rate_limits set count = count - $2 where key = $1 and count > $2",
              [row.key, departs],
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
        `remise en état : ${s.rowCount} session(s), ${c.rowCount} code(s) OpenID, ${st.rowCount} état(s), ${au.rowCount} ligne(s) de journal sur ${audits.flatMap((a) => a.ids).length} écrite(s) effacées, ${undone} compteur(s) du frein des départs rendus (${departs} départs) ; dernière connexion et langue reprises`,
      );
    });
  }
  const after = sqlRead(
    t.ro,
    `select json_build_object('sessions', (select count(*) from sessions where user_id = $1 and created_at >= $2 and user_agent like '%InvoiceLeadApp LeadAppAuth/2%'),
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
  // 4 départs, 4 codes (3 annulés + 0 : le code réussi est préparé par la porte), 5 rachats (3 échecs, 1 réussi, 1 rejoué).
  check(
    `journal d'ERPlead remis comme avant : les ${written.length} ligne(s) écrites par la porte (départs, codes, rachats, rachat rejoué) effacées`,
    departs === 4 &&
      written.length === 4 + 3 + 5 &&
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
