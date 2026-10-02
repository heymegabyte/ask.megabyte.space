/**
 * contract.test.mjs — local contract test for the Ask agent helper.
 *
 * Two layers:
 *  1. Pure-unit: imports the exported helpers from bin/ask.mjs and asserts the
 *     mirror/decision/validation/route logic in-process (no network).
 *  2. End-to-end: spawns a recording mock Ask service (fixtures/mock-service.mjs)
 *     as its OWN process — the helper is driven with synchronous spawnSync, which
 *     would deadlock an in-process HTTP server on Node's single event loop — then
 *     drives the REAL `ask.mjs` subprocess through connect → sync → ask → receipt
 *     in a throwaway cwd. Asserts cursor + outbox behavior, dedup, request shapes,
 *     the `Bearer <installId>.<token>` auth header, AND that no transcript/prompt/
 *     env field is ever transmitted.
 *
 * Node built-in test runner only: `node --test`.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, spawn } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  cpSync,
  rmSync,
} from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(HERE, '..');
const HELPER = join(PKG_ROOT, 'bin', 'ask.mjs');
const MOCK = join(PKG_ROOT, 'fixtures', 'mock-service.mjs');

const ROOM_ID = 'rm_0123456789abcdefghij';

// Fields that MUST NEVER appear anywhere in an outbound request body.
const FORBIDDEN_FIELDS = [
  'transcript',
  'prompt',
  'prompts',
  'messages',
  'conversation',
  'env',
  'environment',
  'secret',
  'secrets',
  'diff',
  'patch',
  'apikey',
  'token', // outbound bodies never carry a token field (auth is a header)
];

// ─────────────────────────────────────────────────────────────────────────────
// Layer 1 — pure units
// ─────────────────────────────────────────────────────────────────────────────

const mod = await import(HELPER);

test('ROUTES match the frozen contract shapes', () => {
  assert.equal(mod.API_VERSION, 'v1');
  assert.equal(mod.ROUTES.agents(ROOM_ID), `/api/v1/rooms/${ROOM_ID}/agents`);
  assert.equal(mod.ROUTES.changes(ROOM_ID), `/api/v1/rooms/${ROOM_ID}/changes`);
  assert.equal(mod.ROUTES.questions(ROOM_ID), `/api/v1/rooms/${ROOM_ID}/questions:batch`);
  assert.equal(mod.ROUTES.receipts(ROOM_ID), `/api/v1/rooms/${ROOM_ID}/receipts`);
  assert.equal(
    mod.ROUTES.answers(ROOM_ID, 'q_1'),
    `/api/v1/rooms/${ROOM_ID}/questions/q_1/answers`,
  );
  assert.equal(mod.MIN_POLL_INTERVAL_MS, 15000);
});

test('parseRoomUrl resolves slug, id, and bare id forms', () => {
  assert.deepEqual(mod.parseRoomUrl('https://ask.megabyte.space/sunny-harbor'), {
    origin: 'https://ask.megabyte.space',
    roomId: undefined,
    slug: 'sunny-harbor',
  });
  const byId = mod.parseRoomUrl(`https://ask.megabyte.space/rooms/${ROOM_ID}`);
  assert.equal(byId.roomId, ROOM_ID);
  const bare = mod.parseRoomUrl(ROOM_ID);
  assert.equal(bare.roomId, ROOM_ID);
});

test('validateQuestions enforces contract limits', () => {
  assert.deepEqual(mod.validateQuestions([{ dedupKey: 'k', kind: 'single', title: 'ok' }]), []);
  assert.ok(mod.validateQuestions([]).length, 'empty array rejected');
  assert.ok(
    mod
      .validateQuestions([{ dedupKey: 'k', kind: 'not_a_kind', title: 'x' }])
      .some((e) => e.includes('kind')),
    'bad kind rejected',
  );
  assert.ok(
    mod
      .validateQuestions([{ dedupKey: 'k', kind: 'single', title: '' }])
      .some((e) => e.includes('title')),
    'empty title rejected',
  );
  const tooMany = Array.from({ length: 26 }, (_, i) => ({
    dedupKey: `k${i}`,
    kind: 'single',
    title: 't',
  }));
  assert.ok(
    mod.validateQuestions(tooMany).some((e) => e.includes('too many')),
    '>25 rejected',
  );
});

test('decisionFromAnswer derives a summary from text or choice', () => {
  const q = { id: 'q_1', title: 'Primary color?' };
  const d = mod.decisionFromAnswer({ id: 'a_1', questionId: 'q_1', text: 'Cyan' }, q);
  assert.match(d.summary, /Primary color\? → Cyan/);
  assert.deepEqual(d.sourceAnswerIds, ['a_1']);
  const choice = mod.decisionFromAnswer(
    { id: 'a_2', questionId: 'q_1', value: { kind: 'choice', selected: ['cyan', 'black'] } },
    q,
  );
  assert.match(choice.summary, /cyan, black/);
  assert.equal(
    mod.decisionFromAnswer({ id: 'a_3', questionId: 'q_1' }, q),
    undefined,
    'no body → no decision',
  );
});

test('parseArgs handles flags, values, and positionals', () => {
  const a = mod.parseArgs(['connectpos', '--state', 'applied', '--json', '--paths', 'a,b']);
  assert.deepEqual(a._, ['connectpos']);
  assert.equal(a.state, 'applied');
  assert.equal(a.json, true);
  assert.equal(a.paths, 'a,b');
});

test('latestAnswersByQuestion picks the highest-revision answer per question', () => {
  const latest = mod.latestAnswersByQuestion([
    { id: 'a_1', questionId: 'q_1', revision: 0, text: 'first' },
    { id: 'a_2', questionId: 'q_1', revision: 2, text: 'latest' },
    { id: 'a_3', questionId: 'q_1', revision: 1, text: 'middle' },
    { id: 'a_9', questionId: 'q_2', revision: 0, text: 'only' },
  ]);
  assert.equal(latest.get('q_1').id, 'a_2', 'highest revision wins for q_1');
  assert.equal(latest.get('q_1').text, 'latest');
  assert.equal(latest.get('q_2').id, 'a_9', 'single answer wins for q_2');
  assert.equal(latest.size, 2);
  // Malformed entries are ignored, not thrown on.
  assert.equal(mod.latestAnswersByQuestion([{ text: 'no ids' }, null]).size, 0);
});

// ─────────────────────────────────────────────────────────────────────────────
// Layer 2 — end-to-end against a recording mock service (separate process)
// ─────────────────────────────────────────────────────────────────────────────

/** Spawn the mock service in its own process; resolve once it prints its origin. */
function startMock(recordFile) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [MOCK, ROOM_ID, recordFile], {
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    let out = '';
    const onData = (c) => {
      out += c;
      const line = out.split('\n').find((l) => l.startsWith('http://'));
      if (line) {
        child.stdout.off('data', onData);
        resolvePromise({ origin: line.trim(), child });
      }
    };
    child.stdout.on('data', onData);
    child.on('error', reject);
    setTimeout(() => reject(new Error('mock did not start within 5s')), 5000);
  });
}

function setMode(recordFile, mode) {
  writeFileSync(`${recordFile}.mode`, mode);
}

/** Parse the recorded requests JSONL into objects. */
function readRequests(recordFile) {
  if (!existsSync(recordFile)) return [];
  return readFileSync(recordFile, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

function makeTempProject() {
  const dir = mkdtempSync(join(tmpdir(), 'ask-contract-'));
  mkdirSync(join(dir, 'bin'), { recursive: true });
  cpSync(HELPER, join(dir, 'bin', 'ask.mjs'));
  return dir;
}

/** Run the helper subprocess with a given cwd + origin. */
function ask(helper, cwd, origin, argv, input) {
  return spawnSync(process.execPath, [helper, ...argv], {
    cwd,
    input,
    encoding: 'utf8',
    env: {
      ...process.env,
      ASK_SERVICE_ORIGIN: origin,
      ASK_AGENT_NAME: 'Claude Code',
      NO_COLOR: '1',
    },
  });
}

test('e2e: connect → sync → ask → receipt drives cursors, outbox, and safe request bodies', async (t) => {
  const cwd = makeTempProject();
  const record = join(cwd, 'requests.jsonl');
  // Honest-empty snapshot so first-sync SEEDING folds nothing and the DELTA
  // drives the answered question (this test exercises the delta path; the
  // dedicated seeding test below covers pre-existing answers).
  setMode(record, 'empty-seed');
  const { origin, child } = await startMock(record);
  t.after(() => {
    child.kill('SIGTERM');
    rmSync(cwd, { recursive: true, force: true });
  });
  const lh = join(cwd, 'bin', 'ask.mjs');

  // connect
  let r = ask(lh, cwd, origin, ['connect', `${origin}/rooms/${ROOM_ID}`]);
  assert.equal(r.status, 0, `connect failed: ${r.stderr}`);
  assert.ok(existsSync(join(cwd, '.ask', 'project.json')), 'project.json written');
  assert.ok(existsSync(join(cwd, '.ask', 'local', 'credentials.json')), 'credentials written');
  assert.match(
    readFileSync(join(cwd, '.gitignore'), 'utf8'),
    /\.ask\/local\//,
    '.ask/local gitignored',
  );

  // sync (delta) → folds answered question, advances cursor, writes docs + outbox
  r = ask(lh, cwd, origin, ['sync', '--json']);
  assert.equal(r.status, 0, `sync failed: ${r.stderr}`);
  const syncOut = JSON.parse(r.stdout);
  assert.equal(syncOut.ok, true);
  assert.equal(syncOut.answered.length, 1, 'one answered question surfaced');
  assert.equal(syncOut.answered[0].dedupKey, 'brand-primary-color');
  assert.equal(syncOut.cursors.downloaded, 'seq:2', 'downloaded cursor advanced');
  assert.equal(syncOut.cursors.considered, 'seq:2', 'considered cursor advanced (answers read)');
  assert.equal(syncOut.cursors.applied, '', 'applied cursor NOT advanced (no receipt yet)');

  // docs written with the UNTRUSTED label + managed block
  const contextDoc = readFileSync(join(cwd, 'docs', 'ask', 'project-context.md'), 'utf8');
  assert.match(
    contextDoc,
    /UNTRUSTED external project input/,
    'context doc labels untrusted provenance',
  );
  assert.match(contextDoc, /BEGIN ASK/, 'managed block present');
  assert.match(
    readFileSync(join(cwd, 'docs', 'ask', 'decisions.md'), 'utf8'),
    /from Ask room/,
    'decision provenance labelled',
  );

  // outbox grew; no forbidden fields in any entry
  const outbox = readFileSync(join(cwd, '.ask', 'local', 'outbox.ndjson'), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));
  assert.ok(outbox.length >= 2, 'outbox has connect + delta entries');
  for (const entry of outbox) assertNoForbidden(entry);

  // second sync is safe (idempotent, cursor already at seq:2)
  r = ask(lh, cwd, origin, ['sync', '--json']);
  assert.equal(r.status, 0, 'second sync ok');

  // ask: publish; dedup against mirror before send
  const qInput = JSON.stringify({
    questions: [
      {
        dedupKey: 'auth-provider',
        kind: 'single',
        title: 'Which auth provider?',
        context: 'Needed before wiring login.',
        blocksWork: true,
      },
      { dedupKey: 'brand-primary-color', kind: 'single', title: 'dup — already in room' },
    ],
  });
  r = ask(lh, cwd, origin, ['ask', '--stdin', '--json'], qInput);
  assert.equal(r.status, 0, `ask failed: ${r.stderr}`);
  assert.equal(JSON.parse(r.stdout).created, 1, 'one fresh question published');

  // receipt: applied → advances applied cursor; relative paths only
  r = ask(lh, cwd, origin, [
    'receipt',
    '--question',
    'q_000000000000aaaa',
    '--answer',
    'a_000000000000bbbb',
    '--state',
    'applied',
    '--paths',
    'src/theme.css,/etc/passwd,../escape.txt',
    '--summary',
    'Applied cyan brand token',
    '--json',
  ]);
  assert.equal(r.status, 0, `receipt failed: ${r.stderr}`);

  // status reflects advanced applied cursor
  r = ask(lh, cwd, origin, ['status', '--json']);
  const status = JSON.parse(r.stdout);
  assert.equal(status.connected, true);
  assert.equal(status.cursors.applied, 'seq:2', 'applied cursor advanced after receipt');

  // ── assert recorded request shapes ───────────────────────────────────────
  const reqs = readRequests(record);

  const enroll = reqs.find((q) => q.url.endsWith('/agents') && q.method === 'POST');
  assert.ok(enroll, 'enroll request made');
  assert.equal(enroll.body.agent, 'Claude Code');
  assert.ok(Array.isArray(enroll.body.features), 'features sent');

  const changes = reqs.find((q) => q.url.includes('/changes'));
  assert.equal(
    changes.auth,
    'Bearer ai_a1b2c3d4e5f6g7h8.tok_fixture_scoped_anonymous_value_do_not_reuse',
    'auth header uses Bearer <installId>.<token>',
  );
  assert.match(changes.ua, /Chrome\/\d+/, 'realistic UA sent');

  const published = reqs.find((q) => q.url.includes('questions:batch'));
  assert.equal(published.body.questions.length, 1, 'duplicate filtered client-side before send');
  assert.equal(published.body.questions[0].dedupKey, 'auth-provider');
  assert.ok(published.body.idempotencyKey, 'idempotency key attached');

  const receiptReq = reqs.find((q) => q.url.endsWith('/receipts'));
  assert.deepEqual(
    receiptReq.body.affectedPaths,
    ['src/theme.css'],
    'absolute + escaping paths stripped',
  );
  assert.equal(receiptReq.body.status, 'applied_to_project');

  // GLOBAL invariant: across EVERY recorded request, no forbidden field transmitted
  for (const req of reqs) {
    if (req.body && typeof req.body === 'object') assertNoForbidden(req.body);
  }
});

test('e2e: snapshotRequired triggers a fresh snapshot refetch', async (t) => {
  const cwd = makeTempProject();
  const record = join(cwd, 'requests.jsonl');
  setMode(record, 'snapshot');
  const { origin, child } = await startMock(record);
  t.after(() => {
    child.kill('SIGTERM');
    rmSync(cwd, { recursive: true, force: true });
  });
  const lh = join(cwd, 'bin', 'ask.mjs');

  let r = ask(lh, cwd, origin, ['connect', `${origin}/rooms/${ROOM_ID}`]);
  assert.equal(r.status, 0, `connect failed: ${r.stderr}`);
  setMode(record, 'snapshot'); // mode file lives next to record; connect reset record but not mode

  r = ask(lh, cwd, origin, ['sync', '--json']);
  assert.equal(r.status, 0, `sync failed: ${r.stderr}`);
  assert.equal(JSON.parse(r.stdout).answered.length, 1, 'snapshot surfaced answered question');

  const reqs = readRequests(record);
  assert.ok(
    reqs.find((q) => q.url === `/api/v1/rooms/${ROOM_ID}` && q.method === 'GET'),
    'snapshot endpoint hit after snapshotRequired',
  );
});

test('e2e: auth failure exits non-zero (never silently retried)', async (t) => {
  const cwd = makeTempProject();
  const record = join(cwd, 'requests.jsonl');
  const { origin, child } = await startMock(record);
  t.after(() => {
    child.kill('SIGTERM');
    rmSync(cwd, { recursive: true, force: true });
  });
  const lh = join(cwd, 'bin', 'ask.mjs');

  // Hand-write project + BAD credentials so /changes returns 401.
  mkdirSync(join(cwd, '.ask', 'local'), { recursive: true });
  writeFileSync(
    join(cwd, '.ask', 'project.json'),
    JSON.stringify({
      schema: 1,
      serviceOrigin: origin,
      roomId: ROOM_ID,
      roomUrl: `${origin}/rooms/${ROOM_ID}`,
    }),
  );
  writeFileSync(
    join(cwd, '.ask', 'local', 'credentials.json'),
    JSON.stringify({ installId: 'ai_wrong00000000', token: 'badtoken' }),
  );

  const started = Date.now();
  const r = ask(lh, cwd, origin, ['sync']);
  const elapsed = Date.now() - started;
  assert.equal(r.status, 2, `auth failure must exit 2 (got ${r.status}): ${r.stderr}`);
  assert.ok(elapsed < 10000, `auth failure must be immediate, not retried (took ${elapsed}ms)`);

  // Exactly one /changes attempt — 401 is never retried.
  const changesAttempts = readRequests(record).filter((q) => q.url.includes('/changes'));
  assert.equal(changesAttempts.length, 1, 'auth failure made exactly one request (no retry storm)');
});

test('e2e: first sync SEEDS pre-existing answers from the snapshot + posts an applied receipt (§9/§22)', async (t) => {
  const cwd = makeTempProject();
  const record = join(cwd, 'requests.jsonl');
  // Delta is EMPTY; the answered question exists ONLY in the snapshot — the exact
  // bug the coordinator hit (sync printed "0 answered" + wrote no docs).
  setMode(record, 'seed-only');
  const { origin, child } = await startMock(record);
  t.after(() => {
    child.kill('SIGTERM');
    rmSync(cwd, { recursive: true, force: true });
  });
  const lh = join(cwd, 'bin', 'ask.mjs');

  let r = ask(lh, cwd, origin, ['connect', `${origin}/rooms/${ROOM_ID}`]);
  assert.equal(r.status, 0, `connect failed: ${r.stderr}`);
  setMode(record, 'seed-only'); // mock truncates the record on boot but not the mode file

  r = ask(lh, cwd, origin, ['sync', '--json']);
  assert.equal(r.status, 0, `sync failed: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.seeded, true, 'first sync reports it seeded from the snapshot');
  assert.equal(out.events, 0, 'delta carried zero events (answer predates enrollment)');
  assert.equal(
    out.answered.length,
    1,
    'the pre-existing answered question was surfaced by the seed',
  );
  assert.equal(out.answered[0].dedupKey, 'brand-primary-color');
  assert.equal(out.receiptsPosted, 1, 'one applied receipt posted for the folded decision');

  // decisions.md created with a managed block + the folded decision.
  const decisionsDoc = readFileSync(join(cwd, 'docs', 'ask', 'decisions.md'), 'utf8');
  assert.match(decisionsDoc, /BEGIN ASK/, 'decisions.md has the managed block');
  assert.match(decisionsDoc, /END ASK/, 'decisions.md managed block is closed');
  assert.match(decisionsDoc, /Primary color\? → Cyan/, 'the decision summary is present');
  assert.match(decisionsDoc, /from Ask room/, 'provenance labelled as untrusted room input');
  // context doc also seeded.
  assert.match(
    readFileSync(join(cwd, 'docs', 'ask', 'project-context.md'), 'utf8'),
    /Primary color\?/,
    'project-context.md seeded too',
  );

  // The receipt request is shaped correctly: applied, points at decisions.md.
  const reqs = readRequests(record);
  const snapshotHit = reqs.find((q) => q.url === `/api/v1/rooms/${ROOM_ID}` && q.method === 'GET');
  assert.ok(snapshotHit, 'first sync fetched the room snapshot');
  const receipt = reqs.find((q) => q.url.endsWith('/receipts') && q.method === 'POST');
  assert.ok(receipt, 'an applied receipt was posted to the room');
  assert.equal(receipt.body.questionId, 'q_000000000000aaaa');
  assert.equal(
    receipt.body.answerId,
    'a_000000000000bbbb',
    'receipt cites the latest answer revision',
  );
  assert.equal(receipt.body.state, 'applied');
  assert.equal(receipt.body.status, 'applied_to_project');
  assert.deepEqual(
    receipt.body.affectedPaths,
    ['docs/ask/decisions.md'],
    'receipt points at decisions.md',
  );
  for (const req of reqs) if (req.body && typeof req.body === 'object') assertNoForbidden(req.body);

  // Idempotency: a SECOND sync must NOT re-seed, NOT post another receipt, and
  // NOT duplicate the decisions.md line.
  const receiptsBefore = reqs.filter((q) => q.url.endsWith('/receipts')).length;
  r = ask(lh, cwd, origin, ['sync', '--json']);
  assert.equal(r.status, 0, `second sync failed: ${r.stderr}`);
  const out2 = JSON.parse(r.stdout);
  assert.equal(out2.seeded, false, 'second sync does not re-seed');
  assert.equal(out2.receiptsPosted, 0, 'second sync posts no additional receipts');
  const receiptsAfter = readRequests(record).filter((q) => q.url.endsWith('/receipts')).length;
  assert.equal(receiptsAfter, receiptsBefore, 'no duplicate receipt posted on re-sync');
  const decisionsAfter = readFileSync(join(cwd, 'docs', 'ask', 'decisions.md'), 'utf8');
  const occurrences = decisionsAfter.split('Primary color? → Cyan').length - 1;
  assert.equal(occurrences, 1, 'the decision line appears exactly once (no duplicate on re-sync)');
});

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Deep-walk an object; fail if any forbidden key appears at any depth. */
function assertNoForbidden(obj, path = '') {
  if (obj === null || typeof obj !== 'object') return;
  for (const [k, v] of Object.entries(obj)) {
    const keyLower = k.toLowerCase();
    assert.ok(
      !FORBIDDEN_FIELDS.includes(keyLower),
      `forbidden field "${k}" present at ${path || '<root>'} — would leak private data`,
    );
    if (v && typeof v === 'object') assertNoForbidden(v, `${path}.${k}`);
  }
}
