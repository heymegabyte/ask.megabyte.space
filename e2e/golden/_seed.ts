/**
 * Golden-path seed helpers — create a room + enroll an agent + publish questions
 * through the REAL API (Playwright `request`), mirroring scripts/verify-prod.mjs.
 *
 * The UI tests then navigate to `/<slug>` and drive the seeded questions with
 * real clicks. Seeding via the API (not the UI) is correct: questions arrive
 * from coding agents, never from the human in the room.
 */
import type { APIRequestContext, Page } from '@playwright/test';

export const API = 'v1';

export interface SeededRoom {
  id: string;
  slug: string;
  bearer: string;
}

/** POST /rooms → a fresh room; returns id + slug (owner cookie lives in the request jar). */
export async function apiCreateRoom(request: APIRequestContext, base: string): Promise<{ id: string; slug: string }> {
  const res = await request.post(`${base}/api/${API}/rooms`, { data: {} });
  const j = (await res.json()) as { room: { id: string; slug: string } };
  return { id: j.room.id, slug: j.room.slug };
}

/** POST /rooms/<id>/agents → enroll an agent, returning a `Bearer id.token`. */
export async function apiEnrollAgent(
  request: APIRequestContext,
  base: string,
  roomId: string,
  agent = 'Claude Code',
): Promise<string> {
  const res = await request.post(`${base}/api/${API}/rooms/${roomId}/agents`, {
    data: { agent, version: 'e2e', features: ['hooks'] },
  });
  const j = (await res.json()) as { install: { id: string }; token: string };
  return `Bearer ${j.install.id}.${j.token}`;
}

/** A single-choice question — the canonical "which database" decision. */
export function singleChoiceQuestion(dedupKey: string): Record<string, unknown> {
  return {
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
  };
}

/** POST a question batch as the agent. Returns the first created question id. */
export async function apiPublishQuestions(
  request: APIRequestContext,
  base: string,
  roomId: string,
  bearer: string,
  questions: Record<string, unknown>[],
): Promise<string> {
  const res = await request.post(`${base}/api/${API}/rooms/${roomId}/questions:batch`, {
    headers: { authorization: bearer },
    data: { questions },
  });
  const j = (await res.json()) as { questions: { id: string }[] };
  return j.questions?.[0]?.id ?? '';
}

/** Full seed: new room + enrolled agent + one single-choice question. */
export async function seedRoomWithQuestion(
  request: APIRequestContext,
  base: string,
  dedupKey = `e2e-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
): Promise<SeededRoom> {
  const room = await apiCreateRoom(request, base);
  const bearer = await apiEnrollAgent(request, base, room.id);
  await apiPublishQuestions(request, base, room.id, bearer, [singleChoiceQuestion(dedupKey)]);
  return { id: room.id, slug: room.slug, bearer };
}

/**
 * Seed a room using the PAGE's OWN browser context (`page.request` shares the
 * page's cookie jar), so the HttpOnly `ask_sid` owner cookie lands in the browser
 * — making the subsequently-navigated page the OWNER. Required for owner-gated UI
 * (rename via slug-input, make-private). Questions are still seeded via the API.
 */
export async function seedOwnedRoom(
  page: Page,
  base: string,
  dedupKey = `e2e-own-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
): Promise<SeededRoom> {
  const room = await apiCreateRoom(page.request, base);
  const bearer = await apiEnrollAgent(page.request, base, room.id);
  await apiPublishQuestions(page.request, base, room.id, bearer, [singleChoiceQuestion(dedupKey)]);
  return { id: room.id, slug: room.slug, bearer };
}
