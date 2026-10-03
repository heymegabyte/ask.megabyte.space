/**
 * Ask Worker — routing, Room Durable Object host, REST API, assets, and the
 * billing/MCP boundaries. Business operations live in the Room DO so REST, MCP,
 * and internal calls share one authority (§11, §12).
 */
import { Hono, type Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import {
  API_VERSION,
  CreateRoomRequest,
  EnrollAgentRequest,
  type IntegrationManifest,
  type MeRoom,
  PostAnswerRequest,
  PostQuestionsRequest,
  PostReceiptRequest,
  PROTOCOL_VERSION,
  type Role,
  type Room,
  UpdateSettingsRequest,
} from '@ask/contracts';
import type { Env, RateLimiter } from './env';
import { RoomDurableObject, RoomError } from './room';
import { newRoomId, newSecret, sha256 } from './ids';
import { generateSlug, isValidSlug, normalizeSlug } from './slugs';

const ADAPTER_VERSION = '0.1.0';
const SID_COOKIE = 'ask_sid';
const now = (): string => new Date().toISOString();

type Ctx = { Bindings: Env };

const app = new Hono<Ctx>();

// ── cross-cutting: request id, noindex, no-store on room data (§13, §21) ──────
app.use('*', async (c, next) => {
  c.header('X-Request-Id', crypto.randomUUID());
  await next();
  // Discovery: no indexing anywhere (§1 — public is still public, just not indexed).
  c.header('X-Robots-Tag', 'noindex, nofollow');
  if (c.req.path.startsWith('/api/')) c.header('Cache-Control', 'no-store');
  // Baseline security headers on every worker response (the SPA shell adds CSP via public/_headers).
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('X-Frame-Options', 'DENY');
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  c.header('Permissions-Policy', 'geolocation=(), microphone=(), camera=(), browsing-topics=()');
  c.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  c.header('Cross-Origin-Opener-Policy', 'same-origin');
});

/** RoomError thrown INSIDE the DO loses its prototype across JSRPC — map by message. */
const DO_ERROR_STATUS: Record<string, ContentfulStatusCode> = {
  question_not_found: 404,
  room_not_found: 404,
  forbidden: 403,
};

app.onError((e, c) => {
  if (e instanceof RoomError) return err(c, e.code, e.status as ContentfulStatusCode);
  const mapped = e instanceof Error ? DO_ERROR_STATUS[e.message] : undefined;
  if (mapped) return err(c, (e as Error).message, mapped);
  console.error('unhandled', e);
  return err(c, 'internal_error', 500);
});

// ── helpers ──────────────────────────────────────────────────────────────────

function err(
  c: Context<Ctx>,
  code: string,
  status: ContentfulStatusCode,
  details?: Record<string, unknown>,
) {
  // Tell throttled callers when to retry (pairs with the per-IP rate limiter, §17).
  if (status === 429) c.header('Retry-After', '60');
  return c.json({ error: code, code, details, requestId: c.req.header('X-Request-Id') }, status);
}

function roomStub(env: Env, roomId: string) {
  return env.ROOM.get(env.ROOM.idFromName(roomId));
}

/**
 * Per-IP rate limit (§17 abuse controls) via the CF rate-limit binding. Honest no-op
 * when the binding is absent (local/dev); fail-OPEN on limiter error so an infra blip
 * never blocks legitimate traffic. Returns true when the caller is OVER the limit.
 */
async function rateLimited(c: Context<Ctx>, limiter: RateLimiter | undefined): Promise<boolean> {
  if (!limiter) return false;
  const key = c.req.header('CF-Connecting-IP') ?? 'anon';
  try {
    const { success } = await limiter.limit({ key });
    return !success;
  } catch {
    return false;
  }
}

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx > -1) out[part.slice(0, idx).trim()] = part.slice(idx + 1).trim();
  }
  return out;
}

/** Resolve the anonymous browser principal; mint + set the HttpOnly cookie if absent (§4). */
async function getPrincipal(c: Context<Ctx>): Promise<{
  principal: string;
  setCookie?: string;
}> {
  const sid = parseCookies(c.req.header('Cookie'))[SID_COOKIE];
  if (sid) return { principal: await sha256(sid) };
  const fresh = newSecret();
  const secure = new URL(c.req.url).protocol === 'https:' ? ' Secure;' : '';
  // Host-only (no Domain), HttpOnly, SameSite=Lax, ~400 days (§4).
  const setCookie = `${SID_COOKIE}=${fresh}; HttpOnly; SameSite=Lax; Path=/;${secure} Max-Age=34560000`;
  return { principal: await sha256(fresh), setCookie };
}

/**
 * CSRF defense (§14): reject cross-site state changes on cookie-authed owner routes.
 * Browsers always send `Origin` on state-changing requests; a malicious site's forged
 * POST carries its own origin and is blocked. CLI agents send no `Origin` (allowed —
 * they authenticate with a Bearer token, not the browser cookie).
 */
function untrustedOrigin(c: Context<Ctx>): boolean {
  const origin = c.req.header('Origin');
  if (!origin) return false;
  try {
    const host = new URL(origin).host;
    const allowed = new Set([new URL(c.env.SERVICE_ORIGIN).host, new URL(c.req.url).host]);
    return !allowed.has(host);
  } catch {
    return true;
  }
}

/** Optional agent identity from `Authorization: Bearer <installId>.<token>` (§12). */
async function resolveInstall(c: Context<Ctx>, env: Env, roomId: string): Promise<string | null> {
  const auth = c.req.header('Authorization');
  if (!auth?.startsWith('Bearer ')) return null;
  const [installId, token] = auth.slice(7).split('.');
  if (!installId || !token) return null;
  const ok = await roomStub(env, roomId).verifyInstall(installId, token);
  return ok ? installId : null;
}

/** Resolve a path param that may be a canonical room id OR a human slug (§12). */
async function roomRow(env: Env, param: string) {
  const sql = param.startsWith('rm_')
    ? 'SELECT * FROM rooms WHERE room_id = ?'
    : 'SELECT r.* FROM rooms r JOIN slugs s ON s.room_id = r.room_id WHERE s.slug = ?';
  return env.DB.prepare(sql).bind(param).first<{
    room_id: string;
    current_slug: string;
    owner_principal: string;
    visibility: string;
  }>();
}

// ── health ─────────────────────────────────────────────────────────────────
app.get('/api/health', (c) =>
  c.json({
    status: 'ok',
    service: c.env.SERVICE_ORIGIN,
    version: ADAPTER_VERSION,
    api: API_VERSION,
  }),
);

// ── create or claim a room (idempotent, atomic slug claim §4, §11) ───────────
app.post(`/api/${API_VERSION}/rooms`, async (c) => {
  if (await rateLimited(c, c.env.CREATE_LIMIT)) return err(c, 'rate_limited', 429);
  const { principal, setCookie } = await getPrincipal(c);
  const parsed = CreateRoomRequest.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return err(c, 'invalid_request', 400, { issues: parsed.error.issues });

  const generated = !parsed.data.slug;
  let slug = parsed.data.slug ? normalizeSlug(parsed.data.slug) : generateSlug();
  if (!isValidSlug(slug)) return err(c, 'invalid_slug', 400, { slug });

  for (let attempt = 0; attempt < 6; attempt += 1) {
    const roomId = newRoomId();
    const ts = now();
    try {
      // Atomic claim: slugs.slug is the PRIMARY KEY — uniqueness enforced by storage.
      await c.env.DB.prepare(
        'INSERT INTO slugs (slug, room_id, status, created_at) VALUES (?, ?, ?, ?)',
      )
        .bind(slug, roomId, 'active', ts)
        .run();
    } catch {
      // Collision. Generated slug → reroll. User-chosen → open the existing room (never transfer §4).
      if (generated) {
        slug = generateSlug(attempt >= 2 ? 3 : 2);
        continue;
      }
      const existingSlug = await c.env.DB.prepare('SELECT room_id FROM slugs WHERE slug = ?')
        .bind(slug)
        .first<{ room_id: string }>();
      if (!existingSlug) return err(c, 'slug_conflict', 409, { slug });
      const existing = await roomRow(c.env, existingSlug.room_id);
      if (!existing) return err(c, 'slug_conflict', 409, { slug });
      const room = await roomStub(c.env, existing.room_id).getState();
      if (!room) return err(c, 'room_not_found', 404);
      if (setCookie) c.header('Set-Cookie', setCookie);
      return c.json(
        {
          room,
          url: `${c.env.SERVICE_ORIGIN}/${room.slug}`,
          owned: existing.owner_principal === principal,
        },
        200,
      );
    }

    // Slug claimed — create the room record + initialize its DO (§11).
    try {
      await c.env.DB.prepare(
        'INSERT INTO rooms (room_id, current_slug, owner_principal, visibility, creation_state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
        .bind(roomId, slug, principal, 'public', 'active', ts, ts)
        .run();
      const room = await roomStub(c.env, roomId).init(roomId, slug, principal);
      if (setCookie) c.header('Set-Cookie', setCookie);
      return c.json({ room, url: `${c.env.SERVICE_ORIGIN}/${room.slug}`, owned: true }, 201);
    } catch (e) {
      // Compensate the orphaned slug claim so the name is reusable (§11 between-steps recovery).
      await c.env.DB.prepare('DELETE FROM slugs WHERE slug = ? AND room_id = ?')
        .bind(slug, roomId)
        .run();
      throw e;
    }
  }
  return err(c, 'could_not_allocate_slug', 503);
});

// ── room snapshot (authorized) ───────────────────────────────────────────────
app.get(`/api/${API_VERSION}/rooms/:id`, async (c) => {
  const id = c.req.param('id');
  const { principal, setCookie } = await getPrincipal(c);
  const row = await roomRow(c.env, id);
  if (!row) return err(c, 'room_not_found', 404);
  const role: Role = row.owner_principal === principal ? 'owner' : 'guest';
  if (setCookie) c.header('Set-Cookie', setCookie);
  // Private rooms return only a minimal access-state to the unauthorized (§12, §14).
  if (row.visibility === 'private' && role !== 'owner') {
    return c.json(
      {
        room: { id: row.room_id, slug: row.current_slug, visibility: 'private' },
        access: 'denied',
      },
      200,
    );
  }
  return c.json(await roomStub(c.env, row.room_id).snapshot(role));
});

// ── delta feed (cursor) ──────────────────────────────────────────────────────
app.get(`/api/${API_VERSION}/rooms/:id/changes`, async (c) => {
  const row = await roomRow(c.env, c.req.param('id'));
  if (!row) return err(c, 'room_not_found', 404);
  return c.json(await roomStub(c.env, row.room_id).changes(c.req.query('cursor') ?? '0'));
});

// ── personal dashboard: the viewer's own rooms + each room's AI read (§28-ext) ─
// Private to this browser's anonymous principal — never a global/public directory (§28).
app.get(`/api/${API_VERSION}/me/rooms`, async (c) => {
  const { principal, setCookie } = await getPrincipal(c);
  if (setCookie) c.header('Set-Cookie', setCookie);
  const rows = await c.env.DB.prepare(
    'SELECT room_id FROM rooms WHERE owner_principal = ? ORDER BY updated_at DESC LIMIT 100',
  )
    .bind(principal)
    .all<{ room_id: string }>();
  const out: MeRoom[] = [];
  for (const r of rows.results ?? []) {
    const s = await roomStub(c.env, r.room_id).dashboardSummary();
    if (!s) continue;
    out.push({
      room: s.room,
      url: `${c.env.SERVICE_ORIGIN}/${s.room.slug}`,
      questionCount: s.questionCount,
      openCount: s.openCount,
      answeredCount: s.answeredCount,
      repos: s.repos,
      understanding: s.understanding,
      lastActivityAt: s.lastActivityAt,
    });
  }
  return c.json({ rooms: out });
});

// ── resolve a git repo ("/{owner}/{repo}") to its canonical room (§28-ext) ────
app.get(`/api/${API_VERSION}/repos/:owner/:repo`, async (c) => {
  const repoSlug = `${c.req.param('owner')}/${c.req.param('repo')}`.toLowerCase();
  const map = await c.env.DB.prepare('SELECT room_id FROM repo_rooms WHERE repo_slug = ?')
    .bind(repoSlug)
    .first<{ room_id: string }>();
  if (!map) return err(c, 'repo_not_found', 404, { repo: repoSlug });
  const row = await roomRow(c.env, map.room_id);
  if (!row) return err(c, 'room_not_found', 404);
  return c.json({
    roomId: row.room_id,
    slug: row.current_slug,
    repo: repoSlug,
    url: `${c.env.SERVICE_ORIGIN}/${row.current_slug}`,
  });
});

// ── agent enrollment (rate-limited anonymous; no admin power §12) ─────────────
app.post(`/api/${API_VERSION}/rooms/:id/agents`, async (c) => {
  if (await rateLimited(c, c.env.WRITE_LIMIT)) return err(c, 'rate_limited', 429);
  const id = c.req.param('id');
  const row = await roomRow(c.env, id);
  if (!row) return err(c, 'room_not_found', 404);
  const parsed = EnrollAgentRequest.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return err(c, 'invalid_request', 400, { issues: parsed.error.issues });
  const result = await roomStub(c.env, row.room_id).enrollAgent(parsed.data);
  // Register the project's /{owner}/{repo} URL — first-wins; never steals another room's repo (§28-ext).
  if (parsed.data.repo) {
    await c.env.DB.prepare(
      'INSERT OR IGNORE INTO repo_rooms (repo_slug, room_id, created_at) VALUES (?, ?, ?)',
    )
      .bind(parsed.data.repo, row.room_id, now())
      .run();
  }
  return c.json(result, 201);
});

// ── publish deduplicated questions ───────────────────────────────────────────
app.post(`/api/${API_VERSION}/rooms/:id/questions:batch`, async (c) => {
  if (await rateLimited(c, c.env.WRITE_LIMIT)) return err(c, 'rate_limited', 429);
  const id = c.req.param('id');
  const row = await roomRow(c.env, id);
  if (!row) return err(c, 'room_not_found', 404);
  const parsed = PostQuestionsRequest.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return err(c, 'invalid_request', 400, { issues: parsed.error.issues });
  const installId = await resolveInstall(c, c.env, row.room_id);
  return c.json(
    await roomStub(c.env, row.room_id).postQuestions(parsed.data.questions, installId ?? undefined),
    201,
  );
});

// ── append an answer revision (public, no account §7) ────────────────────────
app.post(`/api/${API_VERSION}/rooms/:id/questions/:qid/answers`, async (c) => {
  if (await rateLimited(c, c.env.WRITE_LIMIT)) return err(c, 'rate_limited', 429);
  const id = c.req.param('id');
  const qid = c.req.param('qid');
  const row = await roomRow(c.env, id);
  if (!row) return err(c, 'room_not_found', 404);
  const { principal, setCookie } = await getPrincipal(c);
  const parsed = PostAnswerRequest.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return err(c, 'invalid_request', 400, { issues: parsed.error.issues });
  const authorClass = row.owner_principal === principal ? 'owner' : 'guest';
  if (setCookie) c.header('Set-Cookie', setCookie);
  const answer = await roomStub(c.env, id).postAnswer(qid, parsed.data, authorClass, authorClass);
  return c.json({ answer }, 201);
});

// ── record an installation's own retrieval/application evidence (§10, §12) ────
app.post(`/api/${API_VERSION}/rooms/:id/receipts`, async (c) => {
  const id = c.req.param('id');
  if (!(await roomRow(c.env, id))) return err(c, 'room_not_found', 404);
  const installId = await resolveInstall(c, c.env, id);
  if (!installId) return err(c, 'agent_auth_required', 401);
  const parsed = PostReceiptRequest.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return err(c, 'invalid_request', 400, { issues: parsed.error.issues });
  return c.json({ receipt: await roomStub(c.env, id).recordReceipt(installId, parsed.data) }, 201);
});

// ── owner settings: rename (slug changes, room id immutable §4) ──────────────
app.patch(`/api/${API_VERSION}/rooms/:id/settings`, async (c) => {
  if (untrustedOrigin(c)) return err(c, 'bad_origin', 403);
  const id = c.req.param('id');
  const { principal } = await getPrincipal(c);
  const row = await roomRow(c.env, id);
  if (!row) return err(c, 'room_not_found', 404);
  if (row.owner_principal !== principal) return err(c, 'forbidden', 403);
  const parsed = UpdateSettingsRequest.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return err(c, 'invalid_request', 400, { issues: parsed.error.issues });
  if (!parsed.data.slug) return c.json(await stateJson(c.env, id));

  const slug = normalizeSlug(parsed.data.slug);
  if (!isValidSlug(slug)) return err(c, 'invalid_slug', 400, { slug });
  const ts = now();
  try {
    await c.env.DB.prepare(
      'INSERT INTO slugs (slug, room_id, status, created_at) VALUES (?, ?, ?, ?)',
    )
      .bind(slug, id, 'active', ts)
      .run();
  } catch {
    return err(c, 'slug_taken', 409, { slug });
  }
  // Old slug becomes an alias (redirect) honoring current privacy (§4).
  await c.env.DB.prepare('UPDATE slugs SET status = ? WHERE slug = ?')
    .bind('alias', row.current_slug)
    .run();
  await c.env.DB.prepare('UPDATE rooms SET current_slug = ?, updated_at = ? WHERE room_id = ?')
    .bind(slug, ts, id)
    .run();
  const room = await roomStub(c.env, id).rename(slug, principal);
  return c.json({ room });
});

// ── checkout (Stripe) — honest status when not yet configured (§15) ──────────
app.post(`/api/${API_VERSION}/rooms/:id/checkout`, async (c) => {
  if (untrustedOrigin(c)) return err(c, 'bad_origin', 403);
  const row = await roomRow(c.env, c.req.param('id'));
  if (!row) return err(c, 'room_not_found', 404);
  const { principal } = await getPrincipal(c);
  if (row.owner_principal !== principal) return err(c, 'forbidden', 403);
  if (!c.env.STRIPE_SECRET_KEY || !c.env.STRIPE_PRICE_ID) {
    return err(c, 'billing_not_configured', 501, {
      note: 'Private pages require STRIPE_SECRET_KEY + STRIPE_PRICE_ID + shared-auth binding (Increment 3). Adapter + contract tests ship; live checkout is not yet verified.',
    });
  }
  return err(c, 'not_implemented', 501);
});

// ── AI enrichment: manual re-scan trigger (authorized owner §6) ──────────────
app.post(`/api/${API_VERSION}/rooms/:id/enrich`, async (c) => {
  if (untrustedOrigin(c)) return err(c, 'bad_origin', 403);
  const id = c.req.param('id');
  const { principal } = await getPrincipal(c);
  const row = await roomRow(c.env, id);
  if (!row) return err(c, 'room_not_found', 404);
  if (row.owner_principal !== principal) return err(c, 'forbidden', 403);
  // Honest-off: the feature flag lives on the Worker, not in the DO's request path.
  if (c.env.ENRICHMENT_ENABLED === '0') return c.json({ ran: false, reason: 'disabled' });
  return c.json(await roomStub(c.env, row.room_id).enrich());
});

// ── live transport: forward WS upgrade to the room DO (§13) ──────────────────
app.get(`/api/${API_VERSION}/rooms/:id/events`, async (c) => {
  if (untrustedOrigin(c)) return err(c, 'bad_origin', 403);
  const id = c.req.param('id');
  if (c.req.header('Upgrade') !== 'websocket') return err(c, 'expected_websocket', 426);
  const row = await roomRow(c.env, id);
  if (!row) return err(c, 'room_not_found', 404);
  const { principal } = await getPrincipal(c);
  const role: Role = row.owner_principal === principal ? 'owner' : 'guest';
  if (row.visibility === 'private' && role === 'guest') return err(c, 'forbidden', 403);
  const url = new URL(c.req.url);
  url.searchParams.set('role', role);
  url.searchParams.set('handle', role === 'owner' ? 'owner' : 'guest');
  return roomStub(c.env, row.room_id).fetch(new Request(url.toString(), c.req.raw));
});

// ── versioned integration manifest (§8, §12) ─────────────────────────────────
app.get('/integrations/manifest.json', (c) => {
  const manifest: IntegrationManifest = {
    schema: PROTOCOL_VERSION,
    adapterVersion: ADAPTER_VERSION,
    serviceOrigin: c.env.SERVICE_ORIGIN,
    hosts: [
      {
        agent: 'Claude Code',
        skillPath: '.claude/skills/ask-project/SKILL.md',
        automation:
          'Project settings hooks (SessionStart, UserPromptSubmit, throttled PostToolUse, Stop).',
        verified: true,
      },
      {
        agent: 'Codex',
        skillPath: '.agents/skills/ask-project/SKILL.md',
        automation:
          'Project .codex hooks where the installed version supports them; else explicit checkpoints.',
        verified: false,
      },
      {
        agent: 'Cursor',
        skillPath: '.agents/skills/ask-project/SKILL.md',
        automation: 'Project .cursor/hooks.json where supported; IDE vs cloud differ.',
        verified: false,
      },
      {
        agent: 'Gemini CLI',
        skillPath: '.agents/skills/ask-project/SKILL.md',
        automation: 'Documented session/tool hook events of the installed release.',
        verified: false,
      },
      {
        agent: 'OpenCode',
        skillPath: '.agents/skills/ask-project/SKILL.md',
        automation: 'Skill + host integration when verified; else explicit checkpoint calls.',
        verified: false,
      },
      {
        agent: 'Other (HTTP)',
        skillPath: 'referenced project instruction file',
        automation: 'HTTP helper + startup/task-boundary instructions.',
        verified: true,
      },
    ],
    files: [],
    generatedAt: now(),
  };
  return c.json(manifest);
});

// ── MCP (§16) — Streamable HTTP interface lands in Increment 4 ───────────────
app.all('/mcp', (c) =>
  err(c, 'mcp_not_yet_available', 501, {
    note: 'Native MCP (createMcpHandler, shared domain fns) is Increment 4. Use the documented HTTP API meanwhile.',
  }),
);

// ── stripe webhook boundary (§15) — verified + idempotent in Increment 3 ─────
app.post('/api/billing/stripe/webhook', (c) =>
  err(c, 'billing_not_configured', 501, {
    note: 'Webhook verification + idempotent inbox ship in Increment 3.',
  }),
);

app.notFound((c) => {
  if (c.req.path.startsWith('/api/') || c.req.path.startsWith('/integrations/')) {
    return err(c, 'not_found', 404);
  }
  // Non-API unmatched paths are served the SPA shell by the assets layer.
  return c.env.ASSETS.fetch(c.req.raw);
});

async function stateJson(env: Env, id: string): Promise<{ room: Room | null }> {
  return { room: await roomStub(env, id).getState() };
}

export default app;
export { RoomDurableObject };
