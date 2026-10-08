/**
 * Captures de la page d'accueil : des PNG de l'application (données d'exemple d'une entreprise
 * fictive) vers public/landing/<langue>/<nom>-<largeur>.avif|webp, plus leurs dimensions dans
 * src/components/landing/shots.json (lu par <Shot>).
 *
 *   node scripts/landing-images.mjs [dossier des PNG]
 *
 * Par défaut, le dossier partagé « partage/Quantum Liquid LLC/invoicelead/landing/captures », où
 * les PNG s'appellent <écran>-<langue>-desktop.png, <écran>-<langue>-mobile.png et
 * invoice-pdf-<langue>.png (la facture QR en PDF, section paiement comprise).
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import sharp from "sharp";

const SRC =
  process.argv[2] ??
  path.join(homedir(), "partage", "Quantum Liquid LLC", "invoicelead", "landing", "captures");
const OUT = "public/landing";
const LOCALES = ["de", "fr", "en"];
const DESKTOP = [800, 1280, 1920];
const MOBILE = [400, 800];

const SPECS = [
  ...["dashboard", "quote", "reminders", "expenses", "bills", "bank", "vat", "time"].map(
    (screen) => ({
      name: `${screen}-desktop`,
      file: (l) => `${screen}-${l}-desktop.png`,
      widths: DESKTOP,
    }),
  ),
  ...["dashboard", "capture"].map((screen) => ({
    name: `${screen}-mobile`,
    file: (l) => `${screen}-${l}-mobile.png`,
    widths: MOBILE,
  })),
  { name: "invoice-pdf", file: (l) => `invoice-pdf-${l}.png`, widths: [800, 1280] },
];

const manifest = {};
let missing = 0;
for (const locale of LOCALES) {
  mkdirSync(path.join(OUT, locale), { recursive: true });
  for (const spec of SPECS) {
    const input = path.join(SRC, spec.file(locale));
    if (!existsSync(input)) {
      console.warn(`[landing-images] manquant : ${input}`);
      missing += 1;
      continue;
    }
    const meta = await sharp(input).metadata();
    const widths = spec.widths.filter((w) => w <= (meta.width ?? 0));
    for (const width of widths) {
      const base = sharp(input).resize({ width, withoutEnlargement: true });
      const out = path.join(OUT, locale, `${spec.name}-${width}`);
      await base
        .clone()
        .avif({ quality: 62, effort: 6, chromaSubsampling: "4:4:4" })
        .toFile(`${out}.avif`);
      await base
        .clone()
        .webp({ quality: 84, effort: 6, smartSubsample: true })
        .toFile(`${out}.webp`);
    }
    const largest = widths[widths.length - 1] ?? 0;
    manifest[`${locale}/${spec.name}`] = {
      w: largest,
      h: Math.round(((meta.height ?? 0) * largest) / (meta.width ?? 1)),
      widths,
    };
  }
}
// Listes de largeurs sur une ligne, comme le formateur (Biome) les écrit.
const json = JSON.stringify(manifest, null, 2).replace(
  /\[\s+([\d,\s]+?)\s+\]/g,
  (_, list) => `[${list.split(/,\s*/).join(", ")}]`,
);
writeFileSync("src/components/landing/shots.json", `${json}\n`);
console.log(`[landing-images] ${Object.keys(manifest).length} captures, ${missing} manquantes`);
