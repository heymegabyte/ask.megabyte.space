/**
 * og.ts — dynamic per-room Open Graph cards rendered at the EDGE (workers-og /
 * satori + resvg-wasm). Each public room gets a branded 1200×630 PNG showing the
 * brand lockup, `ask/<slug>`, its repo, the AI "understanding" read, and live
 * open/answered counts — so a shared room link unfurls with a card specific to it.
 *
 * Fonts (Space Grotesk 400/700 woff) + the lockup are fetched once from our own
 * static assets and cached on the warm isolate. satori supports ttf/otf/woff
 * (NOT woff2). Private rooms never render counts/understanding (privacy, §12/§14).
 */
import { ImageResponse } from 'workers-og';
import type { Env } from './env';

type Font = { name: string; data: ArrayBuffer; weight: 400 | 700; style: 'normal' };

let FONTS: Font[] | null = null;
let LOCKUP: string | null = null;

function assetUrl(origin: string, path: string): string {
  // SERVICE_ORIGIN is authoritative; fall back to the request origin if it's odd.
  try {
    return new URL(path, origin).toString();
  } catch {
    return `https://questionl.ink${path}`;
  }
}

async function fonts(env: Env, origin: string): Promise<Font[]> {
  if (FONTS) return FONTS;
  const [r4, r7] = await Promise.all([
    env.ASSETS.fetch(assetUrl(origin, '/fonts/space-grotesk-400.woff')),
    env.ASSETS.fetch(assetUrl(origin, '/fonts/space-grotesk-700.woff')),
  ]);
  FONTS = [
    { name: 'Space Grotesk', data: await r4.arrayBuffer(), weight: 400, style: 'normal' },
    { name: 'Space Grotesk', data: await r7.arrayBuffer(), weight: 700, style: 'normal' },
  ];
  return FONTS;
}

async function lockup(env: Env, origin: string): Promise<string> {
  if (LOCKUP) return LOCKUP;
  const bytes = new Uint8Array(
    await (await env.ASSETS.fetch(assetUrl(origin, '/logo-lockup.png'))).arrayBuffer(),
  );
  let bin = '';
  for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]);
  LOCKUP = `data:image/png;base64,${btoa(bin)}`;
  return LOCKUP;
}

const esc = (s: string): string =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

export interface OgData {
  slug: string;
  repo?: string | null;
  openCount: number;
  answeredCount: number;
  summary?: string | null;
}

function cardHtml(d: OgData, lockupUri: string): string {
  const counts = `${d.openCount} open · ${d.answeredCount} answered`;
  const body = d.summary?.trim()
    ? esc(d.summary.trim().slice(0, 180))
    : 'The decisions your coding agents would otherwise guess at — answered live.';
  const repoChip = d.repo
    ? `<div style="display:flex;align-items:center;height:52px;padding:0 24px;border-radius:999px;border:2px solid rgba(0,229,255,0.38);background:rgba(0,229,255,0.08);font-size:27px;font-weight:400;color:#9BE9FF;">${esc(
        d.repo,
      )}</div>`
    : '<div style="display:flex;"></div>';
  return `<div style="display:flex;flex-direction:column;justify-content:space-between;width:1200px;height:630px;padding:72px;background:#060610;color:#ffffff;font-family:'Space Grotesk';position:relative;">
    <div style="display:flex;position:absolute;top:0;left:0;width:1200px;height:6px;background:linear-gradient(90deg,#00E5FF,#7C3AED);"></div>
    <div style="display:flex;align-items:center;justify-content:space-between;width:1056px;">
      <img src="${lockupUri}" width="236" height="72" />
      ${repoChip}
    </div>
    <div style="display:flex;flex-direction:column;">
      <div style="display:flex;font-size:84px;font-weight:700;line-height:1.02;">
        <span style="color:rgba(255,255,255,0.42);">ask/</span><span>${esc(d.slug)}</span>
      </div>
      <div style="display:flex;margin-top:30px;font-size:33px;font-weight:400;line-height:1.35;color:rgba(255,255,255,0.74);max-width:1000px;">${body}</div>
    </div>
    <div style="display:flex;align-items:center;justify-content:space-between;width:1056px;font-size:29px;">
      <div style="display:flex;color:#00E5FF;font-weight:700;letter-spacing:1px;">questionl.ink</div>
      <div style="display:flex;color:rgba(255,255,255,0.6);font-weight:400;">${counts}</div>
    </div>
  </div>`;
}

/** Render the room OG card PNG with a short browser/CDN cache. */
export async function renderRoomOg(env: Env, origin: string, d: OgData): Promise<Response> {
  const [fontList, lockupUri] = await Promise.all([fonts(env, origin), lockup(env, origin)]);
  const img = new ImageResponse(cardHtml(d, lockupUri), {
    width: 1200,
    height: 630,
    fonts: fontList,
  });
  const res = new Response(img.body, img);
  res.headers.set('Content-Type', 'image/png');
  res.headers.set('Cache-Control', 'public, max-age=300, s-maxage=86400');
  return res;
}
