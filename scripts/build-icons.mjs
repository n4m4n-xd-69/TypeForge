/**
 * Renders every brand asset from the one shape in src/components/brand/Logo.jsx.
 *
 *   node scripts/build-icons.mjs
 *
 * The header, favicon, apple-touch icon and PWA icons previously disagreed:
 * index.html carried its own inline data-URI "k" that had nothing to do with
 * Logo.jsx, and public/logo.svg and favicon.svg were referenced by nothing at
 * all. Editing the logo therefore changed one surface and left three showing
 * the old mark. Everything below is derived, so there is exactly one shape to
 * change and no way for them to drift again.
 *
 * PNGs are written only if `sharp` is installed — it is not a dependency, and
 * the SVGs plus the manifest are enough for the browser tab and for install
 * prompts on every current platform. Run `npm i -D sharp` to regenerate the
 * raster set after a shape change.
 */
import fs from 'node:fs';
import path from 'node:path';

const OUT = 'public';

/* Kept in sync with src/components/brand/Logo.jsx — imported rather than
   duplicated so a shape change here is impossible to forget. */
const src = fs.readFileSync('src/components/brand/Logo.jsx', 'utf8');
const pick = (name) => {
  const m = src.match(new RegExp(`export const ${name} =\\s*([\\s\\S]*?);\\r?\\n`));
  if (!m) throw new Error(`Logo.jsx no longer exports ${name}`);
  return m[1].trim();
};

const str = (name) => pick(name).replace(/^['"]|['"]$/g, '');

const RADIUS = Number(pick('LOGO_TILE_RADIUS'));
const FORGE = str('LOGO_FORGE');
const INK = str('LOGO_INK');

/* The mark is two paths — the caret and the baseline it advances along — so
   the glyph is a fragment rather than a single `d`. `pick` throws when a
   constant disappears, which is what makes this file fail loudly on a rename
   instead of quietly emitting an icon with a missing shape. */
const GLYPH =
  `<path d="${str('LOGO_CARET_PATH')}" fill="${INK}"/>` +
  `<path d="${str('LOGO_BAR_PATH')}" fill="${INK}"/>`;

/** The tile is the canvas on icon surfaces, so these never take the house tilt:
 *  rotating would leave the corners empty and every OS mask would crop it. */
const tile = (radius = RADIUS) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100">` +
  `<rect width="100" height="100" rx="${radius}" fill="${FORGE}"/>` +
  GLYPH +
  `</svg>`;

/** Maskable icons need the glyph inside the safe zone: Android crops to a
 *  circle inscribed in the middle 80%, so the artwork is scaled to fit. */
const maskable = () =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100">` +
  `<rect width="100" height="100" fill="${FORGE}"/>` +
  `<g transform="translate(50 50) scale(0.78) translate(-50 -50)">${GLYPH}</g>` +
  `</svg>`;

/**
 * Social card. 1200x630 is what every platform crops toward, and the mark is
 * left of centre so the wordmark that follows it reads as one lockup rather
 * than two centred objects.
 */
const og = () =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630" width="1200" height="630">` +
  `<rect width="1200" height="630" fill="#0A0B0D"/>` +
  `<g transform="translate(96 233) scale(1.64)">` +
  `<rect width="100" height="100" rx="${RADIUS}" fill="${FORGE}"/>${GLYPH}` +
  `</g>` +
  `<text x="292" y="332" font-family="Space Grotesk, Segoe UI, Helvetica, Arial, sans-serif" ` +
  `font-size="92" font-weight="700" letter-spacing="-3" fill="#F2F4F7">TypeForge</text>` +
  `<text x="296" y="390" font-family="JetBrains Mono, Consolas, monospace" ` +
  `font-size="27" fill="#828C97">type faster, prove it</text>` +
  `</svg>`;

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'favicon.svg'), tile());
fs.writeFileSync(path.join(OUT, 'logo.svg'), tile());
console.log('✓ favicon.svg, logo.svg');

let sharp = null;
try {
  ({ default: sharp } = await import('sharp'));
} catch {
  console.log('· sharp not installed — skipping PNGs (npm i -D sharp to regenerate)');
}

if (sharp) {
  const raster = [
    ['icon-192.png', tile(), 192],
    ['icon-512.png', tile(), 512],
    ['apple-touch-icon.png', tile(0), 180], // iOS applies its own mask; a rounded tile would double-round
    ['icon-maskable-512.png', maskable(), 512],
    ['og.png', og(), 1200],
  ];
  for (const [name, svg, size] of raster) {
    await sharp(Buffer.from(svg)).resize(size, size).png().toFile(path.join(OUT, name));
    console.log(`✓ ${name}`);
  }
}
