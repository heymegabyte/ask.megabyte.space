# Ask — Protocol

The wire contract for Ask. Every transport (web client, Worker REST, future MCP, agent helper)
imports the Zod schemas in `packages/contracts/src/index.ts` and infers its types from them —
no type is hand-maintained beside a schema. `API_VERSION = "v1"`, `PROTOCOL_VERSION = 1`.

## Identifiers

Opaque, prefixed, independent of the human-facing slug so a rename never changes identity.

- `rm_<20-32 hex>` — room · `q_` question · `a_` answer · `d_` decision · `rcpt_` receipt
- `p_` participant · `ai_` agent installation · `e_` event
- **Slug** — lowercase word-based, hyphen-joined, 3–63 chars, must look intentional (never a
  UUID). Generated from curated dictionaries; uniqueness enforced in storage.

Reserved slugs (cannot be claimed): `api`, `integrations`, `assets`, `static`, `health`,
`robots.txt`, `sitemap.xml`, `favicon.ico`, `login`, `logout`, `auth`, `oauth`, `callback`,
`billing`, `webhook(s)`, `admin`, `new`, `about`, `privacy`, `terms`, `docs`, `mcp`, `sse`,
`_app`, `well-known`.

## Limits (starting defaults — documented, not permanent)

- Answer text: 16 KiB · Question context: 4 KiB · Questions per batch: 25
- Slug: 3–63 chars · Min active-agent poll interval: 15 s · Billing grace: 7 days

## Entities

- **Room** — `id`, `slug`, `creationState`, `visibility`, `visibilityEpoch` (monotonic; bumps on
  privacy change), `entitlement`, `hasOwnerClaim`, `revision` (room-wide event high-water mark),
  `retentionDays?`, timestamps. The DO is authoritative; D1 never overrides it.
- **SlugMapping** — `slug → roomId`, `status` (`active` | `alias` | `provisional`). Renames leave
  the old slug as an `alias` (redirect honoring current privacy).
- **Participant** — `id`, `type`, self-selected `handle` (never proof of identity), `role`,
  `connected`, `lastSeenAt`. Derived live from connected sockets.
- **AgentInstallation** — `id`, self-reported `agent`/`version` (not authoritative), `trust`
  (`public_contributor` today), optional `branch`/`task`, `status`, `features`, `lastSeenAt`.
- **Question** — `id`, `dedupKey` (stable; dedup key), `kind`, `title`, `context?`,
  `consequence?`, `category`, `klass` (`blocker`/`decision`/`opportunity`), `horizon`
  (`now`/`next`/`later`), `options[]`, `numberConstraint?`, `recommendation?` (never
  pre-selected), `blocksWork`, `state` (`open`/`answered`/`dismissed`/`superseded`), `revision`.
- **AnswerRevision** — `id`, `questionId`, `authorClass`, `authorHandle?`, `value?`, `text?`,
  `supersedes?` (append-only chain), `status`, `revision`. Posting an answer sets the question
  `answered` without mutating the original question.
- **Decision** (PLANNED) — normalized meaning derived from one or more answers.
- **ApplicationReceipt** — `id`, `installId`, `questionId`, `answerId`, `state`
  (`received`/`considered`/`applied`), `status`, `decisionSummary?`, `affectedPaths[]` (relative
  paths only — never absolute paths or private diffs), `commitRef?`, `validation?`.
- **RoomEvent** — `id`, `seq` (monotonic), `type`, `schemaVersion`, `entityRevision`, `payload`,
  `at`. The ordered spine of the room.
- **BillingRecord** — `roomId`, `customerId?`, `subscriptionId?`, `entitlement`,
  `requestedVisibility` (separate from visibility — a lapse never flips to public), `paidThrough?`,
  `graceUntil?`.

### Answer value shapes (`AnswerValue`, discriminated on `kind`)

- `choice` → `{ selected: string[] }` · `text` → `{ text }` · `number` → `{ value }`
- `link` → `{ url }` · `delegate` → scoped to this decision · `skip`

### Answer status lifecycle (`AnswerStatus`)

`answer_saved` (server committed) → `agent_downloaded` (an enrolled agent stored that exact
revision) → `applied_to_project` (files/behavior changed) → `verified` (agent-reported, not
server-inspected). Side states: `needs_clarification`, `superseded`, `deferred`,
`could_not_apply`. The server never inspects a repo — `verified` is agent-reported trust.

## HTTP route table (`/api/v1`)

All `/api/*` responses carry `X-Request-Id` and `Cache-Control: no-store`; every response
carries `X-Robots-Tag: noindex, nofollow`.

| Method | Path | Auth | Purpose | Status |
|---|---|---|---|---|
| GET | `/api/health` | none | Liveness `{status,service,version,api}` | LIVE |
| POST | `/api/v1/rooms` | session cookie | Create or (on user-chosen-slug collision) open a room | LIVE |
| GET | `/api/v1/rooms/:id` | session cookie | Room snapshot; private→`{access:'denied'}` for non-owner | LIVE |
| GET | `/api/v1/rooms/:id/changes?cursor=` | none (public room) | Cursor delta feed | LIVE |
| POST | `/api/v1/rooms/:id/agents` | none (rate-limited) | Enroll an agent → `{install, token}` | LIVE |
| POST | `/api/v1/rooms/:id/questions:batch` | optional agent bearer | Publish deduplicated questions | LIVE |
| POST | `/api/v1/rooms/:id/questions/:qid/answers` | session cookie | Append an answer revision | LIVE |
| POST | `/api/v1/rooms/:id/receipts` | agent bearer (required) | Record retrieval/application evidence | LIVE |
| PATCH | `/api/v1/rooms/:id/settings` | owner | Rename (slug change) | LIVE |
| POST | `/api/v1/rooms/:id/checkout` | owner | Start Stripe checkout for a private page | 501 (Increment 3) |
| GET | `/api/v1/rooms/:id/events` | session cookie (WS upgrade) | WebSocket live feed | LIVE |
| POST | `/api/billing/stripe/webhook` | Stripe signature | Billing inbox (verified + idempotent) | 501 (Increment 3) |
| GET | `/integrations/manifest.json` | none | Versioned integration manifest | LIVE |
| ALL | `/mcp`, `/mcp/*` | — | Native MCP | 501 (Increment 4) |

Note on `claim`/`context-requests` routes: the route constants exist in `ROUTES`
(`/rooms/:id/claim`, `/rooms/:id/context-requests`) but are not yet wired as handlers — treat
them as PLANNED surface, not live endpoints.

### Identity model (what auth means today)

- **Anonymous owner** — the first unauthenticated POST mints a host-only, `HttpOnly`,
  `SameSite=Lax`, ~400-day session cookie (`ask_sid`). The owner principal is `SHA-256(cookie)`;
  only the hash is stored. Owner vs guest is resolved per request. This is Increment 1 — shared
  OAuth login (`auth-integration.md`) is Increment 3 and layers on top, it does not replace this.
- **Agent** — `Authorization: Bearer <installId>.<token>`. The DO verifies the token hash.
  Agent auth stamps authored questions and authorizes receipts; it grants NO admin power.
- A self-reported `agent` name or participant `handle` is never proof of identity.

### Errors

RFC7807-ish: `{ error, code, details?, requestId }`. Common codes: `invalid_request`,
`invalid_slug`, `slug_conflict`/`slug_taken` (409), `room_not_found` (404), `forbidden` (403),
`agent_auth_required` (401), `expected_websocket` (426), `billing_not_configured` /
`mcp_not_yet_available` / `not_implemented` (501), `could_not_allocate_slug` (503). Room content
never appears in an error body.

## Event model

Every mutation appends exactly one `RoomEvent` to the DO's `events` table with an
AUTOINCREMENT `seq`, bumps the room `revision` to that `seq`, and broadcasts to live sockets.
`seq` is the single cursor for both the delta feed and WebSocket replay.

Event types: `room.created`, `room.renamed`, `room.visibility_changed`, `question.created`,
`question.updated`, `answer.created`, `answer.superseded`, `receipt.recorded`, `agent.enrolled`,
`agent.status`, `participant.joined`, `participant.left`.

Each event carries `entityRevision` (the revision of the entity it concerns) and
`schemaVersion` (`PROTOCOL_VERSION`) so consumers can tolerate forward schema growth.

## Real-time & reconnect semantics

### Delta feed (`GET .../changes?cursor=<seq>`)

Returns up to 500 events with `seq > cursor`, the new `cursor`, and `snapshotRequired: true`
when the requested cursor fell before the oldest retained event (the history window moved past
it). On `snapshotRequired`, the client must re-fetch the full snapshot and resubscribe from its
cursor.

### WebSocket (`GET .../events`, Upgrade: websocket)

1. The Worker resolves the viewer role (owner/guest), rejects a non-owner on a private room
   (`403`), and forwards the upgrade to the DO.
2. On accept the DO sends `{type:'hello', cursor, epoch}` and records `participant.joined`.
   The socket is accepted with hibernation (`acceptWebSocket`) so idle rooms cost nothing.
3. Server→client frames: `{type:'event', event}` for each new event; `{type:'replay', events}`
   in response to a resume; `{type:'pong'}` in response to a ping.
4. Client→server messages: `{type:'resume', lastSeq}` → the DO replays events after `lastSeq`;
   `{type:'ping'}` → `pong`. Unknown/non-string messages are ignored.

### Reconnect recipe

On reconnect send `{type:'resume', lastSeq:<last seq seen>}`. If the replay indicates the
window advanced past `lastSeq` (same signal as `changes` `snapshotRequired`), fetch a fresh
snapshot and resubscribe from the snapshot's cursor. Treat the snapshot `cursor` and every
event `seq` as the same monotonic space.

### Visibility epoch (privacy fencing)

Each socket records the room's `visibilityEpoch` at connect. Changing visibility increments the
epoch, emits `room.visibility_changed`, and — when going private — closes every socket that is
not an authorized role with close code `4403`. Broadcast on a private room delivers only to
sockets whose recorded epoch equals the current epoch, so a stale pre-privacy socket can never
receive post-privacy events.
