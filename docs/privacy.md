# Ask — Privacy

Ask is built so rooms are shared by link, never found by search, and private content fails
closed.

## Discovery is off everywhere

- **`noindex` on every response.** The Worker sets `X-Robots-Tag: noindex, nofollow` on all
  responses (LIVE, `worker/index.ts` middleware).
- **`robots.txt` disallow + meta robots.** The SPA ships a disallow-all `robots.txt` and a
  `<meta name="robots" content="noindex, nofollow">` in the shell (verify in `verification.md`).
- **No public directory, no sitemap.** Nothing lists rooms. There is no index page of rooms, no
  `sitemap.xml`, no search surface — by omission, deliberately.
- A public room is still public (anyone with the link can view and answer) — "public" means
  unlisted-and-shareable, not indexed.

## What a room is visible to

- **Public room:** anyone with the URL can read it and append answers; no account required.
- **Private room (Increment 3):** only the entitled owner can read it; non-owners get
  `{access:'denied'}` from the snapshot and a `403` on the WebSocket. Visibility changes bump a
  monotonic epoch that immediately fences stale sockets (`protocol.md` § visibility epoch).

## Identity & what is stored

- The anonymous owner is identified only by `SHA-256(host-only session cookie)`; the raw cookie
  is never stored or returned. The cookie is `HttpOnly`, `SameSite=Lax`, host-only, `Secure` on
  HTTPS.
- Agent tokens are stored only as SHA-256 hashes.
- Participant handles and self-reported agent names are display-only and never proof of identity.

## Data minimization in receipts

- Application receipts carry **relative paths only** — never absolute filesystem paths and never
  private diffs by default. `affectedPaths` is capped and relative; `commitRef` is optional.
- The server never inspects a repository. `verified` status is agent-reported trust, not a
  server claim about your code.

## No content leakage in errors

- Errors are `{error, code, details?, requestId}`. Room content never appears in an error body;
  a private room returns a minimal access-state to the unauthorized, never its questions or
  answers.

## Billing privacy fails closed (Increment 3)

- Requested-visibility and paid-entitlement are separate. **A billing lapse NEVER flips a
  private room to public** — after a 7-day grace it becomes private read-only
  (`decisions/0005-stripe-per-page.md`). The worst case of a payment failure is loss of write
  access, never exposure.

## Retention

- `retentionDays` exists on the room model for future enforcement; no automatic deletion runs in
  Increment 1. Room data lives in the room's Durable Object; registry rows live in D1.
