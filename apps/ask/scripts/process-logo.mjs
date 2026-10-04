/**
 * process-logo.mjs — turn a chosen generated raster logo into the shipped assets.
 *
 * The generated mark sits on a near-black field and its "?" is dark; a luminance-keyed
 * alpha (dark → transparent, with an anti-alias ramp) yields a FLOATING gradient mark
 * whose "?" + background are transparent — perfect on the dark navbar — then trims the
 * margins. Emits: logo-mark.png (transparent navbar mark) + favicon.png + apple-touch +
 * maskable PWA icons (opaque on brand #060610). Run: node scripts/process-logo.mjs <src>
 */
import sharp from 'sharp';

const SRC = process.argv[2];
const T = Number(process.env.LUM_T || 52); // below this luminance → transparent
const RAMP = Number(process.env.LUM_RAMP || 30); // anti-alias ramp above T

const { data, info } = await sharp(SRC).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
for (let p = 0; p < data.length; p += 4) {
  const lum = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
  data[p + 3] = lum <= T ? 0 : lum >= T + RAMP ? 255 : Math.round(((lum - T) / RAMP) * 255);
}
const transparent = await sharp(data, {
  raw: { width: info.width, height: info.height, channels: 4 },
})
  .trim({ threshold: 12 })
  .png()
  .toBuffer();

// Navbar mark — transparent, square-padded to 512.
await sharp(transparent)
  .resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .png()
  .toFile('public/logo-mark.png');

// Opaque icons on the brand surface (favicon + apple-touch + maskable PWA).
const icons = {
  'public/favicon.png': 64,
  'public/apple-touch-icon.png': 180,
  'public/icon-192.png': 192,
  'public/icon-512.png': 512,
};
for (const [f, s] of Object.entries(icons)) {
  await sharp(transparent)
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
console.log('wrote public/logo-mark.png + favicon.png + apple-touch + icon-192/512');
