#!/usr/bin/env node
/**
 * Prod smoke test for the Ask public-core vertical slice (§3, §21).
 * Drives the COMPLETE loop against a live deployment with real persistence +
 * transport: create → resolve-by-slug → enroll agent → publish question →
 * public answer → receipt → changes feed, plus a two-WebSocket-viewer live
 * propagation test and ownership/alias/dedup/noindex gates.
 *
 * Usage: ASK_BASE=https://<host> node scripts/verify-prod.mjs
 */
const BASE = (process.env.ASK_BASE || 'https://ask-megabyte-space.manhattan.workers.dev').replace(
  /\/$/,
  '',
);
const WS_BASE = BASE.replace(/^http/, 'ws');

let pass = 0;
let fail = 0;
const ok = (cond, msg) => {
  if (cond) {
    pass += 1;
    console.log('  ✓', msg);
  } else {
    fail += 1;
    console.log('  ✗', msg);
  }
};
const setCookie = (res) => {
  const all = res.headers.getSetCookie?.() ?? [];
  const raw = all[0] ?? res.headers.get('set-cookie');
  return raw ? raw.split(';')[0] : null;
};
const J = (body) => ({ 'content-type': 'application/json', ...(body || {}) });

async function main() {
  console.log(`\nAsk prod smoke → ${BASE}\n`);

  // 1. health
  let r = await fetch(`${BASE}/api/health`);
  let j = await r.json();
  ok(r.status === 200 && j.status === 'ok', `health 200 (v${j.version}, api ${j.api})`);

  // 2. SPA shell + noindex
  const home = await fetch(`${BASE}/`);
  const html = await home.text();
  ok(home.status === 200, 'GET / → 200');
  ok(/id="root"/.test(html), 'SPA shell served at /');
  ok(/noindex/i.test(html), 'noindex meta present in shell');
  const rob = await fetch(`${BASE}/robots.txt`);
  ok(rob.status === 200 && /Disallow:\s*\//.test(await rob.text()), 'robots.txt disallows all');

  // 3. create room (owner)
  const cr = await fetch(`${BASE}/api/v1/rooms`, { method: 'POST', headers: J(), body: '{}' });
  const crj = await cr.json();
  const ownerCookie = setCookie(cr);
  ok(
    [200, 201].includes(cr.status) && crj.room?.id?.startsWith('rm_') && crj.owned === true,
    `create room → ${crj.room?.slug}`,
  );
  ok(
    /^[a-z]+(?:-[a-z0-9]+)+$/.test(crj.room?.slug || ''),
    `slug looks intentional: ${crj.room?.slug}`,
  );
  ok(!!ownerCookie, 'owner Set-Cookie issued (HttpOnly session)');
  const id = crj.room.id;
  const slug = crj.room.slug;

  // 4. second browser resolves by slug → guest
  const snap2 = await fetch(`${BASE}/api/v1/rooms/${slug}`);
  const snap2j = await snap2.json();
  ok(
    snap2.status === 200 && snap2j.room?.id === id && snap2j.viewerRole === 'guest',
    'second browser resolves slug → guest role',
  );
  ok(
    (snap2.headers.get('x-robots-tag') || '').includes('noindex'),
    'API carries X-Robots-Tag noindex',
  );
  ok((snap2.headers.get('cache-control') || '').includes('no-store'), 'API Cache-Control no-store');

  // 5. enroll agent → scoped token
  const en = await fetch(`${BASE}/api/v1/rooms/${id}/agents`, {
    method: 'POST',
    headers: J(),
    body: JSON.stringify({ agent: 'Claude Code', version: 'verify', features: ['hooks'] }),
  });
  const enj = await en.json();
  ok(
    [200, 201].includes(en.status) && enj.install?.id?.startsWith('ai_') && !!enj.token,
    'agent enrolled + scoped token',
  );
  const bearer = `Bearer ${enj.install.id}.${enj.token}`;

  // 6. open TWO WS viewers BEFORE the writes (live propagation test)
  const received = [[], []];
  const sockets = await Promise.all(
    [0, 1].map(
      (i) =>
        new Promise((resolve) => {
          const ws = new WebSocket(`${WS_BASE}/api/v1/rooms/${id}/events`);
          ws.addEventListener('message', (ev) => {
            try {
              received[i].push(JSON.parse(ev.data));
            } catch {
              /* ignore */
            }
          });
          ws.addEventListener('open', () => resolve(ws));
          ws.addEventListener('error', () => resolve(ws));
          setTimeout(() => resolve(ws), 4000);
        }),
    ),
  );
  await new Promise((res) => setTimeout(res, 600));
  ok(
    received.every((arr) => arr.some((m) => m.type === 'hello')),
    'both WS viewers got hello + cursor',
  );

  // 7. publish a real question (as the agent)
  const qBody = {
    questions: [
      {
        kind: 'single',
        dedupKey: 'verify-db-choice',
        title: 'Which database should the MVP use?',
        context: 'We must pick a store for the first slice.',
        consequence: 'Switching later means a migration.',
        category: 'architecture',
        klass: 'decision',
        horizon: 'now',
        options: [
          { id: 'd1', label: 'Cloudflare D1' },
          { id: 'pg', label: 'Postgres' },
        ],
        recommendation: 'D1 — edge-native, zero infra.',
        blocksWork: true,
      },
    ],
  };
  const pq = await fetch(`${BASE}/api/v1/rooms/${id}/questions:batch`, {
    method: 'POST',
    headers: J({ authorization: bearer }),
    body: JSON.stringify(qBody),
  });
  const pqj = await pq.json();
  ok(
    [200, 201].includes(pq.status) && pqj.created === 1 && pqj.questions?.[0]?.id?.startsWith('q_'),
    'question published (created=1)',
  );
  const qid = pqj.questions[0].id;

  // 8. dedup — same dedupKey must not duplicate
  const pqDup = await fetch(`${BASE}/api/v1/rooms/${id}/questions:batch`, {
    method: 'POST',
    headers: J({ authorization: bearer }),
    body: JSON.stringify(qBody),
  });
  const pqDupj = await pqDup.json();
  ok(pqDupj.deduped === 1 && pqDupj.created === 0, 'dedup: identical dedupKey not re-created');

  // 9. public answer (no account, second browser)
  const an = await fetch(`${BASE}/api/v1/rooms/${id}/questions/${qid}/answers`, {
    method: 'POST',
    headers: J(),
    body: JSON.stringify({ value: { kind: 'choice', selected: ['d1'] }, text: 'D1 for the MVP.' }),
  });
  const anj = await an.json();
  ok(
    [200, 201].includes(an.status) &&
      anj.answer?.id?.startsWith('a_') &&
      anj.answer.status === 'answer_saved',
    'public answer saved (no login)',
  );
  const aid = anj.answer.id;

  // 10. WS propagation — both viewers saw the question + answer with no reload
  await new Promise((res) => setTimeout(res, 1000));
  const sawQ = received.map((arr) =>
    arr.some((m) => m.type === 'event' && m.event?.type === 'question.created'),
  );
  const sawA = received.map((arr) =>
    arr.some((m) => m.type === 'event' && m.event?.type === 'answer.created'),
  );
  ok(sawQ[0] && sawQ[1], 'both WS viewers received question.created (no reload)');
  ok(sawA[0] && sawA[1], 'both WS viewers received answer.created (no reload)');

  // 11. receipt (agent-reported application evidence) advances answer status
  const rc = await fetch(`${BASE}/api/v1/rooms/${id}/receipts`, {
    method: 'POST',
    headers: J({ authorization: bearer }),
    body: JSON.stringify({
      questionId: qid,
      answerId: aid,
      state: 'applied',
      status: 'applied_to_project',
      decisionSummary: 'Chose D1 for the MVP store.',
      affectedPaths: ['docs/ask/decisions.md'],
    }),
  });
  const rcj = await rc.json();
  ok([200, 201].includes(rc.status) && rcj.receipt?.id?.startsWith('rcpt_'), 'receipt recorded');

  // 12. receipt requires agent auth (spoof protection)
  const rcNoAuth = await fetch(`${BASE}/api/v1/rooms/${id}/receipts`, {
    method: 'POST',
    headers: J(),
    body: JSON.stringify({
      questionId: qid,
      answerId: aid,
      state: 'applied',
      status: 'applied_to_project',
    }),
  });
  ok(rcNoAuth.status === 401, 'receipt without agent token → 401 (no forged receipts)');

  // 13. snapshot reflects applied status + receipt (owner view)
  const fin = await fetch(`${BASE}/api/v1/rooms/${id}`, { headers: { cookie: ownerCookie } });
  const finj = await fin.json();
  ok(finj.viewerRole === 'owner', 'owner cookie → owner role');
  ok(
    finj.answers?.find((a) => a.id === aid)?.status === 'applied_to_project',
    'answer status advanced → applied_to_project',
  );
  ok((finj.receipts?.length ?? 0) >= 1, 'receipt present in snapshot');

  // 14. changes feed carries the full event chain
  const ch = await fetch(`${BASE}/api/v1/rooms/${id}/changes?cursor=0`);
  const chj = await ch.json();
  const types = (chj.events || []).map((e) => e.type);
  ok(
    ['room.created', 'question.created', 'answer.created', 'receipt.recorded'].every((t) =>
      types.includes(t),
    ),
    'changes feed has full event chain',
  );

  // 15. ownership — slug knowledge does NOT grant admin
  const rnGuest = await fetch(`${BASE}/api/v1/rooms/${id}/settings`, {
    method: 'PATCH',
    headers: J(),
    body: JSON.stringify({ slug: `${slug}-x` }),
  });
  ok(rnGuest.status === 403, 'non-owner cannot rename (403)');

  // 16. owner rename keeps immutable room id; old slug aliases
  const rnOwner = await fetch(`${BASE}/api/v1/rooms/${id}/settings`, {
    method: 'PATCH',
    headers: J({ cookie: ownerCookie }),
    body: JSON.stringify({ slug: `${slug}-renamed` }),
  });
  const rnOwnerj = await rnOwner.json();
  ok(
    rnOwner.status === 200 && rnOwnerj.room?.slug === `${slug}-renamed` && rnOwnerj.room?.id === id,
    'owner rename works; room id immutable',
  );
  const alias = await fetch(`${BASE}/api/v1/rooms/${slug}`);
  const aliasj = await alias.json();
  ok(alias.status === 200 && aliasj.room?.id === id, 'old slug alias still resolves to same room');

  // 17. unknown API route → real 404
  ok((await fetch(`${BASE}/api/v1/nope`)).status === 404, 'unknown /api route → 404');

  // 18. billing honestly unconfigured (never a fake success)
  const co = await fetch(`${BASE}/api/v1/rooms/${id}/checkout`, {
    method: 'POST',
    headers: { cookie: ownerCookie },
  });
  ok(co.status === 501, 'checkout → honest 501 (billing not configured)');

  // 19. complete identity set — favicon.ico + vector mark + enriched manifest (the floor)
  const ico = await fetch(`${BASE}/favicon.ico`);
  ok(
    ico.status === 200 && (ico.headers.get('content-type') || '').includes('icon'),
    'favicon.ico 200 (multi-res ICO)',
  );
  const svg = await fetch(`${BASE}/logo-mark.svg`);
  ok(
    svg.status === 200 && (svg.headers.get('content-type') || '').includes('svg'),
    'logo-mark.svg 200 (scalable vector mark)',
  );
  ok((await fetch(`${BASE}/mask-icon.svg`)).status === 200, 'mask-icon.svg 200 (Safari pinned tab)');
  const manj = await (await fetch(`${BASE}/site.webmanifest`)).json();
  ok(
    Array.isArray(manj.screenshots) && manj.screenshots.length >= 2 && Array.isArray(manj.shortcuts),
    'manifest complete (screenshots + shortcuts)',
  );
  ok((manj.icons || []).some((i) => i.purpose === 'maskable'), 'manifest has a maskable icon');

  // 20. dynamic per-room OG card (edge-rendered) + HTMLRewriter meta injection
  const curSlug = `${slug}-renamed`;
  const og = await fetch(`${BASE}/og/${curSlug}.png`);
  ok(
    og.status === 200 && (og.headers.get('content-type') || '').includes('image/png'),
    'GET /og/:slug.png → 200 image/png (edge-rendered card)',
  );
  const roomHtml = await (await fetch(`${BASE}/${curSlug}`)).text();
  ok(roomHtml.includes(`/og/${curSlug}.png`), 'room page: per-room og:image injected (HTMLRewriter)');
  ok(roomHtml.includes(`ask/${curSlug} — Ask`), 'room page: per-room og:title injected');
  ok(
    !html.includes(`/og/${curSlug}.png`),
    'root / keeps the DEFAULT OG card (injection scoped to rooms)',
  );

  for (const ws of sockets) {
    try {
      ws.close();
    } catch {
      /* ignore */
    }
  }
  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
