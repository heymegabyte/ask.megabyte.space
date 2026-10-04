/**
 * gen-logo.mjs — generate logo candidates via Cloudflare Workers AI image models
 * (CF-native, billed through Cloudflare — the working path when Ideogram's own key
 * is unavailable; Ideogram-via-AI-Gateway needs a valid Ideogram `Api-Key`). Writes
 * each candidate PNG + one horizontal CONTACT SHEET so an AI-vision pass can pick the
 * best from a single image. Used by the logo-generation recursive-refinement loop.
 *
 * Env: CF_ACCOUNT_ID, CLOUDFLARE_EMAIL, CLOUDFLARE_API_KEY (global key), optional
 *      LOGO_MODEL (default flux-1-schnell), OUT_TAG (sheet suffix).
 * Usage: node scripts/gen-logo.mjs <prompts.json>   (prompts.json = array of strings)
 */
import sharp from 'sharp';
import { readFileSync, writeFileSync } from 'node:fs';

const ACCT = process.env.CF_ACCOUNT_ID;
const EMAIL = process.env.CLOUDFLARE_EMAIL;
const KEY = process.env.CLOUDFLARE_API_KEY;
const MODEL = process.env.LOGO_MODEL || '@cf/black-forest-labs/flux-1-schnell';
const TAG = process.env.OUT_TAG || 'r1';
const prompts = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const CELL = 300;

async function gen(prompt, i) {
  try {
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${ACCT}/ai/run/${MODEL}`,
      {
        method: 'POST',
        headers: { 'X-Auth-Email': EMAIL, 'X-Auth-Key': KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, steps: 8 }),
      },
    );
    const ct = res.headers.get('content-type') || '';
    let buf;
    if (ct.includes('json')) {
      const j = await res.json();
      const b64 = j?.result?.image;
      if (!b64) {
        console.error(`#${i} no image:`, JSON.stringify(j).slice(0, 160));
        return null;
      }
      buf = Buffer.from(b64, 'base64');
    } else {
      buf = Buffer.from(await res.arrayBuffer());
    }
    const f = `/tmp/logo_${TAG}_${i}.png`;
    await sharp(buf).png().toFile(f);
    return { f, i };
  } catch (e) {
    console.error(`#${i} err:`, String(e).slice(0, 120));
    return null;
  }
}

const out = [];
for (let i = 0; i < prompts.length; i++) {
  const r = await gen(prompts[i], i);
  if (r) out.push(r);
}

const tiles = await Promise.all(
  out.map(async ({ f, i }) => {
    const base = await sharp(f)
      .resize(CELL, CELL, { fit: 'contain', background: '#0a0a12' })
      .toBuffer();
    const label = Buffer.from(
      `<svg width="${CELL}" height="26"><rect width="100%" height="26" fill="#000"/><text x="8" y="19" fill="#00E5FF" font-size="18" font-family="monospace">#${i}</text></svg>`,
    );
    return sharp(base)
      .composite([{ input: label, top: 0, left: 0 }])
      .png()
      .toBuffer();
  }),
);

if (tiles.length) {
  const W = CELL * tiles.length + 10 * (tiles.length + 1);
  const sheet = await sharp({
    create: { width: W, height: CELL + 20, channels: 3, background: '#0a0a12' },
  })
    .composite(tiles.map((t, k) => ({ input: t, left: 10 + k * (CELL + 10), top: 10 })))
    .png()
    .toBuffer();
  writeFileSync(`/tmp/logo_sheet_${TAG}.png`, sheet);
}
console.log(`generated ${out.length}/${prompts.length} → /tmp/logo_sheet_${TAG}.png`);
