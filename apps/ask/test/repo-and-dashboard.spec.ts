/**
 * Per-project (git repo) addressing + personal dashboard (§28-ext).
 *
 * Runs against the real Worker via `SELF` (cloudflare:test) with a real Miniflare
 * D1 (`repo_rooms` from migrations/0002) + Durable Object, exactly as prod routes.
 * Covers: enroll-with-repo registers the project's /{owner}/{repo} URL, questions
 * are stamped with the posting agent's repo, resolve is first-wins + case-folded,
 * and /me/rooms is private to the owning browser principal.
 */
import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import {
  API,
  ORIGIN,
  createRoom,
  getSnapshot,
  jsonHeaders,
  publishQuestion,
  singleChoiceQuestion,
} from './helpers';

/** Enroll an agent that reports a git repo; returns a `Bearer id.token`. */
async function enrollWithRepo(
  roomId: string,
  repo: string,
): Promise<{ status: number; bearer: string }> {
  const res = await SELF.fetch(`${ORIGIN}/api/${API}/rooms/${roomId}/agents`, {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({ agent: 'Claude Code', version: 'test', features: ['questions'], repo }),
  });
  const j = (await res.json()) as { install: { id: string }; token: string };
  return { status: res.status, bearer: `Bearer ${j.install.id}.${j.token}` };
}

describe('per-project git repo addressing (§28-ext)', () => {
  it('resolves /repos/:owner/:repo to the room once an agent enrolls with that repo', async () => {
    const before = await SELF.fetch(`${ORIGIN}/api/${API}/repos/acme/widget`);
    expect(before.status, 'unknown repo is 404, not 500').toBe(404);

    const room = await createRoom();
    const { status } = await enrollWithRepo(room.id, 'acme/widget');
    expect(status).toBe(201);

    const res = await SELF.fetch(`${ORIGIN}/api/${API}/repos/acme/widget`);
    expect(res.status).toBe(200);
    const j = (await res.json()) as { roomId: string; slug: string; repo: string; url: string };
    expect(j.roomId).toBe(room.id);
    expect(j.slug).toBe(room.slug);
    expect(j.repo).toBe('acme/widget');
    expect(j.url).toContain(`/${room.slug}`);
  });

  it('is case-insensitive on the path (the stored slug is lowercase)', async () => {
    const room = await createRoom();
    await enrollWithRepo(room.id, 'heymegabyte/projectsites.dev');
    const res = await SELF.fetch(`${ORIGIN}/api/${API}/repos/HeyMegabyte/ProjectSites.dev`);
    expect(res.status).toBe(200);
    const j = (await res.json()) as { roomId: string };
    expect(j.roomId).toBe(room.id);
  });

  it('stamps each published question with the posting agent repo', async () => {
    const room = await createRoom();
    const { bearer } = await enrollWithRepo(room.id, 'acme/stamped');
    const pub = await publishQuestion(room.id, bearer, singleChoiceQuestion('dk-repo-stamp'));
    expect(pub.created).toBe(1);

    const snap = await getSnapshot(room.id, room.ownerCookie);
    const questions = snap.body.questions as Array<{ repo?: string }>;
    expect(questions[0]?.repo).toBe('acme/stamped');
  });

  it('is first-wins — a second room cannot steal a repo already claimed', async () => {
    const roomA = await createRoom();
    await enrollWithRepo(roomA.id, 'dup/project');
    const roomB = await createRoom();
    await enrollWithRepo(roomB.id, 'dup/project');

    const res = await SELF.fetch(`${ORIGIN}/api/${API}/repos/dup/project`);
    const j = (await res.json()) as { roomId: string };
    expect(j.roomId, 'repo still points at the first room that claimed it').toBe(roomA.id);
  });
});

describe('personal dashboard /me/rooms (§28-ext)', () => {
  it('lists the viewer-owned room with live counts + repos', async () => {
    const room = await createRoom();
    const { bearer } = await enrollWithRepo(room.id, 'acme/dash');
    await publishQuestion(room.id, bearer, singleChoiceQuestion('dk-dash-1'));

    const res = await SELF.fetch(`${ORIGIN}/api/${API}/me/rooms`, {
      headers: { cookie: room.ownerCookie },
    });
    expect(res.status).toBe(200);
    const j = (await res.json()) as {
      rooms: Array<{
        room: { id: string; slug: string };
        questionCount: number;
        openCount: number;
        repos: string[];
        url: string;
      }>;
    };
    const mine = j.rooms.find((r) => r.room.id === room.id);
    expect(mine, 'owner sees their own room').toBeTruthy();
    expect(mine!.questionCount).toBeGreaterThanOrEqual(1);
    expect(mine!.openCount).toBeGreaterThanOrEqual(1);
    expect(mine!.repos).toContain('acme/dash');
    expect(mine!.url).toContain(`/${room.slug}`);
  });

  it('is private to the browser principal — a different session does not see it', async () => {
    const room = await createRoom();
    // A fresh, cookieless request mints a NEW anonymous principal that owns nothing.
    const res = await SELF.fetch(`${ORIGIN}/api/${API}/me/rooms`);
    expect(res.status).toBe(200);
    const j = (await res.json()) as { rooms: Array<{ room: { id: string } }> };
    expect(
      j.rooms.find((r) => r.room.id === room.id),
      'stranger cannot see the room',
    ).toBeFalsy();
  });
});
