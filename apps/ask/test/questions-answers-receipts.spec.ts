/**
 * Worker + Room DO — the public Q&A → receipt loop:
 *  - agent enroll → scoped bearer
 *  - question dedupKey upsert (created once, deduped on repeat)
 *  - public answer append WITHOUT login → status 'answer_saved'
 *  - receipt requires agent Bearer (401 without / 201 with)
 *  - after a receipt, the answer status advances → 'applied_to_project'
 *
 * Mirrors scripts/verify-prod.mjs steps 5–13 against the in-pool `SELF` Fetcher.
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

describe('agent enrollment', () => {
  it('enrolls an agent and returns an install id + scoped token', async () => {
    const room = await createRoom();
    const { installId, bearer } = await enrollAgent(room.id);
    expect(installId).toMatch(/^ai_[0-9a-z]+$/);
    expect(bearer.startsWith(`Bearer ${installId}.`)).toBe(true);
  });
});

describe('question dedupKey upsert', () => {
  it('creates once, then dedupes an identical dedupKey (created=0, deduped=1)', async () => {
    const room = await createRoom();
    const { bearer } = await enrollAgent(room.id);
    const body = singleChoiceQuestion('dedup-db-choice');

    const first = await publishQuestion(room.id, bearer, body);
    expect([200, 201]).toContain(first.status);
    expect(first.created).toBe(1);
    expect(first.deduped).toBe(0);
    expect(first.qid).toMatch(/^q_[0-9a-z]+$/);

    const second = await publishQuestion(room.id, bearer, body);
    expect(second.created).toBe(0);
    expect(second.deduped).toBe(1);
    // Dedupe returns the SAME question id.
    expect(second.qid).toBe(first.qid);
  });
});

describe('public answer append (no account)', () => {
  it('appends an answer with no login and durably commits status answer_saved', async () => {
    const room = await createRoom();
    const { bearer } = await enrollAgent(room.id);
    const { qid } = await publishQuestion(room.id, bearer, singleChoiceQuestion('answer-db-choice'));

    // No cookie, no bearer — a public visitor answers.
    const res = await SELF.fetch(`${ORIGIN}/api/${API}/rooms/${room.id}/questions/${qid}/answers`, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ value: { kind: 'choice', selected: ['d1'] }, text: 'D1 for the MVP.' }),
    });
    expect([200, 201]).toContain(res.status);
    const j = (await res.json()) as { answer: { id: string; status: string } };
    expect(j.answer.id).toMatch(/^a_[0-9a-z]+$/);
    expect(j.answer.status).toBe('answer_saved');
  });

  // KNOWN PRODUCT BUG (documented, not patched — out of scope to fix product code):
  // answering a non-existent question returns 500 instead of 404.
  //
  // Root cause: worker/room.ts:202 `postAnswer` throws `new RoomError('question_not_found', 404)`
  // INSIDE the Room Durable Object. That error crosses the JSRPC boundary back to the Worker
  // and LOSES its prototype — so `app.onError`'s `e instanceof RoomError` check
  // (worker/index.ts:44) is false, and it falls through to the generic `internal_error` 500.
  // The receipts-401 gate works because it's checked in the Worker BEFORE the DO call;
  // this 404 is thrown inside the DO. scripts/verify-prod.mjs never exercises this path.
  //
  // `it.fails` = this test PASSES while the bug exists (asserting 404 currently fails) and
  // will START FAILING the moment the product is fixed to return 404 — a built-in tripwire.
  it.fails('answering a non-existent question SHOULD be 404 (currently 500 — see bug note above)', async () => {
    const room = await createRoom();
    const res = await SELF.fetch(`${ORIGIN}/api/${API}/rooms/${room.id}/questions/q_missing0000000000000000/answers`, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ value: { kind: 'skip' } }),
    });
    expect(res.status).toBe(404);
  });
});

describe('receipt auth + answer status advancement', () => {
  it('receipt WITHOUT a bearer → 401 (no forged receipts)', async () => {
    const room = await createRoom();
    const { bearer } = await enrollAgent(room.id);
    const { qid } = await publishQuestion(room.id, bearer, singleChoiceQuestion('rcpt-noauth'));
    const an = await SELF.fetch(`${ORIGIN}/api/${API}/rooms/${room.id}/questions/${qid}/answers`, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ value: { kind: 'choice', selected: ['d1'] } }),
    });
    const aid = ((await an.json()) as { answer: { id: string } }).answer.id;

    const res = await SELF.fetch(`${ORIGIN}/api/${API}/rooms/${room.id}/receipts`, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ questionId: qid, answerId: aid, state: 'applied', status: 'applied_to_project' }),
    });
    expect(res.status).toBe(401);
  });

  it('receipt WITH a bearer → 201, and advances the answer status to applied_to_project', async () => {
    const room = await createRoom();
    const { bearer } = await enrollAgent(room.id);
    const { qid } = await publishQuestion(room.id, bearer, singleChoiceQuestion('rcpt-applied'));
    const an = await SELF.fetch(`${ORIGIN}/api/${API}/rooms/${room.id}/questions/${qid}/answers`, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ value: { kind: 'choice', selected: ['d1'] }, text: 'D1 for the MVP.' }),
    });
    const aid = ((await an.json()) as { answer: { id: string; status: string } }).answer.id;

    const rc = await SELF.fetch(`${ORIGIN}/api/${API}/rooms/${room.id}/receipts`, {
      method: 'POST',
      headers: jsonHeaders({ authorization: bearer }),
      body: JSON.stringify({
        questionId: qid,
        answerId: aid,
        state: 'applied',
        status: 'applied_to_project',
        decisionSummary: 'Chose D1 for the MVP store.',
        affectedPaths: ['docs/ask/decisions.md'],
      }),
    });
    expect([200, 201]).toContain(rc.status);
    const rcj = (await rc.json()) as { receipt: { id: string } };
    expect(rcj.receipt.id).toMatch(/^rcpt_[0-9a-z]+$/);

    // Owner snapshot reflects the advanced status + the receipt.
    const snap = await getSnapshot(room.id, room.ownerCookie);
    const answers = snap.body.answers as { id: string; status: string }[];
    expect(answers.find((a) => a.id === aid)?.status).toBe('applied_to_project');
    expect((snap.body.receipts as unknown[]).length).toBeGreaterThanOrEqual(1);
  });
});
