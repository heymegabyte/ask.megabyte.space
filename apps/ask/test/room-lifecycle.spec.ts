/**
 * Worker + Room DO — room lifecycle: health, create (word-slug + owned +
 * Set-Cookie + immutable room id), and resolve-by-slug → guest.
 *
 * Runs against the real Worker via `SELF` (cloudflare:test) with a real
 * Miniflare D1 + Durable Object. Each test creates its own room → hermetic.
 */
import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { API, ORIGIN, createRoom, getSnapshot } from './helpers';

describe('health', () => {
  it('GET /api/health → 200 {status:ok, api:v1}', async () => {
    const res = await SELF.fetch(`${ORIGIN}/api/health`);
    expect(res.status).toBe(200);
    const j = (await res.json()) as { status: string; api: string; version: string };
    expect(j.status).toBe('ok');
    expect(j.api).toBe('v1');
    expect(typeof j.version).toBe('string');
  });
});

describe('create room', () => {
  it('creates an owned room with a word-based slug + Set-Cookie session', async () => {
    const room = await createRoom();
    expect([200, 201]).toContain(room.status);
    expect(room.id).toMatch(/^rm_[0-9a-z]+$/);
    expect(room.owned).toBe(true);
    // The slug must look intentional — word(s) joined by hyphens, never a UUID.
    expect(room.slug).toMatch(/^[a-z]+(?:-[a-z0-9]+)+$/);
    // HttpOnly session cookie (ownership capability) is set, value opaque.
    expect(room.ownerCookie).toMatch(/^ask_sid=/);
  });

  it('honors a requested valid slug', async () => {
    const want = `test-room-${Date.now().toString(36)}`;
    const res = await SELF.fetch(`${ORIGIN}/api/${API}/rooms`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slug: want }),
    });
    const j = (await res.json()) as { room: { slug: string; id: string }; owned: boolean };
    expect([200, 201]).toContain(res.status);
    expect(j.room.slug).toBe(want);
    expect(j.owned).toBe(true);
  });

  it('rejects an invalid (reserved) slug with 400', async () => {
    const res = await SELF.fetch(`${ORIGIN}/api/${API}/rooms`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slug: 'admin' }),
    });
    expect(res.status).toBe(400);
  });
});

describe('resolve by slug → guest', () => {
  it('a second browser (no owner cookie) resolves the slug to the same room as guest', async () => {
    const room = await createRoom();
    // No cookie forwarded → a fresh anonymous principal → guest role.
    const snap = await getSnapshot(room.slug);
    expect(snap.status).toBe(200);
    expect(snap.body.room).toMatchObject({ id: room.id });
    expect(snap.body.viewerRole).toBe('guest');
    // A fresh guest gets its own session cookie minted.
    expect(snap.setCookie).toMatch(/^ask_sid=/);
  });

  it('the owner cookie resolves the room as owner; room id is immutable across lookups', async () => {
    const room = await createRoom();
    const asOwner = await getSnapshot(room.id, room.ownerCookie);
    expect(asOwner.status).toBe(200);
    expect(asOwner.body.viewerRole).toBe('owner');
    expect((asOwner.body.room as { id: string }).id).toBe(room.id);
    // Resolving by slug returns the SAME immutable id.
    const bySlug = await getSnapshot(room.slug, room.ownerCookie);
    expect((bySlug.body.room as { id: string }).id).toBe(room.id);
  });

  it('API carries noindex + no-store headers', async () => {
    const room = await createRoom();
    const res = await SELF.fetch(`${ORIGIN}/api/${API}/rooms/${room.slug}`);
    expect((res.headers.get('x-robots-tag') ?? '').toLowerCase()).toContain('noindex');
    expect((res.headers.get('cache-control') ?? '')).toContain('no-store');
  });

  it('unknown room id → 404; unknown /api route → 404', async () => {
    const miss = await SELF.fetch(`${ORIGIN}/api/${API}/rooms/rm_doesnotexist000000000000`);
    expect(miss.status).toBe(404);
    const bogus = await SELF.fetch(`${ORIGIN}/api/${API}/nope`);
    expect(bogus.status).toBe(404);
  });
});
