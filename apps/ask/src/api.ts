/**
 * Ask — typed, same-origin API client.
 *
 * Single source of truth is @ask/contracts: we import the Zod schemas + ROUTES
 * and infer every type from them (never hand-maintain a type beside a schema).
 * EVERY request sends `credentials: 'include'` so the HttpOnly `ask_sid` cookie
 * (ownership + principal) travels on every call.
 */
import {
  type AnswerRevision,
  type AnswerValue,
  type ChangesResponse,
  ChangesResponse as ChangesResponseSchema,
  type CreateRoomResponse,
  CreateRoomResponse as CreateRoomResponseSchema,
  type IntegrationManifest,
  IntegrationManifest as IntegrationManifestSchema,
  type PostAnswerResponse,
  PostAnswerResponse as PostAnswerResponseSchema,
  type Room,
  type RoomSnapshot,
  RoomSnapshot as RoomSnapshotSchema,
  ROUTES,
} from '@ask/contracts';

/** A private room the viewer can't see returns a minimal access-state, not a snapshot. */
export interface RoomAccessDenied {
  room: { id: string; slug: string; visibility: 'private' };
  access: 'denied';
}

export type SnapshotResult =
  | { kind: 'snapshot'; snapshot: RoomSnapshot }
  | { kind: 'denied'; info: RoomAccessDenied }
  | { kind: 'free' }; // 404 — slug is unclaimed

/** Typed, structured API failure (mirrors the worker's RFC7807-ish error §12). */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: Record<string, unknown>;
  constructor(status: number, code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const JSON_HEADERS = { 'Content-Type': 'application/json' } as const;

async function readError(res: Response): Promise<ApiError> {
  let code = `http_${res.status}`;
  let details: Record<string, unknown> | undefined;
  try {
    const body = (await res.json()) as { code?: string; error?: string; details?: Record<string, unknown> };
    code = body.code ?? body.error ?? code;
    details = body.details;
  } catch {
    /* non-JSON body — keep the generic code */
  }
  return new ApiError(res.status, code, code, details);
}

async function request<T>(url: string, init: RequestInit, parse: (data: unknown) => T): Promise<T> {
  const res = await fetch(url, { credentials: 'include', ...init });
  if (!res.ok) throw await readError(res);
  return parse(await res.json());
}

/** POST /rooms — body `{}` creates a fresh room; `{slug}` claims/opens a specific one. */
export async function createRoom(slug?: string): Promise<CreateRoomResponse> {
  return request(
    ROUTES.createRoom,
    { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(slug ? { slug } : {}) },
    (d) => CreateRoomResponseSchema.parse(d),
  );
}

/**
 * GET /rooms/<slugOrId>. 200 → a full snapshot OR a `{access:'denied'}` stub for
 * a private room; 404 → the slug is free to claim.
 */
export async function getRoom(slugOrId: string): Promise<SnapshotResult> {
  const res = await fetch(ROUTES.room(slugOrId), { credentials: 'include' });
  if (res.status === 404) return { kind: 'free' };
  if (!res.ok) throw await readError(res);
  const data = (await res.json()) as unknown;
  if (data && typeof data === 'object' && (data as { access?: string }).access === 'denied') {
    return { kind: 'denied', info: data as RoomAccessDenied };
  }
  return { kind: 'snapshot', snapshot: RoomSnapshotSchema.parse(data) };
}

/** GET /rooms/<id>/changes?cursor= — delta feed after a snapshot cursor (§13). */
export async function getChanges(roomId: string, cursor: string): Promise<ChangesResponse> {
  const url = `${ROUTES.changes(roomId)}?cursor=${encodeURIComponent(cursor)}`;
  return request(url, { method: 'GET' }, (d) => ChangesResponseSchema.parse(d));
}

/**
 * POST an answer revision. Server durably commits, then returns the saved
 * revision — the UI flips a draft to "saved" only on THIS response.
 */
export async function postAnswer(
  roomId: string,
  questionId: string,
  body: { value?: AnswerValue; text?: string; supersedes?: string },
): Promise<PostAnswerResponse> {
  return request(
    ROUTES.answers(roomId, questionId),
    { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(body) },
    (d) => PostAnswerResponseSchema.parse(d),
  );
}

/** PATCH /rooms/<id>/settings — owner renames the slug. Returns the updated room. */
export async function updateSettings(roomId: string, slug: string): Promise<{ room: Room }> {
  return request(
    ROUTES.settings(roomId),
    { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify({ slug }) },
    (d) => d as { room: Room },
  );
}

/**
 * POST /rooms/<id>/checkout — owner upgrades to a private page. Billing is not
 * yet wired, so the honest path is a 501; the caller surfaces that as an
 * inline "coming soon" note rather than faking success.
 */
export async function startCheckout(roomId: string): Promise<{ url: string }> {
  return request(ROUTES.checkout(roomId), { method: 'POST', headers: JSON_HEADERS, body: '{}' }, (d) => d as { url: string });
}

/** GET the integration manifest (§8) — used to fill the setup prompt with the live manifest URL/version. */
export async function getManifest(): Promise<IntegrationManifest> {
  return request(ROUTES.manifest, { method: 'GET' }, (d) => IntegrationManifestSchema.parse(d));
}

/** WebSocket URL for a room's live event stream (same origin, ws/wss by protocol). */
export function roomEventsWsUrl(roomId: string): string {
  const origin = window.location.origin.replace(/^http/, 'ws');
  return `${origin}${ROUTES.events(roomId)}`;
}

export type { AnswerRevision, AnswerValue, Room, RoomSnapshot, IntegrationManifest };
