/**
 * gen-icons.mjs — derive the COMPLETE favicon/vector set from the one shipped mark
 * (run after process-logo.mjs). realfavicongenerator-parity, zero drift:
 *   • favicon.ico         — multi-res ICO (16/32/48, PNG-embedded) for legacy + tabs
 *   • favicon-16x16.png   · favicon-32x32.png  — explicit sizes
 *   • logo-mark.svg       — the mark traced to a SCALABLE vector, brand-gradient filled
 *   • mask-icon.svg       — monochrome silhouette for Safari pinned tabs
 * Source: public/favicon.png (padded raster) + public/logo-mark.png (transparent mark).
 * Run: node scripts/gen-icons.mjs
 */
import sharp from 'sharp';
import { writeFileSync } from 'node:fs';
import potrace from 'potrace';

const GRAD_A = '#00E5FF';
const GRAD_B = '#7C3AED';

/** Assemble a PNG-embedded .ico from sized PNG buffers (ICONDIR + entries + bodies). */
function buildIco(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(entries.length, 4);
  const dir = Buffer.alloc(16 * entries.length);
  let offset = 6 + 16 * entries.length;
  const bodies = [];
  entries.forEach(({ size, buf }, i) => {
    const e = dir.subarray(i * 16, i * 16 + 16);
    e.writeUInt8(size >= 256 ? 0 : size, 0); // width (0 ⇒ 256)
    e.writeUInt8(size >= 256 ? 0 : size, 1); // height
    e.writeUInt8(0, 2); // color count
    e.writeUInt8(0, 3); // reserved
    e.writeUInt16LE(1, 4); // color planes
    e.writeUInt16LE(32, 6); // bits per pixel
    e.writeUInt32LE(buf.length, 8); // byte size
    e.writeUInt32LE(offset, 12); // offset
    offset += buf.length;
    bodies.push(buf);
  });
  return Buffer.concat([header, dir, ...bodies]);
}

/** Trace the mark's alpha silhouette (mark opaque, "?" + bg transparent) to an SVG path. */
function traceSvg(grayPngBuf) {
  return new Promise((resolve, reject) => {
    potrace.trace(
      grayPngBuf,
      { threshold: 128, turdSize: 60, optTolerance: 0.4, color: '#000000', background: 'transparent' },
      (err, svg) => (err ? reject(err) : resolve(svg)),
    );
  });
}

// ── favicon-16/32 + favicon.ico (16/32/48) from the padded 64px favicon ──
const sizes = [16, 32, 48];
const pngs = await Promise.all(
  sizes.map(async (size) => ({ size, buf: await sharp('public/favicon.png').resize(size, size).png().toBuffer() })),
);
writeFileSync('public/favicon.ico', buildIco(pngs));
await sharp('public/favicon.png').resize(16, 16).png().toFile('public/favicon-16x16.png');
await sharp('public/favicon.png').resize(32, 32).png().toFile('public/favicon-32x32.png');

// ── trace the mark → scalable vector (gradient) + Safari mask-icon (mono) ──
const { data, info } = await sharp('public/logo-mark.png')
  .ensureAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true });
const gray = Buffer.alloc(info.width * info.height);
for (let i = 0, p = 0; p < data.length; p += 4, i += 1) gray[i] = 255 - data[p + 3]; // mark → black
const grayPng = await sharp(gray, { raw: { width: info.width, height: info.height, channels: 1 } })
  .png()
  .toBuffer();
const traced = await traceSvg(grayPng);

// mask-icon: the traced silhouette as-is (Safari recolors via <link color>).
writeFileSync('public/mask-icon.svg', traced);

// logo-mark.svg: same path, brand-gradient filled — a real scalable brand asset.
const grad = `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${GRAD_A}"/><stop offset="1" stop-color="${GRAD_B}"/></linearGradient></defs>`;
const gradientSvg = traced
  .replace(/(<svg[^>]*>)/, `$1${grad}`)
  .replace(/fill="#000000"/g, 'fill="url(#g)"');
writeFileSync('public/logo-mark.svg', gradientSvg);

// ── Maskable PWA icons — OPAQUE brand bg, mark in the 60% safe zone (OS masks to circle/squircle) ──
for (const s of [192, 512]) {
  const inner = Math.round(s * 0.6);
  const mark = await sharp('public/logo-mark.png')
    .resize(inner, inner, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .toBuffer();
  await sharp({ create: { width: s, height: s, channels: 4, background: '#060610' } })
    .composite([{ input: mark, gravity: 'center' }])
    .png()
    .toFile(`public/icon-${s}-maskable.png`);
}

console.log('wrote favicon.ico (16/32/48) + favicon-16x16/32x32.png + logo-mark.svg + mask-icon.svg + icon-192/512-maskable.png');
