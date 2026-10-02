/**
 * Shared helpers for the Worker spec suite — mirror the sequences proven by
 * scripts/verify-prod.mjs (create → resolve → enroll → publish → answer →
 * receipt → changes) but against the in-pool `SELF` Fetcher.
 *
 * Every helper is hermetic-friendly: `createRoom()` makes a BRAND-NEW room each
 * call, so each test owns an isolated slug + room id + Durable Object.
 */
import { SELF } from 'cloudflare:test';
import { expect } from 'vitest';

export const API = 'v1';
export const ORIGIN = 'http://ask.test';

export const jsonHeaders = (extra?: Record<string, string>): Record<string, string> => ({
  'content-type': 'application/json',
  ...(extra ?? {}),
});

/** Extract the first Set-Cookie name=value pair (drops attributes) from a response. */
export function firstCookie(res: Response): string | null {
  const all = (res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
  const raw = all[0] ?? res.headers.get('set-cookie');
  return raw ? raw.split(';')[0]! : null;
}

export interface CreatedRoom {
  id: string;
  slug: string;
  ownerCookie: string;
  owned: boolean;
  status: number;
}

/** POST /rooms → a fresh owned room. Returns the room + the owner session cookie. */
export async function createRoom(body: Record<string, unknown> = {}): Promise<CreatedRoom> {
  const res = await SELF.fetch(`${ORIGIN}/api/${API}/rooms`, {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify(body),
  });
  const j = (await res.json()) as { room: { id: string; slug: string }; owned: boolean };
  const cookie = firstCookie(res);
  expect(cookie, 'owner Set-Cookie issued').toBeTruthy();
  return { id: j.room.id, slug: j.room.slug, ownerCookie: cookie!, owned: j.owned, status: res.status };
}

/** GET /rooms/<slugOrId> as a given cookie (none = a fresh guest principal). */
export async function getSnapshot(
  idOrSlug: string,
  cookie?: string,
): Promise<{ status: number; body: Record<string, unknown>; setCookie: string | null }> {
  const res = await SELF.fetch(`${ORIGIN}/api/${API}/rooms/${idOrSlug}`, {
    headers: cookie ? { cookie } : {},
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown>, setCookie: firstCookie(res) };
}

/** POST /rooms/<id>/agents → an enrolled installation + a `Bearer id.token` string. */
export async function enrollAgent(
  roomId: string,
  agent = 'Claude Code',
): Promise<{ installId: string; bearer: string }> {
  const res = await SELF.fetch(`${ORIGIN}/api/${API}/rooms/${roomId}/agents`, {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({ agent, version: 'test', features: ['hooks'] }),
  });
  const j = (await res.json()) as { install: { id: string }; token: string };
  return { installId: j.install.id, bearer: `Bearer ${j.install.id}.${j.token}` };
}

/** A single-choice question body matching the verify-prod shape, with a unique dedupKey. */
export function singleChoiceQuestion(dedupKey: string): Record<string, unknown> {
  return {
    questions: [
      {
        kind: 'single',
        dedupKey,
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
}

/** POST a question batch as the agent; returns the created-question response. */
export async function publishQuestion(
  roomId: string,
  bearer: string,
  body: Record<string, unknown>,
): Promise<{ status: number; created: number; deduped: number; qid: string }> {
  const res = await SELF.fetch(`${ORIGIN}/api/${API}/rooms/${roomId}/questions:batch`, {
    method: 'POST',
    headers: jsonHeaders({ authorization: bearer }),
    body: JSON.stringify(body),
  });
  const j = (await res.json()) as { created: number; deduped: number; questions: { id: string }[] };
  return { status: res.status, created: j.created, deduped: j.deduped, qid: j.questions?.[0]?.id ?? '' };
}
