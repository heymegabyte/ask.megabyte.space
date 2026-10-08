/**
 * Builders for the prompts a developer pastes into their coding agent (§22).
 *
 * Three builders, one shared body:
 *  - `buildSetupPrompt(input)` — the in-room "connect this agent" prompt (names the
 *    live room URL, immutable room id, and manifest URL/version). Used by <Room/>.
 *  - `projectSetupPrompt(room)` — "Set up this project": drop the Ask files into the
 *    CURRENT repo so this one project uses Ask. Self-contained, nothing global changes.
 *  - `globalSetupPrompt(room)`  — "Add Ask to my skills & CLAUDE.md": edit ~/.claude so
 *    EVERY project auto-uses Ask. Makes it permanent across all projects.
 *
 * The two get-started prompts take just the room (they derive the room URL the same
 * way the room surface does) so the zero-state and the 404 screen can render copyable
 * cards without threading the manifest through.
 */
import type { MeRoom, ResolveRepoResponse, Room } from '@ask/contracts';

export interface SetupPromptInput {
  roomUrl: string;
  roomId: string;
  manifestUrl: string;
  manifestVersion: string;
}

/** The in-room agent prompt — names exactly where to post questions and read answers. */
export function buildSetupPrompt({
  roomUrl,
  roomId,
  manifestUrl,
  manifestVersion,
}: SetupPromptInput): string {
  return [
    `You now have an Ask room for this project. Use it to raise the decisions and`,
    `clarifications you would normally guess at — I'll answer them there, live.`,
    ``,
    `Room: ${roomUrl}`,
    `Room ID: ${roomId}`,
    `Integration manifest: ${manifestUrl} (schema v${manifestVersion})`,
    ``,
    `How to use it:`,
    `1. Read the manifest above to discover the HTTP endpoints and the project`,
    `   skill for your agent (Claude Code, Codex, Cursor, Gemini CLI, OpenCode, or`,
    `   the generic HTTP helper).`,
    `2. At the start of a task — and at every real decision point — post the`,
    `   questions you'd otherwise assume answers to: single/multiple choice, short`,
    `   or long text, a number, a range, or a link. For each, include why it`,
    `   matters now and what different answers would change. Keep working on`,
    `   anything that isn't blocked.`,
    `3. Poll the room (or subscribe) for my answers and apply them, recording a`,
    `   receipt when you download, apply, or verify each one.`,
    ``,
    `Don't block the whole task on a single question — mark what truly blocks work`,
    `and proceed on the rest.`,
  ].join('\n');
}

/** A room (or dashboard MeRoom / repo-resolve result) → its canonical room URL. */
type RoomLike = Room | MeRoom | ResolveRepoResponse | { slug: string };

function roomUrlFor(room: RoomLike): string {
  const origin =
    typeof window !== 'undefined' && window.location
      ? window.location.origin
      : 'https://questionl.ink';
  // MeRoom/ResolveRepoResponse carry a `url`; a bare Room carries just a `slug`.
  if ('url' in room && typeof room.url === 'string' && room.url) {
    return room.url.startsWith('http')
      ? room.url
      : `${origin}${room.url.startsWith('/') ? '' : '/'}${room.url}`;
  }
  const slug = 'slug' in room ? room.slug : 'room' in room ? room.room.slug : '';
  return `${origin}/${slug}`;
}

/**
 * "Set up this project" — the agent drops the Ask files into the CURRENT repo and
 * works on it. Self-contained: try it on one repo, nothing global changes.
 */
export function projectSetupPrompt(room: RoomLike): string {
  const roomUrl = roomUrlFor(room);
  return [
    `Set up Ask for THIS project (this repo only).`,
    ``,
    `Ask is a room where you post the decisions you'd otherwise guess at and I answer`,
    `them live: ${roomUrl}`,
    ``,
    `Do this now, scoped to the current repository:`,
    `1. Fetch the integration manifest at ${roomUrl.replace(/\/[^/]*$/, '')}/integrations/manifest.json`,
    `   and read the project-skill entry for your agent (Claude Code, Codex, Cursor,`,
    `   Gemini CLI, OpenCode, or the generic HTTP helper).`,
    `2. Add the Ask files into this repo (e.g. the project skill + a short note in the`,
    `   repo's agent instructions) so, from now on, WHILE WORKING IN THIS REPO you post`,
    `   real decision-point questions to the room above and apply my answers.`,
    `3. Commit those files to this repo. Change nothing outside it — no global config.`,
    ``,
    `From now on, in this project: at the start of a task and at every real fork in the`,
    `road, post the question instead of assuming — keep working on anything not blocked.`,
  ].join('\n');
}

/**
 * "Add Ask to my skills & CLAUDE.md" — the agent edits ~/.claude so EVERY project
 * auto-uses Ask. Makes it permanent across all projects.
 */
export function globalSetupPrompt(room: RoomLike): string {
  const roomUrl = roomUrlFor(room);
  return [
    `Add Ask to my global agent config so EVERY project uses it automatically.`,
    ``,
    `Ask is a room where you post the decisions you'd otherwise guess at and I answer`,
    `them live. This project's room: ${roomUrl}`,
    ``,
    `Do this now, editing my global config (make it permanent across all projects):`,
    `1. Fetch ${roomUrl.replace(/\/[^/]*$/, '')}/integrations/manifest.json and read the`,
    `   project-skill entry for your agent.`,
    `2. Install the Ask skill into my user skills directory (~/.claude/skills/ for Claude`,
    `   Code, or the equivalent for your agent) so it's available in every project.`,
    `3. Add a short standing instruction to my ~/.claude/CLAUDE.md: in every project, at`,
    `   the start of a task and at each real decision point, resolve/open that project's`,
    `   Ask room and post the questions you'd otherwise guess at, then apply my answers —`,
    `   never block the whole task on one question.`,
    ``,
    `After this, every repo I work in should auto-use Ask without me setting it up again.`,
  ].join('\n');
}
