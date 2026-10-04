/**
 * Question archival + appropriateness (§6).
 *
 * The AI enrichment pass auto-archives OPEN questions it judges inappropriate (wrong stack) or
 * stale; that path needs the Workers AI binding, so here we exercise the deterministic half: the
 * owner archive/restore state machine + its owner guard, against the real Worker via `SELF`.
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

/** POST the owner archive/restore endpoint; returns the status + updated question. */
async function archive(
  roomId: string,
  qid: string,
  archived: boolean,
  cookie?: string,
): Promise<{ status: number; question?: { state: string; archiveReason?: string } }> {
  const res = await SELF.fetch(`${ORIGIN}/api/${API}/rooms/${roomId}/questions/${qid}/archive`, {
    method: 'POST',
    headers: jsonHeaders(cookie ? { cookie } : {}),
    body: JSON.stringify({ archived }),
  });
  const body =
    res.status === 200
      ? ((await res.json()) as { question: { state: string; archiveReason?: string } })
      : undefined;
  return { status: res.status, question: body?.question };
}

describe('question archival (§6)', () => {
  it('owner archives an open question (with a reason) and it leaves the open set', async () => {
    const room = await createRoom();
    const { bearer } = await enrollAgent(room.id);
    const { qid } = await publishQuestion(room.id, bearer, singleChoiceQuestion('dk-archive-1'));

    const res = await archive(room.id, qid, true, room.ownerCookie);
    expect(res.status).toBe(200);
    expect(res.question?.state).toBe('archived');
    expect(res.question?.archiveReason, 'archive carries a reason').toBeTruthy();

    const snap = await getSnapshot(room.id, room.ownerCookie);
    const q = (snap.body.questions as Array<{ id: string; state: string }>).find(
      (x) => x.id === qid,
    );
    expect(q?.state).toBe('archived');
  });

  it('owner restores an archived question back to open (reason cleared)', async () => {
    const room = await createRoom();
    const { bearer } = await enrollAgent(room.id);
    const { qid } = await publishQuestion(room.id, bearer, singleChoiceQuestion('dk-archive-2'));
    await archive(room.id, qid, true, room.ownerCookie);

    const res = await archive(room.id, qid, false, room.ownerCookie);
    expect(res.status).toBe(200);
    expect(res.question?.state).toBe('open');
    expect(res.question?.archiveReason ?? '').toBe('');
  });

  it('a non-owner cannot archive (403)', async () => {
    const room = await createRoom();
    const { bearer } = await enrollAgent(room.id);
    const { qid } = await publishQuestion(room.id, bearer, singleChoiceQuestion('dk-archive-3'));
    // A fresh cookieless request is a different anonymous principal (a guest, not the owner).
    const res = await archive(room.id, qid, true);
    expect(res.status).toBe(403);
  });

  it('archiving a non-existent question is 404, not 500', async () => {
    const room = await createRoom();
    const res = await archive(room.id, 'q_missing0000000000000000', true, room.ownerCookie);
    expect(res.status).toBe(404);
  });
});
