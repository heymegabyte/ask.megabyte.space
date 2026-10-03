# Ask — Auth Integration

Two identity layers. The anonymous owner model is LIVE (Increment 1). Shared OAuth login is
Increment 3 — built as an adapter + contract tests first, NOT yet live-verified. Nothing below
describes shared-auth as live until `verification.md` records evidence.

## Layer 1 — anonymous owner (LIVE)

- The first unauthenticated `POST /api/v1/rooms` (or any principal-resolving request) mints a
  session cookie `ask_sid`: host-only (no `Domain`), `HttpOnly`, `SameSite=Lax`, `Secure` on
  HTTPS, ~400-day max-age.
- The **owner principal is `SHA-256(ask_sid)`**. Only the hash is stored (D1
  `rooms.owner_principal`); the raw capability is never persisted or returned in a body.
- Owner vs guest is resolved per request by comparing the hashed cookie to the room's stored
  owner principal. Owner-only actions: rename (`PATCH .../settings`), and (Increment 3)
  checkout + visibility change.
- This layer stays as the baseline even after shared login ships — shared auth layers on top of
  it for private rooms; it does not replace it.

## Layer 2 — agent identity (LIVE)

- `POST /api/v1/rooms/:id/agents` enrolls an agent and returns `{ install, token }`.
- The agent sends `Authorization: Bearer <installId>.<token>` on receipts (required) and may
  send it when publishing questions (to stamp authorship). The DO verifies the SHA-256 token
  hash.
- Agent auth authorizes receipts and stamps authored questions. It confers NO admin power — an
  enrolled agent cannot rename, change visibility, or read a private room it isn't entitled to.
- A self-reported `agent` name is never proof of identity; the token is.

## Layer 3 — shared OAuth login (Increment 3, ADAPTER + CONTRACT-TESTS-ONLY)

For private-room ownership tied to a real account.

- **Issuer: `https://projectsites.dev`** (`SHARED_AUTH_ISSUER`). Verified this session to be an
  OAuth 2.1 AS: metadata at `/.well-known/oauth-authorization-server`, endpoints
  `/oauth/authorize`, `/oauth/token`, `/oauth/register`, PKCE S256.
- **Identity = issuer + subject.**
- **Flow (planned):** standard redirect OAuth/OIDC with PKCE (S256):
  1. Client → `/oauth/authorize` with `code_challenge` (S256), redirect URI, state.
  2. Issuer redirects back with an auth code.
  3. Worker exchanges the code at `/oauth/token` with the `code_verifier`.
  4. Worker sets a **host-only Ask session cookie** representing issuer+subject; the room's owner
     becomes that identity.
- **Do NOT depend on Better Auth.** It is dark-flagged (`better_auth` default off). No code path
  may require it.
- Build behind a provider interface so the login backend is swappable without touching room
  logic.

### Status honesty

"Issuer exposes AS metadata" ≠ "login works." Until the adapter is live-verified (full
authorize→token→cookie→owner round trip against the issuer, recorded in `verification.md`),
every doc lists shared-auth as ADAPTER+CONTRACT-TESTS-ONLY, never LIVE.

## What each layer can do

| Action                       | Anonymous owner   | Agent token    | Shared-auth owner (planned) |
| ---------------------------- | ----------------- | -------------- | --------------------------- |
| Answer a public room         | yes (any visitor) | n/a            | yes                         |
| Publish questions            | —                 | yes (stamped)  | —                           |
| Post receipts                | —                 | yes (required) | —                           |
| Rename room                  | yes (owner)       | no             | yes (owner)                 |
| Make room private / checkout | — (Increment 3)   | no             | yes (owner)                 |
| Read a private room          | owner only        | no             | entitled owner only         |
