/**
 * process-logo.mjs — turn chosen generated raster logos into the shipped assets.
 *
 * A luminance-keyed alpha (dark → transparent, with an anti-alias ramp) turns the
 * near-black generation field — and the knocked-out "?" — transparent, yielding a
 * FLOATING gradient mark/lockup that sits cleanly on the dark navbar, then trims the
 * margins. Emits from the ICON source: logo-mark.png (square navbar mark) + favicon +
 * apple-touch + maskable PWA icons. If a LOCKUP source is given, also emits
 * logo-lockup.png (the wide icon+"ask" wordmark, aspect preserved) for the navbar/OG.
 *
 * Run: node scripts/process-logo.mjs <icon.png> [lockup.png]
 */
import sharp from 'sharp';

const SRC_ICON = process.argv[2];
const SRC_LOCK = process.argv[3]; // optional horizontal icon+wordmark lockup
const T = Number(process.env.LUM_T || 52); // below this luminance → transparent
const RAMP = Number(process.env.LUM_RAMP || 30); // anti-alias ramp above T

/** Luminance-key a source to a trimmed transparent PNG buffer. */
async function keyTransparent(src) {
  const { data, info } = await sharp(src).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let p = 0; p < data.length; p += 4) {
    const lum = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
    data[p + 3] = lum <= T ? 0 : lum >= T + RAMP ? 255 : Math.round(((lum - T) / RAMP) * 255);
  }
  return sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
    .trim({ threshold: 12 })
    .png()
    .toBuffer();
}

// ── Icon → navbar mark (square) + favicon/apple-touch/PWA icons ──
const icon = await keyTransparent(SRC_ICON);
await sharp(icon)
  .resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .png()
  .toFile('public/logo-mark.png');

const icons = {
  'public/favicon.png': 64,
  'public/apple-touch-icon.png': 180,
  'public/icon-192.png': 192,
  'public/icon-512.png': 512,
};
for (const [f, s] of Object.entries(icons)) {
  await sharp(icon)
    .resize(Math.round(s * 0.84), Math.round(s * 0.84), {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .extend({
      top: Math.round(s * 0.08),
      bottom: Math.round(s * 0.08),
      left: Math.round(s * 0.08),
      right: Math.round(s * 0.08),
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .resize(s, s)
    .png()
    .toFile(f);
}

// ── Lockup → wide icon+"ask" wordmark (aspect preserved, height-normalized) ──
let lockMsg = '';
if (SRC_LOCK) {
  const lock = await keyTransparent(SRC_LOCK);
  await sharp(lock)
    .resize({ height: 220, fit: 'inside', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile('public/logo-lockup.png');
  const meta = await sharp('public/logo-lockup.png').metadata();
  lockMsg = ` + logo-lockup.png (${meta.width}x${meta.height})`;
}

console.log(`wrote public/logo-mark.png + favicon.png + apple-touch + icon-192/512${lockMsg}`);
