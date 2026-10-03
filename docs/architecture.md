# Ask — Architecture

One deployable Cloudflare app. A React SPA and a Hono Worker share one origin; room state lives
in per-room Durable Objects; D1 is a thin registry. See `protocol.md` for the wire contract and
`decisions/` for the ADRs behind each choice.

## Component table

| Component      | Technology                                         | Responsibility                                                                                                                                                        |
| -------------- | -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SPA            | React 19 + Vite + Tailwind v4 + Cloudflare Kumo    | Room UI: ask/answer, live updates, owner settings. Built into Static Assets.                                                                                          |
| Worker         | Cloudflare Workers + Hono                          | Routing, request-id + `noindex` + `no-store` middleware, REST under `/api/v1`, WS upgrade forwarding, billing + MCP boundaries, SPA fallback.                         |
| Room authority | SQLite-backed Durable Object (`RoomDurableObject`) | One per room. Authoritative for Q&A, append-only answer revisions, receipts, enrolled agents, visibility epoch, the monotonic event log, and hibernatable WebSockets. |
| Registry       | D1 (`ask-registry`)                                | Unique slug→room mapping, immutable room-id index, billing inbox + per-room billing state. Never duplicates Q&A.                                                      |
| Contracts      | `packages/contracts` (Zod)                         | Single source of truth for entities, requests/responses, events, routes, limits. All sides infer types from it.                                                       |
| Agent kit      | `packages/agent-integration` (PLANNED)             | Typed HTTP helper + host adapters + project-skill files. Scaffold only today.                                                                                         |
| Static Assets  | CF Workers Static Assets                           | Serves the SPA; `single-page-application` fallback for unmatched non-API paths.                                                                                       |
| Reserved       | R2 · Queues · Workflows · Workers AI               | Not bound yet; Increment 5 enrichment.                                                                                                                                |

## Bindings (`apps/ask/wrangler.jsonc`)

- `ROOM` — Durable Object namespace → `RoomDurableObject` (SQLite migration `v1`).
- `DB` — D1 `ask-registry` (migrations in `apps/ask/migrations`).
- `ASSETS` — Static Assets fetcher.
- Vars: `SERVICE_ORIGIN`, `SHARED_AUTH_ISSUER` (`https://projectsites.dev`), `BILLING_GRACE_DAYS`.
- Secrets (optional; absent in dev): `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
  `STRIPE_PRICE_ID`. The core free workflow runs with none of them set.

## Data flow

### Create / open a room

1. `POST /api/v1/rooms`. Middleware mints a host-only `ask_sid` cookie if absent; principal =
   `SHA-256(cookie)`.
2. The Worker claims the slug by `INSERT` into D1 `slugs` (PRIMARY KEY = atomic uniqueness).
   Generated-slug collision → reroll; user-chosen collision → open the existing room (never
   transfer ownership).
3. On a fresh claim, insert the `rooms` row, then call the Room DO `init(roomId, slug, owner)`
   which creates its SQLite tables and appends `room.created`. If DO init fails, the orphaned
   slug claim is compensated (deleted) so the name stays reusable.
4. Response returns the canonical `Room` + adopt-URL so the first render needs no index read.

### Ask → answer → apply

1. Agent enrolls (`POST .../agents`) → `{installId, token}`.
2. Agent publishes a batch (`POST .../questions:batch`); the DO dedups by `dedupKey`, stores
   each question, appends `question.created`, and broadcasts.
3. A human opens the room; the SPA loads the snapshot (`GET .../:id`) and subscribes to the
   WebSocket (`GET .../events`) or the cursor feed (`GET .../changes`).
4. A human answers (`POST .../questions/:qid/answers`); the DO appends an `AnswerRevision`, marks
   the question `answered`, appends `answer.created`, broadcasts.
5. The agent reads the answer and posts a receipt (`POST .../receipts`, agent bearer required);
   the DO advances the answer status, stamps the agent `lastSeen`, appends `receipt.recorded`.

All business logic lives in the Room DO so REST, future MCP, and internal calls share one
authority — the Worker is routing + boundaries, never a second source of truth.

## Why a Durable Object per room

- **Single-writer serialization.** A room's Q&A, append-only answer chain, monotonic event
  `seq`, and revision high-water mark must advance without races. A DO gives one authoritative
  serialized owner per room — no distributed-lock dance, no last-write-wins corruption.
- **Colocated live transport.** The same object that owns the state holds the WebSocket
  connections, so broadcast is a local fan-out, not a pub/sub hop. Hibernation makes idle rooms
  free.
- **Natural blast-radius isolation.** One room's corrupt state cannot touch another; a single
  room can be reset without affecting others.
- **D1 stays thin.** The registry answers only "which room is this slug?" and "does this room
  exist?" — cheap, index-backed lookups. Q&A is never duplicated into D1, so there is no
  sync-drift surface between the registry and the authority.

See `decisions/0004-do-per-room.md` for the one-way-door self-argument.

## The assets-first / `run_worker_first` gotcha (load-bearing)

With Static Assets + `not_found_handling: single-page-application`, a browser **navigation**
request (`Accept: text/html`, `Sec-Fetch-Mode: navigate`) to a non-file path is served
`index.html` by the asset layer **without invoking the Worker**. A bare `curl` (`Accept: */*`)
skips that SPA heuristic, reaches the Worker, and can pass a health check while real browsers
get the wrong response — a silent soft-serve bug that curl lies green about.

Mitigation, already in `wrangler.jsonc`:

```jsonc
"assets": {
  "binding": "ASSETS",
  "not_found_handling": "single-page-application",
  "run_worker_first": ["/api/*", "/integrations/*", "/mcp", "/mcp/*"]
}
```

`run_worker_first` forces every Worker-owned path to the Worker before the asset layer. Rules:

- Any new Worker-owned path (new API prefix, new boundary) MUST be added to `run_worker_first`
  in the same change, or the asset layer will shadow it for navigations.
- Regression-test these paths with real browser headers (`Accept: text/html` +
  `Sec-Fetch-Mode: navigate`), never with a bare curl — see `verification.md`.
- The Worker `notFound` handler serves the SPA shell only for non-`/api/` / non-`/integrations/`
  paths; unmatched API paths return a real JSON `404`, never the SPA shell (no soft-404).

## Rollback & recovery

- Worker: `wrangler rollback <version-id>` (<30s, no redeploy).
- Registry (D1): 30-day Time Travel (`wrangler d1 time-travel restore`).
- Room state: per-room DO; a single room can be reset in isolation.
- Prod is the only environment; no staging. Every deploy is reversible by the above.
