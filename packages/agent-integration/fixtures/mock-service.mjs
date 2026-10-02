#!/usr/bin/env node
/**
 * mock-service.mjs — a standalone, recording mock of the Ask service for the
 * contract test. Runs as its OWN process (the test uses synchronous spawnSync
 * for the helper, which would deadlock an in-process server on Node's event
 * loop). Records every inbound request to a JSONL file so the test can assert
 * request shapes + the no-transcript invariant after the run.
 *
 * Usage:
 *   node mock-service.mjs <roomId> <recordFile> [--mode delta|snapshot]
 * Prints the chosen origin ("http://127.0.0.1:<port>") to stdout once listening.
 *
 * Control: write "snapshot" or "delta" (one word) to <recordFile>.mode to flip
 * the /changes behavior between runs without restarting.
 */

import { createServer } from 'node:http';
import { readFileSync, writeFileSync, existsSync, appendFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOM_ID = process.argv[2];
const RECORD = process.argv[3];
const MODE_FILE = `${RECORD}.mode`;

const ENROLL = JSON.parse(readFileSync(join(HERE, 'enroll.json'), 'utf8'));
const CHANGES = JSON.parse(readFileSync(join(HERE, 'changes.json'), 'utf8'));
const VALID_AUTH = `Bearer ${ENROLL.install.id}.${ENROLL.token}`;

function currentMode() {
  if (existsSync(MODE_FILE)) {
    try {
      return readFileSync(MODE_FILE, 'utf8').trim() || 'delta';
    } catch {
      return 'delta';
    }
  }
  return 'delta';
}

// Fresh record file for this run.
writeFileSync(RECORD, '');

const server = createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    let body;
    try {
      body = raw ? JSON.parse(raw) : undefined;
    } catch {
      body = raw;
    }
    appendFileSync(
      RECORD,
      JSON.stringify({
        method: req.method,
        url: req.url,
        auth: req.headers['authorization'] ?? null,
        ua: req.headers['user-agent'] ?? null,
        body,
      }) + '\n',
    );

    const send = (code, obj) => {
      res.writeHead(code, { 'content-type': 'application/json' });
      res.end(JSON.stringify(obj));
    };
    const url = req.url.split('?')[0];

    if (url === '/api/health') return send(200, { status: 'ok' });

    if (url === `/api/v1/rooms/${ROOM_ID}/agents` && req.method === 'POST') {
      return send(200, ENROLL);
    }

    if (url === `/api/v1/rooms/${ROOM_ID}/changes`) {
      if (req.headers['authorization'] !== VALID_AUTH) {
        return send(401, { error: 'unauthorized', code: 'auth_required' });
      }
      const mode = currentMode();
      if (mode === 'snapshot') {
        return send(200, { events: [], cursor: 'seq:0', snapshotRequired: true });
      }
      // `seed-only` → the delta is EMPTY; the pre-existing answered question is
      // reachable ONLY via the snapshot seed (the exact §9/§22 bug scenario).
      if (mode === 'seed-only') {
        return send(200, { events: [], cursor: 'seq:2', snapshotRequired: false });
      }
      return send(200, CHANGES);
    }

    if (url === `/api/v1/rooms/${ROOM_ID}`) {
      // `empty-seed` mode → honest-empty snapshot (no pre-existing answered
      // questions), so first-sync seeding folds nothing and the delta drives the
      // answered question. Any other mode → snapshot carries a pre-answered
      // question (exercises the §9/§22 seed-on-first-sync path).
      const emptySeed = currentMode() === 'empty-seed';
      return send(200, {
        room: { id: ROOM_ID, slug: 'sunny-harbor', revision: 2 },
        questions: emptySeed
          ? []
          : [
              {
                id: 'q_000000000000aaaa',
                dedupKey: 'brand-primary-color',
                title: 'Primary color?',
                state: 'answered',
                latestAnswerText: 'Cyan',
              },
            ],
        answers: emptySeed
          ? []
          : [
              {
                id: 'a_000000000000bbbb',
                questionId: 'q_000000000000aaaa',
                revision: 1,
                text: 'Cyan',
              },
            ],
        receipts: [],
        agents: [],
        participants: [],
        cursor: 'seq:2',
        viewerRole: 'owner',
      });
    }

    if (url === `/api/v1/rooms/${ROOM_ID}/questions:batch` && req.method === 'POST') {
      const qs = (body?.questions ?? []).map((q, i) => ({
        ...q,
        id: `q_published${i}0000000000`,
        revision: 1,
        state: 'open',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }));
      return send(200, { questions: qs, created: qs.length, deduped: 0 });
    }

    if (url === `/api/v1/rooms/${ROOM_ID}/receipts` && req.method === 'POST') {
      return send(200, {
        receipt: { id: 'rcpt_0000000000000001', ...body, createdAt: new Date().toISOString() },
      });
    }

    return send(404, { error: 'not found', code: 'not_found' });
  });
});

server.listen(0, '127.0.0.1', () => {
  const { port } = server.address();
  process.stdout.write(`http://127.0.0.1:${port}\n`);
});

// Graceful shutdown on signal.
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => server.close(() => process.exit(0)));
