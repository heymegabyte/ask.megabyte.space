/**
 * gen-logo.mjs — generate logo candidates. Ideogram V3 (DESIGN) is the PRIMARY
 * generator (crisp vector marks + legible baked text — its signature strength);
 * Cloudflare Workers AI (flux) is the FALLBACK when no Ideogram key is funded.
 * Writes each candidate PNG + one horizontal CONTACT SHEET so an AI-vision pass can
 * pick the best from a single image. Drives the logo-generation refinement loop.
 *
 * Provider: uses Ideogram when IDEOGRAM_API_KEY is set (override with
 *   LOGO_PROVIDER=flux to force the CF path, or =ideogram to require it).
 * Env: IDEOGRAM_API_KEY (primary) · CF_ACCOUNT_ID + CLOUDFLARE_EMAIL +
 *      CLOUDFLARE_API_KEY (fallback) · LOGO_MODEL (flux model) · OUT_TAG (sheet suffix).
 * Input: a JSON array of strings OR {prompt, aspect} objects (aspect e.g. "1x1","3x1").
 * Usage: node scripts/gen-logo.mjs <prompts.json>
 */
import sharp from 'sharp';
import { readFileSync, writeFileSync } from 'node:fs';

const ACCT = process.env.CF_ACCOUNT_ID;
const EMAIL = process.env.CLOUDFLARE_EMAIL;
const KEY = process.env.CLOUDFLARE_API_KEY;
const IDEO = process.env.IDEOGRAM_API_KEY;
const FORCE = process.env.LOGO_PROVIDER; // 'ideogram' | 'flux' | undefined
const MODEL = process.env.LOGO_MODEL || '@cf/black-forest-labs/flux-1-schnell';
const TAG = process.env.OUT_TAG || 'r1';
const raw = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const items = raw.map((x) => (typeof x === 'string' ? { prompt: x } : x));
const useIdeogram = FORCE === 'ideogram' || (!!IDEO && FORCE !== 'flux');
const CELL = 320;

/** Ideogram V3 generate (multipart). DESIGN style, QUALITY speed, no magic-prompt drift. */
async function genIdeogram(prompt, aspect, i) {
  try {
    const fd = new FormData();
    fd.append('prompt', prompt);
    fd.append('aspect_ratio', aspect || '1x1');
    fd.append('rendering_speed', 'QUALITY');
    fd.append('style_type', 'DESIGN');
    fd.append('magic_prompt', 'OFF');
    fd.append('num_images', '1');
    const res = await fetch('https://api.ideogram.ai/v1/ideogram-v3/generate', {
      method: 'POST',
      headers: { 'Api-Key': IDEO },
      body: fd,
    });
    if (!res.ok) {
      console.error(`#${i} ideogram ${res.status}:`, (await res.text()).slice(0, 220));
      return null;
    }
    const j = await res.json();
    const url = j?.data?.[0]?.url;
    if (!url) {
      console.error(`#${i} ideogram no url:`, JSON.stringify(j).slice(0, 180));
      return null;
    }
    const img = await fetch(url);
    const buf = Buffer.from(await img.arrayBuffer());
    const f = `/tmp/logo_${TAG}_${i}.png`;
    await sharp(buf).png().toFile(f);
    return { f, i };
  } catch (e) {
    console.error(`#${i} ideogram err:`, String(e).slice(0, 140));
    return null;
  }
}

/** Cloudflare Workers AI (flux) fallback. */
async function genFlux(prompt, i) {
  try {
    const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCT}/ai/run/${MODEL}`, {
      method: 'POST',
      headers: { 'X-Auth-Email': EMAIL, 'X-Auth-Key': KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, steps: 8 }),
    });
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
for (let i = 0; i < items.length; i++) {
  const { prompt, aspect } = items[i];
  const r = useIdeogram ? await genIdeogram(prompt, aspect, i) : await genFlux(prompt, i);
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
console.log(`[${useIdeogram ? 'ideogram' : 'flux'}] generated ${out.length}/${items.length} → /tmp/logo_sheet_${TAG}.png`);
