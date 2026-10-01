// Icônes de l'application installable (carrées, sans arrondi : Trait net). node scripts/make-icons.mjs
import sharp from "sharp";

const svg = (
  size,
  pad,
) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="#2563eb"/>
  <text x="50%" y="50%" dy="0.35em" text-anchor="middle" font-family="DejaVu Sans, Arial, sans-serif" font-weight="800" font-size="${Math.round((size - 2 * pad) * 0.5)}" fill="#ffffff">IL</text>
</svg>`;

const out = [
  ["public/icons/icon-192.png", 192, 0],
  ["public/icons/icon-512.png", 512, 0],
  ["public/icons/maskable-512.png", 512, 80],
  ["public/icons/apple-touch-icon.png", 180, 0],
  ["public/icons/favicon-32.png", 32, 0],
];
for (const [file, size, pad] of out) {
  await sharp(Buffer.from(svg(size, pad)))
    .png()
    .toFile(file);
  console.log(file);
}
