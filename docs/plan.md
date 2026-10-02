# Ask — Implementation Plan

Ask is a free, open-source Cloudflare service where developers answer the questions their
coding agents publish. An agent posts a batch of decision questions to a room; a human opens
the room's URL and answers; the agent reads the answers and records what it applied.

- One deployable Cloudflare app: `apps/ask/` (React SPA + Worker, same origin).
- Zod single-source-of-truth in `packages/contracts`.
- Room state lives in one SQLite-backed Durable Object per room; D1 is a thin registry.
- MIT licensed. Self-hostable on any Cloudflare account.

See `architecture.md` for component shape, `protocol.md` for entities + routes + events,
`capability-matrix.md` for what is LIVE today vs PLANNED, and `decisions/` for the ADRs.

## Scope (the product)

- An agent creates a room (memorable slug, generated or claimed) and enrolls itself.
- The agent publishes deduplicated questions — choices, text, numbers, links, comparisons —
  each with context, consequence, and an optional labelled recommendation.
- A human opens the room and answers. No account needed to answer a public room.
- The agent reads answers via snapshot + delta feed and posts application receipts
  (downloaded → applied → verified) with relative paths and an optional commit ref.
- Rooms are public by default; a room can be made private for USD $10/month (Increment 3).
- Nothing is indexed: `noindex` header + `robots.txt` disallow + meta. No public directory.

## Non-goals (for now)

- No general chat, no threaded discussion — the unit is a question and its answer revisions.
- No file uploads, no media in Increment 1 (R2 reserved for later).
- No AI generation of questions or answers server-side (Workers AI reserved for later).
- No public discovery, no SEO surface, ever.

## Architecture in one paragraph

A single Worker (`apps/ask/worker`) serves the React SPA via Static Assets and owns the REST
API under `/api/v1/*`. Every room is one `RoomDurableObject` — authoritative for its Q&A,
answer-revision chain, receipts, enrolled agents, visibility epoch, the monotonic event log,
and hibernatable WebSocket connections. D1 (`ask-registry`) holds only the unique slug→room
mapping, the immutable room-id index, and the billing inbox — it never duplicates Q&A. The CF
Vite plugin unifies the SPA build and the Worker into one deployable, guaranteeing same-origin.

## Build order — five increments

The increments are strictly ordered. Each is independently deployable and leaves the service
honest: an unbuilt capability returns a `501` with a note naming its increment, never a stub
that pretends to work.

### Increment 1 — Core free loop (LIVE)

- Create/claim a room with an atomic unique-slug claim in D1; generate memorable slugs.
- Room Durable Object: questions (dedup by `dedupKey`), append-only answer revisions, receipts,
  agent enrollment + token verification, monotonic event log, room snapshot + cursor delta feed.
- Anonymous owner model: a host-only HttpOnly session cookie; the owner principal is the
  SHA-256 of that capability. Owner vs guest resolved per request.
- Agent enrollment returns a scoped bearer token (`installId.token`) that gates receipts and
  stamps authored questions — it never confers admin power.
- Live transport: WebSocket upgrade forwarded to the DO with hibernation; snapshot-or-replay
  reconnect via cursor.
- `noindex` everywhere; `GET /api/health`; versioned `/integrations/manifest.json`.

### Increment 2 — Agent integration kit (PLANNED)

- Flesh out `packages/agent-integration`: a typed HTTP helper (enroll, post questions, poll
  changes, post receipts) plus host adapters + project-skill files for Claude Code, Codex,
  Cursor, Gemini CLI, OpenCode, and a generic HTTP fallback.
- Populate the manifest `files[]` with SHA-256-pinned adapter artifacts.
- Contract tests against the live REST surface; checkpoint cadence respecting
  `minPollIntervalMs`.

### Increment 3 — Private rooms, shared auth, billing (PLANNED — ADAPTER + CONTRACT TESTS)

- Shared-auth adapter: standard redirect OAuth/OIDC + PKCE S256 against
  `https://projectsites.dev`; identity = issuer + subject; host-only Ask session cookie.
  Built behind contract tests; not yet live-verified. Do NOT depend on Better Auth
  (`better_auth` is dark-flagged, default off).
- Stripe billing: USD $10/month per private page; the room is the entitlement unit.
  Separate fields for requested visibility and paid entitlement. A lapse NEVER flips a room
  public: 7-day grace, then private read-only.
- Verified + idempotent Stripe webhook into the D1 billing inbox.

### Increment 4 — Native MCP (PLANNED)

- Streamable-HTTP MCP interface at `/mcp` sharing the same Room DO domain functions as REST,
  so MCP and REST resolve one authority.
- Tools mirror the REST verbs (enroll, publish questions, read snapshot/changes, post receipt).

### Increment 5 — Enrichment (PLANNED)

- R2 (image-comparison assets, exports), Queues + Workflows (async fan-out, digests),
  Workers AI (question clustering, answer summarization) — each behind a feature flag,
  each paired with evals where it generates content.

## Engineering discipline

- Zod validates every boundary; types are inferred, never hand-maintained beside a schema.
- `main`-only; deploy to prod per the verification loop; prod E2E before DONE.
- Every post-Increment-1 feature ships behind a flag (`enabled=0, rollout=0, stage=experimental`).
- Every added surface gets a Playwright spec against the prod URL at 6 breakpoints.
