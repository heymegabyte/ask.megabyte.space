/**
 * Worker + Room DO — ownership, rename aliasing, and the changes event chain:
 *  - rename is owner-only (403 for a guest, 200 for the owner)
 *  - a rename keeps the room id immutable + aliases the old slug (still resolves)
 *  - the changes feed returns the full monotonic event chain after a cursor
 *  - billing checkout is honestly unconfigured (501), never a fake success
 *
 * Mirrors scripts/verify-prod.mjs steps 14–18 against the in-pool `SELF` Fetcher.
 */
import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import {
  API,
  ORIGIN,
  createRoom,
  enrollAgent,
  getSnapshot,
  jsonHeaders,
  publishQuestion,
  singleChoiceQuestion,
} from './helpers';

async function rename(roomId: string, slug: string, cookie?: string): Promise<Response> {
  return SELF.fetch(`${ORIGIN}/api/${API}/rooms/${roomId}/settings`, {
    method: 'PATCH',
    headers: cookie ? jsonHeaders({ cookie }) : jsonHeaders(),
    body: JSON.stringify({ slug }),
  });
}

describe('rename owner-only', () => {
  it('a non-owner (no cookie) cannot rename → 403', async () => {
    const room = await createRoom();
    const res = await rename(room.id, `${room.slug}-x`);
    expect(res.status).toBe(403);
  });

  it('the owner renames → 200, room id immutable, old slug aliases to the same room', async () => {
    const room = await createRoom();
    const next = `${room.slug}-renamed`;
    const res = await rename(room.id, next, room.ownerCookie);
    expect(res.status).toBe(200);
    const j = (await res.json()) as { room: { slug: string; id: string } };
    expect(j.room.slug).toBe(next);
    expect(j.room.id).toBe(room.id); // immutable

    // New slug resolves to the room.
    const byNew = await getSnapshot(next, room.ownerCookie);
    expect((byNew.body.room as { id: string }).id).toBe(room.id);

    // Old slug still resolves (alias) to the SAME room.
    const byOld = await getSnapshot(room.slug);
    expect(byOld.status).toBe(200);
    expect((byOld.body.room as { id: string }).id).toBe(room.id);
  });

  it('renaming to an already-taken slug → 409', async () => {
    const a = await createRoom();
    const b = await createRoom();
    const res = await rename(b.id, a.slug, b.ownerCookie);
    expect(res.status).toBe(409);
  });
});

describe('changes event chain', () => {
  it('the changes feed returns the full event chain after cursor=0', async () => {
    const room = await createRoom();
    const { bearer } = await enrollAgent(room.id);
    const { qid } = await publishQuestion(
      room.id,
      bearer,
      singleChoiceQuestion('changes-db-choice'),
    );
    const an = await SELF.fetch(`${ORIGIN}/api/${API}/rooms/${room.id}/questions/${qid}/answers`, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ value: { kind: 'choice', selected: ['d1'] } }),
    });
    const aid = ((await an.json()) as { answer: { id: string } }).answer.id;
    await SELF.fetch(`${ORIGIN}/api/${API}/rooms/${room.id}/receipts`, {
      method: 'POST',
      headers: jsonHeaders({ authorization: bearer }),
      body: JSON.stringify({
        questionId: qid,
        answerId: aid,
        state: 'applied',
        status: 'applied_to_project',
      }),
    });

    const ch = await SELF.fetch(`${ORIGIN}/api/${API}/rooms/${room.id}/changes?cursor=0`);
    expect(ch.status).toBe(200);
    const chj = (await ch.json()) as { events: { type: string; seq: number }[]; cursor: string };
    const types = chj.events.map((e) => e.type);
    for (const t of ['room.created', 'question.created', 'answer.created', 'receipt.recorded']) {
      expect(types).toContain(t);
    }
    // Sequence is monotonic.
    const seqs = chj.events.map((e) => e.seq);
    expect([...seqs].sort((x, y) => x - y)).toEqual(seqs);
  });

  it('a cursor past the latest seq returns no new events', async () => {
    const room = await createRoom();
    const head = await SELF.fetch(`${ORIGIN}/api/${API}/rooms/${room.id}/changes?cursor=0`);
    const { cursor } = (await head.json()) as { cursor: string };
    const after = await SELF.fetch(
      `${ORIGIN}/api/${API}/rooms/${room.id}/changes?cursor=${cursor}`,
    );
    const afterJ = (await after.json()) as { events: unknown[] };
    expect(afterJ.events.length).toBe(0);
  });
});

describe('billing honesty', () => {
  it('checkout is honestly unconfigured → 501 (never a fake success)', async () => {
    const room = await createRoom();
    const res = await SELF.fetch(`${ORIGIN}/api/${API}/rooms/${room.id}/checkout`, {
      method: 'POST',
      headers: jsonHeaders({ cookie: room.ownerCookie }),
      body: '{}',
    });
    expect(res.status).toBe(501);
  });
});
