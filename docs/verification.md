# Ask — Verification (Acceptance Gate)

The acceptance-gate checklist. Every row has a Result column to fill from evidence — never mark a
row pass without running its check this session. A green deploy is NOT a working deploy; verify
live against `SERVICE_ORIGIN`.

Legend: Result ∈ { PASS / FAIL / N/A (increment) / TODO }. Fill Evidence with the command +
observed output (status, body, header).

## A. Build & static gates (local)

| # | Check | Command | Result | Evidence |
|---|---|---|---|---|
| A1 | Typecheck clean | `pnpm typecheck` | TODO | |
| A2 | Unit tests pass | `pnpm test` | TODO | |
| A3 | Prettier clean | `pnpm lint` | TODO | |
| A4 | Build succeeds | `pnpm build` | TODO | |
| A5 | Contracts import-only (SSOT) | grep hand-written types beside schemas → none | TODO | |

## B. Deploy & liveness

| # | Check | Expected | Result | Evidence |
|---|---|---|---|---|
| B1 | Deploy | `wrangler deploy` success + version id | TODO | |
| B2 | Health | `GET /api/health` → `200 {status:"ok",service,version,api}` | TODO | |
| B3 | Health is noindex | `X-Robots-Tag: noindex, nofollow` present | TODO | |
| B4 | SPA shell | `GET /` → `200`, root renders, 0 console errors | TODO | |

## C. The assets-first / run_worker_first gotcha (browser headers, not bare curl)

| # | Check | Expected | Result | Evidence |
|---|---|---|---|---|
| C1 | API path reaches Worker | `GET /api/health` with `Accept: text/html` + `Sec-Fetch-Mode: navigate` → JSON health, NOT the SPA shell | TODO | |
| C2 | Unknown API path is a real 404 | `GET /api/does-not-exist` → JSON `404 not_found` (not `index.html`) | TODO | |
| C3 | Room path serves SPA to a browser | navigation to `/<some-slug>` (`Accept: text/html`) → SPA shell `200` | TODO | |
| C4 | `/integrations/*` reaches Worker | `GET /integrations/manifest.json` → manifest JSON | TODO | |

## D. Core free loop (LIVE — Increment 1)

| # | Check | Expected | Result | Evidence |
|---|---|---|---|---|
| D1 | Create room | `POST /api/v1/rooms` → `201` canonical `Room` + adopt URL + `Set-Cookie: ask_sid` (HttpOnly, host-only) | TODO | |
| D2 | Generated slug is word-based | slug matches `^[a-z][a-z0-9]*(-[a-z0-9]+)*$`, not a UUID | TODO | |
| D3 | Claim taken user-slug opens existing | re-`POST` same `slug` → `200` existing room, `owned` reflects principal, no transfer | TODO | |
| D4 | Reserved slug rejected | `POST` with `slug:"admin"` → `400 invalid_slug` | TODO | |
| D5 | Enroll agent | `POST .../agents` → `201 {install, token}` | TODO | |
| D6 | Publish batch + dedup | `POST .../questions:batch` twice (same `dedupKey`) → `created` then `deduped` | TODO | |
| D7 | Answer (no account) | `POST .../questions/:qid/answers` → `201`; question `state=answered` | TODO | |
| D8 | Receipt requires agent auth | `POST .../receipts` without bearer → `401 agent_auth_required`; with bearer → `201` | TODO | |
| D9 | Receipt advances answer status | after receipt, answer `status` reflects posted status | TODO | |
| D10 | Rename (owner) | `PATCH .../settings {slug}` as owner → `200`; old slug becomes alias | TODO | |
| D11 | Rename (non-owner) | same from a different cookie → `403 forbidden` | TODO | |
| D12 | Snapshot | `GET .../:id` → `RoomSnapshot` with questions/answers/receipts/agents + cursor + viewerRole | TODO | |

## E. Real-time & reconnect (LIVE)

| # | Check | Expected | Result | Evidence |
|---|---|---|---|---|
| E1 | Delta feed | `GET .../changes?cursor=0` → events + cursor | TODO | |
| E2 | WS connect | `GET .../events` (Upgrade) → `101`, first frame `{type:"hello",cursor,epoch}` | TODO | |
| E3 | WS live event | answer in another client → `{type:"event",event}` received | TODO | |
| E4 | WS resume | send `{type:"resume",lastSeq}` → `{type:"replay",events}` after lastSeq | TODO | |
| E5 | WS ping | send `{type:"ping"}` → `{type:"pong"}` | TODO | |
| E6 | snapshotRequired | cursor older than retained window → `changes` sets `snapshotRequired:true` | TODO | |

## F. Privacy & discovery (LIVE)

| # | Check | Expected | Result | Evidence |
|---|---|---|---|---|
| F1 | noindex everywhere | spot-check several routes → `X-Robots-Tag: noindex, nofollow` | TODO | |
| F2 | API no-store | `/api/*` responses carry `Cache-Control: no-store` | TODO | |
| F3 | robots.txt | `GET /robots.txt` → disallow-all | TODO | |
| F4 | meta robots in shell | `GET /` HTML contains `<meta name="robots" content="noindex...">` | TODO | |
| F5 | No public directory | no route lists rooms; no `sitemap.xml` | TODO | |
| F6 | Errors leak no content | private/forbidden responses contain no question/answer text | TODO | |

## G. Private rooms, auth & billing (Increment 3 — expect N/A until built)

| # | Check | Expected | Result | Evidence |
|---|---|---|---|---|
| G1 | Visibility change fences sockets | going private closes non-owner sockets (`4403`), bumps epoch | N/A (Incr 3) | |
| G2 | Private snapshot denied | non-owner `GET .../:id` on private room → `{access:"denied"}` | N/A (Incr 3) | |
| G3 | Shared-auth round trip | authorize→token→cookie→owner against the issuer succeeds | N/A (Incr 3) | |
| G4 | No Better Auth dependency | `better_auth` off; no path requires it | TODO | |
| G5 | Checkout honest when unconfigured | `POST .../checkout` without Stripe env → `501 billing_not_configured` | TODO | |
| G6 | Webhook honest when unconfigured | `POST /api/billing/stripe/webhook` → `501` | TODO | |
| G7 | Lapse never flips public | simulate lapse → grace → `read_only`, never `public` | N/A (Incr 3) | |

## H. Protocol surface honesty

| # | Check | Expected | Result | Evidence |
|---|---|---|---|---|
| H1 | MCP honest 501 | `GET /mcp` → `501 mcp_not_yet_available` | TODO | |
| H2 | Manifest verified flags | only Claude Code + generic HTTP are `verified:true`; others `false` | TODO | |
| H3 | Manifest files[] | empty until Increment 2 (no fake pinned artifacts) | TODO | |
| H4 | Request id on errors | every error body carries `requestId` matching `X-Request-Id` | TODO | |

## I. Accessibility & UI (per changed surface)

| # | Check | Expected | Result | Evidence |
|---|---|---|---|---|
| I1 | axe-core 0 violations | Playwright + axe on room UI at 6 breakpoints | TODO | |
| I2 | Screenshots captured | per-surface screenshots at 375/390/768/1024/1280/1920 | TODO | |
| I3 | No console errors | 0 red console errors on load + interaction | TODO | |

## How to run

- Curl-only rows (health, status, create/answer round trip) run headless in seconds.
- Browser-header rows (section C, E WebSocket, F4, I) need real Chromium via Playwright against
  `PROD_URL = SERVICE_ORIGIN`.
- Any FAIL → fix-forward (max 3 redeploys) or `wrangler rollback`, then re-run the row. Do not
  mark DONE with an un-run or failing row.
