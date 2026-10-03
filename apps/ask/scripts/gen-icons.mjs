/**
 * gen-icons.mjs — derive every raster brand icon from the one Ask mark.
 *
 * Single source of truth → apple-touch-icon (180) + maskable PWA icons (192/512),
 * so the raster icons never drift from `public/favicon.svg` / the navbar mark.
 * Uses a flat (no-mask) rendition — a dark "?" on the gradient tile — which
 * rasterizes identically to the masked favicon on the dark brand surface and
 * renders reliably in any SVG rasterizer. Run: `node scripts/gen-icons.mjs`.
 */
import sharp from 'sharp';

const MARK = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">
<defs><linearGradient id="g" x1="8" y1="6" x2="40" y2="44" gradientUnits="userSpaceOnUse"><stop stop-color="#00E5FF"/><stop offset="1" stop-color="#7C3AED"/></linearGradient></defs>
<rect x="4" y="4" width="40" height="40" rx="12" fill="url(#g)"/>
<path d="M14 42L10 47.5L22 43Z" fill="url(#g)"/>
<path d="M16.6 18.2C16.6 11.8 20.2 8.6 24.2 8.6C28.6 8.6 31.8 11.7 31.8 15.5C31.8 20 27.8 21.5 25.4 24C24.1 25.4 23.7 26.4 23.7 28.6" fill="none" stroke="#060610" stroke-width="4.3" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M24 30.6L27 33.4L24 36.2L21 33.4Z" fill="#060610"/>
</svg>`;

const buf = Buffer.from(MARK);
const targets = {
  'public/apple-touch-icon.png': 180,
  'public/icon-192.png': 192,
  'public/icon-512.png': 512,
};

for (const [file, size] of Object.entries(targets)) {
  await sharp(buf, { density: 512 })
    .resize(size, size, { fit: 'contain', background: '#060610' })
    .flatten({ background: '#060610' })
    .png()
    .toFile(file);
  console.log('wrote', file, `${size}x${size}`);
}
