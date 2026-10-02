# Ask — Capability Matrix

Honest status for every capability. No unverified integration is called "live".

Status legend:

- **LIVE** — implemented in `apps/ask/worker` and exercised by the running service.
- **ADAPTER+CONTRACT-TESTS-ONLY** — the contract/shape exists (Zod in `packages/contracts`,
  endpoint stub, or adapter), tests target it, but it is NOT yet live-verified end to end.
- **PLANNED** — specified in the data model and/or routed, but not implemented; the endpoint
  returns an honest `501` where one exists.

Source of truth: `packages/contracts/src/index.ts`, `apps/ask/worker/index.ts`,
`apps/ask/worker/room.ts`, `apps/ask/migrations/0001_init.sql`, `apps/ask/wrangler.jsonc`.

## Core room lifecycle

| Capability | Status | Where | Notes |
|---|---|---|---|
| Create room (generated memorable slug) | LIVE | `POST /api/v1/rooms`, `slugs.ts` | Word-dictionary slug, offensive + reserved screen. |
| Claim a specific slug | LIVE | `POST /api/v1/rooms` with `slug` | Atomic claim via `slugs.slug` PRIMARY KEY; collision opens the existing room, never transfers ownership. |
| Room snapshot (authorized) | LIVE | `GET /api/v1/rooms/:id` | Private rooms return `{access:'denied'}` to non-owners. |
| Rename room (slug change, id immutable) | LIVE | `PATCH /api/v1/rooms/:id/settings` | Old slug becomes an `alias`. Owner only. |
| Immutable room id independent of slug | LIVE | `ids.ts`, D1 `rooms` | `rm_<hex>`; slug is cosmetic + reroutable. |
| Room creation state (provisional/active/expired) | LIVE (active only) | `Room.creationState` | Only `active` is produced today; provisional/expired reserved. |

## Questions & answers

| Capability | Status | Where | Notes |
|---|---|---|---|
| Publish questions in a dedup batch | LIVE | `POST /api/v1/rooms/:id/questions:batch` | Dedup by `dedupKey` (UNIQUE); returns created + deduped counts. |
| Question kinds (single/multiple/text/number/range/link/image_comparison) | LIVE (shape) | `QuestionKind` | All kinds accepted + stored; rich per-kind UI is SPA-side and evolving. |
| Question metadata (context, consequence, recommendation, class, horizon, category) | LIVE | `Question` | Stored verbatim; `recommendation` is never pre-selected as the answer. |
| Append an answer revision (no account, public room) | LIVE | `POST /api/v1/rooms/:id/questions/:qid/answers` | Append-only; sets question `state=answered`; original question preserved. |
| Answer values (choice/text/number/link/delegate/skip) | LIVE | `AnswerValue` | Discriminated union; `delegate` is scoped to that decision. |
| Answer supersede chain | LIVE (field) | `AnswerRevision.supersedes` | Field honored on write; revision counter increments per question. |
| Decision interpretation layer (normalized meaning) | PLANNED | `Decision` | Schema defined; no server derivation of decisions yet. |

## Agents & receipts

| Capability | Status | Where | Notes |
|---|---|---|---|
| Agent enrollment | LIVE | `POST /api/v1/rooms/:id/agents` | Returns `installId` + scoped token; trust fixed at `public_contributor`. |
| Scoped bearer token verification | LIVE | `Authorization: Bearer <installId>.<token>` | SHA-256 token hash stored; verified in the DO. No admin power. |
| Application receipts (downloaded/applied/verified) | LIVE | `POST /api/v1/rooms/:id/receipts` | Requires agent auth; advances the answer's status; relative paths only. |
| `creator_bound` agent trust | PLANNED | `AgentTrust` | Only `public_contributor` is issued today. |

## Real-time

| Capability | Status | Where | Notes |
|---|---|---|---|
| Cursor delta feed | LIVE | `GET /api/v1/rooms/:id/changes` | Returns events since cursor + `snapshotRequired` when the window moved. |
| WebSocket live events (hibernation) | LIVE | `GET /api/v1/rooms/:id/events` | Upgrade forwarded to the DO; `acceptWebSocket` hibernation. |
| Reconnect replay (`resume`/`ping`) | LIVE | `room.ts` `webSocketMessage` | `resume` replays from `lastSeq`; `ping`→`pong`. |
| Visibility epoch fencing on sockets | LIVE | `room.ts` `broadcast`/`setVisibility` | Private broadcast only to current-epoch sockets; non-authorized sockets closed on going private. |

## Privacy & discovery

| Capability | Status | Where | Notes |
|---|---|---|---|
| `noindex` on every response | LIVE | `index.ts` middleware (`X-Robots-Tag`) | Plus `no-store` on `/api/*`. |
| No public directory / sitemap | LIVE | by omission | Nothing lists rooms; see `privacy.md`. |
| `robots.txt` disallow + meta robots | ADAPTER+CONTRACT-TESTS-ONLY | SPA assets | Header is live; static `robots.txt` + meta tag ship with the SPA (verify in `verification.md`). |

## Private rooms, auth & billing (Increment 3)

| Capability | Status | Where | Notes |
|---|---|---|---|
| Visibility change (public↔private) | LIVE (mechanism) | `room.ts` `setVisibility` | DO method + epoch bump exist; no owner-facing route wired yet. |
| Shared-auth login (OAuth/OIDC + PKCE vs projectsites.dev) | ADAPTER+CONTRACT-TESTS-ONLY | `SHARED_AUTH_ISSUER` var | Issuer verified to expose AS metadata; adapter + contract tests planned, not live. See `auth-integration.md`. |
| Better Auth | PLANNED (dark) | — | `better_auth` default off; do NOT depend on it. |
| Stripe checkout for a private page | PLANNED | `POST /api/v1/rooms/:id/checkout` | Returns `501 billing_not_configured` until `STRIPE_SECRET_KEY` + `STRIPE_PRICE_ID` set. |
| Stripe webhook (verified, idempotent) | PLANNED | `POST /api/billing/stripe/webhook` | Returns `501`; D1 `billing_events` inbox table exists. |
| Entitlement vs requested-visibility separation | LIVE (schema) | `BillingRecord`, D1 `billing` | Separate columns; a lapse never flips visibility to public. |
| 7-day grace → private read-only | PLANNED | `EntitlementState`, `billingGraceDays=7` | States defined; enforcement ships with billing. |

## Protocol surfaces

| Capability | Status | Where | Notes |
|---|---|---|---|
| Health check | LIVE | `GET /api/health` | `{status:'ok', service, version, api}`. |
| Integration manifest | LIVE | `GET /integrations/manifest.json` | Hosts listed; only Claude Code + generic HTTP marked `verified:true`; `files[]` empty until Increment 2. |
| Native MCP | PLANNED | `/mcp` | Returns `501 mcp_not_yet_available` (Increment 4). |
| RFC7807-style errors | LIVE | `ApiError`, `err()` | `{error, code, details?, requestId}`; room content never leaks into errors. |

## Enrichment (Increment 5)

| Capability | Status | Notes |
|---|---|---|
| R2 (image-comparison assets, exports) | PLANNED | No R2 binding yet. |
| Queues / Workflows (async fan-out, digests) | PLANNED | Not bound. |
| Workers AI (clustering, summarization) | PLANNED | Not bound; will ship behind a flag + evals. |

## What Increment 1 actually delivers (summary)

The full free loop works end to end: an agent can enroll, publish a deduplicated batch of
questions, a human can answer them in a room identified by a memorable slug with no account,
the agent can read answers via snapshot + cursor delta + WebSocket and post application
receipts, and nothing is indexed. Private rooms, shared-auth login, Stripe billing, native
MCP, and all R2/Queues/Workflows/Workers-AI enrichment are NOT in Increment 1 — the endpoints
that exist for them answer honestly with `501` and a note naming the increment.
